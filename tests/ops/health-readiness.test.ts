import { afterEach, describe, expect, it, vi } from "vitest";

import { contactFormOpen } from "@/lib/contact/availability";
import { readinessChecks } from "@/lib/ops/readiness";

vi.mock("server-only", () => ({}));

/** The legal read is the only network-shaped dependency of readiness; tests decide its answer. */
const { getLegalSettings, getSiteSettings } = vi.hoisted(() => ({ getLegalSettings: vi.fn(), getSiteSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getLegalSettings, getSiteSettings }));

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

const CONTACT = { contactEmail: "hello@bibobay.example" };
const EMAIL: Record<string, string> = { RESEND_API_KEY: "re_fixture", RESEND_FROM: "BIBO Bay <hello@bibo.example>" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  getSiteSettings.mockReset();
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
    expect(readinessChecks({}, { legalReviewed: false, settings: {} })).toEqual({ ready: false, sanity: false, supabase: false, email: false, leadRemovalChannel: false, contact: false, revalidation: false, legalReviewed: false, botCheck: false });
  });

  it("is ready with Sanity, Supabase lead storage, the revalidation secret and a removal channel, even without email or reviewed legal text", () => {
    expect(readinessChecks(CONFIGURED, { legalReviewed: false, settings: CONTACT })).toEqual({ ready: true, sanity: true, supabase: true, email: false, leadRemovalChannel: true, contact: false, revalidation: true, legalReviewed: false, botCheck: false });
  });

  it("counts a way to ask for removal toward readiness (P-I1, Ruling R125): email sending or a contact address", () => {
    expect(readinessChecks(CONFIGURED, { legalReviewed: true, settings: {} })).toMatchObject({ ready: false, leadRemovalChannel: false });
    expect(readinessChecks(CONFIGURED, { legalReviewed: true, settings: { contactEmail: "not an address" } })).toMatchObject({ ready: false, leadRemovalChannel: false });
    expect(readinessChecks({ ...CONFIGURED, ...EMAIL }, { legalReviewed: true, settings: {} })).toMatchObject({ ready: true, email: true, leadRemovalChannel: true });
    expect(readinessChecks(CONFIGURED, { legalReviewed: true, settings: CONTACT })).toMatchObject({ ready: true, email: false, leadRemovalChannel: true });
  });

  it.each(["NEXT_PUBLIC_SANITY_PROJECT_ID", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET", "SANITY_REVALIDATE_SECRET"])("is not ready without %s", (name) => {
    const env = { ...CONFIGURED, [name]: "  " };
    expect(readinessChecks(env, { legalReviewed: true, settings: CONTACT }).ready).toBe(false);
  });

  it("does not count a short address-hash secret as configured storage", () => {
    expect(readinessChecks({ ...CONFIGURED, LEAD_IP_HASH_SECRET: "short" }, { legalReviewed: true, settings: CONTACT }).supabase).toBe(false);
  });

  it("reports contact only when contactFormOpen is, and never lets it change ready", () => {
    const open = { ...CONFIGURED, ...EMAIL, STAFF_NOTIFICATION_EMAIL: "staff@bibobay.example" };
    expect(readinessChecks(open, { legalReviewed: false, settings: CONTACT })).toMatchObject({ contact: true, ready: true });
    expect(contactFormOpen(open)).toBe(true);
    for (const missing of ["STAFF_NOTIFICATION_EMAIL", "RESEND_API_KEY", "RESEND_FROM", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET"]) {
      const env = { ...open, [missing]: "" };
      expect(readinessChecks(env, { legalReviewed: false, settings: CONTACT }).contact, missing).toBe(contactFormOpen(env));
      expect(readinessChecks(env, { legalReviewed: false, settings: CONTACT }).contact, missing).toBe(false);
    }
    expect(readinessChecks({ ...open, STAFF_NOTIFICATION_EMAIL: "" }, { legalReviewed: false, settings: CONTACT }).ready).toBe(true);
  });

  it("reports email when Resend has a key and a valid sender", () => {
    expect(readinessChecks({ ...CONFIGURED, ...EMAIL }, { legalReviewed: false, settings: {} }).email).toBe(true);
  });
});

describe("readiness botCheck", () => {
  const KEYS = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };

  it("is true only when the bot check is on, and never changes ready", () => {
    expect(readinessChecks({ ...CONFIGURED, ...KEYS }, { legalReviewed: false, settings: CONTACT })).toMatchObject({ botCheck: true, ready: true });
    expect(readinessChecks({ ...CONFIGURED, ...KEYS, TURNSTILE_SECRET_KEY: "" }, { legalReviewed: false, settings: CONTACT })).toMatchObject({ botCheck: false, ready: true });
    expect(readinessChecks({ ...CONFIGURED, NEXT_PUBLIC_TURNSTILE_SITE_KEY: KEYS.NEXT_PUBLIC_TURNSTILE_SITE_KEY }, { legalReviewed: false, settings: CONTACT }).botCheck).toBe(false);
    expect(readinessChecks({}, { legalReviewed: false, settings: {} })).toMatchObject({ botCheck: false, ready: false });
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
    expect(Object.keys(body).sort()).toEqual(["botCheck", "contact", "email", "leadRemovalChannel", "legalReviewed", "ready", "revalidation", "sanity", "supabase"]);
    for (const value of Object.values(body)) expect(typeof value).toBe("boolean");
    expect(body.ready).toBe(false);
  });

  it("answers 200 when configured, reports reviewed legal text, and never echoes a value", async () => {
    for (const [name, value] of Object.entries(CONFIGURED)) vi.stubEnv(name, value);
    getLegalSettings.mockResolvedValue(REVIEWED);
    getSiteSettings.mockResolvedValue(CONTACT);
    const { GET } = await import("@/app/api/readiness/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ready: true, sanity: true, supabase: true, email: false, leadRemovalChannel: true, contact: false, revalidation: true, legalReviewed: true, botCheck: false });
    for (const value of [...Object.values(CONFIGURED), CONTACT.contactEmail]) expect(text).not.toContain(value);
  });

  it("answers 503 when everything else is configured but nobody could ask to be removed (P-I1)", async () => {
    for (const [name, value] of Object.entries(CONFIGURED)) vi.stubEnv(name, value);
    getLegalSettings.mockResolvedValue(REVIEWED);
    getSiteSettings.mockResolvedValue({});
    const { GET } = await import("@/app/api/readiness/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ready: false, leadRemovalChannel: false, sanity: true, supabase: true, revalidation: true });
  });

  it("counts email sending as the removal channel without waiting for a settings read that hangs", async () => {
    vi.useFakeTimers();
    for (const [name, value] of Object.entries({ ...CONFIGURED, ...EMAIL })) vi.stubEnv(name, value);
    getLegalSettings.mockResolvedValue(REVIEWED);
    getSiteSettings.mockReturnValue(new Promise(() => undefined));
    const { GET } = await import("@/app/api/readiness/route");
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, email: true, leadRemovalChannel: true });
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
