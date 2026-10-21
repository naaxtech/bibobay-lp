import { describe, expect, it } from "vitest";

import { ALLOWED_PUBLIC_NAMES, verifyEnvironment } from "@/scripts/verify-env";

/* Bot check (Cloudflare Turnstile) in the environment verifier: the production phase fails closed on a misconfigured pair, naming variables and never values. */

const TEST_SITE = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const FAILING_TEST_SECRET = "2x0000000000000000000000000000000AA";
const REAL_SITE = "0x4AAAAAAAfixtureSiteKey";
const REAL_SECRET = "0x4AAAAAAAfixtureSecretKeyValue00";

const botCheckErrors = (env: Record<string, string>, phase: "development" | "production" = "production") =>
  verifyEnvironment(env, phase).errors.filter((error) => error.startsWith("NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY"));

describe("verify-env and the bot check", () => {
  it("allows the site key as a public name", () => {
    expect(ALLOWED_PUBLIC_NAMES.has("NEXT_PUBLIC_TURNSTILE_SITE_KEY")).toBe(true);
    expect(verifyEnvironment({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE, TURNSTILE_SECRET_KEY: REAL_SECRET }, "production").forbiddenPublic).toEqual([]);
  });

  it("passes with both keys unset", () => {
    expect(verifyEnvironment({}, "production")).toMatchObject({ ok: true, errors: [] });
  });

  it("passes with both test keys and no VERCEL_ENV, fails with VERCEL_ENV production", () => {
    const keys = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE, TURNSTILE_SECRET_KEY: TEST_SECRET };
    expect(verifyEnvironment(keys, "production").ok).toBe(true);
    expect(botCheckErrors({ ...keys, VERCEL_ENV: "production" })).toHaveLength(1);
  });

  it.each([
    ["half", { NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE }],
    ["malformed", { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "bad key!", TURNSTILE_SECRET_KEY: REAL_SECRET }],
    ["mixed_keys", { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE, TURNSTILE_SECRET_KEY: REAL_SECRET }],
    ["test_keys_in_production", { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE, TURNSTILE_SECRET_KEY: FAILING_TEST_SECRET, VERCEL_ENV: "production" }],
  ])("errors in the production phase for %s, naming both variables and no value", (_problem, env) => {
    const report = verifyEnvironment(env, "production");
    expect(report.ok).toBe(false);
    const errors = botCheckErrors(env);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^NEXT_PUBLIC_TURNSTILE_SITE_KEY \/ TURNSTILE_SECRET_KEY: .+; every form would answer 503$/);
    const text = JSON.stringify(report);
    for (const [name, value] of Object.entries(env)) if (name !== "VERCEL_ENV") expect(text).not.toContain(value);
  });

  it("does not fail the development phase for a misconfigured pair", () => {
    expect(botCheckErrors({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE }, "development")).toEqual([]);
  });
});
