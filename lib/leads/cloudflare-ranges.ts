import { parseClientAddress } from "./http";

/**
 * Cloudflare's published proxy ranges (ruling R245): `CF-Connecting-IP` is trusted only when the address
 * Vercel saw is inside one of these. Refresh the list when Cloudflare changes it.
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

let parsed: ParsedRange[] | null = null;

/** Parsed on first use, not at import, because `./http` and this file import each other. */
function parsedRanges(): ParsedRange[] {
  parsed ??= CLOUDFLARE_RANGES.map((range) => {
    const [base, length] = range.split("/");
    // An IPv4 range has four octets and an IPv6 range eight groups; `parseClientAddress` reads both.
    return { groups: parseClientAddress(base!)!, prefix: Number(length) };
  });
  return parsed;
}

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
  return parsedRanges().some((range) => range.groups.length === groups.length && samePrefix(groups, range.groups, range.prefix));
}
