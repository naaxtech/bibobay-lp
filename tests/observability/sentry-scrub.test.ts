import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { hasSpansEnabled } from "@sentry/core";

import { scrubBreadcrumb, scrubEvent, sentryOptions, tracesSampleRateFor, type Integration, type TransactionEvent } from "@/lib/observability/sentry-config";

/*
 * Task 10M, binding privacy rule 4: Sentry gets error reports only. `beforeSend` strips request
 * bodies, cookies, every header but the user agent, query strings and anything shaped like an email
 * address; no Replay; `sendDefaultPii: false`; traces sampled at 0.1 in production, 1.0 in preview.
 */

const DSN = "https://publickey@o0.ingest.example.com/1";
const ADDRESS = "parent@example.com";
/** A whole founding-family signup, as the form posts it: none of it may reach Sentry. */
const LEAD_PAYLOAD = {
  email: ADDRESS,
  firstName: "Ana",
  ageBand: "6-8",
  consent: true,
  locale: "en-GB",
  utm: { source: "newsletter", campaign: "spring" },
  website: "",
};

function errorEvent(edit: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    event_id: "0123456789abcdef0123456789abcdef",
    message: `Lead for ${ADDRESS} failed`,
    logentry: { message: `could not save ${ADDRESS}` },
    exception: { values: [{ type: "Error", value: `duplicate key for ${ADDRESS}` }] },
    request: {
      url: "https://bibo.example/api/leads?email=parent%40example.com&utm_source=x#top",
      method: "POST",
      data: JSON.stringify(LEAD_PAYLOAD),
      query_string: "email=parent%40example.com",
      cookies: { __prerender_bypass: "cookie-value" },
      headers: {
        "User-Agent": "Mozilla/5.0 (fixture)",
        Cookie: "__prerender_bypass=cookie-value",
        Referer: "https://bibo.example/?email=parent%40example.com",
        "X-Forwarded-For": "203.0.113.9",
        Authorization: "Bearer fixture",
      },
      env: { REMOTE_ADDR: "203.0.113.9" },
    },
    user: { email: ADDRESS, ip_address: "203.0.113.9", username: "Ana" },
    extra: { lead: LEAD_PAYLOAD, note: `reply to ${ADDRESS}` },
    tags: { area: "leads", reporter: ADDRESS },
    contexts: { nextjs: { request_path: "/api/leads?email=parent%40example.com", note: ADDRESS } },
    breadcrumbs: [
      { category: "console", level: "info", message: `submitting ${ADDRESS}` },
      { category: "fetch", type: "http", data: { url: "https://bibo.example/api/leads?email=parent%40example.com", method: "POST", status_code: 500 } },
      { category: "navigation", data: { from: "/?utm_source=a", to: "/thank-you?email=parent%40example.com" } },
    ],
    ...edit,
  };
}

describe("Sentry event scrubbing (beforeSend)", () => {
  it("keeps only the method, the url without its query and the user agent of the request", () => {
    const scrubbed = scrubEvent(errorEvent());
    expect(scrubbed.request).toEqual({
      url: "https://bibo.example/api/leads",
      method: "POST",
      headers: { "User-Agent": "Mozilla/5.0 (fixture)" },
    });
  });

  it("drops the user, every extra value and every email-shaped string in messages, exceptions, tags and contexts", () => {
    const scrubbed = scrubEvent(errorEvent());
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.message).toBe("Lead for [email] failed");
    expect(scrubbed.logentry?.message).toBe("could not save [email]");
    expect(scrubbed.exception?.values?.[0]?.value).toBe("duplicate key for [email]");
    expect(scrubbed.tags).toEqual({ area: "leads", reporter: "[email]" });
    expect(scrubbed.contexts?.nextjs).toEqual({ request_path: "/api/leads", note: "[email]" });
  });

  it("scrubs breadcrumbs: no email in messages, no query string in urls", () => {
    const [consoleCrumb, fetchCrumb, navigationCrumb] = scrubEvent(errorEvent()).breadcrumbs ?? [];
    expect(consoleCrumb).toEqual({ category: "console", level: "info", message: "submitting [email]" });
    expect(fetchCrumb?.data).toEqual({ url: "https://bibo.example/api/leads", method: "POST", status_code: 500 });
    expect(navigationCrumb?.data).toEqual({ from: "/", to: "/thank-you" });
  });

  it("lets no part of a founding-family signup through, whichever field carries it", () => {
    const serialized = JSON.stringify(scrubEvent(errorEvent()));
    for (const value of [ADDRESS, "parent%40example.com", "Ana", "6-8", "newsletter", "spring", "203.0.113.9", "cookie-value", "Bearer fixture"]) {
      expect(serialized, value).not.toContain(value);
    }
  });

  it("scrubs a breadcrumb on its own the same way (beforeBreadcrumb)", () => {
    const crumb: Breadcrumb = { category: "ui.click", message: `button for ${ADDRESS}`, data: { url: "/privacy?ref=mail" } };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: "ui.click", message: "button for [email]", data: { url: "/privacy" } });
  });

  it("scrubs performance events too: no query strings in the transaction name or span urls", () => {
    const transaction: TransactionEvent = {
      type: "transaction",
      transaction: "/thank-you?email=parent%40example.com",
      request: { url: "https://bibo.example/thank-you?email=parent%40example.com", headers: { "user-agent": "fixture", referer: "https://bibo.example/?a=b" } },
      spans: [
        {
          span_id: "0123456789abcdef",
          trace_id: "0123456789abcdef0123456789abcdef",
          start_timestamp: 1,
          status: "ok",
          data: { "url.full": "https://bibo.example/api/leads?email=parent%40example.com", "http.query": "?email=parent%40example.com", "http.method": "POST" },
        },
      ],
    };
    const scrubbed = scrubEvent(transaction);
    expect(scrubbed.transaction).toBe("/thank-you");
    expect(scrubbed.request).toEqual({ url: "https://bibo.example/thank-you", headers: { "user-agent": "fixture" } });
    expect(scrubbed.spans?.[0]?.data).toEqual({ "url.full": "https://bibo.example/api/leads", "http.method": "POST" });
  });
});

/*
 * Task 7b: the private order page (/orders/<token>, Task 7c) carries its tracking token in the path.
 * Request URLs, transaction names, breadcrumbs (and every other string the scrubber cleans) carry
 * /orders/[token] instead.
 */
describe("private order links (Task 7b)", () => {
  const TOKEN = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";

  it("masks the token in the request URL, the transaction, breadcrumbs, messages, tags and contexts", () => {
    const scrubbed = scrubEvent(errorEvent({
      message: `Could not render /orders/${TOKEN}`,
      exception: { values: [{ type: "Error", value: `lookup failed for https://bibo.example/orders/${TOKEN}` }] },
      transaction: `/orders/${TOKEN}`,
      request: { url: `https://bibo.example/orders/${TOKEN}?from=email`, method: "GET", headers: { "user-agent": "fixture", referer: `https://bibo.example/orders/${TOKEN}` } },
      tags: { url: `https://bibo.example/orders/${TOKEN}` },
      contexts: { nextjs: { request_path: `/orders/${TOKEN}` } },
      breadcrumbs: [
        { category: "navigation", data: { from: "/shop", to: `/orders/${TOKEN}` } },
        { category: "fetch", type: "http", data: { url: `https://bibo.example/orders/${TOKEN}`, method: "GET" } },
        { category: "console", message: `opened /orders/${TOKEN}` },
      ],
    }));
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.request).toEqual({ url: "https://bibo.example/orders/[token]", method: "GET", headers: { "user-agent": "fixture" } });
    expect(scrubbed.transaction).toBe("/orders/[token]");
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({ from: "/shop", to: "/orders/[token]" });
    expect(scrubbed.breadcrumbs?.[1]?.data?.url).toBe("https://bibo.example/orders/[token]");
    expect(scrubbed.breadcrumbs?.[2]?.message).toBe("opened /orders/[token]");
    expect(scrubbed.message).toBe("Could not render /orders/[token]");
  });

  it("masks it in performance events and in a breadcrumb on its own", () => {
    const transaction: TransactionEvent = {
      type: "transaction",
      transaction: `GET /orders/${TOKEN}`,
      spans: [{ span_id: "0123456789abcdef", trace_id: "0123456789abcdef0123456789abcdef", start_timestamp: 1, status: "ok", description: `GET /orders/${TOKEN}`, data: { "url.full": `https://bibo.example/orders/${TOKEN}` } }],
    };
    const scrubbed = scrubEvent(transaction);
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.transaction).toBe("GET /orders/[token]");
    expect(scrubbed.spans?.[0]?.description).toBe("GET /orders/[token]");
    expect(scrubBreadcrumb({ category: "navigation", data: { to: `/orders/${TOKEN}` } }).data).toEqual({ to: "/orders/[token]" });
  });

  it("leaves the order API's own paths alone", () => {
    const scrubbed = scrubEvent(errorEvent({ request: { url: "https://bibo.example/api/orders/track", method: "POST" }, transaction: "POST /api/orders/track" }));
    expect(scrubbed.request?.url).toBe("https://bibo.example/api/orders/track");
    expect(scrubbed.transaction).toBe("POST /api/orders/track");
  });
});

describe("shared Sentry options", () => {
  it("sends no default personal data and runs every event, transaction and breadcrumb through the scrubber", () => {
    const options = sentryOptions({ dsn: DSN, environment: "production" });
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.environment).toBe("production");
    const event = errorEvent();
    expect(options.beforeSend?.(event)).toEqual(scrubEvent(errorEvent()));
    expect(options.beforeBreadcrumb?.({ message: ADDRESS })).toEqual({ message: "[email]" });
    // No beforeSendTransaction: see "sets no beforeSendTransaction" below (re-review 3).
  });

  it("keeps the old trace rates on record, unused (ruling R86)", () => {
    expect(tracesSampleRateFor("production")).toBe(0.1);
    expect(tracesSampleRateFor("preview")).toBe(1);
  });

  // Ruling R86 (Task 7b re-review): SDK 11 streams traces as spans and never runs
  // beforeSendTransaction on them, so a trace carried URLs with their query and private order
  // tokens. Error reports are all this site needs: tracing is off.
  it("sends error reports only: tracing is off in every environment", () => {
    for (const environment of ["production", "preview", "development"]) {
      const options = sentryOptions({ dsn: DSN, environment });
      // null, not absent (re-review 2 N2): absent lets the server and edge SDKs read
      // SENTRY_TRACES_SAMPLE_RATE; 0 would let a visitor's sentry-trace header turn sampling on.
      expect(options.tracesSampleRate).toBeNull();
      expect(options).not.toHaveProperty("tracesSampler");
      expect(hasSpansEnabled(options as Parameters<typeof hasSpansEnabled>[0])).toBe(false);
    }
  });

  // SDK 11 has no sendDefaultPii: what it collects is set by dataCollection, which defaults to
  // everything (headers, bodies, query strings, user info, local variables in stack frames).
  it("collects the least data SDK 11 allows", () => {
    expect(sentryOptions({ dsn: DSN, environment: "production" }).dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("never adds session replay, even if a default set offered it", () => {
    const options = sentryOptions({ dsn: DSN, environment: "production" });
    const offered = [{ name: "Replay" }, { name: "ReplayCanvas" }, { name: "BrowserTracing" }, { name: "Dedupe" }] as Integration[];
    const integrations = options.integrations as (defaults: Integration[]) => Integration[];
    // Ruling R86: no browser tracing either.
    expect(integrations(offered).map((integration) => integration.name)).toEqual(["Dedupe"]);
  });

  // Re-review 2 N1: with a release (every Vercel build has one) the SDK sends a session per page
  // load in the browser and session counts from the server. Error reports only: neither.
  it("sends no sessions: no browser or process session integration, and the server's Http integration without sessions", () => {
    const made: Array<{ sessions: boolean }> = [];
    const options = sentryOptions({
      dsn: DSN,
      environment: "production",
      makeHttpIntegration: (settings) => {
        made.push(settings);
        return { name: "Http" };
      },
    });
    const offered = [{ name: "BrowserSession" }, { name: "ProcessSession" }, { name: "Http" }, { name: "Dedupe" }] as Integration[];
    const integrations = options.integrations as (defaults: Integration[]) => Integration[];
    const kept = integrations(offered);
    expect(kept.map((integration) => integration.name)).toEqual(["Http", "Dedupe"]);
    expect(kept[0]).not.toBe(offered[2]);
    expect(made).toEqual([{ sessions: false }]);
  });

  it("keeps the browser's own integrations as they are when no Http factory is given", () => {
    const integrations = sentryOptions({ dsn: DSN, environment: "production" }).integrations as (defaults: Integration[]) => Integration[];
    const offered = [{ name: "Http" }, { name: "Dedupe" }] as Integration[];
    expect(integrations(offered)).toEqual(offered);
  });
});

/*
 * Task 7b review Important 1: a server transaction keeps its root span's attributes in
 * contexts.trace.data, where Next sets http.target to the request URL. Every level is cleaned.
 */
describe("private order links in transaction trace data (Task 7b review)", () => {
  const TOKEN = "tok_SECRET123abcdef";

  it("masks the token and drops the query at every depth of contexts and span data", () => {
    const transaction = {
      type: "transaction" as const,
      transaction: `GET /orders/${TOKEN}`,
      contexts: {
        trace: {
          trace_id: "0123456789abcdef0123456789abcdef",
          span_id: "0123456789abcdef",
          op: "http.server",
          data: {
            "http.target": `/orders/${TOKEN}?x=1`,
            "url.full": `https://bibo.example/orders/${TOKEN}?x=1`,
            "http.query": "x=1",
            "url.query": "?x=1",
            "next.route": "/orders/[token]",
            nested: { deeper: { path: `/orders/${TOKEN}`, list: [`/orders/${TOKEN}?x=1`] } },
          },
        },
      },
      spans: [
        {
          span_id: "1",
          trace_id: "0123456789abcdef0123456789abcdef",
          start_timestamp: 1,
          description: `render /orders/${TOKEN}`,
          data: { "http.target": `/orders/${TOKEN}?x=1`, "url.query": "?x=1", attributes: { route: `/orders/${TOKEN}` } },
        },
      ],
    };
    const scrubbed = scrubEvent(transaction as unknown as Parameters<typeof scrubEvent>[0]);
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("x=1");
    const data = (scrubbed.contexts?.trace as { data: Record<string, unknown> }).data;
    expect(data["http.target"]).toBe("/orders/[token]");
    expect(data["url.full"]).toBe("https://bibo.example/orders/[token]");
    expect(data["next.route"]).toBe("/orders/[token]");
    expect(data).not.toHaveProperty("http.query");
    expect(data).not.toHaveProperty("url.query");
    expect(scrubbed.transaction).toBe("GET /orders/[token]");
  });

  it("stops at a depth limit rather than walking a cycle", () => {
    const loop: Record<string, unknown> = { path: `/orders/${TOKEN}` };
    loop.self = loop;
    const scrubbed = scrubEvent({ contexts: { custom: loop } } as unknown as Parameters<typeof scrubEvent>[0]);
    expect(JSON.stringify(scrubbed.contexts?.custom, (key, value) => (key === "self" && typeof value === "object" ? "[cut]" : value))).not.toContain(TOKEN);
  });
});

describe("what else the scrubber removes (Task 7b re-review)", () => {
  it("drops local variable values from every stack frame", () => {
    const scrubbed = scrubEvent(errorEvent({
      exception: { values: [{ type: "Error", value: "boom", stacktrace: { frames: [{ function: "submit", vars: { email: "parent@example.com", city: "Cebu" }, lineno: 3 }] } }] },
    }));
    const frame = scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).not.toHaveProperty("vars");
    expect(frame?.function).toBe("submit");
    expect(JSON.stringify(scrubbed)).not.toContain("parent@example.com");
  });

  it("keeps an Error in breadcrumb data as its cleaned message, not an empty object", () => {
    const crumb = scrubBreadcrumb({ category: "console", data: { arguments: [new Error("lookup failed for parent@example.com")] } });
    expect(crumb.data?.arguments).toEqual(["Error: lookup failed for [email]"]);
  });

  it("removes a query string from the middle of free text", () => {
    const scrubbed = scrubEvent(errorEvent({ message: "Could not fetch /api/x?email=parent%40example.com then gave up; GET https://bibo.example/shop?utm_source=news ok" }));
    expect(scrubbed.message).toBe("Could not fetch /api/x then gave up; GET https://bibo.example/shop ok");
  });

  it("cuts very long strings before masking them, so a huge value cannot stall the page", () => {
    const crumb = scrubBreadcrumb({ message: `${"word ".repeat(40_000)}end` });
    expect(crumb.message!.length).toBeLessThanOrEqual(2_001);
  });
});

describe("the fields that skipped the cap (re-review 2 N3, N4)", () => {
  it("cuts and masks the request URL, the transaction name and span descriptions too", () => {
    const long = `/x/${"word-".repeat(4_000)}parent@example.com`;
    const scrubbed = scrubEvent({
      request: { url: `https://bibo.example${long}?q=1`, method: "GET" },
      transaction: `GET ${long}`,
      spans: [{ span_id: "1", trace_id: "0123456789abcdef0123456789abcdef", start_timestamp: 1, description: `render ${long}` }],
    } as unknown as Parameters<typeof scrubEvent>[0]);
    for (const text of [scrubbed.request?.url, scrubbed.transaction, scrubbed.spans?.[0]?.description]) {
      expect(text!.length).toBeLessThanOrEqual(2_001);
      expect(text).not.toContain("parent@example.com");
    }
  });

  it("does not throw on a value whose text form throws, and sends a placeholder", () => {
    class Unprintable {
      toString(): string {
        throw new Error("no text form");
      }
    }
    const crumb = scrubBreadcrumb({ category: "console", data: { arguments: [new Unprintable()] } });
    expect(crumb.data?.arguments).toEqual(["[unprintable]"]);
  });
});

describe("re-review 3 follow-ups", () => {
  it("masks a percent-encoded email address in a URL path", () => {
    const scrubbed = scrubEvent(errorEvent({ request: { url: "https://bibo.example/u/parent%40example.com/x", method: "GET" }, message: "failed for /u/parent%2540example.com" }));
    expect(JSON.stringify(scrubbed)).not.toMatch(/parent(%40|%2540|@)example\.com/);
  });

  // SDK 11 warns at every start that beforeSendTransaction is ignored (span streaming), and tracing
  // is off: the option is not set. scrubEvent stays the function to wire with traceLifecycle "static".
  it("sets no beforeSendTransaction, which SDK 11 only warns about", () => {
    expect(sentryOptions({ dsn: DSN, environment: "production" })).not.toHaveProperty("beforeSendTransaction");
  });
});
