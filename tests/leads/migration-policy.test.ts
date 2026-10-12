import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Static policy gate for migration 0001 (ruling R29). It reads the SQL as text, so it runs anywhere
 * without a database; tests/leads/migration-database.test.ts then executes the same migration and
 * the pgTAP file in an embedded Postgres. The real project runs the pgTAP file in Task 11.
 */
const MIGRATION_PATH = resolve("supabase/migrations/0001_leads_and_security.sql");
const PGTAP_PATH = resolve("supabase/tests/0001_leads_rls.sql");

function readSql(path: string) {
  if (!existsSync(path)) throw new Error(`${path} does not exist yet`);
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/** SQL with `--` comments removed and whitespace collapsed, lower-cased for matching. */
function normalized(sql: string) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
}

interface FunctionDefinition { name: string; header: string; body: string }

/** Every `create [or replace] function public.<name>(...) ... as $$ body $$` in the migration. */
function functionsIn(sql: string): FunctionDefinition[] {
  const pattern = /create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g;
  return Array.from(sql.matchAll(pattern), (match) => ({ name: match[1]!, header: match[2]!, body: match[4]! }));
}

const tablesIn = (sql: string) => Array.from(sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g), (match) => match[1]!);

/** `revoke all on function public.<name>(...) from <roles>`: the role lists that apply to one function. */
const revokedRoles = (sql: string, name: string) =>
  Array.from(sql.matchAll(new RegExp(`revoke (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) from ([^;]+);`, "g")), (match) =>
    match[1]!.split(",").map((role) => role.trim()),
  ).flat();

const grantedRoles = (sql: string, name: string) =>
  Array.from(sql.matchAll(new RegExp(`grant (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) to ([^;]+);`, "g")), (match) =>
    match[1]!.split(",").map((role) => role.trim()),
  ).flat();

const RPCS = ["submit_lead", "enqueue_lead_delivery", "record_lead_delivery_attempt", "consume_rate_limit"];
const INTERNAL = ["purge_expired_rate_limit_buckets"];
const TABLES = ["lead_submissions", "lead_delivery_events", "rate_limit_buckets"];

describe("migration 0001: tables", () => {
  const sql = normalized(readSql(MIGRATION_PATH));

  it("creates the lead, outbox and rate-limit tables", () => {
    expect(tablesIn(sql).sort()).toEqual([...TABLES].sort());
  });

  it("enables AND forces row level security on every table it creates", () => {
    for (const table of tablesIn(sql)) {
      expect(sql, `${table}: enable`).toContain(`alter table public.${table} enable row level security`);
      expect(sql, `${table}: force`).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("revokes every table privilege from public, anon, authenticated and service_role (RPC access only)", () => {
    for (const table of tablesIn(sql)) {
      const match = sql.match(new RegExp(`revoke all on (?:table )?public\\.${table} from ([^;]+);`));
      expect(match, `${table}: revoke`).not.toBeNull();
      expect(match![1]!.split(",").map((role) => role.trim()).sort(), table).toEqual(["anon", "authenticated", "public", "service_role"]);
    }
  });

  it("grants nothing to anon, authenticated or public, and creates no row policies", () => {
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/\bcreate policy\b/);
    expect(sql).not.toMatch(/\balter default privileges\b/);
  });

  it("stores no raw IP address and no child data", () => {
    expect(sql).not.toMatch(/\b(ip|ip_address|client_ip|remote_addr)\b|\binet\b/);
    expect(sql).not.toMatch(/child_name|birthday|birth_date|date_of_birth|\bschool\b|photo|voice|health|postcode|street/);
  });

  it("keeps one row per normalised email and one outbox event per lead and kind", () => {
    expect(sql).toMatch(/constraint lead_submissions_email_key unique \(email\)/);
    expect(sql).toMatch(/check \(email = lower\(btrim\(email\)\)\)/);
    expect(sql).toMatch(/constraint lead_delivery_events_lead_kind_key unique \(lead_id, kind\)/);
  });

  it("gives the outbox what a retry worker needs to claim rows idempotently", () => {
    for (const column of ["attempts", "last_attempt_at", "next_attempt_at", "provider_message_id", "last_error_code"]) {
      expect(sql, column).toMatch(new RegExp(`create table (?:if not exists )?public\\.lead_delivery_events \\([^;]*\\b${column}\\b`));
    }
  });
});

describe("migration 0001: functions", () => {
  const raw = readSql(MIGRATION_PATH);
  const sql = normalized(raw);
  const functions = functionsIn(sql);

  it("defines the four service-role RPCs and the internal retention function", () => {
    expect(functions.map((fn) => fn.name).sort()).toEqual([...RPCS, ...INTERNAL].sort());
  });

  it("pins an empty search_path on every security definer function", () => {
    const definers = functions.filter((fn) => fn.header.includes("security definer"));
    expect(definers.map((fn) => fn.name).sort()).toEqual([...RPCS, ...INTERNAL].sort());
    for (const fn of definers) expect(fn.header, fn.name).toContain("set search_path = ''");
  });

  it("revokes every security definer function from public, anon and authenticated", () => {
    for (const fn of functions.filter((entry) => entry.header.includes("security definer"))) {
      expect(revokedRoles(sql, fn.name), fn.name).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    }
  });

  it("grants execute on each RPC to service_role and nobody else", () => {
    for (const name of RPCS) expect(grantedRoles(sql, name), name).toEqual(["service_role"]);
  });

  it("lets nobody but the owner run the retention function", () => {
    for (const name of INTERNAL) {
      expect(grantedRoles(sql, name), name).toEqual([]);
      expect(revokedRoles(sql, name).sort(), name).toEqual(["anon", "authenticated", "public", "service_role"]);
    }
  });

  it("refers to every table by its schema-qualified name inside function bodies", () => {
    for (const fn of functions) {
      for (const table of TABLES) {
        expect(fn.body, `${fn.name} -> ${table}`).not.toMatch(new RegExp(`(?<!public\\.)\\b${table}\\b`));
      }
    }
  });

  it("validates and normalises the email inside submit_lead as well", () => {
    const submit = functions.find((fn) => fn.name === "submit_lead");
    expect(submit?.body).toMatch(/lower\(btrim\(p_email\)\)/);
    expect(submit?.body).toMatch(/raise exception/);
    expect(submit?.header).toMatch(/returns table ?\(lead_id uuid, created boolean\)/);
  });
});

describe("pgTAP file", () => {
  const sql = normalized(readSql(PGTAP_PATH));

  it("is a self-contained pgTAP plan that rolls back", () => {
    expect(sql).toMatch(/^ ?begin;/);
    expect(sql).toMatch(/select plan\(\d+\);/);
    expect(sql).toMatch(/select \* from finish\(\);\s*rollback;\s*$/);
  });

  it("covers forced RLS, grants, search paths and role behaviour", () => {
    for (const probe of ["relforcerowsecurity", "table_privs_are", "function_privs_are", "is_definer", "search_path", "set local role anon", "set local role authenticated", "set local role service_role", "throws_ok"]) {
      expect(sql, probe).toContain(probe);
    }
  });
});
