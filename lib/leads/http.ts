import "server-only";

import { createHmac } from "node:crypto";

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
 * On Vercel the left-most `x-forwarded-for` entry is written by the platform edge, not the client.
 * Behind another proxy that passes a client-supplied header through, a caller could rotate it to get
 * fresh buckets; revisit this before hosting anywhere else.
 */
export function clientKeyFromHeaders(headers: Headers, secret: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHmac("sha256", secret).update(clientAddressBucket(address)).digest("hex");
}

const IPV4_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i;

/** Four octets of a dotted IPv4 address, or null. Leading zeros are refused (they read as octal in some parsers). */
function parseIpv4(value: string): number[] | null {
  const match = IPV4_PATTERN.exec(value);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Eight 16-bit groups of an IPv6 address (compressed, expanded, or with a trailing dotted IPv4), or null. */
function parseIpv6(value: string): number[] | null {
  const address = value.replace(/%[0-9A-Za-z_.~-]+$/, "");
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const groupsOf = (part: string | undefined): string[] | null => {
    if (part === undefined || part === "") return [];
    const groups = part.split(":");
    const last = groups.at(-1)!;
    if (last.includes(".")) {
      const octets = parseIpv4(last);
      if (!octets) return null;
      groups.splice(-1, 1, ((octets[0]! << 8) | octets[1]!).toString(16), ((octets[2]! << 8) | octets[3]!).toString(16));
    }
    return groups.every((group) => HEX_GROUP_PATTERN.test(group)) ? groups : null;
  };

  const compressed = halves.length === 2;
  const head = groupsOf(halves[0]);
  const tail = compressed ? groupsOf(halves[1]) : [];
  if (!head || !tail) return null;
  // A dotted IPv4 part may only end the address.
  if (compressed && head.length > 0 && halves[0]!.includes(".")) return null;
  const given = head.length + tail.length;
  if (compressed ? given > 7 : given !== 8) return null;
  return [...head, ...Array<string>(8 - given).fill("0"), ...tail].map((group) => parseInt(group, 16));
}

/**
 * The rate-limit bucket for one client address: `ipv4:<address>`, `ipv6:<first four groups>::/64`,
 * or `unknown`. Accepts the forms proxies write: surrounding spaces, `a.b.c.d:port`, `[v6]` and
 * `[v6]:port`, and a `%zone` suffix.
 */
export function clientAddressBucket(raw: string): string {
  let value = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else value = value.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/, "$1");

  const ipv4 = parseIpv4(value);
  if (ipv4) return `ipv4:${ipv4.join(".")}`;

  const ipv6 = parseIpv6(value);
  if (!ipv6) return "unknown";
  const mapped = ipv6.slice(0, 5).every((group) => group === 0) && ipv6[5] === 0xffff;
  if (mapped) return `ipv4:${[ipv6[6]! >> 8, ipv6[6]! & 0xff, ipv6[7]! >> 8, ipv6[7]! & 0xff].join(".")}`;
  return `ipv6:${ipv6.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
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
