import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ruling R70: PostHog runs for every visitor in cookieless mode (no cookies, no local or session
 * storage, no person profiles), loads none of PostHog's remote code, and stops for anyone who turns
 * it off or whose browser asks not to be tracked. The SDK is replaced here by a recorder.
 */
const sdk = vi.hoisted(() => {
  const calls = { init: [] as Array<[string, Record<string, unknown>]>, capture: [] as Array<[string, Record<string, unknown>]>, optOut: 0, optIn: 0, imported: 0 };
  const posthog = {
    init: (key: string, options: Record<string, unknown>) => {
      calls.init.push([key, options]);
      return posthog;
    },
    capture: (event: string, properties: Record<string, unknown>) => {
      calls.capture.push([event, properties]);
    },
    opt_out_capturing: () => {
      calls.optOut += 1;
    },
    opt_in_capturing: () => {
      calls.optIn += 1;
    },
  };
  return { calls, posthog };
});
vi.mock("posthog-js/dist/module.no-external", () => {
  sdk.calls.imported += 1;
  return { default: sdk.posthog };
});

import { AnalyticsChoices } from "@/components/analytics/AnalyticsChoices";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { posthogOptions, resetAnalyticsForTests, track } from "@/lib/analytics/client";
import { ANALYTICS_PREFERENCE_KEY } from "@/lib/analytics/preference";

const CONFIG = { key: "phc_ExampleKey0123456789abcdefABCDEF", apiHost: "https://ph.example.com" };

const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  resetAnalyticsForTests();
  Object.assign(sdk.calls, { init: [], capture: [], optOut: 0, optIn: 0 });
  window.localStorage.clear();
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PostHog options", () => {
  it("count visits without cookies or storage, and switch off everything that records or loads remote code", () => {
    const options = posthogOptions(CONFIG);
    expect(options).toMatchObject({
      api_host: "https://ph.example.com",
      cookieless_mode: "always",
      persistence: "memory",
      person_profiles: "never",
      autocapture: false,
      capture_pageview: "history_change",
      capture_pageleave: true,
      save_referrer: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      capture_exceptions: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      enable_heatmaps: false,
      capture_performance: false,
      rageclick: false,
    });
    expect(typeof options.before_send).toBe("function");
  });
});

describe("AnalyticsProvider", () => {
  it("does nothing at all without a configuration", async () => {
    render(<AnalyticsProvider config={null} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    track("cta_clicked", { section: "hero" });
    expect(sdk.calls.capture).toHaveLength(0);
  });

  it("starts for every visitor, with no consent step, and reports what they do", async () => {
    document.body.innerHTML = `<section data-section="episodes"><a id="video" href="https://www.youtube.com/watch?v=3birY6XZ3_c">Watch on YouTube</a></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toEqual([[CONFIG.key, expect.objectContaining({ cookieless_mode: "always" })]]);
    const link = document.getElementById("video")!;
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(sdk.calls.capture).toContainEqual(["youtube_clicked", { kind: "video", video_id: "3birY6XZ3_c", section: "episodes", label: "Watch on YouTube" }]);
  });

  it("holds events sent before the SDK has loaded, then sends them once", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    track("lead_submitted", { persisted: true, acknowledgementQueued: true, email: "ana@example.com" });
    await settle();
    expect(sdk.calls.capture.filter(([event]) => event === "lead_submitted")).toEqual([["lead_submitted", { persisted: true, acknowledgementQueued: true }]]);
  });

  it("never starts in a browser that sends Global Privacy Control or Do Not Track", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    cleanup();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
  });

  it("never starts for a visitor who turned statistics off", async () => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "off");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
  });

  it("leaves the editors' Studio alone", async () => {
    window.history.pushState({}, "", "/studio/desk");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    window.history.pushState({}, "", "/");
  });
});

describe("AnalyticsChoices (footer)", () => {
  it("lets a visitor turn statistics off and on again, and remembers the choice on this device only", async () => {
    render(<><AnalyticsProvider config={CONFIG} /><AnalyticsChoices config={CONFIG} /></>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Analytics choices" }));
    const dialog = screen.getByRole("dialog", { name: "Analytics choices" });
    expect(within(dialog).getByText(/no cookies/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn statistics off" }));
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    expect(sdk.calls.optOut).toBe(1);
    track("cta_clicked", { section: "hero" });
    expect(sdk.calls.capture.some(([event]) => event === "cta_clicked")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn statistics on" }));
    await settle();
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("on");
    expect(sdk.calls.optIn).toBe(1);
  });

  it("is not offered when analytics are not configured: there is nothing to choose", () => {
    render(<AnalyticsChoices config={null} />);
    expect(screen.queryByRole("button", { name: "Analytics choices" })).toBeNull();
  });
});
