/*
 * Deployment verification rules (ruling R44), as pure functions so every rule is unit-tested
 * (tests/scripts/deployment-checks.test.ts). scripts/verify-deployment.ts is the command line; it
 * passes the real `fetch` here and, in --browser mode, feeds what Chromium saw to classifyBrowserRun.
 *
 * It exists because the old GitHub Pages site once served the unbuilt source: a 200 page whose only
 * script, /src/main.tsx, answered 404, so visitors saw a blank page while the URL "worked". Every
 * check below would have failed that page.
 */

import { ADDRESS_NAMES, scanText, type SecretRules } from "./bundle-secrets";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface PageAsset {
  kind: "script" | "stylesheet" | "icon";
  url: string;
  sameOrigin: boolean;
}

export interface HtmlAnalysis {
  title: string;
  headings: string[];
  visibleText: string;
  robotsMeta: string | null;
  assets: PageAsset[];
}

/** Thrown when the deployment cannot be reached at all (the command line exits 2). */
export class DeploymentNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentNetworkError";
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower]!;
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return entity;
  });
}

const collapse = (text: string) => decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Attributes of one start tag, lower-cased names. */
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1]!.toLowerCase();
    if (name.startsWith("<")) continue;
    result[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

/** Text a reader sees: scripts, styles, templates and comments removed, entities decoded. */
function visibleTextOf(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return collapse(
    body
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " "),
  );
}

export function analyzeHtml(html: string, pageUrl: URL): HtmlAnalysis {
  const title = collapse(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  const headings = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi), (match) => collapse(match[1]!)).filter(Boolean);
  let robotsMeta: string | null = null;
  const assets: PageAsset[] = [];
  const add = (kind: PageAsset["kind"], href: string | undefined) => {
    if (!href || /^(?:data|blob|javascript):/i.test(href.trim())) return;
    let url: URL;
    try {
      url = new URL(href.trim(), pageUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    if (assets.some((asset) => asset.url === url.href)) return;
    assets.push({ kind, url: url.href, sameOrigin: url.origin === pageUrl.origin });
  };
  for (const match of html.matchAll(/<(script|link|meta)\b[^>]*>/gi)) {
    const tag = match[1]!.toLowerCase();
    const attrs = attributes(match[0]);
    if (tag === "script") add("script", attrs.src);
    else if (tag === "meta" && attrs.name?.toLowerCase() === "robots") robotsMeta = attrs.content ?? "";
    else if (tag === "link") {
      const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
      if (rel.includes("stylesheet")) add("stylesheet", attrs.href);
      else if (rel.includes("icon")) add("icon", attrs.href);
    }
  }
  return { title, headings, visibleText: visibleTextOf(html), robotsMeta, assets };
}

/** Titles a framework or a hosting error page shows when the real app did not render. */
const DEFAULT_TITLES = [/^create next app$/i, /^vite \+ react/i, /^react app$/i, /^404\b/i, /page could not be found/i, /^site not found/i, /^untitled$/i];

export function checkTitle(title: string): CheckResult {
  const value = title.trim();
  if (!value) return { name: "title", status: "fail", detail: "empty <title>" };
  if (DEFAULT_TITLES.some((pattern) => pattern.test(value))) return { name: "title", status: "fail", detail: `framework or error default: ${value}` };
  return { name: "title", status: "pass", detail: value };
}

/** Enough visible text to be a page rather than an empty app shell. */
export const MIN_VISIBLE_TEXT = 200;

export function checkBody(analysis: HtmlAnalysis, { minTextLength = MIN_VISIBLE_TEXT, expectHeading }: { minTextLength?: number; expectHeading?: string }): CheckResult {
  const length = analysis.visibleText.length;
  if (length < minTextLength) return { name: "body", status: "fail", detail: `${length} visible characters (< ${minTextLength}): an empty shell` };
  if (analysis.headings.length === 0) return { name: "body", status: "fail", detail: `${length} visible characters but no <h1>` };
  if (expectHeading && !analysis.headings.some((heading) => heading === expectHeading.trim())) {
    return { name: "body", status: "fail", detail: `<h1> is "${analysis.headings[0]}", expected "${expectHeading.trim()}"` };
  }
  return { name: "body", status: "pass", detail: `${length} visible characters; <h1> "${analysis.headings[0]}"` };
}

const TYPE_RULES: Record<PageAsset["kind"], RegExp> = {
  script: /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)\b/i,
  stylesheet: /^text\/css\b/i,
  icon: /^image\//i,
};

export function checkAsset(asset: PageAsset, response: { status: number; contentType: string | null }): CheckResult {
  const name = `asset ${asset.kind}`;
  if (response.status !== 200) return { name, status: "fail", detail: `${asset.url} -> ${response.status}` };
  const type = (response.contentType ?? "").trim();
  if (!TYPE_RULES[asset.kind].test(type)) return { name, status: "fail", detail: `${asset.url} -> 200 but content-type "${type || "none"}"` };
  return { name, status: "pass", detail: `${asset.url} -> 200 ${type.split(";")[0]}` };
}

export function checkSecurityHeaders(headers: Headers): CheckResult[] {
  const policy = headers.get("content-security-policy") ?? "";
  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]*)/i.exec(policy)?.[1] ?? "";
  let csp: CheckResult;
  if (!policy) csp = { name: "csp", status: "fail", detail: "no Content-Security-Policy header" };
  else if (/'unsafe-eval'/i.test(policy)) csp = { name: "csp", status: "fail", detail: "policy allows 'unsafe-eval'" };
  else if (!/'nonce-[A-Za-z0-9+/_=-]+'/.test(scriptSrc)) csp = { name: "csp", status: "fail", detail: "script-src has no nonce" };
  else csp = { name: "csp", status: "pass", detail: "nonce script-src, no 'unsafe-eval'" };
  const nosniff = headers.get("x-content-type-options")?.trim().toLowerCase() === "nosniff";
  const referrer = headers.get("referrer-policy")?.trim() ?? "";
  return [
    csp,
    { name: "nosniff", status: nosniff ? "pass" : "fail", detail: nosniff ? "X-Content-Type-Options: nosniff" : "X-Content-Type-Options is not nosniff" },
    { name: "referrer-policy", status: referrer ? "pass" : "fail", detail: referrer || "no Referrer-Policy header" },
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function checkHealth(status: number, body: unknown): CheckResult {
  if (status !== 200) return { name: "health", status: "fail", detail: `/api/health -> ${status}` };
  if (!isRecord(body) || body.status !== "ok") return { name: "health", status: "fail", detail: "/api/health did not answer {status: \"ok\"}" };
  return { name: "health", status: "pass", detail: `200 status=ok version=${typeof body.version === "string" ? body.version : "?"}` };
}

/** The readiness keys app/api/readiness/route.ts returns: booleans only. */
const READINESS_KEYS = ["ready", "sanity", "supabase", "email", "revalidation", "legalReviewed"];

export function checkReadiness(status: number, body: unknown, { requireReady }: { requireReady: boolean }): CheckResult {
  if (status !== 200 && status !== 503) return { name: "readiness", status: "fail", detail: `/api/readiness -> ${status}` };
  if (!isRecord(body) || Object.values(body).some((value) => typeof value !== "boolean")) {
    return { name: "readiness", status: "fail", detail: `/api/readiness -> ${status} with a body that is not booleans only` };
  }
  const flags = [...READINESS_KEYS.filter((key) => key in body), ...Object.keys(body).filter((key) => !READINESS_KEYS.includes(key))]
    .map((key) => `${key}=${String(body[key])}`)
    .join(" ");
  const detail = `${status} ${flags}`;
  if (status === 200 && body.ready === true) return { name: "readiness", status: "pass", detail };
  return { name: "readiness", status: requireReady ? "fail" : "warn", detail };
}

/**
 * robots.txt that blocks every crawler from the whole site: a `Disallow: /` inside a group whose
 * user agents include `*`. Groups are split at each run of `User-agent` lines, so a rule for one
 * named bot is never read as a site-wide signal (review M3).
 */
function disallowsAll(robotsTxt: string): boolean {
  let agents: string[] = [];
  let inRules = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
      continue;
    }
    inRules = true;
    if (field === "disallow" && value === "/" && agents.includes("*")) return true;
  }
  return false;
}

export function checkNoindex({ production, robotsMeta, robotsHeader, robotsTxt }: { production: boolean; robotsMeta: string | null; robotsHeader: string | null; robotsTxt: string }): CheckResult {
  const signals = [
    robotsMeta && /noindex/i.test(robotsMeta) ? `<meta robots="${robotsMeta}">` : null,
    robotsHeader && /noindex/i.test(robotsHeader) ? `X-Robots-Tag: ${robotsHeader}` : null,
    disallowsAll(robotsTxt) ? "robots.txt Disallow: /" : null,
  ].filter((signal): signal is string => signal !== null);
  if (production) {
    // Review M2: a de-indexed production site is a release blocker, whichever signal causes it.
    if (signals.length > 0) return { name: "noindex", status: "fail", detail: `production site is not indexable: ${signals.join("; ")}` };
    return { name: "noindex", status: "pass", detail: "production: indexable" };
  }
  if (signals.length === 0) return { name: "noindex", status: "fail", detail: "non-production URL has no noindex signal (meta, header or robots.txt)" };
  return { name: "noindex", status: "pass", detail: signals.join("; ") };
}

export interface FetchCheckOptions {
  fetch?: typeof fetch;
  requireReady?: boolean;
  production?: boolean;
  expectHeading?: string;
  minTextLength?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /**
   * The bundle scan's rules (scripts/lib/bundle-secrets.ts). When given, the HTML and RSC payload of
   * every page in PAYLOAD_PATHS are fetched and scanned (review I1).
   */
  scanRules?: SecretRules;
}

/**
 * How a URL is printed: origin and path only. A query string may carry a preview bypass token
 * (`x-vercel-protection-bypass`), so it is shown as `?…`; parseArgs refuses user names and passwords.
 */
export function displayUrl(url: URL): string {
  return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
}

const safeDisplay = (href: string) => {
  try {
    return displayUrl(new URL(href));
  } catch {
    return href;
  }
};

const MAX_REDIRECTS = 5;

type Fetched = { ok: true; response: Response; url: URL } | { ok: false; status: number; crossOrigin: URL };

/**
 * GET that follows redirects only within `allowed` origins (review M1): the URL the operator named is
 * the one verified, and nothing is sent to a host they never named. Throws on network errors.
 */
async function get(fetcher: typeof fetch, start: URL, allowed: ReadonlySet<string>, timeoutMs: number, extraHeaders: Record<string, string> = {}): Promise<Fetched> {
  let url = start;
  for (let hop = 0; ; hop += 1) {
    const response = await fetcher(url.href, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "bibobay-verify-deployment", ...extraHeaders } });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location || hop >= MAX_REDIRECTS) return { ok: true, response, url };
    await response.arrayBuffer().catch(() => undefined);
    const next = new URL(location, url);
    if (!allowed.has(next.origin)) return { ok: false, status: response.status, crossOrigin: next };
    url = next;
  }
}

/** The requested origin, plus its https form when it was asked for over http (a same-host upgrade). */
function allowedOrigins(pageUrl: URL): Set<string> {
  const origins = new Set([pageUrl.origin]);
  if (pageUrl.protocol === "http:") origins.add(`https://${pageUrl.host}`);
  return origins;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Pages whose server-rendered HTML and RSC payload are scanned for secrets (all are rendered per request). */
export const PAYLOAD_PATHS = ["/", "/privacy", "/terms", "/thank-you", "/contact"] as const;

/**
 * The form APIs the browser verifier must never call: each is blocked and reported (R199), so a
 * verification run cannot store a signup or a contact message, or send an alert.
 */
export const FORM_API_PATHS = ["/api/leads", "/api/contact"] as const;

/**
 * Pages that exist only while a CMS switch is on (Task 7b: the shop, while commerce is enabled;
 * Task 7c: the order page with it, and the tracking page while tracking is also on). Each is
 * scanned like PAYLOAD_PATHS when it answers 200. Switched off it must answer 404: a server error or
 * a redirect fails the check. /orders/<token> is not listed: without a real token it is a 404.
 */
export const GATED_PAYLOAD_PATHS = ["/shop", "/order", "/track"] as const;

async function scanClientPayloads(fetcher: typeof fetch, origin: string, allowed: ReadonlySet<string>, timeoutMs: number, rules: SecretRules): Promise<CheckResult> {
  const name = "client payloads";
  if (rules.configErrors.length > 0) return { name, status: "fail", detail: rules.configErrors.join("; ") };
  // Pages legitimately publish the contact address editors choose in the CMS, which may be the
  // sender or staff address. Addresses are not credentials, so only they are skipped here; the
  // client-JS scan (verify:bundle) still looks for them.
  const pageRules: SecretRules = { ...rules, secretValues: rules.secretValues.filter(({ name: valueName }) => !ADDRESS_NAMES.has(valueName)) };
  const problems: string[] = [];
  const notes: string[] = [];
  const scannedPaths: string[] = [];
  let scanned = 0;

  const scan = (label: string, body: string) => {
    scanned += 1;
    for (const finding of scanText(body, label, pageRules)) problems.push(`${label}: ${finding.kind} ${finding.rule}`);
  };

  /** The page's RSC payload (Next answers a bare `RSC: 1` GET with a same-origin redirect first). */
  const scanRsc = async (path: string) => {
    const label = `${path} rsc`;
    let fetched: Fetched;
    try {
      fetched = await get(fetcher, new URL(path, origin), allowed, timeoutMs, { RSC: "1" });
    } catch (error) {
      problems.push(`${label} not scanned (${error instanceof Error ? error.message : "request failed"})`);
      return;
    }
    if (!fetched.ok) {
      problems.push(`${label} not scanned (redirected to another origin)`);
      return;
    }
    const { response } = fetched;
    const body = await response.text().catch(() => "");
    const type = response.headers.get("content-type") ?? "";
    if (response.status !== 200) {
      problems.push(`${label} not scanned (${response.status})`);
      return;
    }
    if (!/^text\/x-component\b/i.test(type)) {
      problems.push(`${label} not scanned (answered ${type.split(";")[0] || "no content-type"}, not an RSC payload)`);
      return;
    }
    scan(label, body);
  };

  for (const path of PAYLOAD_PATHS) {
    const label = `${path} html`;
    let fetched: Fetched | null = null;
    try {
      fetched = await get(fetcher, new URL(path, origin), allowed, timeoutMs);
    } catch (error) {
      problems.push(`${label} not scanned (${error instanceof Error ? error.message : "request failed"})`);
    }
    if (fetched && !fetched.ok) problems.push(`${label} not scanned (redirected to another origin)`);
    else if (fetched) {
      const body = await fetched.response.text().catch(() => "");
      if (fetched.response.status !== 200) problems.push(`${label} not scanned (${fetched.response.status})`);
      else scan(label, body);
    }
    await scanRsc(path);
    scannedPaths.push(path);
  }

  for (const path of GATED_PAYLOAD_PATHS) {
    const requested = new URL(path, origin);
    let fetched: Fetched;
    try {
      fetched = await get(fetcher, requested, allowed, timeoutMs);
    } catch (error) {
      problems.push(`${path} html not scanned (${error instanceof Error ? error.message : "request failed"})`);
      continue;
    }
    if (!fetched.ok) {
      problems.push(`${path} redirected to another origin; a switched-off page must answer 404`);
      continue;
    }
    const body = await fetched.response.text().catch(() => "");
    // A same-page upgrade (http to https on the same host) is followed; any other redirect fails.
    if (`${fetched.url.pathname}${fetched.url.search}` !== `${requested.pathname}${requested.search}`) {
      problems.push(`${path} redirected to ${fetched.url.pathname}; a switched-off page must answer 404`);
      continue;
    }
    const { status } = fetched.response;
    if (status === 404) {
      notes.push(`${path} answered 404 (switched off, not scanned)`);
      continue;
    }
    if (status !== 200) {
      problems.push(`${path} answered ${status}; a switchable page must answer 200 or 404`);
      continue;
    }
    scan(`${path} html`, body);
    await scanRsc(path);
    scannedPaths.push(path);
  }

  if (problems.length > 0) return { name, status: "fail", detail: clip(problems, 6) };
  const note = notes.length > 0 ? `; ${notes.join("; ")}` : "";
  return { name, status: "pass", detail: `${scanned} responses (HTML and RSC of ${scannedPaths.join(", ")}): no server name, secret value, token shape or server-code string${note}` };
}

/** Every fetch-only check, in table order. Throws DeploymentNetworkError when the home page is unreachable. */
export async function runFetchChecks(pageUrl: URL, options: FetchCheckOptions = {}): Promise<CheckResult[]> {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const results: CheckResult[] = [];
  const allowed = allowedOrigins(pageUrl);

  let fetched: Fetched;
  try {
    fetched = await get(fetcher, pageUrl, allowed, timeoutMs);
  } catch (error) {
    throw new DeploymentNetworkError(`${displayUrl(pageUrl)} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!fetched.ok) {
    // Nothing is checked or probed on a host the operator never named.
    return [{ name: "home status", status: "fail", detail: `${fetched.status} redirected to another origin (${fetched.crossOrigin.origin}); the requested URL was not verified` }];
  }
  const home = fetched.response;
  const finalUrl = fetched.url;
  const html = await home.text();
  const homeType = home.headers.get("content-type") ?? "";
  results.push({ name: "home status", status: home.status === 200 ? "pass" : "fail", detail: `${home.status} ${homeType.split(";")[0] || "no content-type"}${finalUrl.href !== pageUrl.href ? ` (redirected to ${displayUrl(finalUrl)})` : ""}` });

  const analysis = analyzeHtml(html, finalUrl);
  results.push(checkTitle(analysis.title));
  results.push(checkBody(analysis, { ...(options.minTextLength !== undefined ? { minTextLength: options.minTextLength } : {}), ...(options.expectHeading ? { expectHeading: options.expectHeading } : {}) }));

  const sameOrigin = analysis.assets.filter((asset) => asset.sameOrigin);
  if (!sameOrigin.some((asset) => asset.kind === "script")) results.push({ name: "asset script", status: "fail", detail: "the page references no same-origin script" });
  if (!sameOrigin.some((asset) => asset.kind === "stylesheet")) results.push({ name: "asset stylesheet", status: "warn", detail: "the page references no same-origin stylesheet" });
  for (const asset of analysis.assets) {
    if (!asset.sameOrigin) {
      results.push({ name: `asset ${asset.kind}`, status: "skip", detail: `${safeDisplay(asset.url)} (cross-origin, not fetched)` });
      continue;
    }
    try {
      const assetFetch = await get(fetcher, new URL(asset.url), allowed, timeoutMs);
      if (!assetFetch.ok) {
        results.push({ name: `asset ${asset.kind}`, status: "fail", detail: `${safeDisplay(asset.url)} -> ${assetFetch.status} redirected to another origin` });
        continue;
      }
      await assetFetch.response.arrayBuffer().catch(() => undefined);
      results.push(checkAsset({ ...asset, url: safeDisplay(asset.url) }, { status: assetFetch.response.status, contentType: assetFetch.response.headers.get("content-type") }));
    } catch (error) {
      results.push({ name: `asset ${asset.kind}`, status: "fail", detail: `${safeDisplay(asset.url)} -> ${error instanceof Error ? error.message : "request failed"}` });
    }
  }

  results.push(...checkSecurityHeaders(home.headers));

  const origin = finalUrl.origin;
  const probe = async (path: string) => {
    try {
      const probed = await get(fetcher, new URL(path, origin), allowed, timeoutMs);
      return probed.ok ? { status: probed.response.status, response: probed.response } : { status: probed.status, response: null };
    } catch {
      return { status: 0, response: null };
    }
  };

  const health = await probe("/api/health");
  results.push(checkHealth(health.status, health.response && health.status === 200 ? await readJson(health.response) : null));

  const readiness = await probe("/api/readiness");
  results.push(checkReadiness(readiness.status, readiness.response ? await readJson(readiness.response) : null, { requireReady: options.requireReady === true }));

  const robots = await probe("/robots.txt");
  const robotsTxt = robots.response && robots.status === 200 ? await robots.response.text() : "";
  results.push({ name: "robots.txt", status: robots.status === 200 ? "pass" : "fail", detail: `/robots.txt -> ${robots.status || "unreachable"}` });

  results.push(checkNoindex({ production: options.production === true, robotsMeta: analysis.robotsMeta, robotsHeader: home.headers.get("x-robots-tag"), robotsTxt }));
  if (options.scanRules) results.push(await scanClientPayloads(fetcher, origin, allowed, timeoutMs, options.scanRules));
  return results;
}

export interface BrowserObservation {
  origin: string;
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: string[];
  responses: Array<{ url: string; status: number }>;
  headingVisible: boolean;
  /** Calls to /api/leads during the load: verification must never submit the form. */
  leadRequests: string[];
}

const clip = (items: string[], limit = 3) => (items.length <= limit ? items.join(" | ") : `${items.slice(0, limit).join(" | ")} | +${items.length - limit} more`);

export function classifyBrowserRun(observation: BrowserObservation): CheckResult[] {
  const failing = observation.responses.filter((response) => response.status >= 400);
  const sameOrigin = failing.filter((response) => {
    try {
      return new URL(response.url).origin === observation.origin;
    } catch {
      return false;
    }
  });
  const crossOrigin = failing.filter((response) => !sameOrigin.includes(response));
  const list = (name: string, items: string[], empty: string): CheckResult => ({ name, status: items.length === 0 ? "pass" : "fail", detail: items.length === 0 ? empty : clip(items) });
  return [
    { name: "browser heading", status: observation.headingVisible ? "pass" : "fail", detail: observation.headingVisible ? "an <h1> is visible after load" : "no visible <h1> after load" },
    list("browser console", observation.consoleErrors, "no console errors"),
    list("browser page errors", observation.pageErrors, "no uncaught errors"),
    list("browser csp violations", observation.cspViolations, "no CSP violations"),
    list("browser same-origin responses", sameOrigin.map((response) => `${response.status} ${safeDisplay(response.url)}`), `${observation.responses.length} responses, none >= 400`),
    { name: "browser cross-origin responses", status: crossOrigin.length === 0 ? "pass" : "warn", detail: crossOrigin.length === 0 ? "none >= 400" : clip(crossOrigin.map((response) => `${response.status} ${safeDisplay(response.url)}`)) },
    list("browser lead requests", observation.leadRequests, "the form was not submitted"),
  ];
}

export interface CliOptions {
  url: URL;
  browser: boolean;
  requireReady: boolean;
  production: boolean;
  expectHeading?: string;
  minTextLength?: number;
}

export const USAGE = [
  "Usage: npm run verify:deployment -- <url> [--browser] [--require-ready] [--production] [--expect-heading <text>] [--min-text <n>]",
  "  --browser         also load the page in Chromium (Playwright) and fail on console errors, page errors,",
  "                    CSP violations and same-origin responses >= 400",
  "  --require-ready   fail when /api/readiness answers 503 (default: report it as a warning)",
  "  --production      the URL is the indexable production site (no noindex expected)",
  "  --expect-heading  the exact <h1> text the home page must show",
  "  --min-text        minimum visible text length (default 200)",
  "Exit codes: 0 pass, 1 a check failed, 2 usage or network error.",
].join("\n");

export function parseArgs(argv: readonly string[]): { ok: true; options: CliOptions } | { ok: false; error: string } {
  let url: URL | null = null;
  const options: Omit<CliOptions, "url"> = { browser: false, requireReady: false, production: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--browser") options.browser = true;
    else if (arg === "--require-ready") options.requireReady = true;
    else if (arg === "--production") options.production = true;
    else if (arg === "--expect-heading" || arg === "--min-text") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: `${arg} needs a value` };
      index += 1;
      if (arg === "--expect-heading") options.expectHeading = value;
      else if (/^\d{1,6}$/.test(value)) options.minTextLength = Number(value);
      else return { ok: false, error: "--min-text must be a whole number" };
    } else if (arg.startsWith("--")) return { ok: false, error: `unknown option ${arg}` };
    else if (url) return { ok: false, error: "only one URL may be given" };
    else {
      try {
        url = new URL(arg);
      } catch {
        return { ok: false, error: "not a URL (expected http:// or https://)" };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "the URL must be http or https" };
      // Review M4: the URL is printed and lands in CI logs; credentials never belong in it.
      if (url.username || url.password) return { ok: false, error: "the URL must not contain a user name or password" };
    }
  }
  if (!url) return { ok: false, error: "a URL is required" };
  return { ok: true, options: { url, ...options } };
}

/**
 * Review M4: the table lands in CI logs, and browser-reported text (console errors, CSP reports,
 * navigation errors) can quote any URL, so every `http(s)://…?query` in a detail is cut to `?…`.
 */
const URL_QUERY = /(https?:\/\/[^\s?#"'<>()]+)\?[^\s#"'<>()]*/g;
export const redactQueries = (text: string) => text.replace(URL_QUERY, "$1?…");

export function formatTable(results: readonly CheckResult[]): string {
  const width = Math.max(4, ...results.map((result) => result.name.length));
  const lines = results.map((result) => `${result.status.toUpperCase().padEnd(4)}  ${result.name.padEnd(width)}  ${redactQueries(result.detail.replace(/\s+/g, " "))}`);
  const count = (status: CheckStatus) => results.filter((result) => result.status === status).length;
  const verdict = exitCodeFor(results) === 0 ? "PASS" : "FAIL";
  return [...lines, `Result: ${verdict} (${count("pass")} pass, ${count("warn")} warn, ${count("fail")} fail, ${count("skip")} skip)`].join("\n");
}

/** 0 when nothing failed (warnings and skips allowed); 1 on any failure, or when nothing was checked. */
export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  if (results.length === 0) return 1;
  return results.some((result) => result.status === "fail") ? 1 : 0;
}
