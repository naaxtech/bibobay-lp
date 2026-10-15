import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// lib/leads/dependencies (the consent-version rule) is server-only.
vi.mock("server-only", () => ({}));

import { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY, ORDER_STATUSES } from "@/lib/orders/constants";
import { CONSENT_VERSION_PATTERN } from "@/lib/leads/dependencies";
import { COUNTRY_PATTERN, ORDER_LIMITS, ORDER_LINE_LIMITS, PHONE_MIN_LENGTH, PHONE_PATTERN, POSTAL_CODE_PATTERN } from "@/lib/orders/fields";

/*
 * Static policy gate for the order migrations (0002-0005), like tests/leads/migration-policy.test.ts
 * for 0001: it reads the SQL as text, so it runs anywhere without a database. The migrations and
 * their pgTAP files are then executed in tests/orders/migration-database.test.ts.
 */
const ORDER_MIGRATIONS = [
  "0002_orders.sql",
  "0003_order_tracking.sql",
  "0004_lock_tracking_payload.sql",
  "0005_shared_rate_limits_and_token_rotation.sql",
] as const;

function readSql(path: string) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`${path} does not exist yet`);
  return readFileSync(full, "utf8").replaceAll("\r\n", "\n");
}

/** SQL with `--` comments removed and whitespace collapsed, lower-cased for matching. */
const normalized = (sql: string) => sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

const each = Object.fromEntries(ORDER_MIGRATIONS.map((file) => [file, normalized(readSql(`supabase/migrations/${file}`))])) as Record<(typeof ORDER_MIGRATIONS)[number], string>;
const all = ORDER_MIGRATIONS.map((file) => each[file]).join("\n");

interface FunctionDefinition { name: string; header: string; body: string }

function functionsIn(sql: string): FunctionDefinition[] {
  const pattern = /create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g;
  return Array.from(sql.matchAll(pattern), (match) => ({ name: match[1]!, header: match[2]!, body: match[4]! }));
}

const tablesIn = (sql: string) => Array.from(sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g), (match) => match[1]!);

const rolesIn = (sql: string, verb: "revoke" | "grant", name: string) =>
  Array.from(
    sql.matchAll(new RegExp(`${verb} (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) ${verb === "revoke" ? "from" : "to"} ([^;]+);`, "g")),
    (match) => match[1]!.split(",").map((role) => role.trim()),
  ).flat();

/** The text of one `create table public.<name> (...)` statement. */
function tableDefinition(sql: string, table: string) {
  const match = sql.match(new RegExp(`create table (?:if not exists )?public\\.${table} \\((.*?)\\);`));
  if (!match) throw new Error(`no create table for ${table}`);
  return match[1]!;
}

const TABLES = ["orders", "order_items", "order_events", "order_email_outbox"];
const RPCS = ["submit_order", "lookup_order_by_token", "lookup_order_by_reference_email", "rotate_order_tracking_token"];
const INTERNAL = ["order_tracking_payload", "order_tracking_token_hash", "issue_order_tracking_token"];

describe("order migrations: every file", () => {
  it.each(ORDER_MIGRATIONS)("%s stops unless it runs as a role that bypasses row level security", (file) => {
    expect(each[file]).toMatch(/do \$guard\$ begin if not exists \( select 1 from pg_catalog\.pg_roles r where r\.rolname = current_user and \(r\.rolbypassrls or r\.rolsuper\) \) then raise exception/);
  });

  it("grants nothing to anon, authenticated or public, and creates no row policies or default privileges", () => {
    expect(all).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
    expect(all).not.toMatch(/\bcreate policy\b/);
    expect(all).not.toMatch(/\balter default privileges\b/);
  });

  it("stores no raw IP address and no child data", () => {
    expect(all).not.toMatch(/\b(ip|ip_address|client_ip|remote_addr)\b|\binet\b/);
    expect(all).not.toMatch(/child_name|child_age|birthday|birth_date|date_of_birth|\bschool\b|photo|voice|health/);
  });
});

describe("order migrations: tables", () => {
  it("creates the four order tables of spec §11, and no second rate-limit table (R79)", () => {
    expect(tablesIn(all).sort()).toEqual([...TABLES].sort());
    expect(tablesIn(each["0005_shared_rate_limits_and_token_rotation.sql"])).toEqual([]);
    expect(each["0005_shared_rate_limits_and_token_rotation.sql"]).toContain("consume_rate_limit");
  });

  it("enables AND forces row level security on every order table", () => {
    for (const table of TABLES) {
      expect(all, `${table}: enable`).toContain(`alter table public.${table} enable row level security`);
      expect(all, `${table}: force`).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("revokes every table privilege from public, anon, authenticated and service_role (RPC access only)", () => {
    for (const table of TABLES) {
      const match = all.match(new RegExp(`revoke all on (?:table )?public\\.${table} from ([^;]+);`));
      expect(match, `${table}: revoke`).not.toBeNull();
      expect(match![1]!.split(",").map((role) => role.trim()).sort(), table).toEqual(["anon", "authenticated", "public", "service_role"]);
    }
  });

  it("checks the order status against exactly the Task 6 statuses", () => {
    const orders = tableDefinition(all, "orders");
    const statuses = orders.match(/constraint orders_status_values check \(status in \(([^)]*)\)\)/);
    expect(statuses, "orders.status check").not.toBeNull();
    expect(statuses![1]!.split(",").map((value) => value.trim().replace(/'/g, ""))).toEqual([...ORDER_STATUSES]);
  });

  it("bounds a line's quantity by the order pad's limit", () => {
    expect(tableDefinition(all, "order_items")).toContain(`check (quantity between 1 and ${ORDER_PAD_MAX_QUANTITY})`);
    expect(tableDefinition(all, "order_items")).toContain(`check (line_number between 1 and ${ORDER_PAD_MAX_LINES})`);
  });

  it("bounds every contact, address and notes column by the limits the server validates", () => {
    const orders = tableDefinition(all, "orders");
    for (const [column, limit] of [
      ["contact_name", ORDER_LIMITS.contactName],
      ["email", ORDER_LIMITS.email],
      ["phone", ORDER_LIMITS.phone],
      ["address_line1", ORDER_LIMITS.addressLine],
      ["address_line2", ORDER_LIMITS.addressLine],
      ["city", ORDER_LIMITS.city],
      ["region", ORDER_LIMITS.region],
      ["postal_code", ORDER_LIMITS.postalCode],
      ["notes", ORDER_LIMITS.notes],
    ] as const) {
      expect(orders, column).toMatch(new RegExp(`char_length\\(${column}\\) between \\d+ and ${limit}\\b`));
    }
  });

  it("checks phone, postal code, country and consent version exactly as the server does (review Minor 3)", () => {
    // The raw file: the normalized text is lower-cased, and these patterns are case-sensitive.
    const orders = readSql("supabase/migrations/0002_orders.sql");
    expect(orders).toContain(`char_length(phone) between ${PHONE_MIN_LENGTH} and ${ORDER_LIMITS.phone}`);
    expect(orders).toContain(`phone ~ '${PHONE_PATTERN.source}'`);
    expect(orders).toContain(`postal_code ~ '${POSTAL_CODE_PATTERN.source}'`);
    expect(orders).toContain(`country ~ '${COUNTRY_PATTERN.source}'`);
    // The server accepts a CMS consent version of up to 40 characters; the column must too.
    expect(CONSENT_VERSION_PATTERN.test("v".repeat(40))).toBe(true);
    expect(CONSENT_VERSION_PATTERN.test("v".repeat(41))).toBe(false);
    expect(orders).toContain("check (char_length(consent_version) between 1 and 40)");
  });

  it("keeps retention metadata on each order, empty until a retention policy sets it (spec §11, review Minor 1)", () => {
    const orders = tableDefinition(all, "orders");
    expect(orders).toMatch(/ retain_until timestamptz,/);
    expect(all).not.toMatch(/retain_until\s*=/);
  });

  it("bounds every snapshot column by the limits the catalogue check applies", () => {
    const items = tableDefinition(all, "order_items");
    for (const [column, limit] of Object.entries({ title: ORDER_LINE_LIMITS.name, sku: ORDER_LINE_LIMITS.sku, variant: ORDER_LINE_LIMITS.variant, pack: ORDER_LINE_LIMITS.pack })) {
      expect(items, column).toMatch(new RegExp(`char_length\\(${column}\\) between 1 and ${limit}\\b`));
    }
  });

  it("snapshots the canonical product (spec §11 order_items) and records consent with its version and time", () => {
    const items = tableDefinition(all, "order_items");
    for (const column of ["order_id uuid not null references public.orders", "sanity_id text not null", "sku text", "title text not null", "variant text", "pack text", "quantity integer not null"]) {
      expect(items, column).toContain(column);
    }
    const orders = tableDefinition(all, "orders");
    expect(orders).toContain("consent_version text not null");
    expect(orders).toContain("consent_granted_at timestamptz not null default now()");
  });

  it("stores one order per submission key, so a retried request cannot become a second order (R81)", () => {
    const orders = tableDefinition(all, "orders");
    expect(orders).toContain("submission_key uuid not null");
    expect(orders).toContain("constraint orders_submission_key_key unique (submission_key)");
  });

  it("stores the tracking token only as a hash, with an expiry", () => {
    const orders = tableDefinition(all, "orders");
    expect(orders).toContain("tracking_token_hash text not null");
    expect(orders).toContain("tracking_token_expires_at timestamptz not null");
    expect(orders).not.toMatch(/(?:^|, )tracking_token text/);
  });

  it("keeps one outbox row per order and message kind, for the Task 8 worker", () => {
    const outbox = tableDefinition(all, "order_email_outbox");
    expect(outbox).toContain("unique (order_id, kind)");
    for (const column of ["attempts", "last_attempt_at", "next_attempt_at", "provider_message_id", "last_error_code"]) expect(outbox, column).toMatch(new RegExp(`\\b${column}\\b`));
  });
});

describe("order migrations: functions", () => {
  const functions = functionsIn(all);
  const names = [...new Set(functions.map((fn) => fn.name))].sort();

  it("defines the four service-role RPCs and three internal helpers", () => {
    expect(names).toEqual([...RPCS, ...INTERNAL].sort());
  });

  it("makes each RPC a security definer, and keeps every internal helper with its caller's rights", () => {
    for (const fn of functions) {
      if (RPCS.includes(fn.name)) expect(fn.header, fn.name).toContain("security definer");
      else expect(fn.header, fn.name).not.toContain("security definer");
    }
  });

  it("pins an empty search_path on every function", () => {
    for (const fn of functions) expect(fn.header, fn.name).toContain("set search_path = ''");
  });

  it("grants execute on each RPC to service_role and nobody else, after revoking it from public, anon and authenticated", () => {
    for (const name of RPCS) {
      expect(rolesIn(all, "grant", name), name).toEqual(["service_role"]);
      expect(rolesIn(all, "revoke", name), name).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    }
  });

  it("lets nobody but the owner run an internal helper, naming every role (not PUBLIC alone)", () => {
    for (const name of INTERNAL) {
      expect(rolesIn(all, "grant", name), name).toEqual([]);
      expect(new Set(rolesIn(all, "revoke", name)), name).toEqual(new Set(["public", "anon", "authenticated", "service_role"]));
    }
  });

  it("refers to every table by its schema-qualified name inside function bodies", () => {
    for (const fn of functions) {
      for (const table of [...TABLES, "rate_limit_buckets"]) expect(fn.body, `${fn.name} -> ${table}`).not.toMatch(new RegExp(`(?<![.\\w])${table}\\b(?!\\s*\\.)`));
    }
  });

  it("builds the tracking payload from the locked keys only: no address, email, notes, phone or price", () => {
    const payload = functions.find((fn) => fn.name === "order_tracking_payload");
    expect(payload).toBeDefined();
    const keys = Array.from(payload!.body.matchAll(/'(\w+)', /g), (match) => match[1]).sort();
    expect(keys).toEqual(["lines", "pack", "quantity", "reference", "status", "statuschangedat", "submittedat", "title", "variant"]);
    expect(payload!.body).not.toMatch(/\b(email|address_line1|address_line2|city|region|postal_code|country|notes|phone|contact_name|subtotal_minor|freight_minor|currency|payment_url|tracking_token_hash|sanity_id|sku)\b/);
  });

  it("checks the server's line limits inside submit_order as well", () => {
    const submit = functions.find((fn) => fn.name === "submit_order");
    expect(submit?.body).toContain(`not between 1 and ${ORDER_PAD_MAX_LINES}`);
    expect(submit?.body).toMatch(/raise exception 'consent is required'/);
    expect(submit?.body).toContain("insert into public.order_events");
    expect(submit?.body).toContain("insert into public.order_email_outbox");
  });

  it("takes the submission key as an argument and answers a repeat as a duplicate (R81)", () => {
    const submit = functions.find((fn) => fn.name === "submit_order");
    expect(submit?.header).toMatch(/p_submission_key uuid[,)]/);
    expect(submit?.header).toMatch(/returns table \([^)]*\bduplicate boolean\)/);
    // A concurrent repeat must not raise a unique violation: the insert yields to the first order.
    expect(submit?.body).toContain("on conflict (submission_key) do nothing");
  });

  it("names submit_order's new signature wherever 0004 proves its grants", () => {
    expect(each["0004_lock_tracking_payload.sql"]).toContain("public.submit_order(text, text, text, text, text, boolean, text, jsonb, uuid, text, text, text, text, text)");
  });

  it("verifies its own grants when the payload is locked (0004), so a regression fails the deploy", () => {
    const lock = each["0004_lock_tracking_payload.sql"];
    expect(lock).toMatch(/do \$verify\$/);
    expect(lock).toContain("has_function_privilege");
    expect(lock).toContain("has_table_privilege");
  });
});

describe("order pgTAP files", () => {
  for (const file of ["supabase/tests/0002_orders_rls.sql", "supabase/tests/0003_tracking_grants.sql"]) {
    it(`${file} is a self-contained pgTAP plan that rolls back`, () => {
      const sql = normalized(readSql(file));
      expect(sql).toMatch(/^ ?begin;/);
      expect(sql).toMatch(/select plan\(\d+\);/);
      expect(sql).toMatch(/select \* from finish\(\);\s*rollback;\s*$/);
      for (const probe of ["function_privs_are", "set local role anon", "set local role authenticated", "set local role service_role", "throws_ok"]) expect(sql, probe).toContain(probe);
    });
  }
});
