import { expect, test } from "@playwright/test";

import { COMMERCE_ON } from "../shop/shop-helpers";

/*
 * Task 12 (local pass), spec §10 "Server gating": "Order submission rejects with a non-enumerating
 * response". e2e/shop/commerce-off.spec.ts already asserts the page half (shop, order, tracking and
 * private order routes 404, no links, no sitemap entries, no order-pad code or storage reads); the
 * API half was proven only in Vitest (tests/orders). This asserts it over HTTP on a real server:
 * whatever the request carries, the answer is the same, so it reveals nothing about products,
 * references or emails, and nothing is stored or cookied.
 * Skipped in the commerce-on run (E2E_COMMERCE=1).
 */
test.skip(COMMERCE_ON, "commerce is switched on for this run");

const sameOrigin = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

const ORDER_BODIES: Array<[string, string]> = [
  ["empty object", "{}"],
  ["a plausible order for a real-looking product", JSON.stringify({ items: [{ slug: "tula-reef-plush", quantity: 1 }], contact: { name: "QA", email: "qa@example.com" }, consent: true })],
  ["a product that cannot exist", JSON.stringify({ items: [{ slug: "no-such-product-0000", quantity: 99999 }] })],
  ["malformed JSON", "{not json"],
  ["an oversized body", JSON.stringify({ note: "x".repeat(200_000) })],
  ["a filled honeypot", JSON.stringify({ website: "http://spam.example" })],
];

const TRACK_BODIES: Array<[string, string]> = [
  ["a reference that looks real", JSON.stringify({ reference: "BB-1A2B-3C4D", email: "buyer@example.com" })],
  ["a reference that cannot exist", JSON.stringify({ reference: "nope", email: "nobody@example.com" })],
  ["empty object", "{}"],
  ["malformed JSON", "[["],
];

for (const [path, bodies] of [
  ["/api/orders", ORDER_BODIES],
  ["/api/orders/track", TRACK_BODIES],
] as const) {
  test.describe(`POST ${path} while commerce is off`, () => {
    test("answers every body with the same 404 and the same words, not stored, no cookie", async ({ request }) => {
      const answers: Array<{ label: string; status: number; body: string; cache: string | undefined }> = [];
      for (const [label, data] of bodies) {
        const response = await request.post(path, { headers: sameOrigin, data });
        expect(response.headers()["set-cookie"], label).toBeUndefined();
        answers.push({ label, status: response.status(), body: await response.text(), cache: response.headers()["cache-control"] });
      }
      for (const answer of answers) {
        expect(answer.status, answer.label).toBe(404);
        expect(answer.cache, answer.label).toBe("no-store");
        expect(answer.body, answer.label).toBe(answers[0]!.body);
      }
      const parsed = JSON.parse(answers[0]!.body) as Record<string, unknown>;
      expect(parsed.ok).toBe(false);
      expect(String(parsed.message)).toMatch(/not available/i);
      // Nothing was accepted or queued, and no field echoes what was sent.
      if ("persisted" in parsed) expect(parsed.persisted).toBe(false);
      if ("acknowledgementQueued" in parsed) expect(parsed.acknowledgementQueued).toBe(false);
      expect(answers[0]!.body).not.toMatch(/tula|qa@example|buyer@example|BB-1A2B|reference|product/i);
    });

    test("gives the same answer whether or not the request is from this site, and to a bare content type", async ({ request }) => {
      const reference = await (await request.post(path, { headers: sameOrigin, data: "{}" })).text();
      const variants: Array<Record<string, string>> = [{ "content-type": "application/json" }, { "content-type": "text/plain", "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-origin" }];
      for (const headers of variants) {
        const response = await request.post(path, { headers, data: "{}" });
        expect(response.status(), JSON.stringify(headers)).toBe(404);
        expect(await response.text(), JSON.stringify(headers)).toBe(reference);
      }
    });

    test("other methods are 405", async ({ request }) => {
      for (const method of ["get", "put", "patch", "delete"] as const) {
        expect((await request[method](path)).status(), method).toBe(405);
      }
    });
  });
}

test("the readiness probe does not leak that the shop exists", async ({ request }) => {
  const text = await (await request.get("/api/readiness")).text();
  expect(text).not.toMatch(/commerce|shop|order/i);
});
