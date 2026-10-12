import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite-pgtap";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Executes migration 0001 and the pgTAP file in PGlite (Postgres compiled to WebAssembly), inside a
 * stand-in for a Supabase project: the same anon / authenticated / service_role roles and default
 * privileges, and a non-superuser migration owner that bypasses RLS like Supabase's `postgres`.
 * This proves the policy behaves, not just that the text looks right. Task 11 runs the same pgTAP
 * file against the real project with `supabase test db`.
 */
const MIGRATION = readFileSync(resolve("supabase/migrations/0001_leads_and_security.sql"), "utf8");
const PGTAP_FILE = readFileSync(resolve("supabase/tests/0001_leads_rls.sql"), "utf8");

const SUPABASE_STAND_IN = `
  create schema extensions;
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  -- Supabase's postgres role: not a superuser, but it bypasses RLS and owns migrated objects.
  create role migrator nologin nosuperuser bypassrls;
  grant usage, create on schema public to migrator;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  -- Supabase grants every new public table and function to the API roles by default; the migration must take that back.
  alter default privileges for role migrator in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role migrator in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges for role migrator in schema public grant all on sequences to anon, authenticated, service_role;
  set search_path = public, extensions;
`;

let db: PGlite;

/** Every value pgTAP printed, in order, one TAP line per entry. */
async function runTap(sql: string) {
  const results = await db.exec(sql);
  return results.flatMap((result) => result.rows.flatMap((row) => Object.values(row as Record<string, unknown>)))
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split("\n"));
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgtap } });
  await db.exec(SUPABASE_STAND_IN);
  await db.exec(`set role migrator;\n${MIGRATION}\nreset role;`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 0001 in Postgres", () => {
  it("passes every pgTAP assertion in supabase/tests/0001_leads_rls.sql", async () => {
    const lines = await runTap(PGTAP_FILE);
    const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
    expect(plan, "pgTAP printed a plan").toBeDefined();
    const planned = Number(plan!.slice(3));
    const failures = lines.filter((line) => line.startsWith("not ok") || line.startsWith("# Looks like") || line.startsWith("#     "));
    expect(failures).toEqual([]);
    expect(lines.filter((line) => line.startsWith("ok ")).length).toBe(planned);
  }, 60_000);

  it("is owned by a role that bypasses RLS, so the definer functions can write to forced-RLS tables", async () => {
    const { rows } = await db.query<{ owner: string }>(`select pg_get_userbyid(proowner) as owner from pg_proc where proname = 'submit_lead'`);
    expect(rows).toEqual([{ owner: "migrator" }]);
  });

  it("can be applied twice without error (idempotent objects)", async () => {
    await expect(db.exec(`set role migrator;\n${MIGRATION}\nreset role;`)).resolves.toBeDefined();
  }, 60_000);
});
