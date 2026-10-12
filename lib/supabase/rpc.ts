/**
 * The narrow view of a Supabase client that the lead code needs: one RPC call. Keeping it this
 * small lets tests inject a fake without the Supabase SDK, and keeps every database touch an RPC
 * (the lead tables grant nothing to any API role; see supabase/migrations/0001).
 */
export interface RpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

/**
 * A failed or unreadable RPC. The message names only the function and a database error code, never
 * the arguments or the database's own message, which can echo submitted values.
 */
export class RpcError extends Error {
  readonly rpc: string;
  readonly code: string;

  constructor(rpc: string, code: string | undefined) {
    const safeCode = code && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown";
    super(`${rpc} failed (${safeCode})`);
    this.name = "RpcError";
    this.rpc = rpc;
    this.code = safeCode;
  }
}

/** PostgREST answers a `returns table` function with an array; a scalar-shaped answer is accepted too. */
export function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
}

/** Calls an RPC and returns its data, throwing an `RpcError` (never the raw database message) on failure. */
export async function callRpc(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new RpcError(fn, error.code);
  return data;
}
