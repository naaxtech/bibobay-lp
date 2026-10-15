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
