import { describe, expect, it } from "vitest";

import {
  botCheckConfig,
  botCheckFrameSources,
  botCheckSiteKey,
  TURNSTILE_TEST_SECRET_KEYS,
  TURNSTILE_TEST_SITE_KEYS,
} from "@/lib/bot-check/config";

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";
const REAL_SITE = "0x4AAAAAAAreal_site-key01";
const REAL_SECRET = "0x4AAAAAAAreal_secret-key-0123456789";
const TEST_SITE = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

describe("botCheckConfig", () => {
  it("off when both blank", () => {
    expect(botCheckConfig({})).toEqual({ state: "off" });
    expect(botCheckConfig({ [SITE]: " ", [SECRET]: "" })).toEqual({ state: "off" });
  });

  it("half", () => {
    expect(botCheckConfig({ [SITE]: REAL_SITE })).toEqual({ state: "misconfigured", problem: "half" });
    expect(botCheckConfig({ [SECRET]: REAL_SECRET })).toEqual({ state: "misconfigured", problem: "half" });
  });

  it("malformed", () => {
    expect(botCheckConfig({ [SITE]: "0x4AAAA AAA", [SECRET]: REAL_SECRET })).toEqual({
      state: "misconfigured",
      problem: "malformed",
    });
    expect(botCheckConfig({ [SITE]: REAL_SITE, [SECRET]: "a".repeat(15) })).toEqual({
      state: "misconfigured",
      problem: "malformed",
    });
  });

  it("mixed", () => {
    expect(botCheckConfig({ [SITE]: TEST_SITE, [SECRET]: REAL_SECRET })).toEqual({
      state: "misconfigured",
      problem: "mixed_keys",
    });
    expect(botCheckConfig({ [SITE]: REAL_SITE, [SECRET]: TEST_SECRET })).toEqual({
      state: "misconfigured",
      problem: "mixed_keys",
    });
  });

  it("test keys in production", () => {
    expect(botCheckConfig({ [SITE]: TEST_SITE, [SECRET]: TEST_SECRET, VERCEL_ENV: "production" })).toEqual({
      state: "misconfigured",
      problem: "test_keys_in_production",
    });
    expect(botCheckConfig({ [SITE]: TEST_SITE, [SECRET]: TEST_SECRET, VERCEL_ENV: "preview" })).toEqual({
      state: "on",
      siteKey: TEST_SITE,
      secretKey: TEST_SECRET,
      testKeys: true,
      expectedHostname: null,
    });
  });

  it("is on with real keys, trimmed, testKeys false", () => {
    expect(
      botCheckConfig({ [SITE]: ` ${REAL_SITE} `, [SECRET]: ` ${REAL_SECRET}\n`, VERCEL_ENV: "production" }),
    ).toEqual({
      state: "on",
      siteKey: REAL_SITE,
      secretKey: REAL_SECRET,
      testKeys: false,
      expectedHostname: null,
    });
  });

  it("expectedHostname", () => {
    const keys = { [SITE]: REAL_SITE, [SECRET]: REAL_SECRET };
    expect(botCheckConfig({ ...keys, NEXT_PUBLIC_APP_URL: "https://www.bibobay.com" })).toMatchObject({
      state: "on",
      expectedHostname: "www.bibobay.com",
    });
    expect(botCheckConfig(keys)).toMatchObject({ expectedHostname: null });
    expect(botCheckConfig({ ...keys, NEXT_PUBLIC_APP_URL: "http://www.bibobay.com" })).toMatchObject({
      expectedHostname: null,
    });
    expect(botCheckConfig({ ...keys, NEXT_PUBLIC_APP_URL: "not a url" })).toMatchObject({ expectedHostname: null });
  });

  it("knows the published test keys", () => {
    expect(TURNSTILE_TEST_SITE_KEYS.size).toBe(5);
    expect(TURNSTILE_TEST_SECRET_KEYS.size).toBe(3);
  });
});

describe("botCheckSiteKey and botCheckFrameSources", () => {
  it("are null and empty unless on", () => {
    expect(botCheckSiteKey({})).toBeNull();
    expect(botCheckFrameSources({})).toEqual([]);
    expect(botCheckSiteKey({ [SITE]: REAL_SITE })).toBeNull();
    expect(botCheckFrameSources({ [SITE]: REAL_SITE })).toEqual([]);
  });

  it("return the site key and Cloudflare origin when on", () => {
    const env = { [SITE]: REAL_SITE, [SECRET]: REAL_SECRET };
    expect(botCheckSiteKey(env)).toBe(REAL_SITE);
    expect(botCheckFrameSources(env)).toEqual(["https://challenges.cloudflare.com"]);
  });
});
