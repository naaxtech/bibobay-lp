import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAnalyticsForTests } from "@/lib/analytics/client";
import { ANALYTICS_PREFERENCE_KEY, analyticsAllowed, declinedByBrowser, forgetChoiceForTests, readChoice, subscribeChoice, writeChoice } from "@/lib/analytics/preference";

/** Another tab wrote (or cleared) the stored answer: the browser fires `storage` in this one. */
function storageEventFromAnotherTab(key: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: window.localStorage }));
}

/** Ruling R144: visit statistics are opt-in. Nothing is counted until the visitor says yes. */
describe("a visitor's answer (opt-in, ruling R144)", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    window.localStorage.clear();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
    resetAnalyticsForTests();
  });

  it("counts nothing before the visitor has answered", () => {
    expect(readChoice()).toBeNull();
    expect(analyticsAllowed()).toBe(false);
  });

  it("counts after a \"yes\", and stops after a \"no\", keeping the answer on this device", () => {
    writeChoice("on");
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("on");
    expect(analyticsAllowed()).toBe(true);
    writeChoice("off");
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    expect(analyticsAllowed()).toBe(false);
  });

  it("follows an answer stored by another tab", () => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "on");
    expect(analyticsAllowed()).toBe(true);
  });

  it("does not count a Global Privacy Control browser that has not answered, but an explicit \"yes\" on this site wins (ruling R147)", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    expect(declinedByBrowser()).toBe(true);
    expect(analyticsAllowed()).toBe(false);
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "on");
    expect(analyticsAllowed()).toBe(true);
  });

  it("treats Do Not Track like Global Privacy Control", () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    expect(declinedByBrowser()).toBe(true);
    expect(analyticsAllowed()).toBe(false);
  });
});

describe("subscribing to the answer", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetAnalyticsForTests();
  });

  it("calls the listener after every answer written on this page, once the answer can be read back", () => {
    const seen: Array<string | null> = [];
    subscribeChoice(() => seen.push(readChoice()));
    writeChoice("on");
    writeChoice("off");
    expect(seen).toEqual(["on", "off"]);
  });

  it("calls the listener when another tab writes the answer, and ignores other keys", () => {
    const listener = vi.fn();
    subscribeChoice(listener);
    storageEventFromAnotherTab("some.other.key", "x");
    expect(listener).not.toHaveBeenCalled();
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "off");
    storageEventFromAnotherTab(ANALYTICS_PREFERENCE_KEY, "off");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls the listener when another tab clears the site's storage, so this page reads again: an answer stored earlier is no longer there", () => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "on");
    const seen: Array<string | null> = [];
    subscribeChoice(() => seen.push(readChoice()));
    window.localStorage.clear();
    storageEventFromAnotherTab(null, null);
    expect(seen).toEqual([null]);
  });

  it("keeps an answer given on this page when another tab clears the site's storage: clearing site data is not a \"no\"", () => {
    writeChoice("on");
    const seen: Array<string | null> = [];
    subscribeChoice(() => seen.push(readChoice()));
    window.localStorage.clear();
    storageEventFromAnotherTab(null, null);
    expect(seen).toEqual(["on"]);
    expect(analyticsAllowed()).toBe(true);
  });

  it("calls every listener, and none after it unsubscribed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscribeChoice(first);
    subscribeChoice(second);
    writeChoice("on");
    unsubscribe();
    writeChoice("off");
    storageEventFromAnotherTab(ANALYTICS_PREFERENCE_KEY, "off");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(3);
  });

  it("drops every listener between tests", () => {
    const listener = vi.fn();
    subscribeChoice(listener);
    forgetChoiceForTests();
    writeChoice("on");
    storageEventFromAnotherTab(ANALYTICS_PREFERENCE_KEY, "on");
    expect(listener).not.toHaveBeenCalled();
  });
});

/** Review M3: a browser that blocks storage still gets the choice it made, for this page. */
describe("a visitor's choice when storage is blocked", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    resetAnalyticsForTests();
  });

  it("counts nothing before an answer, then keeps the page's answer for the rest of the page", () => {
    expect(analyticsAllowed()).toBe(false);
    writeChoice("on");
    expect(readChoice()).toBe("on");
    expect(analyticsAllowed()).toBe(true);
    writeChoice("off");
    expect(readChoice()).toBe("off");
    expect(analyticsAllowed()).toBe(false);
  });

  it("lets a Global Privacy Control visitor turn statistics on for the rest of the page", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    expect(analyticsAllowed()).toBe(false);
    writeChoice("on");
    expect(analyticsAllowed()).toBe(true);
  });

  it("still tells the listeners, so the page follows its own answer", () => {
    const seen: Array<string | null> = [];
    subscribeChoice(() => seen.push(readChoice()));
    writeChoice("off");
    expect(seen).toEqual(["off"]);
  });
});

describe("a choice the device refuses to save (re-review)", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetAnalyticsForTests();
  });

  it("keeps this page's \"off\" over an older stored \"on\"", () => {
    window.localStorage.setItem("bibo.analytics.v1", "on");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    writeChoice("off");
    expect(readChoice()).toBe("off");
    expect(analyticsAllowed()).toBe(false);
  });

  it("keeps this page's \"on\" when the device cannot save it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    writeChoice("on");
    expect(readChoice()).toBe("on");
    expect(analyticsAllowed()).toBe(true);
  });
});
