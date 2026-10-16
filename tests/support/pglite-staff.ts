import type { PGlite } from "@electric-sql/pglite";

import type { StaffDatabase, StaffSelect } from "@/lib/orders/admin";

/**
 * The signed-in user's Supabase client, over PGlite (Task 8b): every read and RPC runs as the
 * `authenticated` role with the user's id as the JWT subject, as PostgREST runs it, so row level
 * security, column grants and the staff checks of migration 0007 decide what comes back. Answers
 * are JSON-shaped (timestamps as ISO strings) and errors carry the SQLSTATE code only, like
 * PostgREST's. `userId: null` is a request with no user in its token.
 */
export function pgliteStaffDatabase(db: PGlite, userId: string | null): StaffDatabase {
  const asUser = async <T>(run: () => Promise<T>): Promise<T> => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await db.exec("set role authenticated");
    try {
      return await run();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  };
  const failed = (error: unknown) => ({ data: null, error: { code: (error as { code?: string }).code, message: "failed" } });
  const identifier = (name: string) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected identifier ${name}`);
    return name;
  };

  return {
    async select(query: StaffSelect) {
      const values: unknown[] = [];
      const where = Object.entries(query.match ?? {}).map(([column, value]) => {
        values.push(value);
        return `${identifier(column)} = $${values.length}`;
      });
      const sql = [
        `select ${query.columns.map(identifier).join(", ")} from public.${identifier(query.table)}`,
        where.length ? `where ${where.join(" and ")}` : "",
        query.order ? `order by ${identifier(query.order.column)} ${query.order.ascending ? "asc" : "desc"}` : "",
        query.limit ? `limit ${Math.trunc(query.limit)}` : "",
      ].join(" ");
      try {
        const result = await asUser(() => db.query<{ row: unknown }>(`select to_jsonb(r) as row from (${sql}) as r`, values));
        return { data: result.rows.map((entry) => entry.row), error: null };
      } catch (error) {
        return failed(error);
      }
    },

    async rpc(fn, args) {
      const names = Object.keys(args);
      if (!/^[a-z_]+$/.test(fn) || names.some((name) => !/^p_[a-z0-9_]+$/.test(name))) throw new Error(`unexpected call ${fn}`);
      const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(", ")})`;
      try {
        const { rows } = await db.query<{ retset: boolean }>(
          "select p.proretset as retset from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
          [fn],
        );
        if (rows.length !== 1) return { data: null, error: { code: "PGRST202", message: "no such function" } };
        const values = Object.values(args);
        if (rows[0]!.retset) {
          const result = await asUser(() => db.query<{ row: unknown }>(`select to_jsonb(r) as row from ${call} r`, values));
          return { data: result.rows.map((entry) => entry.row), error: null };
        }
        const result = await asUser(() => db.query<{ value: unknown }>(`select to_jsonb(${call}) as value`, values));
        return { data: result.rows[0]?.value ?? null, error: null };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/** Auth users and staff rows for the staff tests, written as the database owner would. */
export const STAFF_FIXTURE = {
  active: "00000000-0000-4000-8000-0000000000b1",
  inactive: "00000000-0000-4000-8000-0000000000b2",
  visitor: "00000000-0000-4000-8000-0000000000b3",
} as const;

export async function seedStaff(db: PGlite): Promise<void> {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${STAFF_FIXTURE.active}', 'staff@example.com'),
      ('${STAFF_FIXTURE.inactive}', 'former-staff@example.com'),
      ('${STAFF_FIXTURE.visitor}', 'visitor@example.com')
    on conflict do nothing;
    insert into public.staff_users (user_id, display_name) values ('${STAFF_FIXTURE.active}', 'Jo') on conflict do nothing;
    insert into public.staff_users (user_id, display_name, active, disabled_at) values ('${STAFF_FIXTURE.inactive}', 'Former', false, now()) on conflict do nothing;
  `);
}

/** A fresh order, made by submit_order as the order route makes it (service_role). */
export async function seedOrder(db: PGlite, email = "buyer@example.com"): Promise<{ orderId: string; reference: string; trackingToken: string }> {
  await db.exec("set role service_role");
  try {
    const { rows } = await db.query<{ order_id: string; reference: string; tracking_token: string }>(
      `select order_id, reference, tracking_token from public.submit_order(
         p_contact_name => 'Sam Rivers', p_email => $1, p_address_line1 => '12 Harbour Road', p_city => 'Seaside',
         p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
         p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2}]'::jsonb,
         p_submission_key => gen_random_uuid(), p_phone => '+61 2 5550 1234', p_notes => 'Leave at the door')`,
      [email],
    );
    const row = rows[0]!;
    return { orderId: row.order_id, reference: row.reference, trackingToken: row.tracking_token };
  } finally {
    await db.exec("reset role");
  }
}
