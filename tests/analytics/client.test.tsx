import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ruling R144: visit statistics are opt-in. PostHog runs in cookieless mode (no cookies, no local
 * or session storage, no person profiles) and loads none of PostHog's remote code, but only after
 * the visitor has said yes; nothing is loaded, counted or queued before that, and it stops for
 * anyone who says no or turns it off. A browser that sends Global Privacy Control or Do Not Track
 * is not counted unless the visitor says yes on this site. The SDK is replaced here by a recorder.
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
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

/** A stand-in IntersectionObserver the tests drive by hand. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
  /** The element crosses the middle of the screen, for every live observer watching it. */
  static intersect(element: Element) {
    for (const observer of FakeObserver.all) {
      if (observer.disconnected || !observer.observed.has(element)) continue;
      observer.callback([{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    }
  }
}

import { AnalyticsChoices } from "@/components/analytics/AnalyticsChoices";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { posthogOptions, resetAnalyticsForTests, resumeAnalytics, startAnalytics, stopAnalytics, track } from "@/lib/analytics/client";
import { ANALYTICS_PREFERENCE_KEY, writeChoice } from "@/lib/analytics/preference";

const CONFIG = { key: "phc_ExampleKey0123456789abcdefABCDEF", apiHost: "https://ph.example.com" };
const PAGEVIEW = (event = "$pageview") => ({
  uuid: "u-1",
  event,
  properties: { token: CONFIG.key, distinct_id: "$posthog_cookieless", $current_url: "https://bibo.example/privacy" },
});

const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const captured = (name: string) => sdk.calls.capture.filter(([event]) => event === name);

/** The SDK module as a loader the tests can count. */
const recordingLoader = () => vi.fn(async () => ({ default: sdk.posthog }) as unknown as typeof import("posthog-js/dist/module.no-external"));

/** The visitor answers in another tab: the stored answer changes and this tab hears a `storage` event. */
const answerInAnotherTab = (answer: "on" | "off") =>
  act(async () => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, answer);
    window.dispatchEvent(new StorageEvent("storage", { key: ANALYTICS_PREFERENCE_KEY, newValue: answer, storageArea: window.localStorage }));
  });

beforeEach(() => {
  resetAnalyticsForTests();
  nav.pathname = "/";
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Object.assign(sdk.calls, { init: [], capture: [], optOut: 0, optIn: 0 });
  window.localStorage.clear();
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
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

describe("startAnalytics and track before and after an answer (ruling R144)", () => {
  it("loads nothing for a configured site while the visitor has not answered", async () => {
    const load = recordingLoader();
    await expect(startAnalytics(CONFIG, load)).resolves.toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(sdk.calls.init).toHaveLength(0);
  });

  it("queues nothing before an answer: an event from before the \"yes\" is never sent", async () => {
    track("lead_submitted", { persisted: true, acknowledgementQueued: true });
    track("cta_clicked", { section: "hero" });
    writeChoice("on");
    await expect(startAnalytics(CONFIG, recordingLoader())).resolves.toBe(true);
    expect(sdk.calls.init).toHaveLength(1);
    expect(sdk.calls.capture).toEqual([]);
  });

  it("loads and starts PostHog once the visitor has said yes", async () => {
    writeChoice("on");
    const load = recordingLoader();
    await expect(startAnalytics(CONFIG, load)).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdk.calls.init).toEqual([[CONFIG.key, expect.objectContaining({ cookieless_mode: "always", capture_pageview: "history_change" })]]);
  });
});

describe("AnalyticsProvider", () => {
  it("does nothing at all without a configuration, even after a yes", async () => {
    writeChoice("on");
    render(<AnalyticsProvider config={null} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    track("cta_clicked", { section: "hero" });
    expect(sdk.calls.capture).toHaveLength(0);
  });

  it("loads nothing and counts nothing while the visitor has not answered", async () => {
    document.body.innerHTML = `<section data-section="episodes"><a id="video" href="https://www.youtube.com/watch?v=3birY6XZ3_c">Watch on YouTube</a></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    const link = document.getElementById("video")!;
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    FakeObserver.intersect(document.querySelector("[data-section='episodes']")!);
    await settle();
    expect(sdk.calls.capture).toEqual([]);
    expect(sdk.calls.init).toHaveLength(0);
  });

  it("starts for a visitor who said yes, and reports what they do", async () => {
    writeChoice("on");
    document.body.innerHTML = `<section data-section="episodes"><a id="video" href="https://www.youtube.com/watch?v=3birY6XZ3_c">Watch on YouTube</a></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toEqual([[CONFIG.key, expect.objectContaining({ cookieless_mode: "always" })]]);
    const link = document.getElementById("video")!;
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(sdk.calls.capture).toContainEqual(["youtube_clicked", { kind: "video", video_id: "3birY6XZ3_c", section: "episodes", label: "Watch on YouTube" }]);
  });

  it("starts the moment the visitor says yes on this page, and watches the sections from then on", async () => {
    document.body.innerHTML = `<section data-section="episodes"></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    await act(async () => {
      writeChoice("on");
    });
    await settle();
    expect(sdk.calls.init).toHaveLength(1);
    FakeObserver.intersect(document.querySelector("[data-section='episodes']")!);
    expect(captured("section_viewed")).toEqual([["section_viewed", { section: "episodes" }]]);
  });

  it("starts when the visitor says yes in another tab", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    await answerInAnotherTab("on");
    await settle();
    expect(sdk.calls.init).toHaveLength(1);
  });

  it("holds events sent after the yes while the SDK is still loading, then sends them once", async () => {
    writeChoice("on");
    render(<AnalyticsProvider config={CONFIG} />);
    track("lead_submitted", { persisted: true, acknowledgementQueued: true, email: "ana@example.com" });
    await settle();
    expect(sdk.calls.capture.filter(([event]) => event === "lead_submitted")).toEqual([["lead_submitted", { persisted: true, acknowledgementQueued: true }]]);
  });

  // Whatever the browser sends, no answer means nothing starts; that GPC/DNT browsers are not even
  // asked is the notice's job (tests/analytics/consent-notice.test.tsx).
  it("starts nothing for a visitor who has not answered, with Global Privacy Control, Do Not Track or neither", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    cleanup();
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

  it("starts in a Global Privacy Control browser once the visitor said yes on this site (ruling R147)", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    writeChoice("on");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(1);
  });

  it("never starts for a visitor who turned statistics off", async () => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "off");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
  });

  it("leaves the staff pages alone on a hard load, and drops a page view of them after a client-side navigation (8c-M1)", async () => {
    writeChoice("on");
    window.history.pushState({}, "", "/admin/orders/BB-1A2B-3C4D");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    cleanup();

    window.history.pushState({}, "", "/");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    const beforeSend = sdk.calls.init[0]![1].before_send as (capture: unknown) => unknown;
    const pageview = (path: string) => ({ uuid: "u", event: "$pageview", properties: { $current_url: `https://bibobay.example${path}` } });
    expect(beforeSend(pageview("/"))).not.toBeNull();
    expect(beforeSend(pageview("/admin/orders/BB-1A2B-3C4D"))).toBeNull();
    expect(beforeSend(pageview("/studio/desk"))).toBeNull();
  });

  it("leaves the editors' Studio alone", async () => {
    writeChoice("on");
    window.history.pushState({}, "", "/studio/desk");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    window.history.pushState({}, "", "/");
  });
});

describe("AnalyticsChoices (footer)", () => {
  it("lets a visitor turn statistics off and on again, and remembers the choice on this device only", async () => {
    writeChoice("on");
    render(<><AnalyticsProvider config={CONFIG} /><AnalyticsChoices config={CONFIG} /></>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Analytics choices" }));
    const dialog = screen.getByRole("dialog", { name: "Analytics choices" });
    expect(within(dialog).getByText(/no cookies/i)).toBeTruthy();
    // Review I1: the explainer names what is really sent in cookieless mode.
    expect(within(dialog).getByText(/language and time zone/i)).toBeTruthy();
    const beforeSend = sdk.calls.init[0]![1].before_send as (capture: unknown) => unknown;
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn statistics off" }));
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    // Review C1: what proves "off" is that PostHog's own events are dropped, not an opt-out call
    // (cookieless_mode "always" ignores opt_out_capturing).
    expect(beforeSend(PAGEVIEW())).toBeNull();
    track("cta_clicked", { section: "hero" });
    expect(sdk.calls.capture.some(([event]) => event === "cta_clicked")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn statistics on" }));
    await settle();
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("on");
    expect(beforeSend(PAGEVIEW())).not.toBeNull();
  });

  it("lets a visitor who never answered turn statistics on from the footer", async () => {
    render(<><AnalyticsProvider config={CONFIG} /><AnalyticsChoices config={CONFIG} /></>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Analytics choices" }));
    const dialog = screen.getByRole("dialog", { name: "Analytics choices" });
    expect(within(dialog).getByText("Visit statistics are off for this browser.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Turn statistics off" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn statistics on" }));
    await settle();
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("on");
    expect(sdk.calls.init).toHaveLength(1);
  });

  it("keeps the open dialog true when the visitor answers in another tab", async () => {
    render(<AnalyticsChoices config={CONFIG} />);
    fireEvent.click(screen.getByRole("button", { name: "Analytics choices" }));
    const dialog = screen.getByRole("dialog", { name: "Analytics choices" });
    expect(within(dialog).getByRole("status").textContent).toBe("Visit statistics are off for this browser.");
    await answerInAnotherTab("on");
    expect(within(dialog).getByRole("status").textContent).toBe("Visit statistics are on for this browser.");
    expect(within(dialog).getByRole("button", { name: "Turn statistics off" })).toBeTruthy();
    await answerInAnotherTab("off");
    expect(within(dialog).getByRole("status").textContent).toBe("Visit statistics are off for this browser.");
    expect(within(dialog).getByRole("button", { name: "Turn statistics on" })).toBeTruthy();
  });

  it("is not offered when analytics are not configured: there is nothing to choose", () => {
    render(<AnalyticsChoices config={null} />);
    expect(screen.queryByRole("button", { name: "Analytics choices" })).toBeNull();
  });
});

describe("turning statistics off (review C1: cookieless_mode \"always\" ignores PostHog's opt-out)", () => {
  const beforeSend = () => sdk.calls.init[0]![1].before_send as (capture: unknown) => unknown;

  beforeEach(() => {
    writeChoice("on");
  });

  it("drops PostHog's own page views and page leaves from the moment statistics are turned off, until they are on again", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(beforeSend()(PAGEVIEW())).not.toBeNull();
    act(() => stopAnalytics());
    expect(beforeSend()(PAGEVIEW())).toBeNull();
    expect(beforeSend()(PAGEVIEW("$pageleave"))).toBeNull();
    await act(async () => {
      await resumeAnalytics(CONFIG);
    });
    expect(beforeSend()(PAGEVIEW())).not.toBeNull();
  });

  it("drops events once statistics were turned off in another tab", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    await answerInAnotherTab("off");
    expect(beforeSend()(PAGEVIEW())).toBeNull();
  });

  it("never starts PostHog when statistics are turned off while it is still loading, and can start it later", async () => {
    render(<AnalyticsProvider config={CONFIG} />);
    act(() => stopAnalytics());
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    await act(async () => {
      await resumeAnalytics(CONFIG);
    });
    await settle();
    expect(sdk.calls.init).toHaveLength(1);
  });
});

describe("PostHog toolbar links (review M2)", () => {
  beforeEach(() => {
    writeChoice("on");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it.each(["#__posthog=eyJhY3Rpb24iOiJwaF9hdXRob3JpemUifQ", "#state=%7B%22action%22%3A%22ph_authorize%22%7D", "#a=1&__posthog=x"])(
    "removes %s from the address before PostHog starts, so nothing is written to the device",
    async (hash) => {
      window.history.replaceState({}, "", `/?utm_source=news${hash}`);
      render(<AnalyticsProvider config={CONFIG} />);
      await settle();
      expect(sdk.calls.init).toHaveLength(1);
      expect(window.location.hash).toBe("");
      expect(window.location.search).toBe("?utm_source=news");
    },
  );

  it("removes the link before PostHog's code even loads: its toolbar reads the address as it loads (re-review M2)", async () => {
    window.history.replaceState({}, "", "/?utm_source=news#__posthog=eyJhY3Rpb24iOiJwaF9hdXRob3JpemUifQ");
    let addressAtLoad = "not loaded";
    await startAnalytics(CONFIG, async () => {
      addressAtLoad = `${window.location.search}${window.location.hash}`;
      return { default: sdk.posthog } as unknown as typeof import("posthog-js/dist/module.no-external");
    });
    expect(addressAtLoad).toBe("?utm_source=news");
  });

  it("keeps an ordinary page anchor", async () => {
    window.history.replaceState({}, "", "/#lead");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(window.location.hash).toBe("#lead");
  });

  it("never loads PostHog for a toolbar link while the visitor has not answered, so nothing is written to the device", async () => {
    resetAnalyticsForTests();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/#__posthog=eyJhY3Rpb24iOiJwaF9hdXRob3JpemUifQ");
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    expect(sdk.calls.init).toHaveLength(0);
    expect(window.localStorage.length).toBe(0);
  });
});

describe("section views (review M4)", () => {
  beforeEach(() => {
    writeChoice("on");
  });

  it("counts each section once when it reaches the middle of the screen", async () => {
    document.body.innerHTML = `<section data-section="episodes"></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    const section = document.querySelector("[data-section='episodes']")!;
    FakeObserver.intersect(section);
    FakeObserver.intersect(section);
    expect(captured("section_viewed")).toEqual([["section_viewed", { section: "episodes" }]]);
  });

  it("counts the sections of a page reached by client-side navigation", async () => {
    nav.pathname = "/privacy";
    const { rerender } = render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    document.body.insertAdjacentHTML("beforeend", `<section data-section="characters"></section>`);
    nav.pathname = "/";
    rerender(<AnalyticsProvider config={CONFIG} />);
    await settle();
    FakeObserver.intersect(document.querySelector("[data-section='characters']")!);
    expect(captured("section_viewed")).toEqual([["section_viewed", { section: "characters" }]]);
  });

  it("counts a section seen while statistics were off once they are turned on again", async () => {
    document.body.innerHTML = `<section data-section="lead"></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    act(() => stopAnalytics());
    const section = document.querySelector("[data-section='lead']")!;
    FakeObserver.intersect(section);
    expect(captured("section_viewed")).toEqual([]);
    await act(async () => {
      await resumeAnalytics(CONFIG);
    });
    FakeObserver.intersect(section);
    expect(captured("section_viewed")).toEqual([["section_viewed", { section: "lead" }]]);
  });

  it("counts a section once per page view, even when statistics are turned off and on again", async () => {
    document.body.innerHTML = `<section data-section="lead"></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    const section = document.querySelector("[data-section='lead']")!;
    FakeObserver.intersect(section);
    act(() => stopAnalytics());
    await act(async () => {
      await resumeAnalytics(CONFIG);
    });
    await settle();
    FakeObserver.intersect(section);
    expect(captured("section_viewed")).toEqual([["section_viewed", { section: "lead" }]]);
  });

  it("counts the same section again on the next page view", async () => {
    document.body.innerHTML = `<section data-section="lead"></section>`;
    const { rerender } = render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    const section = document.querySelector("[data-section='lead']")!;
    FakeObserver.intersect(section);
    nav.pathname = "/privacy";
    rerender(<AnalyticsProvider config={CONFIG} />);
    await settle();
    FakeObserver.intersect(section);
    expect(captured("section_viewed")).toEqual([
      ["section_viewed", { section: "lead" }],
      ["section_viewed", { section: "lead" }],
    ]);
  });
});

describe("middle-click (review M13)", () => {
  beforeEach(() => {
    writeChoice("on");
  });

  it("counts a YouTube link opened with the middle button", async () => {
    document.body.innerHTML = `<section data-section="hero"><a id="yt" href="https://www.youtube.com/@bibobay-tv">Watch on YouTube</a></section>`;
    render(<AnalyticsProvider config={CONFIG} />);
    await settle();
    fireEvent(document.getElementById("yt")!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(document.getElementById("yt")!, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(captured("youtube_clicked")).toEqual([["youtube_clicked", { kind: "channel", section: "hero", label: "Watch on YouTube" }]]);
  });
});
