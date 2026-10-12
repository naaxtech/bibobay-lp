import "server-only";

import { createHmac } from "node:crypto";

/**
 * Request helpers for the lead route.
 *
 * Client key (ruling R26): the rate-limit bucket is keyed by an HMAC-SHA256 of the client address
 * under a server secret, so the database never holds a raw address and a leaked bucket table cannot
 * be reversed by hashing the IPv4 space. The key is never joined to a lead row.
 *
 * On Vercel the left-most `x-forwarded-for` entry is written by the platform edge, not the client.
 * Behind another proxy that passes a client-supplied header through, a caller could rotate it to get
 * fresh buckets; revisit this before hosting anywhere else.
 */
export function clientKeyFromHeaders(headers: Headers, secret: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHmac("sha256", secret).update(address).digest("hex");
}

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
