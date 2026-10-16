import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { monitoringConnectSources, sentryDsnFrom, sentryEnvironmentFrom, sentryIngestOrigin } from "@/lib/observability/monitoring-env";
import nextConfig from "@/next.config";
import { proxy } from "@/proxy";
import { verifyEnvironment } from "@/scripts/verify-env";

/*
 * Task 10M-a environment (adapted from the stopped run's draft; the PostHog half already lives in
 * lib/analytics/config.ts under ruling R70). Every monitoring name is optional; absent means a
 * complete no-op. Public by design: NEXT_PUBLIC_SENTRY_DSN (plus the two PostHog names). Server
 * only: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT (source-map upload). The environment tag
 * comes from Vercel's VERCEL_ENV: Sentry's own browser SDK reads process.env.SENTRY_ENVIRONMENT, so
 * documenting that name would make verify:bundle flag the SDK chunk (a name, never a value).
 */

const DSN = "https://***@o0.ingest.example.com/1";
const KEY = `phc_${"Fixture0nly".repeat(4)}`;
const SERVER_NAMES = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sentry DSN", () => {
  it("accepts an https DSN with a public key and a numeric project", () => {
    expect(sentryDsnFrom(` ${DSN} `)).toBe(DSN);
    expect(sentryIngestOrigin(sentryDsnFrom(DSN))).toBe("https://o0.ingest.example.com");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["http", "http://***@o0.ingest.example.com/1"],
    ["no public key", "https://o0.ingest.example.com/1"],
    ["a secret key part", "https://publickey:secret@o0.ingest.example.com/1"],
    ["a non-numeric project", "https://***@o0.ingest.example.com/project"],
    ["a query", "https://***@o0.ingest.example.com/1?x=1"],
    ["a wildcard host", "https://***@*.example.com/1"],
    ["not a URL", "publickey"],
  ])("treats a DSN with %s as not configured", (_case, value) => {
    expect(sentryDsnFrom(value)).toBeNull();
    expect(sentryIngestOrigin(sentryDsnFrom(value))).toBeNull();
  });

  it("names the environment from VERCEL_ENV, else development, and ignores SENTRY_ENVIRONMENT", () => {
    expect(sentryEnvironmentFrom({ VERCEL_ENV: "production" })).toBe("production");
    expect(sentryEnvironmentFrom({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(sentryEnvironmentFrom({ VERCEL_ENV: "staging!" })).toBe("development");
    expect(sentryEnvironmentFrom({})).toBe("development");
    expect(sentryEnvironmentFrom({ SENTRY_ENVIRONMENT: "staging", VERCEL_ENV: "preview" } as never)).toBe("preview");
  });

  it("does not document SENTRY_ENVIRONMENT, a name Sentry's browser SDK itself reads", () => {
    const names = readFileSync(resolve(".env.example"), "utf8").split(/\r?\n/).map((line) => line.split("=")[0]!.trim());
    expect(names).not.toContain("SENTRY_ENVIRONMENT");
  });
});

describe("monitoring hosts in the content security policy (connect-src only)", () => {
  it("adds nothing without keys", async () => {
    expect(monitoringConnectSources({})).toEqual([]);
    const policy = (await proxy(new NextRequest("https://bibo.example/"))).headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/connect-src 'self'(;|$)/);
  });

  it("adds the Sentry ingest origin and the PostHog host when configured, never to script-src", async () => {
    const env = { NEXT_PUBLIC_SENTRY_DSN: DSN, NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_POSTHOG_HOST: "https://ph.example.com" };
    expect(monitoringConnectSources(env)).toEqual(["https://o0.ingest.example.com", "https://ph.example.com"]);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const policy = (await proxy(new NextRequest("https://bibo.example/"))).headers.get("content-security-policy") ?? "";
    const directive = (name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
    expect(directive("connect-src")).toBe("connect-src 'self' https://o0.ingest.example.com https://ph.example.com");
    expect(directive("script-src")).not.toMatch(/example\.com|posthog|sentry/);
  });

  it("adds no PostHog host without a project key", () => {
    expect(monitoringConnectSources({ NEXT_PUBLIC_POSTHOG_HOST: "https://ph.example.com" })).toEqual([]);
  });
});

describe("next.config.ts", () => {
  it("keeps the Task 9 settings and, keyless, is not wrapped for Sentry", () => {
    expect(nextConfig.typescript?.tsconfigPath).toBe("tsconfig.build.json");
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(typeof nextConfig.headers).toBe("function");
    expect(nextConfig.images?.remotePatterns).toEqual([{ protocol: "https", hostname: "cdn.sanity.io", pathname: "/images/**" }]);
    // withSentryConfig would turn on browser source maps and add its build hooks.
    expect(nextConfig.productionBrowserSourceMaps).toBeUndefined();
    expect(nextConfig.compiler).toBeUndefined();
  });
});

describe("verify-env and .env.example", () => {
  const envExampleNames = () =>
    readFileSync(resolve(".env.example"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]!);

  it("allows the public monitoring names, documents them, and requires none of them", () => {
    expect(verifyEnvironment({}, "production").ok).toBe(true);
    const report = verifyEnvironment({ NEXT_PUBLIC_SENTRY_DSN: DSN, NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com" }, "production");
    expect(report.errors).toEqual([]);
    expect(envExampleNames()).toContain("NEXT_PUBLIC_SENTRY_DSN");
  });

  it.each(SERVER_NAMES)("documents %s in .env.example unprefixed and refuses it under NEXT_PUBLIC_", (name) => {
    expect(envExampleNames()).toContain(name);
    expect(envExampleNames()).not.toContain(`NEXT_PUBLIC_${name}`);
    expect(verifyEnvironment({ [`NEXT_PUBLIC_${name}`]: "value" }, "production").forbiddenPublic).toEqual([`NEXT_PUBLIC_${name}`]);
  });

  it("treats SENTRY_AUTH_TOKEN as a secret: its value in a public name fails, without being echoed", () => {
    const token = ["sntrys", "fixture", "token", "value"].join("_");
    const report = verifyEnvironment({ SENTRY_AUTH_TOKEN: token, NEXT_PUBLIC_SENTRY_DSN: token }, "production");
    expect(report.forbiddenPublic).toEqual(["NEXT_PUBLIC_SENTRY_DSN"]);
    expect(JSON.stringify(report)).not.toContain(token);
  });
});

describe("browser environment tag", () => {
  it("uses Vercel's public environment name in the browser, else development", async () => {
    const { browserSentryEnvironment } = await import("@/lib/observability/sentry-dsn");
    expect(browserSentryEnvironment("production")).toBe("production");
    expect(browserSentryEnvironment("preview")).toBe("preview");
    expect(browserSentryEnvironment(undefined)).toBe("development");
    expect(browserSentryEnvironment("staging!")).toBe("development");
  });
});
