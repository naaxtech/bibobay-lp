// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { seedOrder } from "@/tests/support/pglite-staff";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * docs/incident-runbook.md (final review O-I6). The SQL the owner will paste under pressure is run here,
 * unchanged apart from its quoted placeholders, against every migration in PGlite: it must parse, touch
 * the rows it says it touches, honour the withdrawn semantics the outbox keeps (migration 0006
 * `claim_lead_deliveries` marks a withdrawn lead's deliveries `skipped`), and leave other rows alone.
 * The names the runbook promises (every secret in .env.example, the linked sections) are pinned too.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const read = (file: string) => readFileSync(resolve(file), "utf8");
const runbook = read("docs/incident-runbook.md");

/** Every ```sql block of the runbook, in order. */
const sqlBlocks = [...runbook.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((match) => match[1]!.trim());
const block = (containing: string) => {
  const found = sqlBlocks.filter((sql) => sql.includes(containing));
  expect(found.length, `exactly one SQL block contains: ${containing}`).toBe(1);
  return found[0]!;
};
const fill = (sql: string, values: Record<string, string>) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`<${name}>`, value), sql);

let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
});

afterAll(async () => {
  await db?.close();
});

async function seedLead(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into public.lead_submissions (email, consent_version) values ($1, 'consent-v1') returning id", [email]);
  const id = rows[0]!.id;
  await db.query("insert into public.lead_delivery_events (lead_id, kind) values ($1, 'acknowledgement'), ($1, 'staff_alert')", [id]);
  return id;
}

describe("removal request SQL", () => {
  it("withdraws exactly the matching granted lead, whatever the case or spacing of the address, and the outbox then skips its deliveries", async () => {
    const target = await seedLead("withdraw.me@example.com");
    const other = await seedLead("keep.me@example.com");

    const { rows } = await db.query<{ id: string; consent_state: string; consent_withdrawn_at: string | null }>(fill(block("set consent_state = 'withdrawn'"), { address: "  Withdraw.Me@Example.com " }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: target, consent_state: "withdrawn" });
    expect(rows[0]!.consent_withdrawn_at).not.toBeNull();

    // A second run finds nothing granted any more and changes nothing.
    const again = await db.query(fill(block("set consent_state = 'withdrawn'"), { address: "withdraw.me@example.com" }));
    expect(again.rows).toEqual([]);

    const states = await db.query<{ id: string; consent_state: string }>("select id, consent_state from public.lead_submissions where id in ($1, $2) order by email", [other, target]);
    expect(Object.fromEntries(states.rows.map((row) => [row.id, row.consent_state]))).toEqual({ [other]: "granted", [target]: "withdrawn" });

    // The semantics the runbook promises: the claim never returns a withdrawn lead's rows and marks them skipped.
    await db.exec("set role service_role");
    const claim = await db.query<{ claimed: Array<{ id: string }> }>("select public.claim_lead_deliveries(50, null, null) as claimed");
    await db.exec("reset role");
    const claimedLeadRows = await db.query<{ lead_id: string }>("select lead_id from public.lead_delivery_events where id = any($1::uuid[])", [(claim.rows[0] as unknown as { claimed: { claimed: Array<{ id: string }> } }).claimed.claimed.map((row) => row.id)]);
    expect(claimedLeadRows.rows.every((row) => row.lead_id !== target)).toBe(true);
    const targetRows = await db.query<{ status: string }>("select status from public.lead_delivery_events where lead_id = $1", [target]);
    expect(targetRows.rows.map((row) => row.status)).toEqual(["skipped", "skipped"]);
    const otherRows = await db.query<{ status: string }>("select status from public.lead_delivery_events where lead_id = $1", [other]);
    expect(otherRows.rows.map((row) => row.status).sort()).toEqual(["sending", "sending"]);
  });

  it("the read-only check shows a lead without changing it", async () => {
    await seedLead("check.me@example.com");
    const { rows } = await db.query<{ consent_state: string }>(fill(block("select id, consent_state, consent_withdrawn_at, rejoin_requested_at"), { address: "Check.Me@example.com" }));
    expect(rows).toEqual([expect.objectContaining({ consent_state: "granted" })]);
  });

  it("uses only columns and values the migrations define", () => {
    const migration = read("supabase/migrations/0001_leads_and_security.sql");
    for (const name of ["consent_state", "consent_withdrawn_at", "rejoin_requested_at", "acknowledgement_status", "lead_submissions_email_normalised"]) expect(migration, name).toContain(name);
    expect(migration).toMatch(/consent_state in \('granted', 'withdrawn'\)/);
  });
});

describe("parked email SQL", () => {
  async function parkLeadRow() {
    const lead = await seedLead(`parked-${Math.random().toString(16).slice(2)}@example.com`);
    const { rows } = await db.query<{ id: string }>(
      "update public.lead_delivery_events set status = 'failed', attempts = 8, next_attempt_at = 'infinity', last_error_code = 'stale_unconfirmed', unconfirmed_since = now() - interval '25 hours', last_attempt_at = now() where lead_id = $1 and kind = 'acknowledgement' returning id",
      [lead],
    );
    return { lead, eventId: rows[0]!.id };
  }

  it("lists parked rows of both outboxes", async () => {
    const parked = await parkLeadRow();
    const order = await seedOrder(db, "parked-order@example.com");
    const orderRow = await db.query<{ id: string }>(
      "update public.order_email_outbox set status = 'failed', attempts = 8, next_attempt_at = 'infinity', last_error_code = 'invalid_idempotent_request', last_attempt_at = now() where order_id = $1 and kind = 'acknowledgement' returning id",
      [order.orderId],
    );
    const { rows } = await db.query<{ outbox: string; id: string; last_error_code: string }>(block("union all"));
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ outbox: "lead", id: parked.eventId }), expect.objectContaining({ outbox: "order", id: orderRow.rows[0]!.id })]));
  });

  it("closes a delivered order row and re-queues an undelivered one, each touching only its own parked row", async () => {
    const order = await seedOrder(db, "requeue-order@example.com");
    const rows = await db.query<{ id: string; kind: string }>(
      "update public.order_email_outbox set status = 'failed', attempts = 8, next_attempt_at = 'infinity', last_error_code = 'stale_unconfirmed', unconfirmed_since = now() - interval '25 hours', claimed_at = now(), last_attempt_at = now() where order_id = $1 returning id, kind",
      [order.orderId],
    );
    const [first, second] = rows.rows;
    expect(first && second).toBeTruthy();

    const closed = await db.query(fill(block("set status = 'skipped', last_error_code = 'closed_by_staff'"), { "row id": first!.id }));
    expect(closed.affectedRows).toBe(1);
    const requeued = await db.query(fill(block("set status = 'pending', attempts = 0"), { "row id": second!.id }));
    expect(requeued.affectedRows).toBe(1);

    const after = await db.query<{ id: string; status: string; attempts: number; last_error_code: string | null; unconfirmed_since: string | null; claimed_at: string | null }>("select id, status, attempts, last_error_code, unconfirmed_since, claimed_at from public.order_email_outbox where order_id = $1", [order.orderId]);
    const byId = Object.fromEntries(after.rows.map((row) => [row.id, row]));
    expect(byId[first!.id]).toMatchObject({ status: "skipped", last_error_code: "closed_by_staff" });
    expect(byId[second!.id]).toMatchObject({ status: "pending", attempts: 0, last_error_code: null, unconfirmed_since: null, claimed_at: null });

    // Neither statement can touch a row that is not parked.
    const again = await db.query(fill(block("set status = 'pending', attempts = 0"), { "row id": first!.id }));
    expect(again.affectedRows).toBe(0);
  });

  it("closes a delivered lead row and mirrors it on the lead, using the same statement on the lead outbox", async () => {
    const parked = await parkLeadRow();
    const closeOrder = block("set status = 'skipped', last_error_code = 'closed_by_staff'");
    const closeLead = closeOrder.replace("public.order_email_outbox", "public.lead_delivery_events");
    expect((await db.query(fill(closeLead, { "row id": parked.eventId }))).affectedRows).toBe(1);
    const mirror = await db.query(fill(block("set acknowledgement_status = 'skipped'"), { "event id": parked.eventId }));
    expect(mirror.affectedRows).toBe(1);
    const { rows } = await db.query<{ acknowledgement_status: string }>("select acknowledgement_status from public.lead_submissions where id = $1", [parked.lead]);
    expect(rows[0]!.acknowledgement_status).toBe("skipped");
  });

  it("re-queues a lead row with the same statement on the lead outbox", async () => {
    const parked = await parkLeadRow();
    const requeueLead = block("set status = 'pending', attempts = 0").replace("public.order_email_outbox", "public.lead_delivery_events");
    expect((await db.query(fill(requeueLead, { "row id": parked.eventId }))).affectedRows).toBe(1);
    const { rows } = await db.query<{ status: string }>("select status from public.lead_delivery_events where id = $1", [parked.eventId]);
    expect(rows[0]!.status).toBe("pending");
  });
});

describe("the runbook's names", () => {
  it("covers every secret and setting in .env.example by name", () => {
    const names = read(".env.example")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]!);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(runbook, name).toContain(`\`${name}\``);
  });

  it("names the five procedures, links to them from the other docs, and ties each to what the code does", () => {
    for (const heading of ["Removal requests", "Parked emails", "Switching commerce off now", "Rollback", "Secret rotation"]) expect(runbook, heading).toContain(`## ${heading}`);
    expect(read("README.md")).toContain("docs/incident-runbook.md");
    expect(read("docs/deployment.md")).toContain("incident-runbook.md#parked-emails");
    expect(read("docs/observability.md")).toContain("incident-runbook.md#switching-commerce-off-now");
    // The parked states the runbook names are the ones the code and the migration use.
    expect(runbook).toContain("stale_unconfirmed");
    expect(runbook).toContain("delivery_expired");
    expect(runbook).toContain("invalid_idempotent_request");
    expect(read("supabase/migrations/0006_order_events_and_email_outbox.sql")).toContain("stale_unconfirmed");
    expect(read("lib/outbox/constants.ts")).toContain("invalid_idempotent_request");
    expect(read("lib/outbox/constants.ts")).toContain("maxAttempts: 8");
    // Idempotency keys the runbook tells the owner to look up in the provider.
    expect(read("docs/database-security.md")).toContain("lead-delivery/<event id>");
    expect(runbook).toContain("lead-delivery/<event id>");
    expect(runbook).toContain("order-email/<row id>");
    expect(runbook).toMatch(/Instant Rollback/);
    expect(runbook).toMatch(/forward-only/);
    expect(runbook).toMatch(/300 seconds/);
  });
});
