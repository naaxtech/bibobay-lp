import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite-pgtap";

/*
 * A stand-in for a Supabase project inside PGlite (Postgres compiled to WebAssembly): the same
 * anon / authenticated / service_role roles and default privileges, and a non-superuser migration
 * owner that bypasses RLS like Supabase's `postgres`. Used by the migration tests to execute the
 * real migrations and pgTAP files; Task 11 runs the same pgTAP files with `supabase test db`.
 */
export const SUPABASE_STAND_IN = `
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
  -- Supabase Auth, test-only (Task 8b): the users table staff_users references, and auth.uid(),
  -- which reads the caller's JWT subject the way Supabase's does (PostgREST sets request.jwt.claims;
  -- older versions set request.jwt.claim.sub). A real project has both already; never put them in
  -- a migration.
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role, migrator;
  grant references, select on auth.users to migrator;
  set search_path = public, extensions;
`;

const MIGRATIONS_DIR = "supabase/migrations";
const PGTAP_DIR = "supabase/tests";

/** Every migration file, in the order Supabase applies them (by their numeric prefix). */
export function migrationFiles(): string[] {
  return readdirSync(resolve(MIGRATIONS_DIR)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
}

/** Every pgTAP file, in name order. */
export function pgtapFiles(): string[] {
  return readdirSync(resolve(PGTAP_DIR)).filter((file) => file.endsWith(".sql")).sort();
}

export const readMigration = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
export const readPgtap = (file: string) => readFileSync(resolve(PGTAP_DIR, file), "utf8");

export async function createSupabaseStandIn(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgtap } });
  await db.exec(SUPABASE_STAND_IN);
  return db;
}

/** Applies migrations as the migration owner, one file at a time, in the order given. */
export async function applyMigrations(db: PGlite, files: readonly string[]): Promise<void> {
  for (const file of files) await db.exec(`set role migrator;\n${readMigration(file)}\nreset role;`);
}

/** Every value pgTAP printed, in order, one TAP line per entry. */
export async function runTap(db: PGlite, sql: string): Promise<string[]> {
  const results = await db.exec(sql);
  return results
    .flatMap((result) => result.rows.flatMap((row) => Object.values(row as Record<string, unknown>)))
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split("\n"));
}

/** The plan, the passing count and every failure line of one pgTAP run. */
export function summariseTap(lines: readonly string[]) {
  const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
  return {
    planned: plan ? Number(plan.slice(3)) : null,
    passed: lines.filter((line) => line.startsWith("ok ")).length,
    failures: lines.filter((line) => line.startsWith("not ok") || line.startsWith("# Looks like") || line.startsWith("#     ")),
  };
}
