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
