import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

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
    expect(typeof options.beforeSendTransaction).toBe("function");
  });

  it("samples traces at 0.1 in production and 1.0 in preview and development, and the rate is configurable", () => {
    expect(tracesSampleRateFor("production")).toBe(0.1);
    expect(tracesSampleRateFor("preview")).toBe(1);
    expect(tracesSampleRateFor("development")).toBe(1);
    expect(sentryOptions({ dsn: DSN, environment: "production" }).tracesSampleRate).toBe(0.1);
    expect(sentryOptions({ dsn: DSN, environment: "preview" }).tracesSampleRate).toBe(1);
    expect(sentryOptions({ dsn: DSN, environment: "production", tracesSampleRate: 0.25 }).tracesSampleRate).toBe(0.25);
  });

  it("never adds session replay, even if a default set offered it", () => {
    const options = sentryOptions({ dsn: DSN, environment: "production" });
    const offered = [{ name: "Replay" }, { name: "ReplayCanvas" }, { name: "BrowserTracing" }, { name: "Dedupe" }] as Integration[];
    const integrations = options.integrations as (defaults: Integration[]) => Integration[];
    expect(integrations(offered).map((integration) => integration.name)).toEqual(["BrowserTracing", "Dedupe"]);
  });
});
