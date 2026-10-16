import { describe, expect, it } from "vitest";

import { maskPrivatePaths } from "@/lib/privacy/private-links";

/*
 * Task 7b review Minor 2: the private order path is masked wherever it starts a path, whatever
 * character comes before it, and never inside a longer path such as /api/orders/track.
 */
const T = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6";

describe("maskPrivatePaths", () => {
  it.each([
    [`/orders/${T}`, "/orders/[token]"],
    [`https://bibo.example/orders/${T}?x=1`, "https://bibo.example/orders/[token]?x=1"],
    [`page:/orders/${T}`, "page:/orders/[token]"],
    [`see \`/orders/${T}\``, "see `/orders/[token]`"],
    [`[/orders/${T}]`, "[/orders/[token]]"],
    [`a,/orders/${T}`, "a,/orders/[token]"],
    [`<a>/orders/${T}`, "<a>/orders/[token]"],
    [`NEXT_HTTP_ERROR;/orders/${T}`, "NEXT_HTTP_ERROR;/orders/[token]"],
    [`"/orders/${T}"`, '"/orders/[token]"'],
    [`next=%2Forders%2F${T}`, "next=%2Forders%2F[token]"],
    [`next=%2forders%2f${T}&a=1`, "next=%2forders%2f[token]&a=1"],
  ])("masks %s", (input, expected) => {
    expect(maskPrivatePaths(input)).toBe(expected);
  });

  it.each([`/api/orders/track`, `https://bibo.example/api/orders/track`, `/shop/orders/${T}`, "/orders", "/orders/", "/orders/[token]"])("leaves %s alone", (input) => {
    expect(maskPrivatePaths(input)).toBe(input);
  });
});

describe("tracking tokens outside a path (Task 7b re-review O2, O4)", () => {
  const TOKEN = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";

  it.each([
    [`%5B%22orders%22%2C%7B%22children%22%3A%5B%22token%22%2C%22${TOKEN}%22`, "a router state header"],
    [`bibo.example/orders/${TOKEN}`, "a host without a scheme"],
    [`/orders//${TOKEN}`, "a doubled slash"],
    [`%252Forders%252F${TOKEN}`, "a double-encoded path"],
    [`token=${TOKEN.toUpperCase()}`, "upper-case hex"],
  ])("masks a 64-digit hex token anywhere (%s: %s)", (input) => {
    expect(maskPrivatePaths(input).toLowerCase()).not.toContain(TOKEN);
  });

  it("leaves shorter hex alone (trace and span ids, commit hashes)", () => {
    for (const id of ["0123456789abcdef0123456789abcdef", "0123456789abcdef", "a86ec9d570cb854962ca99058efdf369615a1b28"]) expect(maskPrivatePaths(id)).toBe(id);
  });

  it("returns quickly for long text without an order path", () => {
    // Not hex ("a" would be one long hex run, masked as a token).
    const text = "z".repeat(200_000);
    const started = performance.now();
    expect(maskPrivatePaths(text)).toBe(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
