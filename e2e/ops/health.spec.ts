import { expect, test } from "@playwright/test";

import { CONFIGURED } from "./environment";

/*
 * Task 12 (local pass), spec §15/§16: the two operational probes answer the way a monitor expects.
 * Liveness (`/api/health`) is always 200 with { status, version, time } and no configuration;
 * readiness (`/api/readiness`) is 200 when Sanity, lead storage and revalidation are configured and
 * 503 otherwise, with booleans only. On the keyless e2e server nothing is configured, so readiness
 * is 503 there. With E2E_CONFIGURED=1 (a server with Supabase, Sanity and the revalidation secret, such
 * as the preview) it must be 200 with those three booleans true (app/api/readiness/route.ts: status is
 * `checks.ready ? 200 : 503`; lib/ops/readiness.ts: ready = sanity && supabase && revalidation).
 * Both are never cached, answer HEAD, and refuse POST.
 */

const READINESS_KEYS = ["email", "leadRemovalChannel", "legalReviewed", "ready", "revalidation", "sanity", "supabase"];
const READINESS_STATUS = CONFIGURED ? 200 : 503;

test.describe("GET /api/health", () => {
  test("answers 200 JSON { status: ok, version, time } and is never cached", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["status", "time", "version"]);
    expect(body.status).toBe("ok");
    // Only a commit hash or "local" is ever echoed.
    expect(body.version).toMatch(/^(?:local|[0-9a-f]{7,40})$/i);
    expect(new Date(body.time).toISOString()).toBe(body.time);
    expect(Math.abs(Date.now() - new Date(body.time).getTime()), "the time is now, not a cached value").toBeLessThan(60_000);
  });

  test("the time moves between calls (the answer is not cached)", async ({ request }) => {
    const first = (await (await request.get("/api/health")).json()).time as string;
    await expect
      .poll(async () => ((await (await request.get("/api/health")).json()) as { time: string }).time, { message: "time never advanced" })
      .not.toBe(first);
  });

  test("answers HEAD with the same status and no body, and refuses POST", async ({ request }) => {
    const head = await request.head("/api/health");
    expect(head.status()).toBe(200);
    expect(head.headers()["cache-control"]).toBe("no-store");
    expect((await head.body()).length).toBe(0);
    for (const method of ["post", "put", "delete", "patch"] as const) {
      expect((await request[method]("/api/health")).status(), method).toBe(405);
    }
  });
});

test.describe("GET /api/readiness", () => {
  test(`answers ${READINESS_STATUS} on ${CONFIGURED ? "a configured server" : "a server with nothing configured"}, booleans only, never cached`, async ({ request }) => {
    const response = await request.get("/api/readiness");
    expect(response.status()).toBe(READINESS_STATUS);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(READINESS_KEYS);
    for (const [key, value] of Object.entries(body)) expect(typeof value, key).toBe("boolean");
    expect(body.ready).toBe(CONFIGURED);
    expect(body.sanity).toBe(CONFIGURED);
    expect(body.supabase).toBe(CONFIGURED);
    expect(body.revalidation).toBe(CONFIGURED);
  });

  test("answers HEAD with the same status and refuses POST", async ({ request }) => {
    const head = await request.head("/api/readiness");
    expect(head.status()).toBe(READINESS_STATUS);
    expect(head.headers()["cache-control"]).toBe("no-store");
    expect((await request.post("/api/readiness")).status()).toBe(405);
    expect((await request.delete("/api/readiness")).status()).toBe(405);
  });
});

test.describe("what the probes never reveal", () => {
  for (const path of ["/api/health", "/api/readiness"]) {
    test(`${path} carries no configuration value, URL, key, path or stack trace`, async ({ request }) => {
      const response = await request.get(path, { headers: { "x-forwarded-host": "attacker.example", origin: "https://attacker.example" } });
      const text = await response.text();
      expect(text).not.toMatch(/https?:\/\//i);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sk_|secret|token|password|service[_-]?role|\bat \w+.*\(/i);
      expect(text).not.toMatch(/[A-Za-z]:[\/]|\/(?:home|Users|var|app)\//);
      expect(text).not.toContain("attacker.example");
      expect(response.headers()["x-powered-by"]).toBeUndefined();
      expect(response.headers()["set-cookie"]).toBeUndefined();
    });
  }
});
