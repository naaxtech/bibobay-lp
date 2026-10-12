import { describe, expect, it, vi } from "vitest";

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
