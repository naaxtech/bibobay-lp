import "server-only";

import { createHmac } from "node:crypto";

import { clientAddressBucket, clientAddressFromHeaders } from "./client-address";

/**
 * Request helpers for the lead route.
 *
 * Client key (ruling R26): the rate-limit bucket is keyed by an HMAC-SHA256 of the client's address
 * bucket under a server secret, so the database never holds a raw address and a leaked bucket table
 * cannot be reversed by hashing the IPv4 space. The key is never joined to a lead row.
 *
 * Address bucket (ruling R40): an IPv4 client is its whole address. An IPv6 client controls at least
 * a /64, so every address in one /64 shares a bucket; otherwise rotating through one's own /64 would
 * hand out fresh budgets without limit. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) counts as the
 * IPv4 address. Anything unreadable shares one "unknown" bucket rather than getting a fresh one.
 *
 * Which address is the client's (rulings R245, R248, R249; `clientAddressFromHeaders`): on Vercel the
 * left-most `x-forwarded-for` entry is written by the platform edge, not the client. Behind the Cloudflare
 * proxy that entry is a Cloudflare server, so every visitor would share one bucket. `CF-Connecting-IP` names
 * the visitor but cannot be trusted by itself: a Worker on any Cloudflare account sends requests from
 * Cloudflare's ranges with a `CF-Connecting-IP` of its choosing. It is read only when the edge is inside
 * Cloudflare's published ranges AND the request carries `x-bibobay-origin` equal to `CLOUDFLARE_ORIGIN_SECRET`,
 * which our own zone's Transform Rule adds. Without that secret the edge address is used, as before. Behind
 * any other proxy that passes a client-supplied header through, a caller could rotate it to get fresh
 * buckets; revisit this before hosting anywhere else.
 * src: https://vercel.com/docs/headers/request-headers · fetched 2026-10-22 (Vercel overwrites `X-Forwarded-For`
 * and does not forward external IPs; a custom one needs Enterprise Trusted Proxy)
 * src: https://vercel.com/docs/security/reverse-proxy · fetched 2026-10-22 (Verified Proxy Lite lists Cloudflare's `CF-Connecting-IP`)
 */
export function clientKeyFromHeaders(headers: Headers, secret: string, originSecret: string | undefined): string {
  return createHmac("sha256", secret).update(clientAddressBucket(clientAddressFromHeaders(headers, originSecret).address)).digest("hex");
}

export { clientAddressBucket };

/** Largest request body the lead route reads. A real signup is well under 1 KB. */
export const LEAD_BODY_LIMIT_BYTES = 8 * 1024;

export type BodyReadResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

/** Reads at most `limit` bytes of the body, stopping (and cancelling the stream) once it is exceeded. */
export async function readBodyWithLimit(request: Request, limit = LEAD_BODY_LIMIT_BYTES): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/**
 * JSON only. Besides keeping the parser simple, this is the route's CSRF guard: a cross-site page
 * cannot send `application/json` without a CORS preflight, which this route never approves.
 */
export function isJsonRequest(request: Request): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}
