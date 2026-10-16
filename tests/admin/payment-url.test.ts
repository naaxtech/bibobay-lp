import { describe, expect, it } from "vitest";

import { PAYMENT_URL_MAX_LENGTH, parsePaymentHostAllowlist, paymentHostsFrom, validatePaymentUrl } from "@/lib/security/payment-url";
import { verifyEnvironment } from "@/scripts/verify-env";

/*
 * Ruling R97 (spec §10 step 8): a quote's payment link must be https, carry no user info, use the
 * default port, name no IP address, contain no whitespace or control characters, stay within 2,048
 * characters, and its host (after WHATWG URL parsing: lower-case, punycode) must equal one entry of
 * PAYMENT_HOST_ALLOWLIST exactly. No wildcards, no subdomains of an entry. An empty list accepts
 * nothing.
 */
const HOSTS = ["pay.example.com", "checkout.example.net", "xn--exmple-cua.com"] as const;

describe("validatePaymentUrl", () => {
  it("accepts an https link on an allowed host and returns its normalised form", () => {
    expect(validatePaymentUrl("https://pay.example.com/checkout/abc?ref=BB-1A2B-3C4D", HOSTS)).toEqual({
      ok: true,
      url: "https://pay.example.com/checkout/abc?ref=BB-1A2B-3C4D",
    });
    // The host is compared after parsing: upper case and an explicit default port are the same URL.
    expect(validatePaymentUrl("https://PAY.Example.COM:443/x", HOSTS)).toEqual({ ok: true, url: "https://pay.example.com/x" });
    expect(validatePaymentUrl("https://pay.example.com", HOSTS)).toEqual({ ok: true, url: "https://pay.example.com/" });
  });

  it("compares an international host in its punycode form", () => {
    expect(validatePaymentUrl("https://exämple.com/pay", HOSTS)).toEqual({ ok: true, url: "https://xn--exmple-cua.com/pay" });
  });

  it.each([
    ["http://pay.example.com/checkout", "not_https"],
    ["ftp://pay.example.com/checkout", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["data:text/html,hi", "not_https"],
    ["//pay.example.com/checkout", "invalid"],
    ["pay.example.com/checkout", "invalid"],
    ["", "invalid"],
  ] as const)("refuses %j (%s)", (url, reason) => {
    expect(validatePaymentUrl(url, HOSTS)).toEqual({ ok: false, reason });
  });

  it("refuses user info, even an empty password or user name", () => {
    for (const url of ["https://user:pass@pay.example.com/", "https://user@pay.example.com/", "https://:pass@pay.example.com/", "https://pay.example.com@evil.example/"]) {
      expect(validatePaymentUrl(url, [...HOSTS, "evil.example"]), url).toEqual({ ok: false, reason: "credentials" });
    }
  });

  it("refuses any port other than the default", () => {
    expect(validatePaymentUrl("https://pay.example.com:8443/checkout", HOSTS)).toEqual({ ok: false, reason: "port" });
    expect(validatePaymentUrl("https://pay.example.com:80/checkout", HOSTS)).toEqual({ ok: false, reason: "port" });
  });

  it("refuses IP literals in every spelling the URL parser accepts", () => {
    for (const url of ["https://127.0.0.1/pay", "https://0x7f.1/pay", "https://2130706433/pay", "https://[::1]/pay", "https://[2001:db8::1]/pay"]) {
      expect(validatePaymentUrl(url, [...HOSTS, "127.0.0.1", "[::1]"]), url).toEqual({ ok: false, reason: "ip_literal" });
    }
  });

  it("refuses whitespace and control characters anywhere, even ones the parser would strip", () => {
    for (const url of [" https://pay.example.com/", "https://pay.example.com/ ", "https://pay.example.com/a b", "https://pay.example.com/\tx", "https://pay.exa\nmple.com/", "https://pay.example.com/\u0000", "https://pay.example.com/\u007f", "https://pay.example.com/\u00a0", "https://pay.example.com/\u2028"]) {
      expect(validatePaymentUrl(url, HOSTS), JSON.stringify(url)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("refuses a link longer than 2,048 characters, before or after normalisation", () => {
    const base = "https://pay.example.com/";
    expect(PAYMENT_URL_MAX_LENGTH).toBe(2048);
    expect(validatePaymentUrl(base + "a".repeat(PAYMENT_URL_MAX_LENGTH - base.length), HOSTS).ok).toBe(true);
    expect(validatePaymentUrl(base + "a".repeat(PAYMENT_URL_MAX_LENGTH - base.length + 1), HOSTS)).toEqual({ ok: false, reason: "too_long" });
    // Percent-encoding makes the stored form longer than what was typed.
    expect(validatePaymentUrl(base + "ä".repeat(700), HOSTS)).toEqual({ ok: false, reason: "too_long" });
  });

  it("matches hosts exactly: no subdomain, no parent, no look-alike, no trailing dot", () => {
    for (const url of [
      "https://evil.pay.example.com/",
      "https://example.com/",
      "https://pay.example.com.evil.example/",
      "https://paypay.example.com/",
      "https://pay-example.com/",
      "https://pay.example.com./",
      "https://pay.examp1e.com/",
    ]) {
      expect(validatePaymentUrl(url, HOSTS), url).toEqual({ ok: false, reason: "host_not_allowed" });
    }
  });

  it("accepts nothing while the allowlist is empty, and says so", () => {
    expect(validatePaymentUrl("https://pay.example.com/checkout", [])).toEqual({ ok: false, reason: "no_allowed_hosts" });
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 42, { href: "https://pay.example.com/" }, ["https://pay.example.com/"]]) {
      expect(validatePaymentUrl(value, HOSTS)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("PAYMENT_HOST_ALLOWLIST", () => {
  it("is a comma-separated list of exact hosts, normalised to lower case and punycode", () => {
    expect(parsePaymentHostAllowlist(" pay.example.com, Checkout.Example.NET ,exämple.com ")).toEqual({
      hosts: ["pay.example.com", "checkout.example.net", "xn--exmple-cua.com"],
      invalid: 0,
    });
  });

  it("is empty when unset or blank", () => {
    expect(parsePaymentHostAllowlist(undefined)).toEqual({ hosts: [], invalid: 0 });
    expect(parsePaymentHostAllowlist("   ")).toEqual({ hosts: [], invalid: 0 });
    expect(parsePaymentHostAllowlist(" , ,")).toEqual({ hosts: [], invalid: 0 });
  });

  it("drops and counts entries that are not one exact host, so a typo never widens the list", () => {
    const parsed = parsePaymentHostAllowlist(
      "*.example.com,https://pay.example.com,pay.example.com/checkout,pay.example.com:443,user@pay.example.com,127.0.0.1,[::1],localhost,pay example.com,pay.example.com.,.example.com,good.example.org",
    );
    expect(parsed).toEqual({ hosts: ["good.example.org"], invalid: 11 });
  });

  it("removes duplicates", () => {
    expect(parsePaymentHostAllowlist("pay.example.com,PAY.example.com")).toEqual({ hosts: ["pay.example.com"], invalid: 0 });
  });

  it("is read from the environment by name", () => {
    expect(paymentHostsFrom({ PAYMENT_HOST_ALLOWLIST: "pay.example.com" })).toEqual(["pay.example.com"]);
    expect(paymentHostsFrom({})).toEqual([]);
  });

  it("feeds validatePaymentUrl", () => {
    const hosts = paymentHostsFrom({ PAYMENT_HOST_ALLOWLIST: "*.example.com, pay.example.com" });
    expect(validatePaymentUrl("https://pay.example.com/x", hosts).ok).toBe(true);
    expect(validatePaymentUrl("https://other.example.com/x", hosts)).toEqual({ ok: false, reason: "host_not_allowed" });
  });
});

describe("scripts/verify-env.ts and PAYMENT_HOST_ALLOWLIST (brief item 7)", () => {
  it("fails, in every phase, on an entry that is not one exact host, naming the variable and a count only", () => {
    for (const phase of ["development", "test", "production"] as const) {
      const report = verifyEnvironment({ PAYMENT_HOST_ALLOWLIST: "pay.example.com, *.wildcard-entry.example, https://url-entry.example/pay" }, phase);
      expect(report.ok, phase).toBe(false);
      expect(report.errors).toEqual([
        "PAYMENT_HOST_ALLOWLIST: 2 entries are not one exact host (no wildcards, schemes, paths, ports or IP addresses) and would be ignored",
      ]);
      expect(report.errors.join(" ")).not.toMatch(/wildcard-entry|url-entry|pay\.example/);
    }
    expect(verifyEnvironment({ PAYMENT_HOST_ALLOWLIST: "203.0.113.9" }, "production").errors).toEqual([
      "PAYMENT_HOST_ALLOWLIST: 1 entry is not one exact host (no wildcards, schemes, paths, ports or IP addresses) and would be ignored",
    ]);
  });

  it("accepts an unset, empty or valid list", () => {
    for (const value of [undefined, "", " ", "pay.example.com", "pay.example.com, checkout.example.net"]) {
      expect(verifyEnvironment({ PAYMENT_HOST_ALLOWLIST: value }, "production").ok, String(value)).toBe(true);
    }
  });

  it("refuses it under a public name: the list is server-only", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_PAYMENT_HOST_ALLOWLIST: "pay.example.com" }, "production").forbiddenPublic).toEqual(["NEXT_PUBLIC_PAYMENT_HOST_ALLOWLIST"]);
  });
});
