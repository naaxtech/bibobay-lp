import { describe, expect, it, vi } from "vitest";

import { CLOUDFLARE_RANGES, isCloudflareAddress } from "@/lib/leads/cloudflare-ranges";

vi.mock("server-only", () => ({}));

/*
 * Ruling R245: `CF-Connecting-IP` is trusted only when the address Vercel saw is inside Cloudflare's
 * published ranges, so the range check must be exact at every prefix length, including the ones that
 * are not a multiple of 8.
 */

const PUBLISHED = [
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

describe("CLOUDFLARE_RANGES", () => {
  it("is exactly the 22 published ranges, in the published order", () => {
    expect(CLOUDFLARE_RANGES).toEqual(PUBLISHED);
    expect(CLOUDFLARE_RANGES).toHaveLength(22);
  });
});

describe("isCloudflareAddress", () => {
  it.each(PUBLISHED.map((range) => [range, range.split("/")[0]!]))("holds the first address of %s", (_range, first) => {
    expect(isCloudflareAddress(first)).toBe(true);
  });

  it.each([
    ["104.23.255.255", true],
    ["104.24.0.0", true],
    ["104.27.255.255", true],
    ["104.28.0.0", false],
    ["104.15.255.255", false],
    ["172.71.255.255", true],
    ["172.72.0.0", false],
    ["172.63.255.255", false],
    ["162.159.255.255", true],
    ["162.160.0.0", false],
    ["162.157.255.255", false],
    ["198.41.255.255", true],
    ["198.42.0.0", false],
    ["198.41.127.255", false],
    ["173.245.63.255", true],
    ["173.245.64.0", false],
    ["103.21.247.255", true],
    ["103.21.248.0", false],
    ["131.0.75.255", true],
    ["131.0.76.0", false],
    ["141.101.127.255", true],
    ["141.101.128.0", false],
    ["2a06:98c7:ffff::1", true],
    ["2a06:98c8::", false],
    ["2a06:98bf:ffff::1", false],
    ["2606:4700:ffff::1", true],
    ["2606:4701::", false],
    ["2606:46ff:ffff::1", false],
  ])("%s -> %s", (address, inside) => {
    expect(isCloudflareAddress(address)).toBe(inside);
  });

  it.each([["104.16.0.1"], [" 104.16.0.1 "], ["104.16.0.1:443"], ["::ffff:104.16.0.1"], ["[2606:4700::1]:443"], ["2606:4700::1%eth0"]])(
    "reads the forms a proxy writes: %j",
    (raw) => {
      expect(isCloudflareAddress(raw)).toBe(true);
    },
  );

  it.each([["203.0.113.7"], ["2001:db8::1"], [""], ["garbage"], ["104.16.0.1, 10.0.0.1"], ["unknown"]])("refuses %j", (raw) => {
    expect(isCloudflareAddress(raw)).toBe(false);
  });
});
