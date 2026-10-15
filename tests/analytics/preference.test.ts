import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAnalyticsForTests } from "@/lib/analytics/client";
import { analyticsAllowed, readChoice, writeChoice } from "@/lib/analytics/preference";

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

  it("keeps \"off\" for the rest of the page", () => {
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
});
