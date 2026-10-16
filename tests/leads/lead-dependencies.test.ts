import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { LegalSettings } from "@/lib/content/types";
import { EMAIL_DOWNLOAD_TTL_SECONDS, IMMEDIATE_DOWNLOAD_TTL_SECONDS, verifyDownloadToken } from "@/lib/freebies/token";
import { ackSendLimitPerHour, createLeadDependencies, immediateDownloadFrom, leadMagnetFrom, leadStorageConfigured } from "@/lib/leads/dependencies";

vi.mock("server-only", () => ({}));

/** The CMS legal settings the next request reads; each test sets what it needs. */
const cms = vi.hoisted(() => ({ legal: null as LegalSettings | null }));
vi.mock("@/lib/sanity/fetch", () => ({
  getLandingPage: async () => SAFE_FALLBACK_CONTENT,
  getLegalSettings: async () => cms.legal ?? SAFE_FALLBACK_LEGAL,
  getSiteSettings: async () => SAFE_FALLBACK_SETTINGS,
}));

const SECRET_32 = "s".repeat(32);
const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://bibo-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture_only" };
const RESEND = { RESEND_API_KEY: "re_fixture", RESEND_FROM: "BIBO Bay <hello@bibobay.example>" };

const request = () => new Request("http://127.0.0.1:3000/api/leads", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });

beforeEach(() => {
  cms.legal = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("address-hashing secret (M8)", () => {
  it("counts storage as configured only with a secret of at least 32 characters", () => {
    expect(leadStorageConfigured({ ...SUPABASE, LEAD_IP_HASH_SECRET: SECRET_32 })).toBe(true);
    expect(leadStorageConfigured({ ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(31) })).toBe(false);
    expect(leadStorageConfigured({ ...SUPABASE, LEAD_IP_HASH_SECRET: ` ${"s".repeat(31)} ` })).toBe(false);
    expect(leadStorageConfigured({ ...SUPABASE })).toBe(false);
  });

  it("stores nothing with a short secret: no repository, no limiter", async () => {
    const deps = await createLeadDependencies(request(), { ...SUPABASE, LEAD_IP_HASH_SECRET: "short-secret" });
    expect(deps.repository).toBeNull();
    expect(deps.rateLimiter).toBeNull();
  });

  it("wires storage with a long enough secret", async () => {
    const deps = await createLeadDependencies(request(), { ...SUPABASE, LEAD_IP_HASH_SECRET: SECRET_32 });
    expect(deps.repository).not.toBeNull();
    expect(deps.rateLimiter).not.toBeNull();
    expect(deps.clientKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("consent copy version (M1)", () => {
  it("uses the CMS version when it fits what the database stores", async () => {
    cms.legal = { ...SAFE_FALLBACK_LEGAL, consentCopyVersion: " 2026-10.v2 " };
    const deps = await createLeadDependencies(request(), {});
    expect(deps.consentVersion).toBe("2026-10.v2");
  });

  it.each([
    ["longer than 40 characters", "v".repeat(41)],
    ["with spaces", "version two"],
    ["with control characters", "v2\u0007"],
    ["with markup", "<b>2</b>"],
  ])("falls back to the repository version, and logs one code without the value, when the CMS version is %s", async (_label, version) => {
    cms.legal = { ...SAFE_FALLBACK_LEGAL, consentCopyVersion: version };
    const deps = await createLeadDependencies(request(), {});
    expect(deps.consentVersion).toBe(SAFE_FALLBACK_LEGAL.consentCopyVersion);
    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([JSON.stringify({ scope: "leads", event: "lead_config_invalid", code: "consent_version_invalid" })]);
    expect(lines.join("")).not.toContain(version);
  });
});

describe("staff alerts (M2)", () => {
  it("passes the staff address on even while Resend is not configured, so the alert is queued", async () => {
    const deps = await createLeadDependencies(request(), { STAFF_NOTIFICATION_EMAIL: "team@bibobay.example" });
    expect(deps.mailer).toBeNull();
    expect(deps.staffEmail).toBe("team@bibobay.example");
  });

  it("passes it on with Resend configured too", async () => {
    const deps = await createLeadDependencies(request(), { ...RESEND, STAFF_NOTIFICATION_EMAIL: "team@bibobay.example" });
    expect(deps.mailer).not.toBeNull();
    expect(deps.staffEmail).toBe("team@bibobay.example");
  });
});

describe("global send cap setting (R40)", () => {
  it.each([
    [undefined, 60],
    ["", 60],
    ["25", 25],
    [" 120 ", 120],
    ["1", 1],
    ["10000", 10000],
    ["0", 60],
    ["-5", 60],
    ["2.5", 60],
    ["1e3", 60],
    ["ten", 60],
    ["10001", 60],
  ])("reads LEAD_ACK_SEND_LIMIT_PER_HOUR=%j as %i per hour", (value, expected) => {
    expect(ackSendLimitPerHour(value === undefined ? {} : { LEAD_ACK_SEND_LIMIT_PER_HOUR: value })).toBe(expected);
  });

  it("hands the cap to the signup flow", async () => {
    const deps = await createLeadDependencies(request(), { LEAD_ACK_SEND_LIMIT_PER_HOUR: "12" });
    expect(deps.sendLimitPerHour).toBe(12);
  });
});

const PACK_URL = "/freebies/bibo-bay-activity-pack.pdf";
const FAKE_SECRET = "fixture-only-not-a-real-secret-0123456789";
const SIGNED_ENV = { LEAD_IP_HASH_SECRET: FAKE_SECRET, NEXT_PUBLIC_APP_URL: "https://bibobay.example" };
const lead = (fileUrl: string) => ({ ...SAFE_FALLBACK_CONTENT.lead, leadMagnet: { ...SAFE_FALLBACK_CONTENT.lead.leadMagnet!, title: "Bibo Bay Activity Pack", available: true, fileUrl } });
const tokenOf = (link: string) => new URL(link, "https://x.example").searchParams.get("t");
const secondsLeft = (token: string | null) => {
  const claims = JSON.parse(Buffer.from((token ?? "").split(".")[0] ?? "", "base64url").toString("utf8")) as { e: number };
  return claims.e - Math.floor(Date.now() / 1000);
};

// R140 overrides R66: the pack is reached only through a signed link, signed at call time.
describe("the activity pack in the acknowledgement email (R140)", () => {
  it("links the signed download route on the site's public origin, valid for the email lifetime", () => {
    const magnet = leadMagnetFrom(lead(PACK_URL), SAFE_FALLBACK_SETTINGS, SIGNED_ENV);
    expect(magnet?.title).toBe("Bibo Bay Activity Pack");
    expect(magnet?.fileUrl.startsWith("https://bibobay.example/api/freebies/download?t=")).toBe(true);
    expect(magnet?.expiresInDays).toBe(30);
    const token = tokenOf(magnet?.fileUrl ?? "");
    expect(verifyDownloadToken(token, SIGNED_ENV)).toEqual({ ok: true, fileUrl: PACK_URL });
    expect(secondsLeft(token)).toBeGreaterThan(EMAIL_DOWNLOAD_TTL_SECONDS - 60);
    expect(secondsLeft(token)).toBeLessThanOrEqual(EMAIL_DOWNLOAD_TTL_SECONDS);
  });

  it("leaves the pack out of the email while the origin is unknown, rather than send a broken link", () => {
    expect(leadMagnetFrom(lead(PACK_URL), SAFE_FALLBACK_SETTINGS, { LEAD_IP_HASH_SECRET: FAKE_SECRET })).toBeNull();
  });

  it("leaves the pack out while the signing secret is missing or short", () => {
    expect(leadMagnetFrom(lead(PACK_URL), SAFE_FALLBACK_SETTINGS, { NEXT_PUBLIC_APP_URL: "https://bibobay.example" })).toBeNull();
    expect(leadMagnetFrom(lead(PACK_URL), SAFE_FALLBACK_SETTINGS, { ...SIGNED_ENV, LEAD_IP_HASH_SECRET: "short" })).toBeNull();
  });

  it("passes an https CMS file through unchanged, without a token", () => {
    const url = "https://cdn.sanity.io/files/abc/production/sheet.pdf";
    expect(leadMagnetFrom(lead(url), SAFE_FALLBACK_SETTINGS, {})).toEqual({ title: "Bibo Bay Activity Pack", fileUrl: url });
    expect(leadMagnetFrom(lead(url), SAFE_FALLBACK_SETTINGS, {})?.expiresInDays).toBeUndefined();
  });

  it("wires the signed link into the request dependencies", async () => {
    const deps = await createLeadDependencies(request(), SIGNED_ENV);
    expect(deps.leadMagnet?.fileUrl).toContain("https://bibobay.example/api/freebies/download?t=");
  });
});

describe("the download the signup answer carries (R140)", () => {
  it("is a same-origin signed path valid for the immediate lifetime", () => {
    const download = immediateDownloadFrom(lead(PACK_URL), SIGNED_ENV);
    expect(download?.title).toBe("Bibo Bay Activity Pack");
    expect(download?.url.startsWith("/api/freebies/download?t=")).toBe(true);
    const token = tokenOf(download?.url ?? "");
    expect(verifyDownloadToken(token, SIGNED_ENV)).toEqual({ ok: true, fileUrl: PACK_URL });
    expect(secondsLeft(token)).toBeGreaterThan(IMMEDIATE_DOWNLOAD_TTL_SECONDS - 60);
    expect(secondsLeft(token)).toBeLessThanOrEqual(IMMEDIATE_DOWNLOAD_TTL_SECONDS);
  });

  it("needs no public origin, only the secret", () => {
    expect(immediateDownloadFrom(lead(PACK_URL), { LEAD_IP_HASH_SECRET: FAKE_SECRET })).not.toBeNull();
  });

  it("is null without a signing secret", () => {
    expect(immediateDownloadFrom(lead(PACK_URL), {})).toBeNull();
  });

  it("is null when no file is available", () => {
    const unavailable = { ...SAFE_FALLBACK_CONTENT.lead, leadMagnet: { ...SAFE_FALLBACK_CONTENT.lead.leadMagnet!, title: "Pack", available: false, fileUrl: PACK_URL } };
    expect(immediateDownloadFrom(unavailable, SIGNED_ENV)).toBeNull();
  });

  it("hands an https CMS file over as it is, with no token", () => {
    const url = "https://cdn.sanity.io/files/abc/production/sheet.pdf";
    expect(immediateDownloadFrom(lead(url), {})).toEqual({ title: "Bibo Bay Activity Pack", url });
  });

  it("refuses a file that is neither the repository pack nor https", () => {
    expect(immediateDownloadFrom(lead("javascript:alert(1)"), SIGNED_ENV)).toBeNull();
  });

  it("is wired into the request dependencies", async () => {
    expect((await createLeadDependencies(request(), SIGNED_ENV)).download?.url).toContain("/api/freebies/download?t=");
    expect((await createLeadDependencies(request(), {})).download).toBeNull();
  });
});
