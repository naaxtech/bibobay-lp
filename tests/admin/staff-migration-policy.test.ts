import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// lib/orders/admin.ts (QUOTE_AMOUNT_MAX_MINOR) is server-only.
vi.mock("server-only", () => ({}));

import { ORDER_STATUSES, canTransitionOrder } from "@/lib/orders/constants";
import { PAYMENT_URL_MAX_LENGTH } from "@/lib/security/payment-url";
import { QUOTE_AMOUNT_MAX_MINOR } from "@/lib/orders/admin";

/*
 * Static policy gate for migration 0007 (Task 8b, rulings R95-R98), like
 * tests/orders/migration-policy.test.ts for 0002-0005: it reads the SQL as text, so it runs without
 * a database. The migration and supabase/tests/0005_staff_access.sql are executed in
 * tests/orders/migration-database.test.ts.
 */
function readSql(path: string) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`${path} does not exist yet`);
  return readFileSync(full, "utf8").replaceAll("\r\n", "\n");
}

/** SQL with `--` comments removed and whitespace collapsed, lower-cased for matching. */
const normalized = (sql: string) => sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

const sql = normalized(readSql("supabase/migrations/0007_staff_access.sql"));

interface FunctionDefinition { name: string; header: string; body: string }
const functions: FunctionDefinition[] = Array.from(
  sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g),
  (match) => ({ name: match[1]!, header: match[2]!, body: match[4]! }),
);

const STAFF_RPCS = ["staff_save_order_quote", "staff_queue_order_quote", "staff_advance_order_status", "staff_rotate_order_tracking_token"];
const ORDER_TABLES = ["orders", "order_items", "order_events", "order_email_outbox"];

const rolesIn = (verb: "revoke" | "grant", name: string) =>
  Array.from(
    sql.matchAll(new RegExp(`${verb} (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) ${verb === "revoke" ? "from" : "to"} ([^;]+);`, "g")),
    (match) => match[1]!.split(",").map((role) => role.trim()),
  ).flat();

describe("migration 0007: staff access (static)", () => {
  it("defines exactly is_active_staff and the four staff RPCs", () => {
    expect(functions.map((fn) => fn.name).sort()).toEqual(["is_active_staff", ...STAFF_RPCS].sort());
  });

  it("makes every function a security definer with an empty search path, executable by authenticated only", () => {
    for (const fn of functions) {
      expect(fn.header, fn.name).toMatch(/security definer/);
      expect(fn.header, fn.name).toMatch(/set search_path = ''/);
      expect(rolesIn("revoke", fn.name).sort(), fn.name).toEqual(["anon", "authenticated", "public", "service_role"]);
      expect(rolesIn("grant", fn.name), fn.name).toEqual(["authenticated"]);
    }
  });

  it("checks for active staff first in every staff RPC, and writes the event with the caller's own id", () => {
    for (const name of STAFF_RPCS) {
      const body = functions.find((fn) => fn.name === name)!.body;
      const begin = body.indexOf(" begin ");
      expect(body.slice(begin, begin + 120), name).toMatch(/^ begin if not public\.is_active_staff\(\) then raise exception 'staff only' using errcode = '42501'/);
      expect(body, name).toMatch(/insert into public\.order_events \([^)]*actor, actor_user_id[^)]*\) values \([^)]*'staff', auth\.uid\(\)/);
      // Never a user id passed in by the caller.
      expect(functions.find((fn) => fn.name === name)!.header, name).not.toMatch(/p_(?:actor|user)/);
    }
  });

  it("keeps staff_users closed: forced RLS, nothing granted but reading one's own row's three columns", () => {
    expect(sql).toMatch(/alter table public\.staff_users enable row level security;/);
    expect(sql).toMatch(/alter table public\.staff_users force row level security;/);
    expect(sql).toMatch(/revoke all on table public\.staff_users from public, anon, authenticated, service_role;/);
    expect(sql).toMatch(/create policy staff_users_read_own on public\.staff_users for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\);/);
    expect(Array.from(sql.matchAll(/grant ([^;]*) on public\.staff_users to ([^;]+);/g), (match) => [match[1], match[2]])).toEqual([["select (user_id, display_name, active)", "authenticated"]]);
    const definition = /create table if not exists public\.staff_users \((.*?)\);/.exec(sql)?.[1] ?? "";
    expect(definition).toMatch(/^ ?user_id uuid primary key references auth\.users \(id\) on delete cascade/);
    expect(definition).not.toMatch(/password|email|phone|token/);
  });

  it("gives staff a select policy and column grants on the order tables, for authenticated only, gated by is_active_staff", () => {
    const policies = Array.from(sql.matchAll(/create policy (\w+) on public\.(\w+) (for \w+) to (\w+) using \(([^;]*)\);/g), (match) => ({ name: match[1]!, table: match[2]!, command: match[3]!, role: match[4]!, using: match[5]! }));
    for (const table of ORDER_TABLES) {
      const policy = policies.filter((entry) => entry.table === table);
      expect(policy, table).toEqual([{ name: `${table}_staff_read`, table, command: "for select", role: "authenticated", using: "(select public.is_active_staff())" }]);
    }
    expect(sql).not.toMatch(/for (?:insert|update|delete|all) to/);
    expect(sql).not.toMatch(/grant (?:insert|update|delete|all|truncate|references|trigger)\b/);
  });

  it("never grants the tracking token hash, the submission key or the outbox's delivery internals", () => {
    const grants = Array.from(sql.matchAll(/grant select \(([^)]*)\) on public\.(\w+) to authenticated;/g), (match) => ({ table: match[2]!, columns: match[1]!.split(",").map((column) => column.trim()) }));
    const columns = (table: string) => grants.find((grant) => grant.table === table)?.columns ?? [];
    expect(columns("orders")).not.toContain("tracking_token_hash");
    expect(columns("orders")).not.toContain("submission_key");
    for (const hidden of ["provider_message_id", "idempotency_key", "unconfirmed_since", "claimed_at"]) expect(columns("order_email_outbox"), hidden).not.toContain(hidden);
    for (const table of ORDER_TABLES) expect(columns(table).length, table).toBeGreaterThan(0);
    expect(sql).not.toMatch(/grant [^;]* to (?:anon|service_role|public)\b/);
  });

  it("allows exactly the status steps lib/orders/constants.ts allows (R98)", () => {
    const body = functions.find((fn) => fn.name === "staff_advance_order_status")!.body;
    const allowed = new Set<string>();
    for (const match of body.matchAll(/\(p_from = '(\w+)' and p_to in \(([^)]*)\)\)/g)) {
      for (const to of match[2]!.split(",")) allowed.add(`${match[1]}->${to.trim().replaceAll("'", "")}`);
    }
    const expected = new Set<string>();
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) if (canTransitionOrder(from, to)) expected.add(`${from}->${to}`);
    expect([...allowed].sort()).toEqual([...expected].sort());
    // Optimistic: the status the staff member saw must still be the order's.
    expect(body).toMatch(/if v_order\.status <> p_from then raise exception 'stale' using errcode = '40001'/);
  });

  it("raises quote_revision in the same statement that changes the quote figures (Task 8a review M7)", () => {
    const save = functions.find((fn) => fn.name === "staff_save_order_quote")!.body;
    const updates = Array.from(save.matchAll(/update public\.orders as o set ([^;]*);/g), (match) => match[1]!);
    expect(updates).toHaveLength(1);
    for (const column of ["currency", "subtotal_minor", "freight_minor", "payment_url", "quote_revision"]) expect(updates[0], column).toMatch(new RegExp(`\\b${column} = `));
    // No other function in 0007 touches the quote figures.
    for (const fn of functions.filter((entry) => entry.name !== "staff_save_order_quote")) {
      for (const [, assignments] of fn.body.matchAll(/update public\.orders as o set ([^;]*?) where/g)) {
        expect(assignments, fn.name).not.toMatch(/\b(?:currency|subtotal_minor|freight_minor|payment_url|quote_revision) =/);
      }
    }
  });

  it("quotes and queues only while the order is new or confirmed (R96; 8a skips the rest as order_past_quote)", () => {
    for (const name of ["staff_save_order_quote", "staff_queue_order_quote"]) {
      expect(functions.find((fn) => fn.name === name)!.body, name).toMatch(/if v_order\.status not in \('new', 'confirmed'\) then raise exception 'order cannot be quoted' using errcode = '55000'/);
    }
    const queue = functions.find((fn) => fn.name === "staff_queue_order_quote")!.body;
    expect(queue).toMatch(/on conflict \(idempotency_key\) do nothing/);
    expect(queue).not.toMatch(/update public\.orders/);
  });

  it("bounds the figures and the link as the app does", () => {
    expect(QUOTE_AMOUNT_MAX_MINOR).toBe(100_000_000);
    const save = functions.find((fn) => fn.name === "staff_save_order_quote")!.body;
    expect(save).toContain(`p_subtotal_minor not between 0 and ${QUOTE_AMOUNT_MAX_MINOR}`);
    expect(save).toContain(`p_freight_minor not between 0 and ${QUOTE_AMOUNT_MAX_MINOR}`);
    expect(save).toContain(`char_length(p_payment_url) > ${PAYMENT_URL_MAX_LENGTH}`);
    // Three capital letters (the text is lower-cased for matching).
    expect(save).toContain("p_currency !~ '^[a-z]{3}$'");
    expect(sql).toContain(`subtotal_minor <= ${QUOTE_AMOUNT_MAX_MINOR}`);
  });

  it("never logs the payment link in an event (it may carry the provider's session id)", () => {
    const save = functions.find((fn) => fn.name === "staff_save_order_quote")!.body;
    const event = /'quote_saved', pg_catalog\.jsonb_build_object\(([^;]*)\)\);/.exec(save)?.[1] ?? "";
    expect(event).toContain("'revision'");
    expect(event).not.toMatch(/payment/);
  });

  it("guards the owner and the Auth schema, and never creates Auth objects itself", () => {
    expect(sql).toMatch(/r\.rolbypassrls or r\.rolsuper/);
    expect(sql).toMatch(/to_regclass\('auth\.users'\) is null or pg_catalog\.to_regprocedure\('auth\.uid\(\)'\) is null/);
    for (const migration of readdirSync(resolve("supabase/migrations"))) {
      expect(normalized(readSql(`supabase/migrations/${migration}`)), migration).not.toMatch(/create (?:schema|table|(?:or replace )?function) (?:if not exists )?auth\b/);
    }
  });
});
