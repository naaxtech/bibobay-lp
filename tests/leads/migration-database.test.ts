import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, createSupabaseStandIn, readPgtap, runTap, summariseTap } from "@/tests/support/supabase-db";

/*
 * Executes migration 0001 and its pgTAP file in PGlite (Postgres compiled to WebAssembly), inside a
 * stand-in for a Supabase project (tests/support/supabase-db.ts): the same anon / authenticated /
 * service_role roles and default privileges, and a non-superuser migration owner that bypasses RLS
 * like Supabase's `postgres`. This proves the policy behaves, not just that the text looks right.
 * tests/orders/migration-database.test.ts runs every migration and every pgTAP file together; Task 11
 * runs the same pgTAP files against the real project with `supabase test db`.
 */
const MIGRATION = "0001_leads_and_security.sql";

let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, [MIGRATION]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 0001 in Postgres", () => {
  it("passes every pgTAP assertion in supabase/tests/0001_leads_rls.sql", async () => {
    const { planned, passed, failures } = summariseTap(await runTap(db, readPgtap("0001_leads_rls.sql")));
    expect(planned, "pgTAP printed a plan").not.toBeNull();
    expect(failures).toEqual([]);
    expect(passed).toBe(planned);
  }, 60_000);

  it("is owned by a role that bypasses RLS, so the definer functions can write to forced-RLS tables", async () => {
    const { rows } = await db.query<{ owner: string }>(`select pg_get_userbyid(proowner) as owner from pg_proc where proname = 'submit_lead'`);
    expect(rows).toEqual([{ owner: "migrator" }]);
  });

  it("can be applied twice without error (idempotent objects)", async () => {
    await expect(applyMigrations(db, [MIGRATION])).resolves.toBeUndefined();
  }, 60_000);
});
