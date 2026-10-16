// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { BYPASS_ENV, BYPASS_HEADER, bypassFetch, bypassSecretFrom, carriesBypass } from "../../scripts/lib/protection-bypass";

/*
 * Final review O-I3: a protected Vercel preview needs `x-vercel-protection-bypass` on every request, and
 * the verifier rebuilds follow-up URLs from the origin, so the token is a header, sent to the named
 * origin only and never printed.
 */

const ORIGIN = "https://preview.example.com";

describe("bypass secret", () => {
  it("is read from VERCEL_AUTOMATION_BYPASS_SECRET and is null when unset or blank", () => {
    expect(BYPASS_ENV).toBe("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(bypassSecretFrom({ [BYPASS_ENV]: " s3cret-value " })).toBe("s3cret-value");
    expect(bypassSecretFrom({})).toBeNull();
    expect(bypassSecretFrom({ [BYPASS_ENV]: "   " })).toBeNull();
  });
});

describe("bypassFetch", () => {
  const recorded = () => {
    const inner = vi.fn<typeof fetch>(async () => new Response("ok"));
    return { inner, fetcher: bypassFetch(inner, ORIGIN, "s3cret-value") };
  };

  it("adds the header to every request on the named origin, whatever the path or query, and keeps the caller's headers", async () => {
    const { inner, fetcher } = recorded();
    for (const href of [`${ORIGIN}/`, `${ORIGIN}/api/health`, `${ORIGIN}/_next/static/a.js?v=1`, `${ORIGIN}/robots.txt`]) {
      await fetcher(href, { redirect: "manual", headers: { "user-agent": "bibobay-verify-deployment", RSC: "1" } });
    }
    expect(inner).toHaveBeenCalledTimes(4);
    for (const [, init] of inner.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get(BYPASS_HEADER)).toBe("s3cret-value");
      expect(headers.get("user-agent")).toBe("bibobay-verify-deployment");
      expect(init?.redirect).toBe("manual");
    }
    expect(new Headers(inner.mock.calls[0]![1]?.headers).get("rsc")).toBe("1");
  });

  it("never sends the header to another host", async () => {
    const { inner, fetcher } = recorded();
    await fetcher("https://cdn.example.net/a.js");
    await fetcher(new URL("https://elsewhere.example.org/x"));
    for (const [, init] of inner.mock.calls) expect(new Headers(init?.headers).has(BYPASS_HEADER)).toBe(false);
  });

  it("decides the browser's requests the same way", () => {
    expect(carriesBypass(`${ORIGIN}/a?b=1`, ORIGIN)).toBe(true);
    expect(carriesBypass("https://cdn.example.net/a.js", ORIGIN)).toBe(false);
    expect(carriesBypass("http://preview.example.com/", ORIGIN)).toBe(false);
  });
});

describe("wiring", () => {
  const source = (file: string) => readFileSync(resolve(file), "utf8");

  it("the verifier wraps its fetch and its Chromium requests, and prints nothing about the secret", () => {
    const script = source("scripts/verify-deployment.ts");
    expect(script).toContain("bypassSecretFrom(process.env)");
    expect(script).toContain("bypassFetch(");
    expect(script).toContain("carriesBypass(");
    expect(script).not.toMatch(/console\.\w+\([^)]*secret/i);
  });

  it("Playwright no longer sends the header as an extra HTTP header: the cookie setup replaces it (residual fixer item 4)", () => {
    const config = source("playwright.config.ts");
    expect(config).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(config).not.toContain("extraHTTPHeaders");
    // Storage state may hold the cookie, so a run that carries the secret must not write a trace.
    expect(config).toMatch(/trace:\s*bypassSecret \? "off"/);
  });
});
