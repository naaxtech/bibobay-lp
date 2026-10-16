import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { SITE_SETTINGS_QUERY } from "@/lib/sanity/queries";

vi.mock("server-only", () => ({}));
const { getSanityClient } = vi.hoisted(() => ({ getSanityClient: vi.fn<(options?: { preview?: boolean }) => unknown>(() => null) }));
vi.mock("@/lib/sanity/client", () => ({ getSanityClient }));

import { GATE_SETTINGS_REVALIDATE_SECONDS, getGateSettings, getSiteSettings } from "@/lib/sanity/fetch";

/*
 * Fix wave D-M2, Ruling R127: the commerce kill switch has a time backstop. The settings read that
 * feeds the order routes' gates (`isCommerceEnabled` / `isTrackingEnabled`) is cached for at most
 * 300 seconds besides its tag, so switching commerce off in Studio stops orders within five minutes
 * even when the revalidation webhook is broken. The landing page's reads keep tag-only caching.
 */
afterEach(() => {
  getSanityClient.mockReset().mockReturnValue(null);
});

const client = (answer: unknown = { commerceEnabled: true, trackingEnabled: true }) => {
  const fetch = vi.fn().mockResolvedValue(answer);
  getSanityClient.mockReturnValue({ fetch });
  return fetch;
};

describe("the gate's settings read (D-M2, Ruling R127)", () => {
  it("is tagged siteSettings AND expires after 300 seconds, from the published dataset", async () => {
    const fetch = client();
    await getGateSettings();
    expect(GATE_SETTINGS_REVALIDATE_SECONDS).toBe(300);
    expect(fetch).toHaveBeenCalledWith(SITE_SETTINGS_QUERY, {}, { next: { tags: ["siteSettings"], revalidate: 300 }, perspective: "published" });
  });

  it("reads the same settings document as the landing page, normalised the same way", async () => {
    client({ commerceEnabled: true, trackingEnabled: true });
    expect(await getGateSettings()).toEqual(await getSiteSettings());
    expect((await getGateSettings()).commerceEnabled).toBe(true);
  });

  it("leaves the landing page's read on tag-only caching", async () => {
    const fetch = client();
    await getSiteSettings();
    expect(fetch).toHaveBeenCalledWith(SITE_SETTINGS_QUERY, {}, { next: { tags: ["siteSettings"], revalidate: false }, perspective: "published" });
  });

  it("falls back to the repository settings (commerce off) when Sanity is unconfigured or fails", async () => {
    expect(await getGateSettings()).toEqual(SAFE_FALLBACK_SETTINGS);
    getSanityClient.mockReturnValue({ fetch: vi.fn().mockRejectedValue(new Error("origin unavailable")) });
    expect(await getGateSettings()).toEqual(SAFE_FALLBACK_SETTINGS);
    expect(SAFE_FALLBACK_SETTINGS.commerceEnabled).toBe(false);
  });
});

describe("the order routes gate on that read", () => {
  it.each([
    ["POST /api/orders", "@/app/api/orders/route", "http://127.0.0.1:3000/api/orders"],
    ["POST /api/orders/track", "@/app/api/orders/track/route", "http://127.0.0.1:3000/api/orders/track"],
  ])("%s asks Sanity with the 300-second backstop and honours it", async (_label, path, url) => {
    const { POST } = (await import(path)) as { POST: (request: Request) => Promise<Response> };
    const notJson = () => new Request(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });

    // Switched on: the request gets past the gate (415: not JSON), and the read carried the backstop.
    const on = client({ commerceEnabled: true, trackingEnabled: true });
    expect((await POST(notJson())).status).toBe(415);
    expect(on).toHaveBeenCalledWith(SITE_SETTINGS_QUERY, {}, { next: { tags: ["siteSettings"], revalidate: 300 }, perspective: "published" });

    // Switched off: the same request is refused at the gate.
    client({ commerceEnabled: false, trackingEnabled: false });
    expect((await POST(notJson())).status).toBe(404);
  });
});

describe("every server module that decides commerce or tracking gating reads through the gate settings (R127)", () => {
  it.each([
    "components/shop/OrderPadMount.tsx",
    "app/(commerce)/order/page.tsx",
    "app/(commerce)/shop/page.tsx",
    "app/(commerce)/shop/[slug]/page.tsx",
    "app/orders/[token]/page.tsx",
    "app/orders/[token]/not-found.tsx",
    "app/track/page.tsx",
  ])("%s calls getGateSettings and never the tag-only getSiteSettings", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).toMatch(/\bgetGateSettings\(/);
    expect(source).not.toMatch(/\bgetSiteSettings\b/);
  });

  it("the commerce layout, which makes no gating decision, does not read settings at all", () => {
    expect(readFileSync(resolve(process.cwd(), "app/(commerce)/layout.tsx"), "utf8")).not.toMatch(/getSiteSettings|getGateSettings/);
  });
});
