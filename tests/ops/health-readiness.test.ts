import { afterEach, describe, expect, it, vi } from "vitest";

import { readinessChecks } from "@/lib/ops/readiness";

vi.mock("server-only", () => ({}));

/** The legal read is the only network-shaped dependency of readiness; tests decide its answer. */
const { getLegalSettings } = vi.hoisted(() => ({ getLegalSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getLegalSettings, getSiteSettings: vi.fn() }));

const block = (text: string) => [{ _type: "block" as const, children: [{ _type: "span" as const, text }] }];
const REVIEWED = { privacy: block("p"), terms: block("t"), privacyVersion: "2026-10", termsVersion: "2026-10", consentCopyVersion: "1" };
const FALLBACK = { privacy: [], terms: [], consentCopyVersion: "1" };

/** Fixture values only; long enough for the 32-character hash-secret rule. */
const CONFIGURED: Record<string, string> = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "abc123",
  NEXT_PUBLIC_SANITY_DATASET: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-value",
  LEAD_IP_HASH_SECRET: "x".repeat(40),
  SANITY_REVALIDATE_SECRET: "revalidate-fixture-secret",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/health", () => {
  it("answers 200 with status, version and time only, never cached", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["status", "time", "version"]);
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });

  it("reports a local version without a commit, and never echoes an odd value", async () => {
    const { GET } = await import("@/app/api/health/route");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    expect((await (await GET()).json()).version).toBe("local");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "<script>alert(1)</script>");
    expect((await (await GET()).json()).version).toBe("local");
  });
});

describe("readiness checks", () => {
  it("is all false with nothing configured", () => {
    expect(readinessChecks({}, { legalReviewed: false })).toEqual({ ready: false, sanity: false, supabase: false, email: false, revalidation: false, legalReviewed: false });
  });

  it("is ready with Sanity, Supabase lead storage and the revalidation secret, even without email or reviewed legal text", () => {
    expect(readinessChecks(CONFIGURED, { legalReviewed: false })).toEqual({ ready: true, sanity: true, supabase: true, email: false, revalidation: true, legalReviewed: false });
  });

  it.each(["NEXT_PUBLIC_SANITY_PROJECT_ID", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET", "SANITY_REVALIDATE_SECRET"])("is not ready without %s", (name) => {
    const env = { ...CONFIGURED, [name]: "  " };
    expect(readinessChecks(env, { legalReviewed: true }).ready).toBe(false);
  });

  it("does not count a short address-hash secret as configured storage", () => {
    expect(readinessChecks({ ...CONFIGURED, LEAD_IP_HASH_SECRET: "short" }, { legalReviewed: true }).supabase).toBe(false);
  });

  it("reports email when Resend has a key and a valid sender", () => {
    const env = { ...CONFIGURED, RESEND_API_KEY: "re_fixture", RESEND_FROM: "BIBO Bay <hello@bibo.example>" };
    expect(readinessChecks(env, { legalReviewed: false }).email).toBe(true);
  });
});

describe("GET /api/readiness", () => {
  it("answers 503 with booleans only when production dependencies are missing", async () => {
    getLegalSettings.mockResolvedValue(FALLBACK);
    const { GET } = await import("@/app/api/readiness/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["email", "legalReviewed", "ready", "revalidation", "sanity", "supabase"]);
    for (const value of Object.values(body)) expect(typeof value).toBe("boolean");
    expect(body.ready).toBe(false);
  });

  it("answers 200 when configured, reports reviewed legal text, and never echoes a value", async () => {
    for (const [name, value] of Object.entries(CONFIGURED)) vi.stubEnv(name, value);
    getLegalSettings.mockResolvedValue(REVIEWED);
    const { GET } = await import("@/app/api/readiness/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ready: true, sanity: true, supabase: true, email: false, revalidation: true, legalReviewed: true });
    for (const value of Object.values(CONFIGURED)) expect(text).not.toContain(value);
  });

  it("treats legal text without a reviewed version as not reviewed", async () => {
    getLegalSettings.mockResolvedValue({ ...REVIEWED, termsVersion: undefined });
    const { GET } = await import("@/app/api/readiness/route");
    expect((await (await GET()).json()).legalReviewed).toBe(false);
  });

  it("answers within its time budget when the legal read hangs", async () => {
    vi.useFakeTimers();
    getLegalSettings.mockReturnValue(new Promise(() => undefined));
    const { GET } = await import("@/app/api/readiness/route");
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5000);
    const body = await (await pending).json();
    expect(body.legalReviewed).toBe(false);
  });
});
