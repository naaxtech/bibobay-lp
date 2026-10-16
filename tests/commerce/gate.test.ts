import { describe, expect, it } from "vitest";

import { CommerceDisabledError, assertCommerceEnabled, isCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";

/**
 * Task 6, spec §10 "Server gating": commerce is off unless the CMS switches it on, and order
 * tracking needs commerce as well as its own flag. The gate never trusts a value that is not a
 * literal true.
 */
describe("the commerce gate", () => {
  it("is off in the repository fallback, which ships with commerce disabled", () => {
    expect(SAFE_FALLBACK_SETTINGS.commerceEnabled).toBe(false);
    expect(SAFE_FALLBACK_SETTINGS.trackingEnabled).toBe(false);
    expect(isCommerceEnabled(SAFE_FALLBACK_SETTINGS)).toBe(false);
    expect(isTrackingEnabled(SAFE_FALLBACK_SETTINGS)).toBe(false);
  });

  it.each([
    ["missing settings", null],
    ["undefined settings", undefined],
    ["a missing flag", {}],
    ["false", { commerceEnabled: false }],
    ["the string \"true\"", { commerceEnabled: "true" }],
    ["1", { commerceEnabled: 1 }],
  ])("is off for %s", (_case, settings) => {
    expect(isCommerceEnabled(settings as never)).toBe(false);
    expect(() => assertCommerceEnabled(settings as never)).toThrow(CommerceDisabledError);
  });

  it("is on only for a literal true, and then asserts without throwing", () => {
    expect(isCommerceEnabled({ commerceEnabled: true })).toBe(true);
    expect(() => assertCommerceEnabled({ commerceEnabled: true })).not.toThrow();
  });

  it("gives a disabled error that says nothing about the shop's contents", () => {
    try {
      assertCommerceEnabled({ commerceEnabled: false });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommerceDisabledError);
      expect((error as Error).message).toBe("Commerce is not enabled");
    }
  });
});

describe("order tracking", () => {
  it.each([
    [{ commerceEnabled: false, trackingEnabled: true }, false],
    [{ commerceEnabled: true, trackingEnabled: false }, false],
    [{ commerceEnabled: true }, false],
    [{ commerceEnabled: true, trackingEnabled: "true" }, false],
    [{ commerceEnabled: true, trackingEnabled: true }, true],
  ])("needs commerce and its own flag: %j -> %s", (settings, expected) => {
    expect(isTrackingEnabled(settings as never)).toBe(expected);
  });
});
