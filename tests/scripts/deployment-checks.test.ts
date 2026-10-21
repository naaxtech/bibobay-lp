// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DeploymentNetworkError,
  FORM_API_PATHS,
  GATED_PAYLOAD_PATHS,
  PAYLOAD_PATHS,
  analyzeHtml,
  checkAsset,
  checkBody,
  checkHealth,
  checkNoindex,
  checkReadiness,
  checkSecurityHeaders,
  checkTitle,
  classifyBrowserRun,
  displayUrl,
  exitCodeFor,
  formatTable,
  parseArgs,
  runFetchChecks,
  type CheckResult,
} from "@/scripts/lib/deployment-checks";
import { deriveSecretRules } from "@/scripts/lib/bundle-secrets";

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

/**
 * A fetch stand-in answering from a URL table; anything unlisted is a 404 page. Like real fetch, it
 * follows 3xx `location` headers unless the caller asks for `redirect: "manual"`.
 */
function fakeFetch(routes: Record<string, Canned>, seen: string[] = []): typeof fetch {
  const answer = (url: string): Response => {
    seen.push(url);
    const canned = routes[url] ?? { status: 404, type: "text/html; charset=utf-8", body: "<html><title>404</title></html>" };
    const headers = new Headers(canned.headers ?? {});
    if (canned.type) headers.set("content-type", canned.type);
    const response = new Response(canned.status === 204 ? null : (canned.body ?? ""), { status: canned.status, headers });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let response = answer(url);
    for (let hop = 0; init?.redirect !== "manual" && hop < 5 && response.status >= 300 && response.status < 400 && response.headers.get("location"); hop += 1) {
      url = new URL(response.headers.get("location")!, url).href;
      response = answer(url);
    }
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

  it("needs a noindex signal on a non-production URL and fails production carrying any noindex signal", () => {
    expect(checkNoindex({ production: false, robotsMeta: "noindex, nofollow", robotsHeader: null, robotsTxt: "" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: null, robotsHeader: "noindex", robotsTxt: "" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: null, robotsHeader: null, robotsTxt: "User-Agent: *\nDisallow: /\n" }).status).toBe("pass");
    expect(checkNoindex({ production: false, robotsMeta: "index, follow", robotsHeader: null, robotsTxt: "User-Agent: *\nAllow: /\n" }).status).toBe("fail");
    expect(checkNoindex({ production: true, robotsMeta: "index, follow", robotsHeader: null, robotsTxt: "User-Agent: *\nAllow: /\n" }).status).toBe("pass");
    // Review M2: a de-indexed production site is a release blocker, whichever signal does it.
    expect(checkNoindex({ production: true, robotsMeta: "noindex", robotsHeader: null, robotsTxt: "" }).status).toBe("fail");
    expect(checkNoindex({ production: true, robotsMeta: null, robotsHeader: "noindex", robotsTxt: "" }).status).toBe("fail");
    expect(checkNoindex({ production: true, robotsMeta: null, robotsHeader: null, robotsTxt: "User-agent: *\nDisallow: /\n" }).status).toBe("fail");
  });

  // Review M3: only the group that applies to every crawler counts as a site-wide signal.
  it.each([
    ["a Disallow: / for one named bot", "User-agent: *\nAllow: /\n\nUser-agent: BadBot\nDisallow: /\n", false],
    ["a Disallow: / for one named bot listed first", "User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n", false],
    ["Disallow: / for every crawler", "User-agent: *\nDisallow: /\n", true],
    ["a * group shared with a named bot", "User-agent: BadBot\nUser-agent: *\nDisallow: / # all\n", true],
    ["Next's own output", "User-Agent: *\nDisallow: /\n\nHost: https://h.example\n", true],
    ["Disallow of a sub-path only", "User-agent: *\nDisallow: /api/\n", false],
  ])("reads robots.txt with %s as site-wide noindex: %s", (_label, robotsTxt, expected) => {
    expect(checkNoindex({ production: false, robotsMeta: null, robotsHeader: null, robotsTxt }).status).toBe(expected ? "pass" : "fail");
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

  // Review M1: the URL that was asked for is the one verified; nothing is sent to a host the operator never named.
  it("fails a home page that redirects to another origin and probes nothing there", async () => {
    const origin = "https://preview.example.com";
    const elsewhere = "https://sso.thirdparty.example";
    const seen: string[] = [];
    const routes = { ...healthyPage(elsewhere), [`${origin}/`]: { status: 307, headers: { location: `${elsewhere}/` } } };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: fakeFetch(routes, seen) });
    expect(statusOf(results, "home status")).toBe("fail");
    expect(results.find((result) => result.name === "home status")?.detail).toContain("another origin");
    expect(seen.filter((url) => url.startsWith(elsewhere))).toEqual([]);
    expect(exitCodeFor(results)).toBe(1);
  });

  it("follows a same-origin redirect and a same-host upgrade to https", async () => {
    const origin = "https://site.example.com";
    const routes = { ...healthyPage(origin), [`${origin}/start`]: { status: 308, headers: { location: "/" } }, "http://site.example.com/": { status: 301, headers: { location: `${origin}/start` } } };
    const results = await runFetchChecks(new URL("http://site.example.com/"), { fetch: fakeFetch(routes) });
    expect(failures(results)).toEqual([]);
  });

  it("never follows a probe's redirect to another origin", async () => {
    const origin = "http://127.0.0.1:3200";
    const seen: string[] = [];
    const routes = { ...healthyPage(origin), [`${origin}/api/health`]: { status: 302, headers: { location: "https://health.thirdparty.example/ok" } } };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: fakeFetch(routes, seen) });
    expect(statusOf(results, "health")).toBe("fail");
    expect(seen.some((url) => url.includes("thirdparty"))).toBe(false);
  });
});

/*
 * Review I1: every page is rendered per request, so no page HTML or RSC payload exists in the build
 * output for verify:bundle to scan. The deployment verifier fetches them from the running site and
 * runs the same rules over them.
 */
describe("runFetchChecks client payload scan", () => {
  const origin = "http://127.0.0.1:3200";
  const rules = deriveSecretRules({
    envExample: "SUPABASE_SERVICE_ROLE_KEY=\nSANITY_REVALIDATE_SECRET=\nNEXT_PUBLIC_SITE_URL=\n",
    allowedPublicNames: new Set(["NEXT_PUBLIC_SITE_URL"]),
    env: { SANITY_REVALIDATE_SECRET: "rv-7Hq2LmN9xPz4" },
  });
  const RSC_TYPE = "text/x-component";

  function withPayloads(overrides: Record<string, Canned> = {}): Record<string, Canned> {
    const routes = healthyPage(origin);
    const page = routes[`${origin}/`]!;
    for (const path of ["/privacy", "/terms", "/thank-you", "/contact"]) routes[`${origin}${path}`] = { ...page };
    for (const path of ["/", "/privacy", "/terms", "/thank-you", "/contact"]) routes[`rsc:${origin}${path}`] = { status: 200, type: RSC_TYPE, body: '0:{"P":null,"b":"build"}\n1:["$","main",null,{}]\n' };
    return { ...routes, ...overrides };
  }

  /** Answers `RSC: 1` requests from the `rsc:` entries, everything else from the plain table. */
  function rscAwareFetch(routes: Record<string, Canned>, seen: string[] = []): typeof fetch {
    const plain = fakeFetch(routes, seen);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const isRsc = new Headers(init?.headers).get("rsc") === "1";
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isRsc) {
        seen.push(`rsc:${url}`);
        const canned = routes[`rsc:${url}`] ?? { status: 404, type: "text/html", body: "missing" };
        return new Response(canned.body ?? "", { status: canned.status, headers: { ...(canned.type ? { "content-type": canned.type } : {}), ...canned.headers } });
      }
      return plain(input, init);
    }) as typeof fetch;
  }

  it("scans the HTML and the RSC payload of /, /privacy, /terms, /thank-you and /contact", async () => {
    const seen: string[] = [];
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(withPayloads(), seen), scanRules: rules });
    const scan = results.find((result) => result.name === "client payloads");
    expect(scan?.status).toBe("pass");
    expect(scan?.detail).toContain("10 responses");
    for (const path of ["/", "/privacy", "/terms", "/thank-you", "/contact"]) expect(seen).toContain(`rsc:${origin}${path}`);
    expect(exitCodeFor(results)).toBe(0);
  });

  it("fails when a server-only name or a configured secret value reaches a page's RSC payload, never repeating the value", async () => {
    const leak = { status: 200, type: RSC_TYPE, body: '1:["$","form",null,{"k":"rv-7Hq2LmN9xPz4","n":"SUPABASE_SERVICE_ROLE_KEY"}]\n' };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(withPayloads({ [`rsc:${origin}/terms`]: leak })), scanRules: rules });
    const scan = results.find((result) => result.name === "client payloads");
    expect(scan?.status).toBe("fail");
    expect(scan?.detail).toContain("/terms");
    expect(scan?.detail).toContain("SANITY_REVALIDATE_SECRET");
    expect(scan?.detail).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(scan?.detail).not.toContain("rv-7Hq2LmN9xPz4");
  });

  it("fails when a token-shaped secret reaches the server-rendered HTML of a page", async () => {
    const routes = withPayloads();
    const resendKey = `re_Ab12Cd34_${"Xy9".repeat(8)}`;
    routes[`${origin}/privacy`] = { ...routes[`${origin}/privacy`]!, body: `<html><body><script>self.__next_f.push([1,"${resendKey}"])</script></body></html>` };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes), scanRules: rules });
    const scan = results.find((result) => result.name === "client payloads");
    expect(scan?.status).toBe("fail");
    expect(scan?.detail).toContain("/privacy");
    expect(scan?.detail).not.toContain(resendKey);
  });

  it("fails when a page cannot be fetched, because it was not scanned", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(withPayloads({ [`${origin}/thank-you`]: { status: 500, type: "text/html", body: "boom" } })), scanRules: rules });
    const scan = results.find((result) => result.name === "client payloads");
    expect(scan?.status).toBe("fail");
    expect(scan?.detail).toContain("/thank-you");
  });

  it("fails when the RSC request is not answered with an RSC payload", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(withPayloads({ [`rsc:${origin}/privacy`]: { status: 200, type: "text/html", body: "<html></html>" } })), scanRules: rules });
    const scan = results.find((result) => result.name === "client payloads");
    expect(scan?.status).toBe("fail");
    expect(scan?.detail).toContain("/privacy");
  });

  it("does not treat a published contact address as a leak, even when it is the configured sender or staff address", async () => {
    const withSender = deriveSecretRules({
      envExample: "RESEND_FROM=\nSTAFF_NOTIFICATION_EMAIL=\nSANITY_REVALIDATE_SECRET=\n",
      allowedPublicNames: new Set(),
      env: { RESEND_FROM: "BIBO Bay <hello@bibobay.example>", STAFF_NOTIFICATION_EMAIL: "team@bibobay.example", SANITY_REVALIDATE_SECRET: "rv-7Hq2LmN9xPz4" },
    });
    const routes = withPayloads();
    routes[`${origin}/privacy`] = { ...routes[`${origin}/privacy`]!, body: `<html><body><a href="mailto:hello@bibobay.example">hello@bibobay.example</a> team@bibobay.example</body></html>` };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes), scanRules: withSender });
    expect(results.find((result) => result.name === "client payloads")?.status).toBe("pass");
    // Credentials are still looked for on the same pages.
    routes[`${origin}/privacy`] = { ...routes[`${origin}/privacy`]!, body: "<html><body>rv-7Hq2LmN9xPz4</body></html>" };
    const leaked = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes), scanRules: withSender });
    expect(leaked.find((result) => result.name === "client payloads")?.status).toBe("fail");
  });
});

/*
 * Task 7b: pages that exist only while a CMS switch is on (the shop). Each is scanned like the
 * always-on pages when it answers 200; otherwise it must answer 404, never a server error and never a
 * redirect, because a switched-off shop is a clean "not found".
 */
describe("runFetchChecks client payload scan of switchable pages", () => {
  const origin = "http://127.0.0.1:3200";
  const rules = deriveSecretRules({
    envExample: "SUPABASE_SERVICE_ROLE_KEY=\nSANITY_REVALIDATE_SECRET=\n",
    allowedPublicNames: new Set(),
    env: { SANITY_REVALIDATE_SECRET: "rv-7Hq2LmN9xPz4" },
  });
  const RSC = { status: 200, type: "text/x-component", body: '0:{"P":null,"b":"build"}\n' };

  function routesWith(shop?: { html?: Canned; rsc?: Canned }): Record<string, Canned> {
    const routes = healthyPage(origin);
    const page = routes[`${origin}/`]!;
    for (const path of PAYLOAD_PATHS) {
      routes[`${origin}${path}`] = { ...page };
      routes[`rsc:${origin}${path}`] = RSC;
    }
    if (shop?.html) routes[`${origin}/shop`] = shop.html;
    if (shop?.rsc) routes[`rsc:${origin}/shop`] = shop.rsc;
    return routes;
  }

  /** Answers `RSC: 1` requests from the `rsc:` entries, everything else from the plain table. */
  function rscAwareFetch(routes: Record<string, Canned>, seen: string[] = []): typeof fetch {
    const plain = fakeFetch(routes, seen);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new Headers(init?.headers).get("rsc") === "1") {
        seen.push(`rsc:${url}`);
        const canned = routes[`rsc:${url}`] ?? { status: 404, type: "text/html", body: "missing" };
        return new Response(canned.body ?? "", { status: canned.status, headers: { ...(canned.type ? { "content-type": canned.type } : {}), ...canned.headers } });
      }
      return plain(input, init);
    }) as typeof fetch;
  }

  const scanOf = (results: CheckResult[]) => results.find((result) => result.name === "client payloads");

  it("keeps the always-on list as it was and lists the shop, order and tracking pages as switchable (Task 7c)", () => {
    expect([...PAYLOAD_PATHS]).toEqual(["/", "/privacy", "/terms", "/thank-you", "/contact"]);
    expect([...GATED_PAYLOAD_PATHS]).toEqual(["/shop", "/order", "/track"]);
  });

  it("pins the form API paths the browser verifier blocks (R199)", () => {
    expect([...FORM_API_PATHS]).toEqual(["/api/leads", "/api/contact"]);
  });

  it("scans the order and tracking pages once they answer, and names a leak on either (Task 7c)", async () => {
    const seen: string[] = [];
    const routes = routesWith();
    routes[`${origin}/order`] = { status: 200, type: "text/html", body: "<html><body>order</body></html>" };
    routes[`rsc:${origin}/order`] = RSC;
    routes[`${origin}/track`] = { status: 200, type: "text/html", body: "<html><script>var k='rv-7Hq2LmN9xPz4'</script></html>" };
    routes[`rsc:${origin}/track`] = RSC;
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes, seen), scanRules: rules });
    expect(seen).toContain(`rsc:${origin}/order`);
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toContain("/track html");
    expect(scanOf(results)?.detail).not.toContain("rv-7Hq2LmN9xPz4");
  });

  it("fails when the order page answers a server error while switched off", async () => {
    const routes = routesWith();
    routes[`${origin}/order`] = { status: 500, type: "text/html", body: "boom" };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes), scanRules: rules });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toMatch(/\/order answered 500/);
  });

  it("passes a switched-off shop that answers 404, without scanning it", async () => {
    const seen: string[] = [];
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith(), seen), scanRules: rules });
    expect(scanOf(results)?.status).toBe("pass");
    expect(scanOf(results)?.detail).toContain("10 responses");
    expect(scanOf(results)?.detail).toMatch(/\/shop answered 404/);
    expect(seen).toContain(`${origin}/shop`);
    expect(seen).not.toContain(`rsc:${origin}/shop`);
  });

  it("scans a switched-on shop's HTML and RSC payload like the other pages", async () => {
    const seen: string[] = [];
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith({ html: { status: 200, type: "text/html", body: "<html><body>shop</body></html>" }, rsc: RSC }), seen), scanRules: rules });
    expect(scanOf(results)?.status).toBe("pass");
    expect(scanOf(results)?.detail).toContain("12 responses");
    expect(scanOf(results)?.detail).toContain("/shop");
    expect(seen).toContain(`rsc:${origin}/shop`);
  });

  it("fails when a switched-on shop leaks a secret, naming the page and never the value", async () => {
    const leak = { status: 200, type: "text/x-component", body: '1:["$","p",null,{"k":"rv-7Hq2LmN9xPz4"}]\n' };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith({ html: { status: 200, type: "text/html", body: "<html></html>" }, rsc: leak })), scanRules: rules });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toContain("/shop rsc");
    expect(scanOf(results)?.detail).not.toContain("rv-7Hq2LmN9xPz4");
  });

  it("fails when the shop answers a server error", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith({ html: { status: 500, type: "text/html", body: "boom" } })), scanRules: rules });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toMatch(/\/shop answered 500/);
  });

  it("follows the host's upgrade of the same page to https, then accepts its 404 (review Minor 3)", async () => {
    const routes = routesWith({ html: { status: 308, headers: { location: "https://127.0.0.1:3200/shop" } } });
    routes["https://127.0.0.1:3200/shop"] = { status: 404, type: "text/html", body: "not found" };
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routes), scanRules: rules });
    expect(scanOf(results)?.status).toBe("pass");
    expect(scanOf(results)?.detail).toMatch(/\/shop answered 404/);
  });

  it("fails when a switched-on shop's HTML leaks a secret, naming the page and never the value (review Minor 3)", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), {
      fetch: rscAwareFetch(routesWith({ html: { status: 200, type: "text/html", body: "<html><script>var k='rv-7Hq2LmN9xPz4'</script></html>" }, rsc: RSC })),
      scanRules: rules,
    });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toContain("/shop html");
    expect(scanOf(results)?.detail).not.toContain("rv-7Hq2LmN9xPz4");
  });

  it("fails when the shop redirects to another site (review Minor 3)", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith({ html: { status: 307, headers: { location: "https://elsewhere.example/shop" } } })), scanRules: rules });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toMatch(/\/shop redirected to another origin/);
  });

  it("fails when the shop redirects, even within the site", async () => {
    const results = await runFetchChecks(new URL(`${origin}/`), { fetch: rscAwareFetch(routesWith({ html: { status: 307, headers: { location: "/" } } })), scanRules: rules });
    expect(scanOf(results)?.status).toBe("fail");
    expect(scanOf(results)?.detail).toMatch(/\/shop redirected/);
  });
});

describe("classifyBrowserRun", () => {
  const origin = "http://127.0.0.1:3200";
  const clean = { origin, consoleErrors: [], pageErrors: [], cspViolations: [], responses: [{ url: `${origin}/`, status: 200 }], headingVisible: true, leadRequests: [] };

  it("passes a clean load", () => {
    expect(classifyBrowserRun(clean).every((result) => result.status === "pass")).toBe(true);
  });

  it("prints failing response URLs without their query string (review M4: a bypass token must not reach CI logs)", () => {
    const results = classifyBrowserRun({
      ...clean,
      responses: [
        { url: `${origin}/?x-vercel-protection-bypass=tok-same`, status: 401 },
        { url: "https://cdn.example.com/a.js?x-vercel-protection-bypass=tok-cross", status: 403 },
      ],
    });
    const printed = JSON.stringify(results);
    expect(printed).not.toContain("tok-same");
    expect(printed).not.toContain("tok-cross");
    expect(results.find((result) => result.name === "browser same-origin responses")?.detail).toContain(`401 ${origin}/?…`);
  });

  it("redacts query strings in every printed line, including browser-reported text (review M4)", () => {
    const results: CheckResult[] = [
      { name: "browser console", status: "fail", detail: `Failed to load resource: ${origin}/x.js?x-vercel-protection-bypass=tok-console&a=1 (404)` },
      { name: "browser csp violations", status: "fail", detail: "script-src blocked https://evil.example/s.js?token=tok-csp" },
      { name: "home", status: "pass", detail: "200 at http://127.0.0.1:3200/ (query kept: none)" },
    ];
    const table = formatTable(results);
    expect(table).not.toMatch(/tok-(console|csp)/);
    expect(table).toContain(`${origin}/x.js?… (404)`);
    expect(table).toContain("https://evil.example/s.js?…");
    expect(table).toContain("200 at http://127.0.0.1:3200/ (query kept: none)");
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

  // Review M4: printed output lands in CI logs.
  it("refuses a URL carrying credentials, without repeating them", () => {
    const result = parseArgs(["https://user:hunter2-pass@site.example.com/"]);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).not.toContain("hunter2-pass");
  });

  it("prints the page URL without its query string, which may hold a preview bypass token", () => {
    expect(displayUrl(new URL("https://preview.example.com/a?x-vercel-protection-bypass=tok3n-Value&x=1"))).toBe("https://preview.example.com/a?…");
    expect(displayUrl(new URL("https://site.example.com/"))).toBe("https://site.example.com/");
  });

  it("never repeats the page URL's query string in any check result", async () => {
    const origin = "https://preview.example.com";
    const page = new URL(`${origin}/?x-vercel-protection-bypass=tok3n-Value`);
    const routes = { ...healthyPage(origin), [page.href]: { status: 307, headers: { location: `https://elsewhere.example/?x-vercel-protection-bypass=tok3n-Value` } } };
    const results = await runFetchChecks(page, { fetch: fakeFetch(routes) });
    expect(JSON.stringify(results)).not.toContain("tok3n-Value");
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const error = await runFetchChecks(page, { fetch: unreachable }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeploymentNetworkError);
    expect((error as Error).message).not.toContain("tok3n-Value");
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
