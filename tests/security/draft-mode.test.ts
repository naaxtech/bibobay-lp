import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { DRAFT_DISABLE_PATH, handleDraftModeEnable, safeRedirectPath } from "@/lib/sanity/draft-mode";

vi.mock("server-only", () => ({}));

/** Next's draft-mode store, as a route handler or page sees it. */
const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false, enable: vi.fn(), disable: vi.fn() } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

/** The Sanity reads, so the test sees which perspective each page asked for. */
const { getLandingPage, getSiteSettings, getLegalSettings } = vi.hoisted(() => ({
  getLandingPage: vi.fn(),
  getSiteSettings: vi.fn(),
  getLegalSettings: vi.fn(),
}));
vi.mock("@/lib/sanity/fetch", () => ({ getLandingPage, getSiteSettings, getLegalSettings }));

const { validatePreviewUrl } = vi.hoisted(() => ({ validatePreviewUrl: vi.fn() }));
vi.mock("@sanity/preview-url-secret", () => ({ validatePreviewUrl }));

const { getSanityClient } = vi.hoisted(() => ({ getSanityClient: vi.fn() }));
vi.mock("@/lib/sanity/client", () => ({ getSanityClient }));

const client = { config: () => ({ token: "t" }), withConfig: () => client, fetch: vi.fn() };
const enableUrl = (query: string) => new Request(`https://bibo.example/api/draft-mode/enable?${query}`);

beforeEach(() => {
  draft.isEnabled = false;
  draft.enable.mockReset();
  draft.disable.mockReset();
  validatePreviewUrl.mockReset();
  getSanityClient.mockReset();
  getLandingPage.mockReset().mockResolvedValue(SAFE_FALLBACK_CONTENT);
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getLegalSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_LEGAL);
});
afterEach(() => {
  cleanup();
});

describe("safe redirect paths", () => {
  it.each([
    ["/", "/"],
    ["/privacy", "/privacy"],
    ["/terms?sanity-preview-perspective=drafts#top", "/terms?sanity-preview-perspective=drafts#top"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    undefined, null, "", "privacy", "//evil.example/x", "/\\evil.example", "\\\\evil.example", "https://evil.example/", "javascript:alert(1)", "/\t/evil.example", "/%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"),
    // Dot segments normalise to a protocol-relative path, which a browser follows off-site (Task 9 review I3).
    "/.//evil.example", "/a/..//evil.example", "/%2e//evil.example/x", "/%2E%2E//evil.example",
  ])(
    "sends %j home instead",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );
});

describe("draft mode enable", () => {
  it("refuses without validating when preview is not configured (no read token)", async () => {
    const response = await handleDraftModeEnable(enableUrl("sanity-preview-secret=s"), { client: null, validate: validatePreviewUrl, enable: draft.enable });
    expect(response.status).toBe(503);
    expect(validatePreviewUrl).not.toHaveBeenCalled();
    expect(draft.enable).not.toHaveBeenCalled();
  });

  it("answers 401 and leaves draft mode off for an invalid secret", async () => {
    validatePreviewUrl.mockResolvedValue({ isValid: false });
    const response = await handleDraftModeEnable(enableUrl("sanity-preview-secret=wrong&sanity-preview-pathname=/privacy"), { client, validate: validatePreviewUrl, enable: draft.enable });
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(draft.enable).not.toHaveBeenCalled();
  });

  it("validates the full request URL with the Studio's secret and redirects to the previewed path", async () => {
    validatePreviewUrl.mockResolvedValue({ isValid: true, redirectTo: "/privacy?sanity-preview-perspective=drafts" });
    const request = enableUrl("sanity-preview-secret=s&sanity-preview-pathname=/privacy");
    const response = await handleDraftModeEnable(request, { client, validate: validatePreviewUrl, enable: draft.enable });
    expect(validatePreviewUrl).toHaveBeenCalledWith(client, request.url);
    expect(draft.enable).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/privacy?sanity-preview-perspective=drafts");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["//evil.example/phish", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"])("never redirects off-site, even for a valid secret: %s", async (redirectTo) => {
    validatePreviewUrl.mockResolvedValue({ isValid: true, redirectTo });
    const response = await handleDraftModeEnable(enableUrl("sanity-preview-secret=s"), { client, validate: validatePreviewUrl, enable: draft.enable });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/");
  });

  it("answers 503 and leaves draft mode off when the secret cannot be checked", async () => {
    validatePreviewUrl.mockRejectedValue(new Error("network down"));
    const response = await handleDraftModeEnable(enableUrl("sanity-preview-secret=s"), { client, validate: validatePreviewUrl, enable: draft.enable });
    expect(response.status).toBe(503);
    expect(draft.enable).not.toHaveBeenCalled();
  });
});

describe("draft mode routes", () => {
  it("GET /api/draft-mode/enable uses the token client and Next's draft mode", async () => {
    getSanityClient.mockReturnValue(client);
    validatePreviewUrl.mockResolvedValue({ isValid: true, redirectTo: "/terms" });
    const { GET } = await import("@/app/api/draft-mode/enable/route");
    const response = await GET(enableUrl("sanity-preview-secret=s&sanity-preview-pathname=/terms"));
    expect(getSanityClient).toHaveBeenCalledWith({ preview: true });
    expect(draft.enable).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("/terms");
  });

  it("GET /api/draft-mode/disable turns draft mode off and goes home", async () => {
    const { GET } = await import("@/app/api/draft-mode/disable/route");
    const response = await GET();
    expect(DRAFT_DISABLE_PATH).toBe("/api/draft-mode/disable");
    expect(draft.disable).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/");
  });
});

describe("pages in draft mode", () => {
  it("the home page reads drafts, says it is a preview, offers a way out, and is noindex", async () => {
    draft.isEnabled = true;
    const { default: Home, generateMetadata } = await import("@/app/page");
    render(await Home());
    expect(getLandingPage).toHaveBeenCalledWith({ preview: true });
    expect(getSiteSettings).toHaveBeenCalledWith({ preview: true });
    expect(screen.getByRole("link", { name: /exit preview/i }).getAttribute("href")).toBe(DRAFT_DISABLE_PATH);
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });

  it("the home page reads published content and shows no preview notice otherwise", async () => {
    const { default: Home } = await import("@/app/page");
    render(await Home());
    expect(getLandingPage).toHaveBeenCalledWith({ preview: false });
    expect(screen.queryByRole("link", { name: /exit preview/i })).toBeNull();
  });

  it.each(["privacy", "terms"] as const)("/%s reads draft legal text in draft mode", async (kind) => {
    draft.isEnabled = true;
    const { default: Page } = kind === "privacy" ? await import("@/app/privacy/page") : await import("@/app/terms/page");
    render(await Page());
    expect(getLegalSettings).toHaveBeenCalledWith({ preview: true });
    expect(screen.getByRole("link", { name: /exit preview/i })).toBeTruthy();
  });
});
