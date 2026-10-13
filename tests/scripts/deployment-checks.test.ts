// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DeploymentNetworkError,
  analyzeHtml,
  checkAsset,
  checkBody,
  checkHealth,
  checkNoindex,
  checkReadiness,
  checkSecurityHeaders,
  checkTitle,
  classifyBrowserRun,
  exitCodeFor,
  formatTable,
  parseArgs,
  runFetchChecks,
  type CheckResult,
} from "@/scripts/lib/deployment-checks";

/*
 * scripts/verify-deployment.ts (ruling R44): classification is pure, so every rule is tested here
 * with canned responses. The GitHub Pages case uses the repository's own legacy index.html, which is
 * exactly what Pages served when the old site went blank: a page whose only script is /src/main.tsx.
 */

const LEGACY_INDEX_HTML = readFileSync(resolve("index.html"), "utf8");
const FALLBACK_HEADING = "Where bright little adventures begin.";

const statusOf = (results: CheckResult[], name: string) => results.find((result) => result.name === name)?.status;
const failures = (results: CheckResult[]) => results.filter((result) => result.status === "fail");

type Canned = { status: number; type?: string; body?: string; headers?: Record<string, string> };

/** A fetch stand-in answering from a URL table; anything unlisted is a 404 page. */
function fakeFetch(routes: Record<string, Canned>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    const canned = routes[url] ?? { status: 404, type: "text/html; charset=utf-8", body: "<html><title>404</title></html>" };
    const headers = new Headers(canned.headers ?? {});
    if (canned.type) headers.set("content-type", canned.type);
    const response = new Response(canned.status === 204 ? null : (canned.body ?? ""), { status: canned.status, headers });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof fetch;
}

const NEXT_CSP = "default-src 'self'; script-src 'self' 'nonce-QUJDREVGR0hJSktMTU5PUA==' 'strict-dynamic'; style-src-elem 'self' 'nonce-QUJDREVGR0hJSktMTU5PUA=='; object-src 'none'; frame-ancestors 'self'";
const SECURITY_HEADERS = { "content-security-policy": NEXT_CSP, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
const PARAGRAPH = "Meet a story world in development, shaped around curiosity, kindness and imaginative play. ";

function healthyPage(origin: string, overrides: { html?: string; headers?: Record<string, string> } = {}): Record<string, Canned> {
  const html = overrides.html ?? `<!DOCTYPE html><html lang="en"><head>
    <meta charSet="utf-8"/><title>BIBO Bay | Where bright little adventures begin</title>
    <meta name="robots" content="noindex, nofollow"/>
    <link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next"/>
    <link rel="icon" href="/icon.svg?icon.0a1b2c" type="image/svg+xml" sizes="any"/>
    <script src="/_next/static/chunks/main.js" async="" nonce="abc"></script>
    <script nonce="abc">self.__next_f.push([1,"payload"])</script>
    <style>.hidden{display:none}</style>
    </head><body><header><a href="#main">Skip to content</a></header>
    <main><h1 id="hero-heading">${FALLBACK_HEADING}</h1><p>${PARAGRAPH.repeat(4)}</p></main>
    <script src="https://cdn.example.net/widget.js"></script></body></html>`;
  return {
    [`${origin}/`]: { status: 200, type: "text/html; charset=utf-8", body: html, headers: { ...SECURITY_HEADERS, ...overrides.headers } },
    [`${origin}/_next/static/css/app.css`]: { status: 200, type: "text/css; charset=utf-8", body: "body{}" },
    [`${origin}/icon.svg?icon.0a1b2c`]: { status: 200, type: "image/svg+xml", body: "<svg/>" },
    [`${origin}/_next/static/chunks/main.js`]: { status: 200, type: "application/javascript; charset=utf-8", body: "1" },
    [`${origin}/api/health`]: { status: 200, type: "application/json", body: JSON.stringify({ status: "ok", version: "local", time: "2026-10-13T00:00:00.000Z" }) },
    [`${origin}/api/readiness`]: { status: 503, type: "application/json", body: JSON.stringify({ ready: false, sanity: false, supabase: false, email: false, revalidation: false, legalReviewed: false }) },
    [`${origin}/robots.txt`]: { status: 200, type: "text/plain", body: "User-Agent: *\nDisallow: /\n" },
  };
}

describe("analyzeHtml", () => {
  it("reads the title, level-one headings, robots meta and same-origin assets, ignoring scripts and styles in the text", () => {
    const routes = healthyPage("http://127.0.0.1:3200");
    const analysis = analyzeHtml(routes["http://127.0.0.1:3200/"]!.body!, new URL("http://127.0.0.1:3200/"));
    expect(analysis.title).toBe("BIBO Bay | Where bright little adventures begin");
    expect(analysis.headings).toEqual([FALLBACK_HEADING]);
    expect(analysis.robotsMeta).toBe("noindex, nofollow");
    expect(analysis.visibleText).toContain("Skip to content");
    expect(analysis.visibleText).not.toContain("__next_f");
    expect(analysis.visibleText).not.toContain("display:none");
    expect(analysis.assets).toEqual([
      { kind: "stylesheet", url: "http://127.0.0.1:3200/_next/static/css/app.css", sameOrigin: true },
      { kind: "icon", url: "http://127.0.0.1:3200/icon.svg?icon.0a1b2c", sameOrigin: true },
      { kind: "script", url: "http://127.0.0.1:3200/_next/static/chunks/main.js", sameOrigin: true },
      { kind: "script", url: "https://cdn.example.net/widget.js", sameOrigin: false },
    ]);
  });

  it("resolves the legacy page's root-absolute /src/main.tsx against the host root, as a browser does", () => {
    const analysis = analyzeHtml(LEGACY_INDEX_HTML, new URL("https://owner.github.io/bibobay-lp/"));
    expect(analysis.assets.filter((asset) => asset.kind === "script")).toEqual([{ kind: "script", url: "https://owner.github.io/src/main.tsx", sameOrigin: true }]);
    expect(analysis.visibleText).toBe("");
    expect(analysis.headings).toEqual([]);
  });
});

describe("single checks", () => {
  it.each(["", "   ", "Create Next App", "Vite + React + TS", "React App", "404: This page could not be found."])("fails the title %j", (title) => {
    expect(checkTitle(title).status).toBe("fail");
  });

  it("passes a real title", () => {
    expect(checkTitle("BIBO Bay | Where bright little adventures begin")).toEqual({ name: "title", status: "pass", detail: "BIBO Bay | Where bright little adventures begin" });
  });

  it("fails an empty body and passes a page with a heading and enough visible text", () => {
    const blank = analyzeHtml(LEGACY_INDEX_HTML, new URL("https://owner.github.io/bibobay-lp/"));
    expect(checkBody(blank, {}).status).toBe("fail");
    const page = analyzeHtml(healthyPage("http://h")["http://h/"]!.body!, new URL("http://h/"));
    expect(checkBody(page, {}).status).toBe("pass");
    expect(checkBody(page, { expectHeading: FALLBACK_HEADING }).status).toBe("pass");
    expect(checkBody(page, { expectHeading: "A heading that is not there" }).status).toBe("fail");
    expect(checkBody(page, { minTextLength: 5000 }).status).toBe("fail");
  });

  it("classifies the GitHub Pages blank page's script (/src/main.tsx answering 404) as a failure", () => {
    const result = checkAsset({ kind: "script", url: "https://owner.github.io/src/main.tsx", sameOrigin: true }, { status: 404, contentType: "text/html; charset=utf-8" });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("404");
  });

  it("fails a script served with a type browsers will not execute, even with a 200", () => {
    expect(checkAsset({ kind: "script", url: "https://h/src/main.tsx", sameOrigin: true }, { status: 200, contentType: "application/octet-stream" }).status).toBe("fail");
    expect(checkAsset({ kind: "stylesheet", url: "https://h/a.css", sameOrigin: true }, { status: 200, contentType: "text/html" }).status).toBe("fail");
    expect(checkAsset({ kind: "icon", url: "https://h/i.svg", sameOrigin: true }, { status: 200, contentType: "text/html" }).status).toBe("fail");
  });

  it("passes assets served with a sane type", () => {
    expect(checkAsset({ kind: "script", url: "https://h/a.js", sameOrigin: true }, { status: 200, contentType: "application/javascript; charset=UTF-8" }).status).toBe("pass");
    expect(checkAsset({ kind: "script", url: "https://h/a.mjs", sameOrigin: true }, { status: 200, contentType: "text/javascript" }).status).toBe("pass");
    expect(checkAsset({ kind: "stylesheet", url: "https://h/a.css", sameOrigin: true }, { status: 200, contentType: "text/css" }).status).toBe("pass");
    expect(checkAsset({ kind: "icon", url: "https://h/i.svg", sameOrigin: true }, { status: 200, contentType: "image/svg+xml" }).status).toBe("pass");
  });

  it("requires a nonce CSP without unsafe-eval, nosniff and a referrer policy", () => {
    expect(checkSecurityHeaders(new Headers(SECURITY_HEADERS)).map((result) => result.status)).toEqual(["pass", "pass", "pass"]);
    const evalPolicy = new Headers({ ...SECURITY_HEADERS, "content-security-policy": `${NEXT_CSP.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'")}` });
    expect(checkSecurityHeaders(evalPolicy)[0]!.status).toBe("fail");
    const noNonce = new Headers({ ...SECURITY_HEADERS, "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'" });
    expect(checkSecurityHeaders(noNonce)[0]!.status).toBe("fail");
    expect(checkSecurityHeaders(new Headers({})).map((result) => result.status)).toEqual(["fail", "fail", "fail"]);
  });

  it("passes health only for a 200 JSON body with status ok", () => {
    expect(checkHealth(200, { status: "ok", version: "local" }).status).toBe("pass");
    expect(checkHealth(200, { status: "degraded" }).status).toBe("fail");
    expect(checkHealth(404, null).status).toBe("fail");
  });

  it("reports readiness booleans, failing a 503 only when readiness is required", () => {
    const body = { ready: false, sanity: false, supabase: true, email: false, revalidation: false, legalReviewed: false };
    const reported = checkReadiness(503, body, { requireReady: false });
    expect(reported.status).toBe("warn");
    expect(reported.detail).toBe("503 ready=false sanity=false supabase=true email=false revalidation=false legalReviewed=false");
    expect(checkReadiness(503, body, { requireReady: true }).status).toBe("fail");
    expect(checkReadiness(200, { ...body, ready: true }, { requireReady: true }).status).toBe("pass");
    expect(checkReadiness(200, { ready: true, secret: "value" }, { requireReady: false }).status).toBe("fail");
    expect(checkReadiness(500, null, { requireReady: false }).status).toBe("fail");
  });

  it("needs a noindex signal on a non-production URL and warns when production is noindex", () => {
    expect(checkNoindex({ production: false, robotsMeta: "noindex, nofollow", robotsHeader: null, robotsTxt: "" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: null, robotsHeader: "noindex", robotsTxt: "" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: null, robotsHeader: null, robotsTxt: "User-Agent: *\nDisallow: /\n" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: "index, follow", robotsHeader: null, robotsTxt: "User-Agent: *\nAllow: /\n" }).status).toBe("fail");
    expect(checkNoindex({ production: true, robotsMeta: "index, follow", robotsHeader: null, robotsTxt: "User-Agent: *\nAllow: /\n" }).status).toBe("pass");
    expect(checkNoindex({ production: true, robotsMeta: "noindex", robotsHeader: null, robotsTxt: "" }).status).toBe("warn");
  });
});

describe("runFetchChecks", () => {
  it("fails the GitHub Pages blank page: the only script 404s and the body has no visible text", async () => {
    const pages = "https://owner.github.io";
    const fetcher = fakeFetch({
      [`${pages}/bibobay-lp/`]: { status: 200, type: "text/html; charset=utf-8", body: LEGACY_INDEX_HTML },
      [`${pages}/bibobay-lp/bibo-logo.svg`]: { status: 200, type: "image/svg+xml", body: "<svg/>" },
      [`${pages}/src/main.tsx`]: { status: 404, type: "text/html; charset=utf-8", body: "<h1>404</h1>" },
    });
    const results = await runFetchChecks(new URL(`${pages}/bibobay-lp/`), { fetch: fetcher });
    const scriptFailure = results.find((result) => result.name === "asset script" && result.detail.includes("/src/main.tsx"));
    expect(scriptFailure?.status).toBe("fail");
    expect(scriptFailure?.detail).toContain("404");
    expect(statusOf(results, "body")).toBe("fail");
    expect(statusOf(results, "health")).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  it("passes a healthy local build, reporting an unconfigured readiness as a warning", async () => {
    const origin = "http://127.0.0.1:3200";
    const seen: string[] = [];
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: fakeFetch(healthyPage(origin), seen), expectHeading: FALLBACK_HEADING });
    expect(failures(results)).toEqual([]);
    expect(statusOf(results, "readiness")).toBe("warn");
    expect(statusOf(results, "noindex")).toBe("pass");
    expect(exitCodeFor(results)).toBe(0);
    // The cross-origin script is listed but never fetched.
    expect(seen).not.toContain("https://cdn.example.net/widget.js");
    expect(results.find((result) => result.detail.includes("cdn.example.net"))?.status).toBe("skip");
  });

  it("fails the same deployment when readiness is required", async () => {
    const origin = "http://127.0.0.1:3200";
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: fakeFetch(healthyPage(origin)), requireReady: true });
    expect(statusOf(results, "readiness")).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  it("fails a home page that is not 200", async () => {
    const origin = "http://127.0.0.1:3200";
    const routes = healthyPage(origin);
    routes[`${origin}/`] = { ...routes[`${origin}/`]!, status: 500 };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: fakeFetch(routes) });
    expect(statusOf(results, "home status")).toBe("fail");
  });

  it("throws a network error when the home page cannot be reached at all (exit code 2 in the CLI)", async () => {
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(runFetchChecks(new URL("http://127.0.0.1:9/"), { fetch: unreachable })).rejects.toBeInstanceOf(DeploymentNetworkError);
  });
});

describe("classifyBrowserRun", () => {
  const origin = "http://127.0.0.1:3200";
  const clean = { origin, consoleErrors: [], pageErrors: [], cspViolations: [], responses: [{ url: `${origin}/`, status: 200 }], headingVisible: true, leadRequests: [] };

  it("passes a clean load", () => {
    expect(classifyBrowserRun(clean).every((result) => result.status === "pass")).toBe(true);
  });

  it.each([
    ["browser console", { consoleErrors: ["Uncaught ReferenceError: x is not defined"] }],
    ["browser page errors", { pageErrors: ["TypeError: boom"] }],
    ["browser csp violations", { cspViolations: ["script-src blocked inline"] }],
    ["browser same-origin responses", { responses: [{ url: `${origin}/src/main.tsx`, status: 404 }] }],
    ["browser heading", { headingVisible: false }],
    ["browser lead requests", { leadRequests: [`POST ${origin}/api/leads`] }],
  ])("fails %s", (name, change) => {
    const results = classifyBrowserRun({ ...clean, ...change });
    expect(statusOf(results, name)).toBe("fail");
  });

  it("only warns about a failing cross-origin response", () => {
    const results = classifyBrowserRun({ ...clean, responses: [{ url: "https://cdn.example.net/a.js", status: 404 }] });
    expect(statusOf(results, "browser cross-origin responses")).toBe("warn");
    expect(exitCodeFor(results)).toBe(0);
  });
});

describe("command line", () => {
  /** URL instances have no own properties, so compare their href rather than the objects. */
  const parsed = (argv: string[]) => {
    const result = parseArgs(argv);
    return result.ok ? { ...result.options, url: result.options.url.href } : result;
  };

  it("parses a URL and flags", () => {
    expect(parsed(["https://site.example.com", "--browser", "--require-ready", "--production", "--expect-heading", FALLBACK_HEADING, "--min-text", "300"])).toEqual({
      url: "https://site.example.com/",
      browser: true,
      requireReady: true,
      production: true,
      expectHeading: FALLBACK_HEADING,
      minTextLength: 300,
    });
    expect(parsed(["http://127.0.0.1:3200"])).toEqual({ url: "http://127.0.0.1:3200/", browser: false, requireReady: false, production: false });
  });

  it.each([[[]], [["ftp://site.example.com"]], [["not a url"]], [["https://a.example", "--unknown"]], [["https://a.example", "--min-text", "x"]], [["https://a.example", "https://b.example"]]])("refuses %j as a usage error", (argv) => {
    const parsed = parseArgs(argv as string[]);
    expect(parsed.ok).toBe(false);
  });

  it("prints a compact table with a verdict and never more than one line per check", () => {
    const table = formatTable([
      { name: "home status", status: "pass", detail: "200" },
      { name: "readiness", status: "warn", detail: "503 ready=false" },
      { name: "asset script", status: "fail", detail: "https://h/src/main.tsx -> 404" },
    ]);
    const lines = table.split("\n");
    expect(lines.some((line) => /^PASS\s+home status\s+200$/.test(line))).toBe(true);
    expect(lines.some((line) => /^FAIL\s+asset script\s+https:\/\/h\/src\/main\.tsx -> 404$/.test(line))).toBe(true);
    expect(lines.at(-1)).toBe("Result: FAIL (1 pass, 1 warn, 1 fail, 0 skip)");
  });

  it("exits 0 with only passes, warnings and skips, and 1 with any failure", () => {
    expect(exitCodeFor([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "warn", detail: "" }, { name: "c", status: "skip", detail: "" }])).toBe(0);
    expect(exitCodeFor([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "fail", detail: "" }])).toBe(1);
    expect(exitCodeFor([])).toBe(1);
  });
});
