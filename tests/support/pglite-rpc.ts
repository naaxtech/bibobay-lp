import type { PGlite } from "@electric-sql/pglite";

import type { RpcClient } from "@/lib/supabase/rpc";

/**
 * An RpcClient over PGlite that calls each RPC as PostgREST does: by name, with named arguments,
 * as service_role. A renamed argument or a changed answer shape then fails the adapter tests the
 * way it would fail against Supabase. (tests/orders/supabase-orders-adapter.test.ts keeps its own
 * copy from Task 7a; this one also passes arrays, as PostgREST converts a JSON array argument to a
 * Postgres array.)
 */
export function pgliteRpc(db: PGlite): RpcClient {
  return {
    async rpc(fn, args) {
      const names = Object.keys(args);
      if (!/^[a-z_]+$/.test(fn) || names.some((name) => !/^p_[a-z0-9_]+$/.test(name))) throw new Error(`unexpected call ${fn}`);
      const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(", ")})`;
      const values = Object.values(args).map((value) => (value !== null && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value));
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
