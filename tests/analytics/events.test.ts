import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS, cleanCapture, cleanProperties } from "@/lib/analytics/events";

/**
 * Ruling R70 (owner, 2026-10-16): count every visit, what visitors do and where they come from,
 * with nothing that identifies a person. Every event passes through cleanCapture (PostHog's
 * before_send) on its way out.
 */
const capture = (event: string, properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ uuid: "u-1", event, properties, ...extra });

describe("the event allow-list", () => {
  it("names what a visitor does on the page, and nothing else", () => {
    expect(Object.keys(ANALYTICS_EVENTS).sort()).toEqual(["cta_clicked", "faq_opened", "freebie_downloaded", "lead_submitted", "menu_opened", "section_viewed", "tab_selected", "youtube_clicked"]);
  });

  it("keeps only the properties each event allows, as short plain values", () => {
    expect(cleanProperties("youtube_clicked", { kind: "video", video_id: "3birY6XZ3_c", section: "episodes", label: "Watch", email: "a@b.example", extra: 1 }))
      .toEqual({ kind: "video", video_id: "3birY6XZ3_c", section: "episodes", label: "Watch" });
    expect(cleanProperties("lead_submitted", { persisted: true, acknowledgementQueued: false, firstName: "Ana", ageBand: "3-5" }))
      .toEqual({ persisted: true, acknowledgementQueued: false });
    expect(cleanProperties("cta_clicked", { label: "x".repeat(200), section: { nested: true } })).toEqual({ label: "x".repeat(80) });
    expect(cleanProperties("not_an_event", { section: "hero" })).toBeNull();
  });

  it("never lets an email address through, whatever property it hides in", () => {
    expect(cleanProperties("cta_clicked", { label: "Write to ana@example.com", section: "faq" })).toEqual({ section: "faq" });
  });
});

describe("staff and editor pages are never counted (8c-M1)", () => {
  const pageview = (url: string, extra: Record<string, unknown> = {}) => capture("$pageview", { $current_url: url, ...extra });

  it("drops page views, page leaves and actions whose address is under /admin or /studio", () => {
    for (const path of ["/admin", "/admin/", "/admin/login", "/admin/orders", "/admin/orders/BB-1A2B-3C4D", "/studio", "/studio/desk/page;abc", "/ADMIN/orders"]) {
      expect(cleanCapture(pageview(`https://bibobay.example${path}`)), path).toBeNull();
      expect(cleanCapture(capture("$pageleave", { $current_url: `https://bibobay.example${path}` })), path).toBeNull();
      expect(cleanCapture(capture("cta_clicked", { $current_url: `https://bibobay.example${path}`, section: "hero" })), path).toBeNull();
    }
  });

  it("also drops an event that only carries $pathname", () => {
    expect(cleanCapture(capture("$pageview", { $pathname: "/admin/orders/BB-1A2B-3C4D" }))).toBeNull();
  });

  it("still counts the public pages, including paths that only start with the same letters", () => {
    for (const path of ["/", "/privacy", "/administration", "/studios", "/orders/abc", "/api/admin-not-a-page"]) {
      expect(cleanCapture(pageview(`https://bibobay.example${path}`)), path).not.toBeNull();
    }
  });
});

describe("cleanCapture (before_send)", () => {
  it("drops every event that is not a page view, a page leave or an allow-listed action", () => {
    for (const event of ["$autocapture", "$rageclick", "$exception", "$identify", "$snapshot", "$web_vitals", "$opt_in", "survey shown", "made_up"]) {
      expect(cleanCapture(capture(event, {})), event).toBeNull();
    }
    expect(cleanCapture(capture("$pageview", {}))?.event).toBe("$pageview");
    expect(cleanCapture(capture("$pageleave", {}))?.event).toBe("$pageleave");
  });

  it("keeps where a visit came from (campaign tags and the referring site) and drops everything else in the address", () => {
    const result = cleanCapture(capture("$pageview", {
      $current_url: "https://bibobay.example/?utm_source=youtube&utm_medium=video&utm_campaign=launch&email=ana%40example.com&gclid=abc123&ref=secret#lead",
      $referrer: "https://www.google.com/search?q=bibo+bay+for+ana",
      $referring_domain: "www.google.com",
      utm_source: "youtube", utm_medium: "video", utm_campaign: "launch",
      gclid: "abc123", fbclid: "xyz", msclkid: "m-1",
      $pathname: "/",
    }));
    expect(result?.properties.$current_url).toBe("https://bibobay.example/?utm_source=youtube&utm_medium=video&utm_campaign=launch");
    expect(result?.properties.$referrer).toBe("https://www.google.com");
    expect(result?.properties.$referring_domain).toBe("www.google.com");
    expect(result?.properties).toMatchObject({ utm_source: "youtube", utm_medium: "video", utm_campaign: "launch", $pathname: "/" });
    for (const key of ["gclid", "fbclid", "msclkid"]) expect(result?.properties, key).not.toHaveProperty(key);
  });

  it("builds no person profile: person properties and initial-visit copies are removed", () => {
    const result = cleanCapture(capture("$pageview", { $initial_referrer: "https://x.example/a", $initial_current_url: "https://bibobay.example/?q=1", $browser: "Chrome" }, { $set: { email: "a@b.example" }, $set_once: { $initial_referrer: "x" } }));
    expect(result).not.toHaveProperty("$set");
    expect(result).not.toHaveProperty("$set_once");
    expect(result?.properties).toEqual({ $browser: "Chrome" });
  });

  it("passes an action's own properties through the allow-list and keeps the SDK's device and page fields", () => {
    const result = cleanCapture(capture("freebie_downloaded", { file: "/freebies/bibo-bay-activity-pack.pdf", section: "lead", label: "Download", $browser: "Firefox", $device_type: "Mobile", $current_url: "https://bibobay.example/#lead" }));
    expect(result?.properties).toEqual({ file: "/freebies/bibo-bay-activity-pack.pdf", section: "lead", $browser: "Firefox", $device_type: "Mobile", $current_url: "https://bibobay.example/" });
  });

  it("keeps the fields PostHog needs to accept an event, and the page title", () => {
    // Without token and distinct_id PostHog drops the event in the browser (found in the e2e run).
    const result = cleanCapture(capture("$pageview", { token: "phc_key", distinct_id: "$posthog_cookieless", title: "BIBO Bay", $browser: "Chrome" }));
    expect(result?.properties).toEqual({ token: "phc_key", distinct_id: "$posthog_cookieless", title: "BIBO Bay", $browser: "Chrome" });
    const action = cleanCapture(capture("section_viewed", { token: "phc_key", distinct_id: "$posthog_cookieless", section: "hero" }));
    expect(action?.properties).toEqual({ token: "phc_key", distinct_id: "$posthog_cookieless", section: "hero" });
  });

  it("drops any SDK field holding an email address", () => {
    const result = cleanCapture(capture("$pageview", { $title: "Hello ana@example.com", $browser: "Safari" }));
    expect(result?.properties).toEqual({ $browser: "Safari" });
  });
});

describe("email addresses in the page address (review M1)", () => {
  it.each(["/missing/parent@example.com", "/missing/parent%40example.com", "/missing/parent%2540example.com"])("drops %s from the page address and path", (path) => {
    const result = cleanCapture({
      uuid: "u-1",
      event: "$pageview",
      properties: { token: "phc_x", distinct_id: "$posthog_cookieless", $current_url: `https://bibo.example${path}?utm_source=news`, $pathname: path },
    });
    expect(JSON.stringify(result)).not.toMatch(/parent/);
    expect(result!.properties.$current_url).toBe("https://bibo.example/?utm_source=news");
  });

  it("drops a percent-encoded address from an action's own properties", () => {
    expect(cleanProperties("cta_clicked", { label: "Write to parent%40example.com", section: "hero" })).toEqual({ section: "hero" });
  });
});

/*
 * Task 7b: the private order page (/orders/<token>, Task 7c) puts its tracking token in the path.
 * Whatever PostHog captures, the address, the path, the previous page or a label, carries
 * /orders/[token], never the token.
 */
describe("private order links (Task 7b)", () => {
  const TOKEN = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";

  it("masks the token in every address and path a page view carries", () => {
    const result = cleanCapture(capture("$pageview", {
      $current_url: `https://bibobay.example/orders/${TOKEN}?utm_source=email&ref=x`,
      $pathname: `/orders/${TOKEN}`,
      $prev_pageview_pathname: `/orders/${TOKEN}`,
      $session_entry_url: `https://bibobay.example/orders/${TOKEN}`,
      $referrer: `https://bibobay.example/orders/${TOKEN}`,
      title: "Your order | BIBO Bay",
    }));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result?.properties.$current_url).toBe("https://bibobay.example/orders/[token]?utm_source=email");
    expect(result?.properties.$pathname).toBe("/orders/[token]");
    expect(result?.properties.$prev_pageview_pathname).toBe("/orders/[token]");
    expect(result?.properties.$session_entry_url).toBe("https://bibobay.example/orders/[token]");
    expect(result?.properties.$referrer).toBe("https://bibobay.example");
  });

  it("masks the token in a page leave and in an action's own words", () => {
    expect(JSON.stringify(cleanCapture(capture("$pageleave", { $current_url: `https://bibobay.example/orders/${TOKEN}`, $pathname: `/orders/${TOKEN}` })))).not.toContain(TOKEN);
    expect(cleanProperties("cta_clicked", { label: `Open /orders/${TOKEN}`, section: "page", destination: "internal" })).toEqual({ label: "Open /orders/[token]", section: "page", destination: "internal" });
    expect(cleanCapture(capture("cta_clicked", { label: `/orders/${TOKEN}`, section: "page" }))?.properties.label).toBe("/orders/[token]");
  });

  it("leaves every other address alone, the order API and the shop included", () => {
    const result = cleanCapture(capture("$pageview", { $current_url: "https://bibobay.example/shop/tula-plush", $pathname: "/api/orders/track" }));
    expect(result?.properties.$current_url).toBe("https://bibobay.example/shop/tula-plush");
    expect(result?.properties.$pathname).toBe("/api/orders/track");
    expect(cleanCapture(capture("$pageview", { $pathname: "/orders" }))?.properties.$pathname).toBe("/orders");
  });
});

describe("long addresses (Task 7b re-review 2 O-a)", () => {
  it("cleans a page view with a 16,000-character path quickly, keeping at most 2,000 characters per value", () => {
    const path = `/${"zz-".repeat(5_400)}`;
    const capture = { uuid: "u-1", event: "$pageview", properties: { $current_url: `https://bibo.example${path}?utm_source=${"z".repeat(16_000)}`, $pathname: path, token: "phc_fixture", distinct_id: "d" } };
    const started = performance.now();
    const clean = cleanCapture(capture);
    expect(performance.now() - started).toBeLessThan(250);
    // A page address is its origin, a path of at most 2,000 characters and five 80-character tags at most.
    for (const value of Object.values(clean!.properties)) if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(2_600);
    expect(String(clean!.properties.$pathname).length).toBeLessThanOrEqual(2_000);
  });

  it("still finds an encoded email address anywhere it keeps", () => {
    const clean = cleanCapture({ uuid: "u-2", event: "$pageview", properties: { $pathname: "/hello/parent%252540example.com", token: "phc_fixture", distinct_id: "d" } });
    expect(clean!.properties).not.toHaveProperty("$pathname");
  });
});

describe("encoded email addresses next to a broken escape (Task 7b re-review 3 M1)", () => {
  const page = (pathname: string) => cleanCapture({ uuid: "u-3", event: "$pageview", properties: { $pathname: pathname, $current_url: `https://bibo.example${pathname}`, token: "phc_fixture", distinct_id: "d" } });

  it("drops a path whose 2,000-character cut lands inside a later escape", () => {
    // 22 + 1,976 = 1,998 characters, so the cut at 2,000 leaves "%2" at the end.
    const clean = page(`/parent%40example.com/${"z".repeat(1_976)}%20end`);
    expect(clean!.properties).not.toHaveProperty("$pathname");
    expect(clean!.properties.$current_url).toBe("https://bibo.example/");
  });

  it("drops a short path with a stray percent sign beside an encoded address", () => {
    const clean = page("/parent%40example.com/100%");
    expect(clean!.properties).not.toHaveProperty("$pathname");
    expect(clean!.properties.$current_url).toBe("https://bibo.example/");
  });
});
