import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { SiteSettings } from "@/lib/content/types";

vi.mock("server-only", () => ({}));

const { getSiteSettings } = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getLegalSettings: vi.fn() }));

const withStudio = (studioUrl: string | undefined): SiteSettings => ({ ...SAFE_FALLBACK_SETTINGS, ...(studioUrl ? { studioUrl } : {}) });

beforeEach(() => {
  getSiteSettings.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /studio", () => {
  it("redirects (307) to the Studio URL from site settings when it is https", async () => {
    getSiteSettings.mockResolvedValue(withStudio("https://bibobay.sanity.studio/"));
    const { GET } = await import("@/app/studio/route");
    const response = await GET();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://bibobay.sanity.studio/");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([undefined, "http://bibobay.sanity.studio", "javascript:alert(1)", "//evil.example", "/admin"])("answers 404 for %s", async (studioUrl) => {
    getSiteSettings.mockResolvedValue(withStudio(studioUrl));
    const { GET } = await import("@/app/studio/route");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
