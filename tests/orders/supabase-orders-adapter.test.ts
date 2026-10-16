import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OrderRecordInput } from "@/lib/orders/submit";
import { createSupabaseOrderRepository } from "@/lib/supabase/orders";
import type { RpcClient } from "@/lib/supabase/rpc";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * Review Minor 2: the order adapter (lib/supabase/orders.ts) against the real migrations, not a
 * fixture. The client below calls each RPC as PostgREST does: by name, with named arguments, as
 * service_role; so a renamed argument or a changed answer shape fails here.
 */
function pgliteRpc(db: PGlite): RpcClient {
  return {
    async rpc(fn, args) {
      const names = Object.keys(args);
      if (!/^[a-z_]+$/.test(fn) || names.some((name) => !/^p_[a-z0-9_]+$/.test(name))) throw new Error(`unexpected call ${fn}`);
      const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(", ")})`;
      const values = Object.values(args).map((value) => (value !== null && typeof value === "object" ? JSON.stringify(value) : value));
      try {
        const { rows } = await db.query<{ retset: boolean }>(
          "select p.proretset as retset from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
          [fn],
        );
        if (rows.length !== 1) return { data: null, error: { code: "PGRST202", message: "no such function" } };
        await db.exec("set role service_role");
        try {
          if (rows[0]!.retset) {
            const result = await db.query<{ row: unknown }>(`select to_jsonb(r) as row from ${call} r`, values);
            return { data: result.rows.map((entry) => entry.row), error: null };
          }
          const result = await db.query<{ value: unknown }>(`select to_jsonb(${call}) as value`, values);
          return { data: result.rows[0]?.value ?? null, error: null };
        } finally {
          await db.exec("reset role");
        }
      } catch (error) {
        return { data: null, error: { code: (error as { code?: string }).code, message: "failed" } };
      }
    },
  };
}

const RECORD: OrderRecordInput = {
  contactName: "Alex Rivera",
  email: "parent@example.com",
  phone: "+63 912 345 6789",
  addressLine1: "12 Reef Road",
  city: "Cebu City",
  country: "PH",
  notes: "Please call before delivery.",
  consentVersion: "2026-10.v1",
  submissionKey: "3b0e2f4a-5c6d-4e7f-8a9b-0c1d2e3f4a5b",
  lines: [
    { productId: "plush-tula", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: null, quantity: 2 },
    { productId: "book-bubbles", name: "Bubble breathing book", sku: null, variant: null, pack: "Pack of 3", quantity: 1 },
  ],
};

let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the order adapter against the real migrations", () => {
  it("stores an order, tracks it both ways, and rotates its token", async () => {
    const repository = createSupabaseOrderRepository(pgliteRpc(db));
    const stored = await repository.submitOrder(RECORD);
    expect(stored.reference).toMatch(/^BB-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(stored.trackingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.acknowledgementQueued).toBe(true);
    expect(stored.duplicate).toBe(false);
    if (stored.duplicate) return;
    expect(Date.parse(stored.trackingTokenExpiresAt)).toBeGreaterThan(Date.now());

    const expected = {
      reference: stored.reference,
      status: "new",
      lines: [
        { title: "Tula plush", variant: "Large", pack: null, quantity: 2 },
        { title: "Bubble breathing book", variant: null, pack: "Pack of 3", quantity: 1 },
      ],
    };
    expect(await repository.lookupByToken(stored.trackingToken)).toMatchObject(expected);
    expect(await repository.lookupByReferenceAndEmail(stored.reference, RECORD.email)).toMatchObject(expected);
    expect(await repository.lookupByReferenceAndEmail(stored.reference, "someone@example.com")).toBeNull();

    const rotated = await repository.rotateTrackingToken(stored.orderId);
    expect(rotated.trackingToken).not.toBe(stored.trackingToken);
    expect(await repository.lookupByToken(stored.trackingToken)).toBeNull();
    expect(await repository.lookupByToken(rotated.trackingToken)).toMatchObject(expected);
  });

  it("answers a repeated submission key with the first order: same reference, no new token, nothing queued (R81)", async () => {
    const repository = createSupabaseOrderRepository(pgliteRpc(db));
    const record: OrderRecordInput = { ...RECORD, submissionKey: "7d1c9e2b-4a3f-4c6d-9e8f-1a2b3c4d5e6f" };
    const first = await repository.submitOrder(record);
    expect(first.duplicate).toBe(false);
    // The retry of a request whose answer was lost: the same key, the email as the person typed it again.
    const again = await repository.submitOrder({ ...record, email: " PARENT@example.com " });
    expect(again).toEqual({ orderId: first.orderId, reference: first.reference, trackingToken: null, trackingTokenExpiresAt: null, acknowledgementQueued: false, duplicate: true });
    // The first order's private link keeps working; nothing was replaced.
    if (first.duplicate) return;
    expect(await repository.lookupByToken(first.trackingToken)).toMatchObject({ reference: first.reference });
  });

  it("refuses a repeated submission key with another email as a value-free error (R81)", async () => {
    const repository = createSupabaseOrderRepository(pgliteRpc(db));
    const record: OrderRecordInput = { ...RECORD, submissionKey: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" };
    await repository.submitOrder(record);
    const error = await repository.submitOrder({ ...record, email: "someone-else@example.com" }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("submit_order failed (23505)");
  });

  it("surfaces a database refusal as an RpcError naming only the function", async () => {
    const repository = createSupabaseOrderRepository(pgliteRpc(db));
    await expect(repository.submitOrder({ ...RECORD, country: "Philippines" })).rejects.toThrow(/^submit_order failed \(/);
  });
});
