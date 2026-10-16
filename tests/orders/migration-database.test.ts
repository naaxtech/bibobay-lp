import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, createSupabaseStandIn, migrationFiles, pgtapFiles, readPgtap, runTap, summariseTap } from "@/tests/support/supabase-db";

/*
 * Applies every migration (0001-0007) in order inside a Supabase stand-in (tests/support/supabase-db.ts)
 * and runs every pgTAP file against the result, so each file proves its policy holds alongside all
 * the others. This is the same set Task 11 runs against the real project with `supabase test db`.
 * 0006_catalogue.sql (fix wave T-I4) sweeps the whole public schema, so a grant or a table a later
 * migration adds is caught even before a per-object check names it.
 */
let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("every migration in Postgres", () => {
  it("applies 0001 to 0007 in order", () => {
    expect(migrationFiles()).toEqual([
      "0001_leads_and_security.sql",
      "0002_orders.sql",
      "0003_order_tracking.sql",
      "0004_lock_tracking_payload.sql",
      "0005_shared_rate_limits_and_token_rotation.sql",
      "0006_order_events_and_email_outbox.sql",
      "0007_staff_access.sql",
    ]);
  });

  it("has a pgTAP file for the leads, the orders, the tracking grants, the email outbox, staff access and the whole-schema sweep", () => {
    expect(pgtapFiles()).toEqual(["0001_leads_rls.sql", "0002_orders_rls.sql", "0003_tracking_grants.sql", "0004_email_outbox.sql", "0005_staff_access.sql", "0006_catalogue.sql"]);
  });

  it.each(pgtapFiles())("passes every pgTAP assertion in supabase/tests/%s", async (file) => {
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
    expect(failures).toEqual([]);
    expect(passed).toBe(planned);
  }, 120_000);

  it("leaves every order object owned by a role that bypasses RLS", async () => {
    const { rows } = await db.query<{ name: string; owner: string }>(
      `select proname as name, pg_get_userbyid(proowner) as owner from pg_proc
        where pronamespace = 'public'::regnamespace and proname in ('submit_order', 'lookup_order_by_token', 'lookup_order_by_reference_email', 'rotate_order_tracking_token')
        order by proname`,
    );
    expect(rows).toEqual([
      { name: "lookup_order_by_reference_email", owner: "migrator" },
      { name: "lookup_order_by_token", owner: "migrator" },
      { name: "rotate_order_tracking_token", owner: "migrator" },
      { name: "submit_order", owner: "migrator" },
    ]);
  });

  it("can apply every migration a second time without error (idempotent objects)", async () => {
    await expect(applyMigrations(db, migrationFiles())).resolves.toBeUndefined();
  }, 120_000);

  it("keeps the outbox rules after a second application of every migration", async () => {
    const { planned, passed, failures } = summariseTap(await runTap(db, readPgtap("0004_email_outbox.sql")));
    expect(failures).toEqual([]);
    expect(passed).toBe(planned);
  }, 120_000);

  it("leaves every outbox function owned by a role that bypasses RLS", async () => {
    const { rows } = await db.query<{ name: string; owner: string }>(
      `select distinct proname as name, pg_get_userbyid(proowner) as owner from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('claim_lead_deliveries', 'claim_order_emails', 'record_order_email_attempt', 'record_lead_delivery_attempt', 'enqueue_lead_delivery', 'outbox_failure_unconfirmed')
        order by proname`,
    );
    expect(rows.map((row) => row.owner)).toEqual(Array(6).fill("migrator"));
  });

  it("leaves every staff function and staff_users owned by a role that bypasses RLS (Task 8b)", async () => {
    const { rows } = await db.query<{ name: string; owner: string }>(
      `select distinct proname as name, pg_get_userbyid(proowner) as owner from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('is_active_staff', 'staff_save_order_quote', 'staff_queue_order_quote', 'staff_advance_order_status', 'staff_rotate_order_tracking_token')
        order by proname`,
    );
    expect(rows.map((row) => row.owner)).toEqual(Array(5).fill("migrator"));
    const table = await db.query<{ owner: string }>("select pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.staff_users'::regclass");
    expect(table.rows).toEqual([{ owner: "migrator" }]);
  });

  it("keeps the staff access rules after a second application of every migration", async () => {
    const { planned, passed, failures } = summariseTap(await runTap(db, readPgtap("0005_staff_access.sql")));
    expect(failures).toEqual([]);
    expect(passed).toBe(planned);
  }, 120_000);

  it("keeps the whole-schema sweep green after a second application of every migration (fix wave T-I4)", async () => {
    const { planned, passed, failures } = summariseTap(await runTap(db, readPgtap("0006_catalogue.sql")));
    expect(planned).toBe(14);
    expect(failures).toEqual([]);
    expect(passed).toBe(planned);
  }, 120_000);
});

describe("migration preconditions", () => {
  it("refuses to apply the staff migration before the outbox migration", async () => {
    const fresh = await createSupabaseStandIn();
    try {
      await expect(applyMigrations(fresh, migrationFiles().filter((file) => !file.startsWith("0006") && !file.startsWith("0007")))).resolves.toBeUndefined();
      await expect(applyMigrations(fresh, ["0007_staff_access.sql"])).rejects.toThrow(/must be applied before 0007/);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("refuses to apply the staff migration without Supabase Auth", async () => {
    const fresh = await createSupabaseStandIn();
    try {
      await fresh.exec("drop function auth.uid();");
      await expect(applyMigrations(fresh, migrationFiles())).rejects.toThrow(/needs Supabase Auth/);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("refuses to apply the outbox migration before the lead and order migrations", async () => {
    const fresh = await createSupabaseStandIn();
    try {
      await expect(applyMigrations(fresh, ["0006_order_events_and_email_outbox.sql"])).rejects.toThrow(/must be applied before 0006/);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("refuses to apply the orders migration before migration 0001", async () => {
    const fresh = await createSupabaseStandIn();
    try {
      await expect(applyMigrations(fresh, ["0002_orders.sql"])).rejects.toThrow(/0001 must be applied/);
    } finally {
      await fresh.close();
    }
  }, 120_000);
});
