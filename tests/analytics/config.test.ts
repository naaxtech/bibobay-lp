import { describe, expect, it } from "vitest";

import { analyticsConfig, POSTHOG_DEFAULT_HOST } from "@/lib/analytics/config";

/** Ruling R70: analytics run only with a real-shaped project key; the host is an exact https origin. */
describe("analytics configuration", () => {
  const KEY = "phc_ExampleKey0123456789abcdefABCDEF";

  it("is off without a project key, so the site makes no analytics request at all", () => {
    expect(analyticsConfig({})).toBeNull();
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "  " })).toBeNull();
  });

  it("refuses a key that is not a PostHog project key (a personal API key must never be public)", () => {
    for (const key of ["phx_personal0123456789abcdef", "sk_live_abc", "phc_short", "phc_has space 0123456789abc"]) {
      expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: key }), key).toBeNull();
    }
  });

  it("uses PostHog's US host by default and accepts an exact https origin", () => {
    expect(POSTHOG_DEFAULT_HOST).toBe("https://us.i.posthog.com");
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: KEY })).toEqual({ key: KEY, apiHost: POSTHOG_DEFAULT_HOST });
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: ` ${KEY} `, NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/" })).toEqual({ key: KEY, apiHost: "https://eu.i.posthog.com" });
  });

  it("stays off rather than send events to a host it cannot trust", () => {
    for (const host of ["http://us.i.posthog.com", "https://user:pass@ph.example.com", "https://ph.example.com/ingest", "javascript:alert(1)", "ph.example.com"]) {
      expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_POSTHOG_HOST: host }), host).toBeNull();
    }
  });
});
