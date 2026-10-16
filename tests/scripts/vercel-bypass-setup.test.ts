// @vitest-environment node
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { bypassCookieUrl, bypassStorageStatePath, selectBypassCookies } from "../../e2e/support/vercel-bypass";

/*
 * Residual fixer, item 4: the bypass secret used to travel as `extraHTTPHeaders`, which Playwright
 * adds to every request the browser makes, third-party hosts included (YouTube embeds, Sanity CDN,
 * PostHog). It is now spent once, in a global setup that asks the deployment for Vercel's bypass
 * cookie; the cookie is host-scoped, so it can reach only the deployment.
 */
describe("bypassCookieUrl", () => {
  it("asks the deployment's root for the bypass cookie, with the secret encoded", () => {
    const url = new URL(bypassCookieUrl("https://preview.example.com", "s3cret value&x"));
    expect(url.origin).toBe("https://preview.example.com");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe("s3cret value&x");
    expect(url.searchParams.get("x-vercel-set-bypass-cookie")).toBe("true");
  });

  it("drops any path or query on the base URL", () => {
    expect(new URL(bypassCookieUrl("https://preview.example.com/some/path?a=1", "k")).pathname).toBe("/");
  });
});

describe("selectBypassCookies", () => {
  const cookie = (name: string, domain: string) => ({ name, value: "v", domain, path: "/" });

  it("keeps only cookies scoped to the deployment's host, with or without a leading dot", () => {
    const kept = selectBypassCookies(
      [cookie("_vercel_jwt", "preview.example.com"), cookie("a", ".preview.example.com"), cookie("tracker", "analytics.example.net"), cookie("b", "other.example.com")],
      "https://preview.example.com",
    );
    expect(kept.map((entry) => entry.name)).toEqual(["_vercel_jwt", "a"]);
  });

  it("returns nothing when no cookie was set for the host", () => {
    expect(selectBypassCookies([cookie("tracker", "analytics.example.net")], "https://preview.example.com")).toEqual([]);
  });
});

describe("bypassStorageStatePath", () => {
  it("lives in the OS temp folder, never in the repository", () => {
    const path = bypassStorageStatePath();
    expect(isAbsolute(path)).toBe(true);
    expect(relative(tmpdir(), path).startsWith("..")).toBe(false);
    expect(path.startsWith(resolve("."))).toBe(false);
  });
});

describe("wiring", () => {
  const source = (file: string) => readFileSync(resolve(file), "utf8");

  it("the config points storageState at the file only when the secret is set, and sends no header", () => {
    const config = source("playwright.config.ts");
    expect(config).not.toContain("extraHTTPHeaders");
    expect(config).toMatch(/storageState:\s*bypassSecret/);
    expect(config).toContain("globalSetup");
    expect(config).toMatch(/trace:\s*bypassSecret \? "off"/);
  });

  it("the global setup is a no-op without the secret and never prints it", () => {
    const setup = source("e2e/support/vercel-bypass.setup.ts");
    expect(setup).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(setup).toMatch(/if \(!secret\) return/);
    expect(setup).not.toMatch(/console\.\w+\([^)]*(secret|url)/i);
  });
});
