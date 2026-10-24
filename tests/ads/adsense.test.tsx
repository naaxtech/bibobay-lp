import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADSENSE_CLIENT,
  ADSENSE_CSP_SOURCES,
  ADSENSE_PAGES,
  ADS_TXT_LINE,
  ADSENSE_SCRIPT_SRC,
  adsenseEnabled,
  adsenseOnFor,
  isAdScriptUrl,
} from "@/lib/ads/adsense";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/security/headers";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
let draft = false;
vi.mock("@/lib/sanity/draft-mode", () => ({ isDraftMode: async () => draft }));
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const PRODUCTION = { VERCEL_ENV: "production" } as const;

describe("AdSense settings (R251, R252)", () => {
  it("is the owner's publisher and the exact script address AdSense gave", () => {
    expect(ADSENSE_CLIENT).toBe("ca-pub-6883401604924323");
    expect(ADSENSE_SCRIPT_SRC).toBe("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6883401604924323");
  });

  it("is on for the Vercel production deployment only", () => {
    expect(adsenseEnabled(PRODUCTION)).toBe(true);
    expect(adsenseEnabled({ VERCEL_ENV: " production " })).toBe(true);
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { NODE_ENV: "production" }]) expect(adsenseEnabled(env), JSON.stringify(env)).toBe(false);
  });

  it("is on for the content pages only: the home page today (R257)", () => {
    expect(ADSENSE_PAGES).toEqual(["/"]);
    expect(adsenseOnFor("/", PRODUCTION)).toBe(true);
    // Google Publisher Policies: no ads on screens without publisher content (thank-you, error/404),
    // alerts or forms; legal and shop pages are left out too until there is a reason to add them.
    for (const path of ["/thank-you", "/no-such-page", "/contact", "/privacy", "/terms", "/shop", "/shop/tula", "/order", "/adminx", "/ordersx", "//", "/?x=1", "/index"]) {
      expect(adsenseOnFor(path, PRODUCTION), path).toBe(false);
    }
  });

  it("is never on for staff, order, tracking or Studio pages (R252)", () => {
    for (const path of ["/admin", "/admin/", "/admin/login", "/admin/orders/BB-1", "/orders", "/orders/abc123token", "/track", "/track/", "/studio", "/studio/structure"]) {
      expect(adsenseOnFor(path, PRODUCTION), path).toBe(false);
    }
    expect(adsenseOnFor(null, PRODUCTION)).toBe(false);
    expect(adsenseOnFor("", PRODUCTION)).toBe(false);
    expect(adsenseOnFor("/", { VERCEL_ENV: "preview" })).toBe(false);
  });

  it("keeps the CSP sources to exact Google ad hosts or ad-only domains, all https", () => {
    for (const source of ADSENSE_CSP_SOURCES) expect(source, source).toMatch(/^https:\/\/(?:\*\.)?[a-z0-9.-]+$/);
    expect(ADSENSE_CSP_SOURCES).toContain("https://*.googlesyndication.com");
    expect(ADSENSE_CSP_SOURCES).toContain("https://*.doubleclick.net");
    expect(ADSENSE_CSP_SOURCES).not.toContain("https:");
    expect(ADSENSE_CSP_SOURCES).not.toContain("https://*.google.com");
  });

  it("recognises addresses served by Google's ad script, and nothing that only looks like one", () => {
    for (const url of [
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6883401604924323",
      "https://tpc.googlesyndication.com/sodar/x.js",
      "https://googleads.g.doubleclick.net/pagead/ads",
      "https://ep1.adtrafficquality.google/getconfig/sodar",
      "https://fundingchoicesmessages.google.com/i/pub-6883401604924323",
    ]) {
      expect(isAdScriptUrl(url), url).toBe(true);
    }
    for (const url of ["https://www.bibobay.com/", "https://googlesyndication.com.evil.example/a.js", "https://evil-googlesyndication.com/a.js", "http://pagead2.googlesyndication.com/a.js", "", "not a url"]) {
      expect(isAdScriptUrl(url), url).toBe(false);
    }
  });
});

describe("AdSenseTag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    requestHeaders = new Headers();
    draft = false;
  });

  async function markup(path: string | null, nonce: string | null = "bm9uY2U9") {
    requestHeaders = new Headers();
    if (path !== null) requestHeaders.set(PATHNAME_HEADER, path);
    if (nonce !== null) requestHeaders.set(NONCE_HEADER, nonce);
    const { AdSenseTag } = await import("@/components/ads/AdSenseTag");
    const element = await AdSenseTag();
    return element ? renderToStaticMarkup(element) : "";
  }

  it("renders the owner's snippet, with the request's nonce, on a production public page", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const html = await markup("/");
    expect(html).toBe(`<script async="" src="${ADSENSE_SCRIPT_SRC.replace(/&/g, "&amp;")}" crossorigin="anonymous" nonce="bm9uY2U9"></script>`);
  });

  it("renders nothing on a private page, off production, or when the proxy did not name the page", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await markup("/orders/abc123token")).toBe("");
    expect(await markup("/thank-you")).toBe("");
    expect(await markup("/no-such-page")).toBe("");
    expect(await markup("/admin/orders")).toBe("");
    expect(await markup(null)).toBe("");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await markup("/")).toBe("");
  });

  it("renders nothing in Sanity draft mode, so editors' previews never count as ad impressions", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    draft = true;
    expect(await markup("/")).toBe("");
  });

  it("mounts the leave guard exactly where the tag is rendered (R257)", async () => {
    const { AdSenseLeaveGuard } = await import("@/components/ads/AdSenseTag");
    const guardFor = async (path: string) => {
      requestHeaders = new Headers({ [PATHNAME_HEADER]: path });
      return AdSenseLeaveGuard();
    };
    expect(await guardFor("/")).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    const element = await guardFor("/");
    expect(element).not.toBeNull();
    expect((element as { props: { pages: readonly string[] } }).props.pages).toEqual(ADSENSE_PAGES);
    expect(await guardFor("/contact")).toBeNull();
    draft = true;
    expect(await guardFor("/")).toBeNull();
  });

  it("leaves the nonce off rather than inventing one when the request has none", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const html = await markup("/", null);
    expect(html).toContain('src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6883401604924323"');
    expect(html).not.toContain("nonce");
  });
});

describe("ads.txt (R256)", () => {
  const file = readFileSync(resolve("public/ads.txt"), "utf8");

  it("is Google's line for this publisher, exactly as AdSense gives it", () => {
    expect(ADS_TXT_LINE).toBe("google.com, pub-6883401604924323, DIRECT, f08c47fec0942fa0");
    expect(ADS_TXT_LINE).toContain(ADSENSE_CLIENT.replace(/^ca-/, ""));
  });

  it("lists that line once and nothing else", () => {
    const records = file.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    expect(records).toEqual([ADS_TXT_LINE]);
    expect(file.endsWith("\n")).toBe(true);
  });
});

describe("AdPageGuard (R257)", () => {
  afterEach(() => {
    pathname = "/";
    cleanup();
  });

  it("reloads the document once a client-side navigation leaves the ad pages, and never on them", async () => {
    const { AdPageGuard } = await import("@/components/ads/AdPageGuard");
    const reload = vi.fn();
    const view = render(<AdPageGuard pages={["/"]} reload={reload} />);
    expect(reload).not.toHaveBeenCalled();
    pathname = "/contact";
    view.rerender(<AdPageGuard pages={["/"]} reload={reload} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(view.container.innerHTML).toBe("");
  });

  it("stays quiet while the path is an ad page", async () => {
    const { AdPageGuard } = await import("@/components/ads/AdPageGuard");
    const reload = vi.fn();
    const view = render(<AdPageGuard pages={["/", "/stories"]} reload={reload} />);
    pathname = "/stories";
    view.rerender(<AdPageGuard pages={["/", "/stories"]} reload={reload} />);
    expect(reload).not.toHaveBeenCalled();
  });
});
