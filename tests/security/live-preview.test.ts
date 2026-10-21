import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyPerspectiveChange, handleDraftModeDisable, handleDraftModeEnable, type PreviewCookieJar } from "@/lib/sanity/draft-mode";
import { PARTITIONED_COOKIE, PERSPECTIVE_COOKIE, sanitizePreviewPerspective } from "@/lib/sanity/perspective";
import { createPreviewRefresher } from "@/components/preview/refresh";
import { inPresentationContext } from "@/components/preview/presentation-context";

/*
 * Live editing in the Studio's Presentation tool (rulings R159-R165): stega only for previews,
 * the perspective the Studio picks, draft cookies that survive a cross-site iframe, and a refresh
 * on every edit.
 */

vi.mock("server-only", () => ({}));

const { cookieValues } = vi.hoisted(() => ({ cookieValues: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieValues.has(name) ? { name, value: cookieValues.get(name)! } : undefined) }),
  draftMode: async () => ({ isEnabled: true, enable: vi.fn(), disable: vi.fn() }),
}));

/** A cookie jar that records what a route or action wrote, like Next's mutable cookies. */
function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: Array<Record<string, unknown>> = [];
  const store: PreviewCookieJar = {
    get: (name) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
    has: (name) => values.has(name),
    set: (options) => { writes.push({ op: "set", ...options }); values.set(options.name, options.value); },
    delete: (options) => { writes.push({ op: "delete", ...options }); values.delete(options.name); },
  };
  return { store, writes, values };
}

const client = { config: () => ({ token: "t" }), withConfig: () => client, fetch: vi.fn() };
const enableRequest = (headers: Record<string, string> = {}) => new Request("https://www.bibobay.com/api/draft-mode/enable?sanity-preview-secret=s", { headers });
const IFRAME = { "sec-fetch-dest": "iframe", "sec-fetch-site": "cross-site" };

beforeEach(() => {
  cookieValues.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the perspective a preview reads with (R162)", () => {
  it.each([
    [undefined, "drafts"],
    ["", "drafts"],
    ["drafts", "drafts"],
    ["published", "published"],
    ["raw", "drafts"],
    ["rSummer1,drafts", ["rSummer1", "drafts"]],
    [["rSummer1", "drafts"], ["rSummer1", "drafts"]],
    ["drafts;Path=/", "drafts"],
    ["<script>", "drafts"],
    ["previewDrafts", "drafts"],
    [42, "drafts"],
  ])("%j reads as %j", (input, expected) => {
    expect(sanitizePreviewPerspective(input)).toEqual(expected);
  });

  it("draft reads use the perspective cookie, and published reads never do", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "k82r18ol");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_READ_TOKEN", "viewer-token");
    cookieValues.set(PERSPECTIVE_COOKIE, "published");
    const fetchSpy = vi.fn().mockResolvedValue(null);
    vi.resetModules();
    vi.doMock("@/lib/sanity/client", () => ({ getSanityClient: () => ({ fetch: fetchSpy }) }));
    const { getLegalSettings } = await import("@/lib/sanity/fetch");
    await getLegalSettings({ preview: true });
    expect(fetchSpy.mock.calls[0]?.[2]).toEqual({ cache: "no-store", perspective: "published" });
    await getLegalSettings({ preview: false });
    expect(fetchSpy.mock.calls[1]?.[2]).toMatchObject({ perspective: "published", next: { tags: ["legalSettings"] } });
    cookieValues.clear();
    await getLegalSettings({ preview: true });
    expect(fetchSpy.mock.calls[2]?.[2]).toEqual({ cache: "no-store", perspective: "drafts" });
    vi.doUnmock("@/lib/sanity/client");
  });

  it("the contact page's draft read uses the perspective cookie too, and its published read never does", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "k82r18ol");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_READ_TOKEN", "viewer-token");
    cookieValues.set(PERSPECTIVE_COOKIE, "rSummer1,drafts");
    const fetchSpy = vi.fn().mockResolvedValue(null);
    vi.resetModules();
    vi.doMock("@/lib/sanity/client", () => ({ getSanityClient: () => ({ fetch: fetchSpy }) }));
    const { getContactPage } = await import("@/lib/sanity/fetch");
    await getContactPage({ preview: true });
    expect(fetchSpy.mock.calls[0]?.[2]).toEqual({ cache: "no-store", perspective: ["rSummer1", "drafts"] });
    await getContactPage({ preview: false });
    expect(fetchSpy.mock.calls[1]?.[2]).toMatchObject({ perspective: "published", next: { tags: ["contactPage"] } });
    vi.doUnmock("@/lib/sanity/client");
  });
});

describe("stega is for previews only (R159)", () => {
  const load = async () => {
    vi.resetModules();
    return (await import("@/lib/sanity/client")).getSanityClient;
  };
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "k82r18ol");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_READ_TOKEN", "viewer-token");
  });

  it("a preview client encodes click-to-edit links to the verified Studio", async () => {
    vi.stubEnv("SANITY_STUDIO_ORIGIN", "https://bibobay.sanity.studio");
    const config = (await load())({ preview: true })!.config();
    expect(config.stega).toMatchObject({ enabled: true, studioUrl: "https://bibobay.sanity.studio" });
    expect(config.perspective).toBe("drafts");
  });

  it("a published client never asks for source maps", async () => {
    vi.stubEnv("SANITY_STUDIO_ORIGIN", "https://bibobay.sanity.studio");
    const config = (await load())()!.config();
    expect(config.stega.enabled).toBe(false);
    expect(config.token).toBeUndefined();
  });

  it.each(["", "http://bibobay.sanity.studio", "not a url"])("a preview without a verified Studio origin (%j) encodes nothing", async (origin) => {
    vi.stubEnv("SANITY_STUDIO_ORIGIN", origin);
    const config = (await load())({ preview: true })!.config();
    expect(config.stega.enabled).toBe(false);
  });
});

describe("draft cookies in the Presentation iframe (R162, R163)", () => {
  const valid = (extra: Record<string, unknown> = {}) => vi.fn().mockResolvedValue({ isValid: true, redirectTo: "/", ...extra });

  it("re-sets the draft cookie Partitioned in a cross-site iframe and stores the Studio's perspective", async () => {
    const { store, writes } = jar({ __prerender_bypass: "bypass-id" });
    const enable = vi.fn();
    const response = await handleDraftModeEnable(enableRequest(IFRAME), { client, validate: valid({ studioPreviewPerspective: "rSummer1,drafts" }), enable, cookies: store, secure: true });
    expect(response.status).toBe(307);
    expect(enable).toHaveBeenCalledTimes(1);
    const attributes = { httpOnly: true, path: "/", secure: true, sameSite: "none", partitioned: true };
    expect(writes).toContainEqual({ op: "set", name: "__prerender_bypass", value: "bypass-id", ...attributes });
    expect(writes).toContainEqual({ op: "set", name: PERSPECTIVE_COOKIE, value: "rSummer1,drafts", ...attributes });
    expect(writes).toContainEqual({ op: "set", name: PARTITIONED_COOKIE, value: "1", ...attributes });
  });

  it("keeps plain cookies for a top-level visit, with a refused perspective read as drafts", async () => {
    const { store, writes } = jar({ __prerender_bypass: "bypass-id" });
    await handleDraftModeEnable(enableRequest({ "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" }), { client, validate: valid({ studioPreviewPerspective: "raw" }), enable: vi.fn(), cookies: store, secure: true });
    expect(writes).toContainEqual({ op: "set", name: "__prerender_bypass", value: "bypass-id", httpOnly: true, path: "/", secure: true, sameSite: "none", partitioned: false });
    expect(writes).toContainEqual(expect.objectContaining({ op: "set", name: PERSPECTIVE_COOKIE, value: "drafts", partitioned: false }));
    expect(writes.some((write) => write.name === PARTITIONED_COOKIE)).toBe(false);
  });

  it("uses lax, not secure, cookies on a local http server", async () => {
    const { store, writes } = jar({ __prerender_bypass: "bypass-id" });
    await handleDraftModeEnable(enableRequest(IFRAME), { client, validate: valid(), enable: vi.fn(), cookies: store, secure: false });
    expect(writes).toContainEqual(expect.objectContaining({ name: "__prerender_bypass", secure: false, sameSite: "lax", partitioned: false }));
  });

  it("writes no cookie of its own when the secret is wrong", async () => {
    const { store, writes } = jar({ __prerender_bypass: "bypass-id" });
    const response = await handleDraftModeEnable(enableRequest(IFRAME), { client, validate: vi.fn().mockResolvedValue({ isValid: false }), enable: vi.fn(), cookies: store, secure: true });
    expect(response.status).toBe(401);
    expect(writes).toEqual([]);
  });

  it("leaving draft mode clears the perspective and, inside the frame, the partitioned copies", async () => {
    const framed = jar({ __prerender_bypass: "bypass-id", [PERSPECTIVE_COOKIE]: "published", [PARTITIONED_COOKIE]: "1" });
    const disable = vi.fn();
    const response = await handleDraftModeDisable({ disable, cookies: framed.store, secure: true });
    expect(disable).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/");
    for (const name of ["__prerender_bypass", PERSPECTIVE_COOKIE, PARTITIONED_COOKIE]) {
      expect(framed.writes).toContainEqual(expect.objectContaining({ op: "delete", name, partitioned: true }));
    }
    const plain = jar({ __prerender_bypass: "bypass-id", [PERSPECTIVE_COOKIE]: "published" });
    await handleDraftModeDisable({ disable: vi.fn(), cookies: plain.store, secure: true });
    expect(plain.writes).toContainEqual(expect.objectContaining({ op: "delete", name: PERSPECTIVE_COOKIE, partitioned: false }));
    expect(plain.writes.some((write) => write.name === "__prerender_bypass")).toBe(false);
  });
});

describe("the Studio's perspective switch (R162)", () => {
  it("stores a valid perspective and refreshes, in draft mode only", async () => {
    const framed = jar({ [PARTITIONED_COOKIE]: "1" });
    const refresh = vi.fn();
    await applyPerspectiveChange("published", { draftMode: true, cookies: framed.store, secure: true, refresh });
    expect(framed.writes).toEqual([{ op: "set", name: PERSPECTIVE_COOKIE, value: "published", httpOnly: true, path: "/", secure: true, sameSite: "none", partitioned: true }]);
    expect(refresh).toHaveBeenCalledTimes(1);

    const same = jar({ [PERSPECTIVE_COOKIE]: "published" });
    await applyPerspectiveChange("published", { draftMode: true, cookies: same.store, secure: true, refresh });
    expect(same.writes).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);

    const visitor = jar();
    await applyPerspectiveChange("published", { draftMode: false, cookies: visitor.store, secure: true, refresh });
    expect(visitor.writes).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a perspective that is not one, rather than storing drafts by accident", async () => {
    const { store, writes } = jar({ [PERSPECTIVE_COOKIE]: "published" });
    const refresh = vi.fn();
    await applyPerspectiveChange("raw", { draftMode: true, cookies: store, secure: true, refresh });
    await applyPerspectiveChange("a;b=c", { draftMode: true, cookies: store, secure: true, refresh });
    expect(writes).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("refreshing the preview on every edit (R162)", () => {
  it("refreshes at once when the Studio asks, and twice after the last of a burst of edits", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const handle = createPreviewRefresher(refresh);
    void handle({ source: "manual" });
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockClear();

    const first = handle({ source: "mutation" });
    await vi.advanceTimersByTimeAsync(200);
    const second = handle({ source: "mutation" });
    await vi.advanceTimersByTimeAsync(299);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1200);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("declines a refresh source it does not know, so Presentation does not wait on it", () => {
    expect(createPreviewRefresher(vi.fn())({ source: "something-else" } as never)).toBe(false);
  });
});

describe("where Visual Editing loads (R161, R164)", () => {
  it.each([
    ["a normal tab", { self: "w", top: "w", opener: null }, false],
    ["the Presentation iframe", { self: "w", top: "studio", opener: null }, true],
    ["a window Presentation opened", { self: "w", top: "w", opener: {} }, true],
  ])("%s → %s", (_label, win, expected) => {
    expect(inPresentationContext(win as unknown as Window)).toBe(expected);
  });

  it("counts a frame whose top it may not read as framed", () => {
    const win = { self: "w", opener: null, get top(): Window { throw new DOMException("blocked", "SecurityError"); } };
    expect(inPresentationContext(win as unknown as Window)).toBe(true);
  });
});
