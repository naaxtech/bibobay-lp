import { expect, test, type Page } from "@playwright/test";

import { CONFIGURED } from "../ops/environment";
import { NOT_FOUND_TITLE } from "../shop/shop-helpers";

/*
 * Task 12 (local pass), spec §16 "Crawl all public, legal, commerce-disabled, tracking, error, and
 * 404 routes" and the last bullet (console errors, unhandled rejections, failed network requests,
 * missing assets, horizontal overflow, broken links, metadata). One inventory, one expected answer
 * per route, on a keyless server: commerce is off and no Sanity project is configured, so the
 * repository fallbacks render and the shop family answers the branded 404. Nothing here reaches a
 * host other than the base URL (external links are inspected, never followed).
 *
 * Run it against the keyless production server; with E2E_COMMERCE=1 the shop family is a different
 * set of pages and is covered by e2e/shop instead, so those rows are skipped. With E2E_CONFIGURED=1
 * (final review O-I3: a server that has Supabase configured, such as the preview) two rows change:
 * readiness answers 200 (app/api/readiness/route.ts: `checks.ready ? 200 : 503`), and a signed-out visit
 * to a staff orders page redirects to the sign-in page (app/admin/orders/page.tsx), so the document that
 * ends up loaded is the sign-in page.
 */

const COMMERCE_ON = process.env.E2E_COMMERCE === "1";
const TOKEN = "0123456789abcdef".repeat(4);

interface PageRoute {
  path: string;
  /** The status the document answers with. */
  status: 200 | 404;
  /** Why this is the expected answer. */
  why: string;
  /** Rows that exist only while commerce is off. */
  commerceOffOnly?: true;
  /** Staff orders pages: the unconfigured notice when keyless, the sign-in page after a redirect when configured; 200 either way. */
  ordersPages?: true;
  noindex?: true;
}

/** Every HTML route of the site. One line per entry says why it answers what it does. */
export const PAGE_ROUTES: PageRoute[] = [
  { path: "/", status: 200, why: "the landing page, rendered from the repository fallback" },
  { path: "/privacy", status: 200, why: "legal route with a safe repository fallback" },
  { path: "/terms", status: 200, why: "legal route with a safe repository fallback" },
  { path: "/thank-you", status: 200, why: "confirmed-signup page" },
  { path: "/contact", status: 200, why: "contact page: the closed notice keyless, the form when contact is configured" },
  { path: "/track", status: 404, why: "tracking is a commerce route; commerce is off", commerceOffOnly: true },
  { path: "/shop", status: 404, why: "catalogue is a commerce route; commerce is off", commerceOffOnly: true },
  { path: "/shop/x", status: 404, why: "product page is a commerce route; commerce is off", commerceOffOnly: true },
  { path: "/order", status: 404, why: "order pad is a commerce route; commerce is off", commerceOffOnly: true },
  { path: `/orders/${TOKEN}`, status: 404, why: "private order link; commerce is off, so even a well-formed token is not found", commerceOffOnly: true },
  { path: "/no-such-page", status: 404, why: "no such route: the branded not-found page" },
  { path: "/admin/login", status: 200, why: "staff sign-in page (noindex, admin headers)", noindex: true },
  // Keyless: the unconfigured notice. Configured: a signed-out visit is redirected to sign-in. Both end on a 200 page.
  { path: "/admin/orders", status: 200, why: "staff orders list: the unconfigured notice, or sign-in when configured", ordersPages: true, noindex: true },
  { path: "/admin/orders/BB-0000-0000", status: 200, why: "staff order detail: the unconfigured notice, or sign-in when configured", ordersPages: true, noindex: true },
];

interface FileRoute {
  path: string;
  type: RegExp;
  status: number;
  why: string;
}

/** Non-HTML routes and their expected answers. */
export const FILE_ROUTES: FileRoute[] = [
  { path: "/api/health", type: /application\/json/, status: 200, why: "liveness" },
  { path: "/api/readiness", type: /application\/json/, status: CONFIGURED ? 200 : 503, why: "readiness is 503 until Sanity, lead storage and revalidation are configured" },
  { path: "/robots.txt", type: /text\/plain/, status: 200, why: "crawler rules" },
  { path: "/sitemap.xml", type: /xml/, status: 200, why: "sitemap" },
  { path: "/manifest.webmanifest", type: /json/, status: 200, why: "web app manifest" },
  { path: "/icon.svg", type: /image\/svg\+xml/, status: 200, why: "the canonical logo as the site icon" },
  { path: "/opengraph-image", type: /image\/png/, status: 200, why: "generated social image" },
];

/** Same-origin link targets that are meant to answer 404 (none: no public page links to a gated route). */
export const DELIBERATE_404_LINK_TARGETS: string[] = [];

const VIEWPORTS = [
  { name: "mobile 390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "tablet 820", use: { viewport: { width: 820, height: 1180 } } },
  { name: "desktop 1440", use: { viewport: { width: 1440, height: 900 } } },
] as const;

/** Console errors, uncaught exceptions and failed requests, minus the document the route is meant to answer with. */
function collectProblems(page: Page, documentUrl: () => string) {
  const problems: string[] = [];
  let documentStatus: number | undefined;
  page.on("response", (response) => {
    if (response.url() === documentUrl()) documentStatus = response.status();
  });
  page.on("console", (message) => {
    if (message.type() !== "error" || message.text().includes("/_next/hmr")) return;
    // Chromium logs "Failed to load resource" for a document that answers 404 on purpose; that line is the route, not a defect.
    // Only that one line, only when the document itself answered 404 (final review T-M3): any other console
    // error located at the document URL, such as a CSP refusal of an inline script, is a real problem.
    if (documentStatus === 404 && message.text().startsWith("Failed to load resource") && message.location().url === documentUrl()) return;
    problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("requestfailed", (request) => {
    // A prefetch the browser cancelled while navigating away is not a failure.
    if (request.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`failed: ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url() !== documentUrl()) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

/** Scrolls end to end so lazy images and prefetches start, then waits for the network to settle. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(40);
  }
  await page.waitForLoadState("networkidle");
}

const rows = PAGE_ROUTES.filter((route) => !(COMMERCE_ON && route.commerceOffOnly));

for (const { name, use } of VIEWPORTS) {
  test.describe(`the route crawl at ${name}`, () => {
    test.use(use);

    for (const route of rows) {
      test(`${route.path} answers ${route.status} (${route.why}) with metadata, no errors, no overflow`, async ({ page, baseURL }) => {
        const documentUrl = new URL(route.path, baseURL).toString();
        const problems = collectProblems(page, () => documentUrl);
        const response = await page.goto(route.path);
        const status = response?.status() ?? 0;

        expect(status, "status").toBe(route.status);
        expect(response?.headers()["content-type"], "content type").toContain("text/html");

        // Metadata a person or a crawler reads.
        const title = await page.title();
        expect(title.trim(), "title").not.toBe("");
        expect(title, "title is not a framework default").not.toMatch(/create next app|untitled|localhost/i);
        expect(await page.locator("html").getAttribute("lang"), "html lang").toMatch(/^[a-z]{2}/);
        await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
        const description = await page.locator('meta[name="description"]').getAttribute("content");
        expect((description ?? "").trim().length, "meta description").toBeGreaterThan(20);
        if (route.noindex) await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
        if (route.path === "/" || route.path === "/privacy" || route.path === "/terms") {
          await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        }
        if (status === 404) {
          await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE })).toBeVisible();
        }
        await expect(page.getByRole("main")).toHaveCount(1);

        await scrollThrough(page);
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          wide: Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.right > document.documentElement.clientWidth + 1 && getComputedStyle(element).position !== "fixed" && !element.closest("[aria-hidden='true'], [inert], .overflow-x-clip, [data-bay-layer]");
            })
            .slice(0, 5)
            .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`),
        }));
        expect(overflow.page, `horizontal overflow (wide elements: ${overflow.wide.join(", ") || "none"})`).toBeLessThanOrEqual(0);
        expect(problems, "console errors, uncaught exceptions and failed requests").toEqual([]);
      });
    }
  });
}

test.describe("the links on every page", () => {
  for (const route of rows.filter((entry) => entry.status === 200 && !entry.noindex)) {
    test(`${route.path}: every same-origin link answers below 400, every in-page anchor has its target, external links are safe`, async ({ page, request, baseURL }) => {
      await page.goto(route.path);
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => ({
          href: anchor.getAttribute("href") ?? "",
          resolved: anchor.href,
          target: anchor.target,
          rel: anchor.rel,
          text: (anchor.textContent ?? "").trim() || anchor.getAttribute("aria-label") || "",
        })),
      );
      expect(links.length, "a page with no links").toBeGreaterThan(0);
      const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
      const checked = new Set<string>();
      for (const link of links) {
        if (/^(?:mailto|tel):/i.test(link.href)) continue;
        const url = new URL(link.resolved);
        if (url.origin !== origin) {
          expect(url.protocol, `external link ${link.href} uses https`).toBe("https:");
          if (link.target === "_blank") expect(link.rel, `external link ${link.href} opens a tab safely`).toMatch(/noopener/);
          continue;
        }
        url.hash = "";
        if (!checked.has(url.toString())) {
          checked.add(url.toString());
          const answer = await request.get(url.toString(), { maxRedirects: 5 });
          if (DELIBERATE_404_LINK_TARGETS.includes(url.pathname)) expect(answer.status(), link.href).toBe(404);
          else expect(answer.status(), `link "${link.text}" -> ${link.href}`).toBeLessThan(400);
        }
        if (link.href.includes("#") && link.href.split("#")[1]) {
          const id = decodeURIComponent(link.href.split("#")[1]!);
          const samePage = link.href.startsWith("#") || url.pathname === new URL(page.url()).pathname;
          if (samePage) await expect(page.locator(`[id="${id}"]`), `anchor #${id} has a target on ${route.path}`).toHaveCount(1);
        }
      }
    });
  }
});

test.describe("the non-HTML routes", () => {
  for (const route of FILE_ROUTES) {
    test(`${route.path} answers ${route.status} (${route.why})`, async ({ request }) => {
      const response = await request.get(route.path);
      expect(response.status()).toBe(route.status);
      expect(response.headers()["content-type"]).toMatch(route.type);
      expect((await response.body()).length, "empty body").toBeGreaterThan(0);
    });
  }

  test("sitemap.xml is a well-formed urlset (empty until a production URL is verified) of absolute URLs with no gated or private route", async ({ request }) => {
    const text = await (await request.get("/sitemap.xml")).text();
    expect(text).toMatch(/<urlset[\s>]/);
    const locs = Array.from(text.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]!);
    // With no verified production URL (this keyless server) the site is not indexable and the sitemap is an empty urlset (spec §14).
    for (const loc of locs) expect(() => new URL(loc), loc).not.toThrow();
    expect(text).not.toMatch(/\/admin|\/api\/|thank-you/);
  });

  test("manifest.webmanifest names the app and lists icons that exist", async ({ request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as { name?: string; icons?: Array<{ src: string }> };
    expect((manifest.name ?? "").length).toBeGreaterThan(0);
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  });

  test("opengraph-image is a PNG of the standard social size", async ({ request }) => {
    const body = await (await request.get("/opengraph-image")).body();
    expect(body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect({ width: body.readUInt32BE(16), height: body.readUInt32BE(20) }).toEqual({ width: 1200, height: 630 });
  });

  test("icon.svg is an SVG document", async ({ request }) => {
    expect(await (await request.get("/icon.svg")).text()).toMatch(/<svg[\s>]/);
  });

  test("robots.txt is plain rules: user-agent groups, no HTML", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    expect(text).toMatch(/^User-agent:/im);
    expect(text).not.toMatch(/<html|<!doctype/i);
  });
});

/*
 * Spec §17 criteria 10 and 11 and §3 rulings 1, 3 and 6, read off the pages as a visitor sees them:
 * no unsupported social proof, no pressure, no invented social profiles, and legal pages that are
 * either reviewed or kept out of search with the review blocker said plainly.
 */
test.describe("what the pages claim", () => {
  const visibleText = (page: Page) => page.evaluate(() => document.body.innerText);

  test("the landing page carries no unsupported social proof, scarcity or pressure", async ({ page }) => {
    await page.goto("/");
    const text = await visibleText(page);
    expect(text, "invented counts").not.toMatch(/\b\d[\d,.]*\+?\s*(?:families|parents|moms|mums|kids|children|subscribers|members|reviews|five-star)\b/i);
    expect(text, "ratings, awards and endorsements").not.toMatch(/★|\b\d(?:\.\d)?\s*\/\s*5\b|award[- ]winning|as seen (?:on|in)|featured (?:on|in)|experts? (?:approved|endorsed|recommended)|doctor[- ]approved|clinically proven/i);
    expect(text, "scarcity and pressure").not.toMatch(/\bonly \d+ (?:left|spots)\b|limited[- ]time|hurry|last chance|don'?t miss out|sells? out|act now/i);
    await expect(page.locator("section#testimonials")).toHaveCount(0);
  });

  test("outbound links go only to the verified YouTube channel and its videos, never to an invented social profile", async ({ page }) => {
    await page.goto("/");
    const hosts = await page.locator("a[href^='http']").evaluateAll((anchors) => Array.from(new Set(anchors.map((anchor) => new URL((anchor as HTMLAnchorElement).href).hostname))));
    expect(hosts.sort()).toEqual(["www.youtube.com"]);
  });

  for (const legal of ["/privacy", "/terms"]) {
    test(`${legal} is either reviewed or noindex with the missing review stated on the page`, async ({ page }) => {
      await page.goto(legal);
      const text = await visibleText(page);
      expect(text, "placeholder text").not.toMatch(/lorem ipsum|\bTODO\b|\bTBD\b|\[(?:company|address|email|date)[^\]]*\]|coming soon|placeholder/i);
      const robots = (await page.locator('meta[name="robots"]').getAttribute("content")) ?? "";
      if (!/noindex/.test(robots)) expect(text, "an indexable legal page must not admit it is unreviewed").not.toMatch(/not yet been reviewed/i);
      else expect(text, "a noindex legal page says why").toMatch(/not yet been reviewed by a lawyer/i);
    });
  }

  test("the thank-you page never claims an email was sent or delivered", async ({ page }) => {
    await page.goto("/thank-you");
    expect(await visibleText(page)).not.toMatch(/(?:we(?:'ve| have)|has been|was) (?:sent|emailed|delivered)|check your (?:inbox|email)|on its way|attached|download link (?:has|is)/i);
  });

  test("no public page is indexable while the production URL is unverified, and none declares a canonical", async ({ page, baseURL }) => {
    test.skip(!/^https?:\/\/(?:127\.0\.0\.1|localhost)[:/]/.test(baseURL ?? ""), "a deployed URL may be verified and indexable");
    for (const path of ["/", "/privacy", "/terms", "/thank-you"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]'), path).toHaveCount(0);
    }
  });
});
