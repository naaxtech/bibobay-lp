import { describe, expect, it, vi } from "vitest";

import { clientAddressFromHeaders } from "@/lib/leads/client-address";
import { clientAddressBucket, clientKeyFromHeaders } from "@/lib/leads/http";

vi.mock("server-only", () => ({}));

/*
 * Ruling R40: one client gets one rate-limit bucket. An IPv4 client is its full address. An IPv6
 * client controls at least a /64, so its bucket is the /64, whatever form the address is written in;
 * otherwise rotating addresses inside one's own /64 would hand out fresh budgets without limit.
 */

describe("clientAddressBucket", () => {
  it.each([
    ["203.0.113.9", "ipv4:203.0.113.9"],
    [" 203.0.113.9 ", "ipv4:203.0.113.9"],
    ["203.0.113.9:51234", "ipv4:203.0.113.9"],
    ["0.0.0.0", "ipv4:0.0.0.0"],
    ["255.255.255.255", "ipv4:255.255.255.255"],
  ])("keeps a whole IPv4 address: %s", (raw, bucket) => {
    expect(clientAddressBucket(raw)).toBe(bucket);
  });

  it.each([
    ["::ffff:203.0.113.9"],
    ["::FFFF:203.0.113.9"],
    ["0:0:0:0:0:ffff:203.0.113.9"],
    ["::ffff:cb00:7109"],
    ["[::ffff:203.0.113.9]:443"],
  ])("treats an IPv4-mapped IPv6 address as the IPv4 address: %s", (raw) => {
    expect(clientAddressBucket(raw)).toBe("ipv4:203.0.113.9");
  });

  it.each([
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348"],
    ["2001:db8:85a3:8d3::1"],
    ["2001:0DB8:85A3:08D3:0000:0000:0000:0001"],
    ["2001:db8:85a3:8d3:ffff:ffff:ffff:ffff"],
    ["[2001:db8:85a3:8d3::abcd]"],
    ["[2001:db8:85a3:8d3::abcd]:8443"],
    ["2001:db8:85a3:8d3::1%eth0"],
    ["2001:db8:85a3:8d3:0:0:192.0.2.1"],
  ])("buckets every address in one IPv6 /64 together: %s", (raw) => {
    expect(clientAddressBucket(raw)).toBe("ipv6:2001:db8:85a3:8d3::/64");
  });

  it("keeps neighbouring IPv6 /64s apart", () => {
    expect(clientAddressBucket("2001:db8:85a3:8d4::1")).toBe("ipv6:2001:db8:85a3:8d4::/64");
    expect(clientAddressBucket("2001:db8:85a3:8d3::1")).not.toBe(clientAddressBucket("2001:db8:85a3:8d4::1"));
  });

  it("handles compression at either end", () => {
    expect(clientAddressBucket("::1")).toBe("ipv6:0:0:0:0::/64");
    expect(clientAddressBucket("::")).toBe("ipv6:0:0:0:0::/64");
    expect(clientAddressBucket("fe80::")).toBe("ipv6:fe80:0:0:0::/64");
  });

  it.each([
    [""],
    ["unknown"],
    ["not an address"],
    ["256.1.1.1"],
    ["1.2.3"],
    ["1.2.3.4.5"],
    ["01.2.3.4"],
    ["2001:db8::1::2"],
    ["2001:db8:1:2:3:4:5:6:7"],
    ["12345::1"],
    ["gggg::1"],
    [":::"],
    ["2001:db8:1:2:3:4:5:6::"],
  ])("puts an unreadable address in one shared bucket rather than a fresh one each time: %j", (raw) => {
    expect(clientAddressBucket(raw)).toBe("unknown");
  });
});

describe("clientKeyFromHeaders", () => {
  it("is a keyed hash of the client's bucket, never the address itself", () => {
    const key = clientKeyFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "secret-a");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "::ffff:203.0.113.9" }), "secret-a")).toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" }), "secret-a")).toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9" }), "secret-b")).not.toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.4" }), "secret-a")).not.toBe(key);
  });

  it("gives every address in one IPv6 /64 the same key, and another /64 a different one", () => {
    const key = (address: string) => clientKeyFromHeaders(new Headers({ "x-forwarded-for": address }), "secret-a");
    expect(key("2001:db8:1:2::a")).toBe(key("2001:db8:1:2:ffff:ffff:ffff:1"));
    expect(key("2001:db8:1:2::a")).not.toBe(key("2001:db8:1:3::a"));
  });
});

/*
 * Rulings R245, R248, R249: behind the Cloudflare proxy, Vercel's `x-forwarded-for` is a Cloudflare address.
 * The visitor's own address in `cf-connecting-ip` counts only when the edge is Cloudflare's AND the request
 * carries our zone's secret header AND the header is a readable, non-Class-E address. A Worker on any
 * Cloudflare account can set `cf-connecting-ip` from Cloudflare's ranges, so the range alone proves nothing.
 */
describe("clientKeyFromHeaders behind Cloudflare", () => {
  const SECRET = "origin-secret-0123456789abcdefghijklmnop";
  const SAME_LENGTH_WRONG = "origin-secret-0123456789abcdefghijklmnoq";
  type Fields = Record<string, string | undefined>;
  const headersOf = (fields: Fields) => new Headers(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const key = (fields: Fields, originSecret: string | undefined = SECRET) => clientKeyFromHeaders(headersOf(fields), "secret-a", originSecret);
  const direct = (address: string) => key({ "x-forwarded-for": address }, undefined);
  const trusted = (extra: Fields = {}): Fields => ({ "x-forwarded-for": "104.16.0.1", "cf-connecting-ip": "203.0.113.7", "x-bibobay-origin": SECRET, ...extra });

  it("keys a request that carries our secret through a Cloudflare edge on the visitor's address", () => {
    expect(key(trusted())).toBe(direct("203.0.113.7"));
  });

  it("gives two visitors behind the same Cloudflare server different keys", () => {
    expect(key(trusted())).not.toBe(key(trusted({ "cf-connecting-ip": "203.0.113.8" })));
  });

  it.each([[undefined], [""], ["short"], ["origin secret with spaces 0123456789abcdef"], ["x".repeat(257)]])("never trusts the header when the secret is %j", (secret) => {
    expect(clientKeyFromHeaders(headersOf(trusted({ "x-bibobay-origin": secret })), "secret-a", secret)).toBe(direct("104.16.0.1"));
  });

  it.each([
    ["missing", undefined],
    ["wrong, same length", SAME_LENGTH_WRONG],
    ["wrong, shorter", SECRET.slice(0, -1)],
    ["wrong, longer", `${SECRET}x`],
  ])("ignores the visitor header when the secret header is %s", (_name, value) => {
    expect(key(trusted({ "x-bibobay-origin": value }))).toBe(direct("104.16.0.1"));
  });

  it("ignores a correct secret header from an edge that is not Cloudflare's", () => {
    expect(key(trusted({ "x-forwarded-for": "198.51.100.1" }))).toBe(direct("198.51.100.1"));
  });

  it("ignores a Worker's forged header: Cloudflare edge, no secret header, even with cf-worker", () => {
    expect(key(trusted({ "cf-worker": "attacker.example", "cf-connecting-ip": "198.51.100.99", "x-bibobay-origin": undefined }))).toBe(direct("104.16.0.1"));
  });

  it("never trusts a Class E (240.0.0.0/4) visitor address, Cloudflare's Pseudo IPv4", () => {
    expect(key(trusted({ "cf-connecting-ip": "240.16.0.1" }))).toBe(direct("104.16.0.1"));
    expect(key(trusted({ "cf-connecting-ip": "255.255.255.255" }))).toBe(direct("104.16.0.1"));
    expect(key(trusted({ "cf-connecting-ip": "::ffff:240.16.0.1" }))).toBe(direct("104.16.0.1"));
    expect(key(trusted({ "cf-connecting-ip": "239.255.255.255" }))).toBe(direct("239.255.255.255"));
  });

  it.each([[""], ["garbage"], ["1.2.3.4, 5.6.7.8"], [undefined]])("falls back to the Cloudflare address for the header %j", (value) => {
    expect(key(trusted({ "cf-connecting-ip": value }))).toBe(direct("104.16.0.1"));
  });

  it("buckets an IPv6 visitor by its /64, bracketed or not", () => {
    const expected = direct("2001:db8:1:2::9");
    expect(key(trusted({ "x-forwarded-for": "2606:4700::1", "cf-connecting-ip": "2001:db8:1:2::5" }))).toBe(expected);
    expect(key(trusted({ "cf-connecting-ip": "[2001:db8:1:2::5]" }))).toBe(expected);
  });

  it("reads the edge from x-real-ip when x-forwarded-for is absent", () => {
    expect(key(trusted({ "x-forwarded-for": undefined, "x-real-ip": "104.16.0.1" }))).toBe(direct("203.0.113.7"));
  });

  it("reads an IPv4-mapped Cloudflare edge as IPv4", () => {
    expect(key(trusted({ "x-forwarded-for": "::ffff:104.16.0.1" }))).toBe(direct("203.0.113.7"));
  });

  it("uses only the left-most x-forwarded-for entry as the edge", () => {
    expect(key(trusted({ "x-forwarded-for": "198.51.100.1, 104.16.0.1" }))).toBe(direct("198.51.100.1"));
  });

  it("keeps the unknown bucket when no edge address is present, whatever the header says", () => {
    expect(key({ "cf-connecting-ip": "203.0.113.7", "x-bibobay-origin": SECRET })).toBe(key({}));
  });
});

describe("clientAddressFromHeaders", () => {
  const SECRET = "origin-secret-0123456789abcdefghijklmnop";
  const base = { "x-forwarded-for": "104.16.0.1", "cf-connecting-ip": "203.0.113.7" };

  it("reports the two flags independently of whether the visitor address is trusted", () => {
    expect(clientAddressFromHeaders(new Headers({ ...base, "x-bibobay-origin": SECRET }), SECRET)).toEqual({ address: "203.0.113.7", cloudflareEdge: true, cloudflareOrigin: true });
    expect(clientAddressFromHeaders(new Headers(base), SECRET)).toEqual({ address: "104.16.0.1", cloudflareEdge: true, cloudflareOrigin: false });
    expect(clientAddressFromHeaders(new Headers({ ...base, "x-forwarded-for": "198.51.100.1", "x-bibobay-origin": SECRET }), SECRET)).toEqual({ address: "198.51.100.1", cloudflareEdge: false, cloudflareOrigin: true });
    expect(clientAddressFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.1" }), undefined)).toEqual({ address: "198.51.100.1", cloudflareEdge: false, cloudflareOrigin: false });
  });

  it("never reports the origin as confirmed when the secret is unset or malformed", () => {
    expect(clientAddressFromHeaders(new Headers({ ...base, "x-bibobay-origin": "short" }), "short").cloudflareOrigin).toBe(false);
    expect(clientAddressFromHeaders(new Headers({ ...base, "x-bibobay-origin": "" }), undefined).cloudflareOrigin).toBe(false);
  });
});
