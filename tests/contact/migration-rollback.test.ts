import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, createSupabaseStandIn, migrationFiles, pgtapFiles, readPgtap, runTap, summariseTap } from "@/tests/support/supabase-db";

/*
 * The emergency rollback of migration 0008 (the contact form; layer 3 of the production walk: a
 * reversible schema delta). supabase/downs/0008_contact_messages_down.sql drops what 0008 created and
 * nothing else. This file runs it in the Supabase stand-in (tests/support/supabase-db.ts): 0001-0007,
 * then 0008, then the down, must leave the catalogue exactly as 0001-0007 left it, with every earlier
 * pgTAP file still green; a second run of the down changes nothing; and 0008 applied again brings the
 * contact objects back with their pgTAP file and the whole-schema sweep green (up, down, up).
 */
const DOWN_PATH = "supabase/downs/0008_contact_messages_down.sql";
const readDown = () => readFileSync(resolve(DOWN_PATH), "utf8");
const applyDown = (db: PGlite) => db.exec(`set role migrator;\n${readDown()}\nreset role;`);

const BEFORE_CONTACT = migrationFiles().filter((file) => file < "0008");
const CONTACT_FUNCTIONS = [
  "public.submit_contact_message(text, text, text, text)",
  "public.claim_contact_deliveries(integer, uuid)",
  "public.record_contact_delivery_attempt(uuid, text, text, text)",
];
const CONTACT_RELATIONS = [
  "public.contact_messages",
  "public.contact_message_deliveries",
  "public.contact_messages_created_at_idx",
  "public.contact_message_deliveries_due_idx",
  "public.contact_message_deliveries_message_kind_key",
];
/** pgTAP files that prove 0001-0007 alone. 0006_catalogue.sql lists 0008's functions and runs after the re-apply. */
const EARLIER_PGTAP = ["0001_leads_rls.sql", "0002_orders_rls.sql", "0003_tracking_grants.sql", "0004_email_outbox.sql", "0005_staff_access.sql"];

/**
 * Everything the migrations write into public, one line per object: relations (tables, indexes,
 * sequences) with their grants and row level security flags, functions with their signature, grants,
 * owner, security mode, settings and a hash of their body, constraints with their definition,
 * policies, triggers and types. Two equal snapshots mean the schema is the same object for object.
 */
const CATALOGUE = `
  select entry from (
    select 'relation ' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(c.relacl::text, '-') || ' ' || c.relrowsecurity::text || c.relforcerowsecurity::text || ' ' || pg_catalog.pg_get_userbyid(c.relowner) as entry
      from pg_catalog.pg_class as c where c.relnamespace = 'public'::regnamespace
    union all
    select 'function ' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ') ' || coalesce(p.proacl::text, '-') || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-') || ' ' || pg_catalog.pg_get_userbyid(p.proowner) || ' ' || md5(p.prosrc)
      from pg_catalog.pg_proc as p where p.pronamespace = 'public'::regnamespace
    union all
    select 'constraint ' || con.conrelid::regclass::text || '.' || con.conname || ' ' || pg_catalog.pg_get_constraintdef(con.oid)
      from pg_catalog.pg_constraint as con where con.connamespace = 'public'::regnamespace
    union all
    select 'policy ' || pol.tablename || '.' || pol.policyname || ' ' || pol.cmd || ' ' || pol.roles::text
      from pg_catalog.pg_policies as pol where pol.schemaname = 'public'
    union all
    select 'trigger ' || tg.tgrelid::regclass::text || '.' || tg.tgname
      from pg_catalog.pg_trigger as tg join pg_catalog.pg_class as c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace
    union all
    select 'type ' || t.typname || ' ' || t.typtype::text
      from pg_catalog.pg_type as t where t.typnamespace = 'public'::regnamespace
  ) as catalogue
  order by entry collate "C"`;

async function catalogue(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ entry: string }>(CATALOGUE);
  return rows.map((row) => row.entry);
}

async function contactObjectsLeft(db: PGlite): Promise<string[]> {
  const names = [...CONTACT_FUNCTIONS.map((signature) => ({ name: signature, sql: "select pg_catalog.to_regprocedure($1) is not null as present" })), ...CONTACT_RELATIONS.map((relation) => ({ name: relation, sql: "select pg_catalog.to_regclass($1) is not null as present" }))];
  const left: string[] = [];
  for (const { name, sql } of names) {
    const { rows } = await db.query<{ present: boolean }>(sql, [name]);
    if (rows[0]?.present) left.push(name);
  }
  return left;
}

async function expectTapGreen(db: PGlite, file: string) {
  let lines: string[] = [];
  let error: unknown;
  try {
    lines = await runTap(db, readPgtap(file));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : caught;
    await db.exec("rollback;").catch(() => {});
  }
  expect(error, `${file} ran to the end`).toBeUndefined();
  const { planned, passed, failures } = summariseTap(lines);
  expect(planned, `${file} printed a plan`).not.toBeNull();
  expect(failures, file).toEqual([]);
  expect(passed, file).toBe(planned);
}

describe("the 0008 down script, as text", () => {
  it("exists outside supabase/migrations, so neither `supabase db push` nor the migration harness applies it", () => {
    expect(existsSync(resolve(DOWN_PATH)), DOWN_PATH).toBe(true);
    expect(migrationFiles()).not.toContain("0008_contact_messages_down.sql");
    expect(pgtapFiles()).not.toContain("0008_contact_messages_down.sql");
  });

  it("drops only contact objects, each with `if exists`, never with cascade, inside one transaction", () => {
    const sql = readDown().replaceAll("\r\n", "\n").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
    expect(sql).not.toMatch(/\bcascade\b/);
    expect(sql).not.toMatch(/\b(?:delete|truncate|alter|update|insert|create|grant|revoke)\b/);
    const drops = Array.from(sql.matchAll(/\bdrop (function|table|index) (if exists )?([^;]+);/g), (match) => ({ kind: match[1]!, guarded: Boolean(match[2]), target: match[3]!.trim() }));
    expect(drops.map(({ kind, target }) => `${kind} ${target}`)).toEqual([
      "function public.submit_contact_message(text, text, text, text)",
      "function public.claim_contact_deliveries(integer, uuid)",
      "function public.record_contact_delivery_attempt(uuid, text, text, text)",
      "index public.contact_message_deliveries_due_idx",
      "index public.contact_messages_created_at_idx",
      "table public.contact_message_deliveries",
      "table public.contact_messages",
    ]);
    for (const drop of drops) expect(drop.guarded, `${drop.kind} ${drop.target}`).toBe(true);
    expect(sql.match(/\bdrop\b/g)).toHaveLength(drops.length);
    expect(sql.trim()).toMatch(/^begin;[\s\S]*commit;$/);
  });

  it("states the data loss, that a code revert is the normal rollback, and the command that runs it", () => {
    const header = readDown().replaceAll("\r\n", "\n");
    const flat = header.replace(/\s+/g, " ");
    expect(flat).toMatch(/DELETES every stored contact message/);
    expect(flat).toMatch(/emergencies only/i);
    expect(flat).toMatch(/revert/);
    expect(header).toContain("npx supabase@2.121.0 db query --linked -f supabase/downs/0008_contact_messages_down.sql");
    expect(header).toContain("npx supabase@2.121.0 migration repair 0008 --status reverted --linked");
  });
});

describe("the 0008 down script in Postgres (up, down, up)", () => {
  let db: PGlite;
  let before: string[];

  beforeAll(async () => {
    db = await createSupabaseStandIn();
    await applyMigrations(db, BEFORE_CONTACT);
    before = await catalogue(db);
    await applyMigrations(db, ["0008_contact_messages.sql"]);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("starts from 0001-0007 plus 0008, with every contact object present", async () => {
    expect(BEFORE_CONTACT).toEqual(migrationFiles().slice(0, 7));
    expect(await contactObjectsLeft(db)).toEqual([...CONTACT_FUNCTIONS, ...CONTACT_RELATIONS]);
    expect(await catalogue(db)).not.toEqual(before);
  });

  it("serves 0008's one foreign key with an index that leads with its column (an index on every foreign key)", async () => {
    const { rows } = await db.query<{ constraint: string; covering: string | null }>(
      `select con.conname as constraint,
              (select pg_catalog.string_agg(i.indexrelid::regclass::text, ', ' order by i.indexrelid::regclass::text)
                 from pg_catalog.pg_index as i
                where i.indrelid = con.conrelid and i.indpred is null
                  and (pg_catalog.string_to_array(i.indkey::text, ' ')::int2[])[1:pg_catalog.array_length(con.conkey, 1)] = con.conkey) as covering
         from pg_catalog.pg_constraint as con
        where con.contype = 'f' and con.conrelid in ('public.contact_messages'::regclass, 'public.contact_message_deliveries'::regclass)`,
    );
    expect(rows).toEqual([{ constraint: "contact_message_deliveries_message_id_fkey", covering: "contact_message_deliveries_message_kind_key" }]);
  });

  it("refuses to drop a contact table something else depends on, and then drops nothing (no cascade, one transaction)", async () => {
    await db.exec("create view public.rollback_probe as select id from public.contact_messages;");
    try {
      await expect(applyDown(db)).rejects.toThrow(/depend/);
      await db.exec("rollback; reset role;");
      expect(await contactObjectsLeft(db)).toEqual([...CONTACT_FUNCTIONS, ...CONTACT_RELATIONS]);
    } finally {
      await db.exec("drop view public.rollback_probe;");
    }
  }, 120_000);

  it("removes every object 0008 created, messages and alerts included", async () => {
    await db.exec(`set role service_role;
      select * from public.submit_contact_message('Sam Rivers', 'parent@example.com', 'general', 'A message long enough to store.');
      reset role;`);
    await expect(applyDown(db)).resolves.toBeDefined();
    expect(await contactObjectsLeft(db)).toEqual([]);
  }, 120_000);

  it("leaves the schema exactly as 0001-0007 left it: every lead, order, staff and rate-limit object, grant and function body", async () => {
    expect(await catalogue(db)).toEqual(before);
    const { rows } = await db.query<{ name: string; present: boolean }>(
      `select name, pg_catalog.to_regclass(name) is not null as present
         from unnest(array['public.lead_delivery_events', 'public.lead_submissions', 'public.orders', 'public.order_items', 'public.order_events', 'public.order_email_outbox', 'public.rate_limit_buckets', 'public.staff_users']) as name`,
    );
    for (const row of rows) expect(row.present, row.name).toBe(true);
    const functions = await db.query<{ name: string; present: boolean }>(
      `select name, pg_catalog.to_regprocedure(name) is not null as present
         from unnest(array['public.outbox_failure_unconfirmed(text)', 'public.is_active_staff()', 'public.consume_rate_limit(text, integer, integer)', 'public.submit_lead(text, boolean, text, text, text, text, text, jsonb)', 'public.record_lead_delivery_attempt(uuid, text, text, text)']) as name`,
    );
    for (const row of functions.rows) expect(row.present, row.name).toBe(true);
  });

  it.each(EARLIER_PGTAP)("keeps supabase/tests/%s green after the down", async (file) => {
    await expectTapGreen(db, file);
  }, 120_000);

  it("can run a second time without error and changes nothing (idempotent)", async () => {
    await expect(applyDown(db)).resolves.toBeDefined();
    expect(await catalogue(db)).toEqual(before);
  }, 120_000);

  it("lets 0008 apply again: the contact objects come back and their pgTAP file and the whole-schema sweep pass", async () => {
    await applyMigrations(db, ["0008_contact_messages.sql"]);
    expect(await contactObjectsLeft(db)).toEqual([...CONTACT_FUNCTIONS, ...CONTACT_RELATIONS]);
    await expectTapGreen(db, "0007_contact_messages.sql");
    await expectTapGreen(db, "0006_catalogue.sql");
  }, 120_000);
});
