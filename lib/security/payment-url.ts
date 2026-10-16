/*
 * Payment links on quotes (Task 8b; spec §10 step 8, ruling R97).
 *
 * A quote's payment link is sent to the buyer, so it must lead to one of the payment providers the
 * owner named, and nowhere else. `validatePaymentUrl` accepts a link only when it is https, carries
 * no user info, uses the default port, names no IP address, holds no whitespace or control
 * characters, stays within 2,048 characters (the database bound, migration 0002), and its host
 * (after WHATWG URL parsing: lower case, punycode) is exactly one entry of the allowlist. No
 * wildcards and no subdomains: `pay.example.com` allows that host only.
 *
 * The allowlist is PAYMENT_HOST_ALLOWLIST, a comma-separated list of hosts (server only). Empty or
 * unset accepts no payment link at all, and the quote save says why.
 *
 * No imports: scripts/verify-env.ts (run by tsx without the "@/" alias) checks the list's shape
 * with the same parser.
 */

export const PAYMENT_URL_MAX_LENGTH = 2048;

export type PaymentUrlRefusal =
  | "invalid"
  | "not_https"
  | "credentials"
  | "port"
  | "ip_literal"
  | "too_long"
  | "host_not_allowed"
  | "no_allowed_hosts";

export type PaymentUrlResult = { ok: true; url: string } | { ok: false; reason: PaymentUrlRefusal };

/** Any whitespace (Unicode included) or control character. The URL parser would silently strip some. */
const UNSAFE_CHARACTER = /[\s\u0000-\u001f\u007f-\u009f]/u;
/** What the URL parser leaves for an IPv4 host in any spelling (`0x7f.1`, `2130706433`). */
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** One exact DNS host after parsing: two or more labels of letters, digits and inner hyphens. */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const refuse = (reason: PaymentUrlRefusal): PaymentUrlResult => ({ ok: false, reason });

export function validatePaymentUrl(value: unknown, allowedHosts: readonly string[]): PaymentUrlResult {
  if (typeof value !== "string" || value.length === 0 || UNSAFE_CHARACTER.test(value)) return refuse("invalid");
  if (value.length > PAYMENT_URL_MAX_LENGTH) return refuse("too_long");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse("invalid");
  }
  if (url.protocol !== "https:") return refuse("not_https");
  if (url.username !== "" || url.password !== "" || /^https:\/\/[^/?#]*@/i.test(value)) return refuse("credentials");
  if (url.port !== "") return refuse("port");
  if (url.hostname.startsWith("[") || IPV4_HOST.test(url.hostname)) return refuse("ip_literal");
  if (url.href.length > PAYMENT_URL_MAX_LENGTH) return refuse("too_long");
  if (allowedHosts.length === 0) return refuse("no_allowed_hosts");
  if (!allowedHosts.includes(url.hostname)) return refuse("host_not_allowed");
  return { ok: true, url: url.href };
}

/** One allowlist entry as the exact host it names, or null when it is anything else. */
function exactHost(entry: string): string | null {
  if (UNSAFE_CHARACTER.test(entry) || /[/:@*?#[\]\\]/.test(entry)) return null;
  let host: string;
  try {
    host = new URL(`https://${entry}/`).hostname;
  } catch {
    return null;
  }
  return HOST.test(host) && !IPV4_HOST.test(host) ? host : null;
}

/**
 * PAYMENT_HOST_ALLOWLIST as exact hosts. Entries that are not one exact host (a wildcard, a URL, a
 * port, an IP address, a single label) are dropped and counted, so a typo can never widen the
 * list; scripts/verify-env.ts fails the build on any (counts only, never the value).
 */
export function parsePaymentHostAllowlist(raw: string | undefined): { hosts: string[]; invalid: number } {
  const hosts: string[] = [];
  let invalid = 0;
  for (const entry of (raw ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const host = exactHost(entry);
    if (!host) invalid += 1;
    else if (!hosts.includes(host)) hosts.push(host);
  }
  return { hosts, invalid };
}

export function paymentHostsFrom(env: Readonly<Record<string, string | undefined>>): string[] {
  return parsePaymentHostAllowlist(env.PAYMENT_HOST_ALLOWLIST).hosts;
}
