// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import globalTeardown from "../../e2e/support/vercel-bypass.teardown";
import { BYPASS_STATE_ENV, bypassCookieUrl, bypassStateDir, bypassStorageStatePath, newBypassStatePath, selectBypassCookies } from "../../e2e/support/vercel-bypass";

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

describe("the per-run storage state location", () => {
  const saved = process.env[BYPASS_STATE_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[BYPASS_STATE_ENV];
    else process.env[BYPASS_STATE_ENV] = saved;
  });

  it("is random per run, under the OS temp folder and outside the repository", () => {
    const first = newBypassStatePath();
    expect(newBypassStatePath()).not.toBe(first);
    expect(isAbsolute(first)).toBe(true);
    expect(relative(tmpdir(), first).startsWith("..")).toBe(false);
    expect(first.startsWith(resolve("."))).toBe(false);
    expect(bypassStateDir(first)).toBe(dirname(first));
  });

  it("is read from the environment by the single accessor, and fails loudly when the config did not set it", () => {
    delete process.env[BYPASS_STATE_ENV];
    expect(() => bypassStorageStatePath()).toThrow(BYPASS_STATE_ENV);
    process.env[BYPASS_STATE_ENV] = "somewhere";
    expect(bypassStorageStatePath()).toBe("somewhere");
  });

  it("only treats a bypass folder directly under the temp folder as removable", () => {
    expect(bypassStateDir(resolve("state.json"))).toBeNull();
    expect(bypassStateDir(`${tmpdir()}/other/state.json`)).toBeNull();
  });

  it("the setup's non-recursive mkdir refuses an existing folder, and the teardown removes the folder", async () => {
    const path = newBypassStatePath();
    const dir = dirname(path);
    await mkdir(dir, { recursive: false, mode: 0o700 });
    await expect(mkdir(dir, { recursive: false, mode: 0o700 })).rejects.toThrow();
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o077).toBe(0);
    await writeFile(path, "{}", { mode: 0o600 });
    process.env[BYPASS_STATE_ENV] = path;
    await globalTeardown();
    expect(existsSync(dir)).toBe(false);
  });

  it("the teardown leaves a folder that is not a bypass folder alone", async () => {
    const dir = await mkdtemp(`${tmpdir()}/unrelated-`);
    process.env[BYPASS_STATE_ENV] = `${dir}/state.json`;
    await globalTeardown();
    expect(existsSync(dir)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("wiring", () => {
  const source = (file: string) => readFileSync(resolve(file), "utf8");

  it("the config points storageState at the file only when the secret is set, and sends no header", () => {
    const config = source("playwright.config.ts");
    expect(config).not.toContain("extraHTTPHeaders");
    expect(config).toMatch(/storageState:\s*bypassSecret/);
    expect(config).toContain("globalSetup");
    expect(config).toContain("globalTeardown");
    expect(config).toMatch(/process\.env\[BYPASS_STATE_ENV\] \?\?= newBypassStatePath\(\)/);
    expect(config).toMatch(/trace:\s*bypassSecret \? "off"/);
  });

  it("the global setup is a no-op without the secret and never prints it", () => {
    const setup = source("e2e/support/vercel-bypass.setup.ts");
    expect(setup).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(setup).toMatch(/if \(!secret\) return/);
    expect(setup).toMatch(/mkdir\(dirname\(path\), \{ recursive: false, mode: 0o700 \}\)/);
    expect(setup).not.toMatch(/console\.\w+\([^)]*(secret|url)/i);
  });
});
