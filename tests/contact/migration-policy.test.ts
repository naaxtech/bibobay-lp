import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTACT_LIMITS, CONTACT_TOPICS } from "@/lib/contact/fields";
import { CONTACT_DELIVERY_KINDS, OUTBOX_FINAL_FAILURE_CODES, OUTBOX_LIMITS, OUTBOX_STATUSES } from "@/lib/outbox/constants";

/*
 * Static policy gate for migration 0008 (the contact form; rulings R159, R169, R175), like the
 * 0001-0007 gates: it reads the SQL as text, so it runs anywhere without a database. The behaviour
 * is proved by supabase/tests/0007_contact_messages.sql in tests/orders/migration-database.test.ts.
 * This file pins what the TypeScript side relies on to the SQL: the topics, the bounds, the kind,
 * the statuses and the outbox limits, and that the lead outbox is not touched (R169).
 */
const RAW = readFileSync(resolve("supabase/migrations/0008_contact_messages.sql"), "utf8").replaceAll("\r\n", "\n");
const SQL = RAW.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

interface FunctionDefinition { name: string; header: string; body: string }
const FUNCTIONS: FunctionDefinition[] = Array.from(
  SQL.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g),
  (match) => ({ name: match[1]!, header: match[2]!, body: match[4]! }),
);
const RPCS = ["submit_contact_message", "claim_contact_deliveries", "record_contact_delivery_attempt"];
const TABLES = ["contact_messages", "contact_message_deliveries"];

const fn = (name: string) => {
  const found = FUNCTIONS.find((entry) => entry.name === name);
  if (!found) throw new Error(`migration 0008 defines no function ${name}`);
  return found;
};

const rolesIn = (verb: "revoke" | "grant", name: string) =>
  Array.from(
    SQL.matchAll(new RegExp(`${verb} (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) ${verb === "revoke" ? "from" : "to"} ([^;]+);`, "g")),
    (match) => match[1]!.split(",").map((role) => role.trim()),
  ).flat();

const listIn = (text: string, pattern: RegExp) => {
  const match = text.match(pattern);
  if (!match) throw new Error(`no match for ${pattern}`);
  return match[1]!.split(",").map((value) => value.trim().replace(/'/g, ""));
};

describe("migration 0008: guards", () => {
  it("stops unless it runs as a role that bypasses row level security", () => {
    expect(SQL).toMatch(/do \$guard\$ begin if not exists \( select 1 from pg_catalog\.pg_roles r where r\.rolname = current_user and \(r\.rolbypassrls or r\.rolsuper\) \) then raise exception/);
    expect(RAW).toContain("'Migration 0008 must run as a role that bypasses row level security (Supabase: postgres).'\n      using errcode = '42501'");
  });

  it("stops unless 0006's failure helper and 0007's staff check exist (0001-0007 applied)", () => {
    expect(SQL).toContain("pg_catalog.to_regprocedure('public.outbox_failure_unconfirmed(text)') is null");
    expect(SQL).toContain("pg_catalog.to_regprocedure('public.is_active_staff()') is null");
    expect(RAW).toContain("'Migrations 0001 to 0007 must be applied before 0008.' using errcode = '55000'");
  });

  it("verifies its own grants, so a regression fails the deploy", () => {
    expect(SQL).toMatch(/do \$verify\$/);
    expect(SQL).toContain("has_function_privilege");
    expect(SQL).toContain("has_table_privilege");
  });
});

describe("migration 0008: tables", () => {
  const tables = Array.from(SQL.matchAll(/create table (?:if not exists )?public\.(\w+)/g), (match) => match[1]!);

  it("creates exactly the message table and its own outbox, idempotently", () => {
    expect([...tables].sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) expect(SQL, table).toContain(`create table if not exists public.${table} (`);
  });

  it.each(TABLES)("%s: row level security enabled AND forced", (table) => {
    expect(SQL).toContain(`alter table public.${table} enable row level security`);
    expect(SQL).toContain(`alter table public.${table} force row level security`);
  });

  it.each(TABLES)("%s: every privilege revoked from public, anon, authenticated and service_role", (table) => {
    const match = SQL.match(new RegExp(`revoke all on (?:table )?public\\.${table} from ([^;]+);`));
    expect(match, table).not.toBeNull();
    expect(match![1]!.split(",").map((role) => role.trim()).sort()).toEqual(["anon", "authenticated", "public", "service_role"]);
  });

  it("creates no policy, grants no table and grants nothing to anon, authenticated or public", () => {
    expect(SQL).not.toMatch(/\bcreate policy\b|\balter default privileges\b/);
    expect(SQL).not.toMatch(/\bgrant [^;]* on (?:table )?public\./);
    expect(SQL).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
  });

  it("writes only idempotent DDL (the harness applies every migration twice)", () => {
    expect(SQL).not.toMatch(/create table (?!if not exists)/);
    expect(SQL).not.toMatch(/create (?:unique )?index (?!if not exists)/);
    expect(SQL).not.toMatch(/create function/);
    expect(SQL).not.toMatch(/\badd (?:constraint|column)\b|\bdrop\b/);
  });

  it("indexes the inbox by time and the outbox by when a row is next due", () => {
    expect(SQL).toContain("create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc)");
    expect(SQL).toContain("create index if not exists contact_message_deliveries_due_idx on public.contact_message_deliveries (next_attempt_at) where status in ('pending', 'sending', 'failed')");
  });

  it("stores no raw IP address, no user agent and no child data (R159, R162)", () => {
    expect(SQL).not.toMatch(/\b(ip|ip_address|client_ip|remote_addr|inet|user_agent)\b/);
    expect(SQL).not.toMatch(/age_band|child|birth|school/);
  });
});

describe("migration 0008: the values the form and the alert rely on", () => {
  const submit = () => fn("submit_contact_message").body;

  it("allows exactly the form's topics, in the table and in the RPC", () => {
    expect(listIn(SQL, /constraint contact_messages_topic_values check \(topic in \(([^)]*)\)\)/)).toEqual([...CONTACT_TOPICS]);
    expect(listIn(submit(), /p_topic not in \(([^)]*)\)/)).toEqual([...CONTACT_TOPICS]);
  });

  it("bounds the name, the email and the message at the form's limits, in the table and in the RPC", () => {
    expect(SQL).toContain(`char_length(name) between 1 and ${CONTACT_LIMITS.name}`);
    expect(submit()).toContain(`char_length(v_name) not between 1 and ${CONTACT_LIMITS.name}`);
    expect(SQL).toContain(`char_length(email) between 3 and ${CONTACT_LIMITS.email}`);
    expect(submit()).toContain(`char_length(v_email) not between 3 and ${CONTACT_LIMITS.email}`);
    expect(SQL).toContain(`char_length(message) between ${CONTACT_LIMITS.messageMin} and ${CONTACT_LIMITS.messageMax}`);
    expect(submit()).toContain(`char_length(p_message) not between ${CONTACT_LIMITS.messageMin} and ${CONTACT_LIMITS.messageMax}`);
  });

  it("refuses markup and control characters in the name, and control characters other than LF and TAB in the message", () => {
    expect(SQL).toContain("check (char_length(name) between 1 and 80 and name !~ '[<>\\x01-\\x1f\\x7f]')");
    expect(submit()).toContain("v_name ~ '[<>\\x01-\\x1f\\x7f]'");
    expect(SQL).toContain("message !~ '[\\x01-\\x08\\x0b-\\x1f\\x7f]'");
    expect(submit()).toContain("p_message ~ '[\\x01-\\x08\\x0b-\\x1f\\x7f]'");
  });

  it("stores the email trimmed and lower-cased, as a signup does", () => {
    expect(SQL).toContain("check (email = lower(btrim(email)))");
    expect(submit()).toContain("lower(btrim(p_email))");
    expect(submit()).toContain("btrim(p_name)");
  });

  it("writes the message and its one staff alert in one function, and returns both ids", () => {
    expect(fn("submit_contact_message").header).toMatch(/returns table \(message_id uuid, delivery_id uuid\)/);
    expect(submit()).toContain("#variable_conflict use_column");
    expect(submit()).toMatch(/insert into public\.contact_messages\b/);
    expect(submit()).toContain("insert into public.contact_message_deliveries as delivery (message_id, kind, status, attempts) values (v_message_id, 'contact_staff_alert', 'pending', 0)");
    expect(SQL).toContain("constraint contact_message_deliveries_message_kind_key unique (message_id, kind)");
    expect(SQL).toContain("references public.contact_messages (id) on delete cascade");
  });
});

describe("migration 0008: the contact outbox (R169, R175)", () => {
  it("lists exactly the contact outbox's kind, by a positive list, and never branches on a kind by elimination", () => {
    expect(listIn(SQL, /constraint contact_message_deliveries_kind_values check \(kind in \(([^)]*)\)\)/)).toEqual([...CONTACT_DELIVERY_KINDS]);
    expect(RAW).not.toMatch(/kind\s*(<>|!=|not in)\s*\(?'/i);
  });

  it("has every outbox status but skipped, which a contact message never needs (R175)", () => {
    const statuses = listIn(SQL, /constraint contact_message_deliveries_status_values check \(status in \(([^)]*)\)\)/);
    expect(statuses).toEqual(["pending", "sending", "sent", "failed"]);
    for (const status of statuses) expect(OUTBOX_STATUSES as readonly string[]).toContain(status);
    expect(SQL).not.toMatch(/status\s*=\s*'skipped'|v_skipped/);
    expect(fn("claim_contact_deliveries").body).toContain("'skipped', 0");
  });

  it("gives the outbox every column the lead outbox's worker relies on", () => {
    const outbox = SQL.match(/create table if not exists public\.contact_message_deliveries \(([^;]*)\);/)?.[1] ?? "";
    for (const column of ["message_id", "kind", "status", "attempts", "last_attempt_at", "next_attempt_at", "provider_message_id", "last_error_code", "unconfirmed_since", "claimed_at", "created_at", "updated_at"]) {
      expect(outbox, column).toMatch(new RegExp(`(?:^|, )${column} `));
    }
    expect(outbox).toContain("check (attempts between 0 and 1000)");
    expect(outbox).toContain("check (provider_message_id is null or char_length(provider_message_id) between 1 and 200)");
    expect(outbox).toContain("check (last_error_code is null or last_error_code ~ '^[a-za-z0-9_]{1,60}$')");
  });

  it("bounds a claim, re-claims a stuck row and parks it at the constants' values (R91)", () => {
    const { header, body } = fn("claim_contact_deliveries");
    expect(header).toMatch(/^\s*p_limit integer default 10, p_message_id uuid default null \) returns jsonb\b/);
    expect(body).toContain(`p_limit not between 1 and ${OUTBOX_LIMITS.maxClaim}`);
    expect(body).toContain(`now() - interval '${OUTBOX_LIMITS.staleSendingMinutes} minutes'`);
    expect(body).toContain(`now() - interval '${OUTBOX_LIMITS.idempotencyWindowHours} hours'`);
    expect(body).toContain(`r.attempts >= ${OUTBOX_LIMITS.maxAttempts}`);
    expect(body).toContain("'stale_unconfirmed'");
    expect(body).toContain("next_attempt_at = 'infinity'");
    expect(body).toContain("order by delivery.next_attempt_at, delivery.created_at, delivery.id");
    expect(body).toContain("for update of delivery skip locked");
    // The provider keeps an idempotency key for 24 hours; the window must close before that.
    expect(OUTBOX_LIMITS.idempotencyWindowHours).toBeLessThan(24);
  });

  it("backs off as the other outboxes do, capped at 6 hours, and treats the final failure codes as final", () => {
    const { header, body } = fn("record_contact_delivery_attempt");
    expect(header).toMatch(/^\s*p_delivery_id uuid, p_status text, p_provider_message_id text default null, p_error_code text default null \) returns boolean\b/);
    expect(body).toContain("p_status not in ('sent', 'failed', 'deferred')");
    expect(body).toContain("least(interval '6 hours', interval '1 minute' * power(2, least(delivery.attempts, 12)))");
    expect(body).toContain("public.outbox_failure_unconfirmed(p_error_code)");
    expect(body).toContain(`delivery.attempts >= ${OUTBOX_LIMITS.maxAttempts}`);
    for (const code of OUTBOX_FINAL_FAILURE_CODES) expect(body, code).toContain(`p_error_code = '${code}'`);
    expect(body).toContain("where delivery.id = p_delivery_id and delivery.status = 'sending'");
    expect(body).toMatch(/return found;/);
  });
});

describe("migration 0008: functions", () => {
  it("defines exactly the three service-role RPCs", () => {
    expect(FUNCTIONS.map((entry) => entry.name).sort()).toEqual([...RPCS].sort());
  });

  it.each(RPCS)("%s is a plpgsql security definer with an empty search_path, executable by service_role alone", (name) => {
    const { header } = fn(name);
    expect(header).toContain("language plpgsql");
    expect(header).toContain("security definer");
    expect(header).toContain("set search_path = ''");
    expect(rolesIn("revoke", name)).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    expect(rolesIn("grant", name)).toEqual(["service_role"]);
  });

  it("refers to every table by its schema-qualified name inside function bodies", () => {
    for (const { name, body } of FUNCTIONS) {
      for (const table of TABLES) expect(body, `${name} -> ${table}`).not.toMatch(new RegExp(`(?<![.\\w])${table}\\b(?!\\s*\\.)`));
    }
  });

  it("names errors by field with 22023, never by value", () => {
    const bodies = FUNCTIONS.map(({ body }) => body).join(" ");
    const raised = Array.from(bodies.matchAll(/raise exception '([^']*)' using errcode = '(\w+)'/g), (match) => ({ message: match[1]!, code: match[2]! }));
    expect(raised).toHaveLength(Array.from(bodies.matchAll(/raise exception/g)).length);
    expect([...new Set(raised.map(({ message }) => message))].sort()).toEqual(
      ["claim limit is invalid", "delivery status is invalid", "email is invalid", "error code is invalid", "message is invalid", "name is invalid", "provider message id is invalid", "topic is invalid"],
    );
    for (const { message, code } of raised) expect(code, message).toBe("22023");
  });
});

describe("migration 0008 leaves the lead outbox alone (R169)", () => {
  it("never names a lead object", () => {
    expect(RAW).not.toMatch(/\blead_delivery_events\b|\blead_submissions\b|\benqueue_lead_delivery\b|\bclaim_lead_deliveries\b|\brecord_lead_delivery_attempt\b|\bsubmit_lead\b/);
  });

  it("alters no table it does not create", () => {
    const altered = Array.from(SQL.matchAll(/alter table public\.(\w+)/g), (match) => match[1]!);
    expect(new Set(altered)).toEqual(new Set(TABLES));
  });
});
