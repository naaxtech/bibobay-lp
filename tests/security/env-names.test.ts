import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyEnvironment } from "@/scripts/verify-env";

/*
 * Task 9 environment names. Every one is server-only: documented in .env.example without a public
 * prefix and refused by scripts/verify-env.ts under NEXT_PUBLIC_.
 */
const TASK_9_SERVER_NAMES = ["SANITY_REVALIDATE_SECRET", "SANITY_API_READ_TOKEN", "SANITY_STUDIO_ORIGIN"];

const envExampleNames = () =>
  readFileSync(resolve(".env.example"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]!);

describe("Task 9 environment names", () => {
  it("documents each server name in .env.example, unprefixed", () => {
    const names = envExampleNames();
    for (const name of TASK_9_SERVER_NAMES) {
      expect(names, name).toContain(name);
      expect(names, name).not.toContain(`NEXT_PUBLIC_${name}`);
    }
  });

  it.each(TASK_9_SERVER_NAMES)("refuses NEXT_PUBLIC_%s", (name) => {
    expect(verifyEnvironment({ [`NEXT_PUBLIC_${name}`]: "value" }, "production").forbiddenPublic).toEqual([`NEXT_PUBLIC_${name}`]);
  });

  it("refuses the revalidation secret copied into an allowed public value, without echoing it", () => {
    const secret = ["revalidate", "fixture", "secret"].join("-");
    const report = verifyEnvironment({ SANITY_REVALIDATE_SECRET: secret, NEXT_PUBLIC_SANITY_DATASET: secret }, "production");
    expect(report.forbiddenPublic).toEqual(["NEXT_PUBLIC_SANITY_DATASET"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});

describe("Vercel's own public variables", () => {
  // src: https://raw.githubusercontent.com/vercel/vercel/main/packages/build-utils/src/get-prefixed-env-vars.ts · read 2026-10-16
  // Vercel adds these to every Next.js build (System Environment Variables with the framework prefix).
  // Refusing them would fail the first Vercel build at `npm run build`'s verify:env step.
  const VERCEL_PUBLIC = ["NEXT_PUBLIC_VERCEL_URL", "NEXT_PUBLIC_VERCEL_ENV", "NEXT_PUBLIC_VERCEL_TARGET_ENV", "NEXT_PUBLIC_VERCEL_REGION", "NEXT_PUBLIC_VERCEL_BRANCH_URL", "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID", "NEXT_PUBLIC_VERCEL_PROJECT_ID", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF", "NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG"];

  it("accepts the names Vercel itself sets on a build", () => {
    const env = Object.fromEntries(VERCEL_PUBLIC.map((name) => [name, "value"]));
    expect(verifyEnvironment(env, "production").forbiddenPublic).toEqual([]);
  });

  it("still refuses an invented NEXT_PUBLIC_VERCEL_ name and any secret value under these names", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_VERCEL_TOKEN: "value" }, "production").forbiddenPublic).toEqual(["NEXT_PUBLIC_VERCEL_TOKEN"]);
    expect(verifyEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "secret-value", NEXT_PUBLIC_VERCEL_URL: "secret-value" }, "production").forbiddenPublic).toEqual(["NEXT_PUBLIC_VERCEL_URL"]);
  });
});

describe("monitoring values the app would silently ignore (review M6)", () => {
  const VALID_KEY = `phc_${"Fixture0nly".repeat(4)}`;
  it.each([
    ["a project secret key", { NEXT_PUBLIC_POSTHOG_KEY: `phs_${"Fixture0nly".repeat(4)}` }],
    ["a key too short to be a project key", { NEXT_PUBLIC_POSTHOG_KEY: "phc_short" }],
    ["a host that is not an https origin", { NEXT_PUBLIC_POSTHOG_KEY: VALID_KEY, NEXT_PUBLIC_POSTHOG_HOST: "http://ph.example.com" }],
    ["a Sentry DSN without a public key", { NEXT_PUBLIC_SENTRY_DSN: "https://o0.ingest.example.com/1" }],
  ])("fails for %s, naming the variable but never its value", (_case, env) => {
    const report = verifyEnvironment(env, "production");
    expect(report.ok).toBe(false);
    const text = report.errors.join("\n");
    expect(text).toMatch(/NEXT_PUBLIC_(POSTHOG_KEY|POSTHOG_HOST|SENTRY_DSN)/);
    for (const value of Object.values(env)) expect(text).not.toContain(value);
  });

  it("accepts a valid key, host and DSN, and empty values", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_POSTHOG_KEY: VALID_KEY, NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com", NEXT_PUBLIC_SENTRY_DSN: "https://abc123@o0.ingest.example.com/1" }, "production").errors).toEqual([]);
    expect(verifyEnvironment({ NEXT_PUBLIC_POSTHOG_KEY: "", NEXT_PUBLIC_POSTHOG_HOST: "", NEXT_PUBLIC_SENTRY_DSN: " " }, "production").errors).toEqual([]);
  });
});
