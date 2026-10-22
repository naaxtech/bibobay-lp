import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { cloudflareOriginSecretFrom } from "@/lib/security/secrets";

/**
 * Who is the client? One leaf module for reading a client address (it imports nothing from lib/leads).
 * The address bucket is ruling R40 (`clientAddressBucket`); the trust decision is rulings R245, R248 and
 * R249 (`clientAddressFromHeaders`).
 */

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
 * The groups of one client address as proxies write it (surrounding spaces, `a.b.c.d:port`, `[v6]` and
 * `[v6]:port`, a `%zone` suffix): four octets for IPv4 or an IPv4-mapped IPv6 address, eight 16-bit groups
 * for other IPv6, or null when unreadable.
 */
export function parseClientAddress(raw: string): number[] | null {
  let value = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else value = value.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/, "$1");

  const ipv4 = parseIpv4(value);
  if (ipv4) return ipv4;

  const ipv6 = parseIpv6(value);
  if (!ipv6) return null;
  const mapped = ipv6.slice(0, 5).every((group) => group === 0) && ipv6[5] === 0xffff;
  if (mapped) return [ipv6[6]! >> 8, ipv6[6]! & 0xff, ipv6[7]! >> 8, ipv6[7]! & 0xff];
  return ipv6;
}

/**
 * The rate-limit bucket for one client address: `ipv4:<address>`, `ipv6:<first four groups>::/64`,
 * or `unknown`. Accepts the forms `parseClientAddress` reads.
 */
export function clientAddressBucket(raw: string): string {
  const groups = parseClientAddress(raw);
  if (!groups) return "unknown";
  if (groups.length === 4) return `ipv4:${groups.join(".")}`;
  return `ipv6:${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/**
 * Cloudflare's published proxy ranges (ruling R245): `CF-Connecting-IP` is trusted only when the address
 * Vercel saw is inside one of these (and the request carries our secret, R248). Refresh the list when Cloudflare changes it.
 * src: https://www.cloudflare.com/ips/ · list last updated 2023-09-28 · fetched 2026-10-22
 */
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

type ParsedRange = { groups: number[]; prefix: number };

const PARSED_RANGES: ParsedRange[] = CLOUDFLARE_RANGES.map((range) => {
  const [base, length] = range.split("/");
  // An IPv4 range has four octets and an IPv6 range eight groups; `parseClientAddress` reads both.
  return { groups: parseClientAddress(base!)!, prefix: Number(length) };
});

/** True when the first `prefix` bits of `address` equal those of `base`. Both have the same group width. */
function samePrefix(address: number[], base: number[], prefix: number): boolean {
  const width = address.length === 4 ? 8 : 16;
  let remaining = prefix;
  for (let index = 0; index < address.length && remaining > 0; index += 1) {
    const bits = Math.min(width, remaining);
    const shift = width - bits;
    if (address[index]! >> shift !== base[index]! >> shift) return false;
    remaining -= bits;
  }
  return true;
}

/**
 * Whether one address is a Cloudflare proxy address. Accepts the raw forms `clientAddressBucket` does
 * (spaces, `:port`, `[v6]`, `%zone`); an IPv4-mapped IPv6 address counts as IPv4 (R246). Unreadable
 * input, including a comma list, is not Cloudflare.
 */
export function isCloudflareAddress(address: string): boolean {
  const groups = parseClientAddress(address);
  if (!groups) return false;
  return PARSED_RANGES.some((range) => range.groups.length === groups.length && samePrefix(groups, range.groups, range.prefix));
}

/** The request header our zone's Transform Rule sets to `CLOUDFLARE_ORIGIN_SECRET` (R248). */
export const ORIGIN_SECRET_HEADER = "x-bibobay-origin";

/** Equal without leaking where they differ or throwing on a length mismatch: compare fixed-length digests. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

export interface ClientAddress {
  /** The address to key the rate limit on: the visitor's when trusted, else the address Vercel saw. */
  address: string;
  /** The address Vercel saw (left-most `x-forwarded-for`, else `x-real-ip`) is inside a Cloudflare range. */
  cloudflareEdge: boolean;
  /** The secret is configured and this request carried it. */
  cloudflareOrigin: boolean;
}

/**
 * The one trust decision (R245, R248, R249). `CF-Connecting-IP` is the visitor's address only when ALL hold:
 * the edge address is in a Cloudflare range; `originSecret` is a well-formed secret and the request's
 * `x-bibobay-origin` equals it; and the header is one readable address outside Class E (240.0.0.0/4,
 * Cloudflare's Pseudo IPv4). Otherwise it is the edge address. A request from any Cloudflare account's Worker
 * leaves from Cloudflare's ranges and may set `CF-Connecting-IP` freely, so only the secret, which only our
 * own zone's Transform Rule adds, authenticates our zone; the range check is defence in depth against a
 * leaked secret used from a direct connection.
 * src: https://developers.cloudflare.com/fundamentals/reference/http-headers/ · fetched 2026-10-22
 */
export function clientAddressFromHeaders(headers: Headers, originSecret: string | undefined): ClientAddress {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const edge = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  const cloudflareEdge = isCloudflareAddress(edge);
  const secret = cloudflareOriginSecretFrom({ CLOUDFLARE_ORIGIN_SECRET: originSecret });
  const given = headers.get(ORIGIN_SECRET_HEADER);
  const cloudflareOrigin = secret !== null && given !== null && sameSecret(given.trim(), secret);
  const visitor = headers.get("cf-connecting-ip")?.trim();
  const groups = visitor ? parseClientAddress(visitor) : null;
  const classE = groups !== null && groups.length === 4 && groups[0]! >= 240;
  const trusted = cloudflareEdge && cloudflareOrigin && visitor && groups !== null && !classE;
  return { address: trusted ? visitor : edge, cloudflareEdge, cloudflareOrigin };
}
