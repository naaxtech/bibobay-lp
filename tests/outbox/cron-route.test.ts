import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, dynamic, maxDuration, runtime } from "@/app/api/cron/email-outbox/route";

vi.mock("server-only", () => ({}));

/** Every RPC the worker makes, in order, through the mocked Supabase client. */
const { rpcCalls, rpcAnswers, createClient } = vi.hoisted(() => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpcAnswers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }> = {};
  const createClient = vi.fn(() => ({
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args]);
      const answer = rpcAnswers[fn];
      return Promise.resolve(answer ? answer(args) : { data: null, error: { code: "42883", message: "missing" } });
    },
  }));
  return { rpcCalls, rpcAnswers, createClient };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const SECRET = "cron-fixture-secret-0123456789abcdef";
const ORDER_EMAIL_ID = "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71";
const LEAD_EVENT_ID = "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f";

function configure({ secret = SECRET, supabase = true, resend = true } = {}) {
  if (secret) vi.stubEnv("CRON_SECRET", secret);
  if (supabase) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
  }
  if (resend) {
    vi.stubEnv("RESEND_API_KEY", "re_fixture_only");
    vi.stubEnv("RESEND_FROM", "BIBO Bay <hello@bibobay.example>");
  }
}

const get = (authorization?: string) =>
  GET(new Request("http://127.0.0.1:3000/api/cron/email-outbox", { headers: authorization === undefined ? {} : { authorization } }));

/** One due row in each outbox, then nothing. */
function oneDueRowEach() {
  let orderRows = [{ id: ORDER_EMAIL_ID, kind: "acknowledgement", attempt: 2, reference: "BB-1A2B-3C4D", contactName: "Sam Rivers", email: "buyer@example.com", lines: [{ title: "Tula plush", variant: null, pack: null, quantity: 1 }], quote: null }];
  let leadRows = [{ id: LEAD_EVENT_ID, kind: "acknowledgement", attempt: 3, email: "parent@example.com", firstName: "Ana", ageBand: "6-8", source: "landing" }];
  // Each claim hands out the due rows of the kinds it names (fix wave D-I1: the worker claims kind by kind).
  rpcAnswers.claim_order_emails = (args) => {
    const claimed = orderRows.filter((row) => (args.p_kinds as string[]).includes(row.kind));
    orderRows = orderRows.filter((row) => !claimed.includes(row));
    return { data: { claimed, skipped: 0, expired: 0 }, error: null };
  };
  rpcAnswers.claim_lead_deliveries = (args) => {
    const claimed = leadRows.filter((row) => (args.p_kinds as string[]).includes(row.kind));
    leadRows = leadRows.filter((row) => !claimed.includes(row));
    return { data: { claimed, skipped: claimed.length > 0 ? 1 : 0, expired: 0 }, error: null };
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcAnswers)) delete rpcAnswers[key];
  resendSend.mockReset();
  resendSend.mockResolvedValue({ data: { id: "re_fixture" }, error: null, headers: null });
  rpcAnswers.consume_rate_limit = () => ({ data: [{ allowed: true, remaining: 10, retry_after_seconds: 0 }], error: null });
  rpcAnswers.record_order_email_attempt = () => ({ data: true, error: null });
  rpcAnswers.record_lead_delivery_attempt = () => ({ data: true, error: null });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/email-outbox", () => {
  it("is dynamic, runs on Node and is bounded to a minute", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });

  it("answers 503 and does nothing without a CRON_SECRET of at least 32 characters", async () => {
    configure({ secret: "" });
    const missing = await get(`Bearer ${SECRET}`);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ ok: false });
    vi.stubEnv("CRON_SECRET", "s".repeat(31));
    expect((await get(`Bearer ${"s".repeat(31)}`)).status).toBe(503);
    expect(rpcCalls).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers a generic 401 to a missing or wrong secret, before saying anything about configuration", async () => {
    configure({ supabase: false, resend: false });
    for (const header of [undefined, "", `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
      const response = await get(header);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(rpcCalls).toEqual([]);
  });

  it("answers 503 to an authorised call while Supabase or Resend is unconfigured, naming neither", async () => {
    for (const missing of [{ supabase: false }, { resend: false }]) {
      vi.unstubAllEnvs();
      configure(missing);
      const response = await get(`Bearer ${SECRET}`);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe(JSON.stringify({ ok: false }));
    }
    expect(rpcCalls).toEqual([]);
  });

  it("drains both outboxes through the shared claims and answers counts only", async () => {
    configure();
    oneDueRowEach();
    const response = await get(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ sent: 2, failed: 0, skipped: 1, deferred: 0 });

    // Fix wave D-I1: one kind per claim, quotes first; no staff alert without a staff address.
    const claims = rpcCalls.filter(([fn]) => fn.startsWith("claim_"));
    expect(claims.map(([fn, args]) => [fn, (args.p_kinds as string[]).join()])).toEqual([
      ["claim_order_emails", "quote"],
      ["claim_order_emails", "acknowledgement"],
      ["claim_order_emails", "acknowledgement"],
      ["claim_lead_deliveries", "acknowledgement"],
      ["claim_lead_deliveries", "acknowledgement"],
    ]);
    expect(claims[0]).toEqual(["claim_order_emails", { p_limit: 1, p_order_id: null, p_kinds: ["quote"] }]);
    expect(claims.find(([fn]) => fn === "claim_lead_deliveries")?.[1]).toEqual({ p_limit: 1, p_lead_id: null, p_kinds: ["acknowledgement"] });
    // R91: the provider idempotency key is the row id, so a retried send cannot be delivered twice.
    expect(resendSend.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([`order-email/${ORDER_EMAIL_ID}`, `lead-delivery/${LEAD_EVENT_ID}`]);
    // R40 + D-I1: every send spends one unit of its own kind's hourly budget.
    expect(rpcCalls.filter(([fn]) => fn === "consume_rate_limit").map(([, args]) => args.bucket_key)).toEqual(["send:order_acknowledgement", "send:lead_acknowledgement"]);
    expect(rpcCalls.filter(([fn]) => fn.startsWith("record_")).map(([fn, args]) => [fn, args.p_status])).toEqual([
      ["record_order_email_attempt", "sent"],
      ["record_lead_delivery_attempt", "sent"],
    ]);
  });

  it("sends nothing past each kind's send budget and hands each capped row back (D-I1)", async () => {
    configure();
    oneDueRowEach();
    rpcAnswers.consume_rate_limit = () => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 600 }], error: null });
    const response = await get(`Bearer ${SECRET}`);
    expect(await response.json()).toEqual({ sent: 0, failed: 0, skipped: 1, deferred: 2 });
    expect(resendSend).not.toHaveBeenCalled();
    expect(rpcCalls.filter(([fn]) => fn.startsWith("record_"))).toEqual([
      ["record_order_email_attempt", { p_email_id: ORDER_EMAIL_ID, p_status: "deferred", p_provider_message_id: null, p_error_code: null }],
      ["record_lead_delivery_attempt", { p_event_id: LEAD_EVENT_ID, p_status: "deferred", p_provider_message_id: null, p_error_code: null }],
    ]);
  });

  it("a spent signup budget never holds up the order emails or a quote (D-I1)", async () => {
    configure();
    oneDueRowEach();
    rpcAnswers.consume_rate_limit = (args) => ({ data: [args.bucket_key === "send:lead_acknowledgement" ? { allowed: false, remaining: 0, retry_after_seconds: 600 } : { allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null });
    const response = await get(`Bearer ${SECRET}`);
    expect(await response.json()).toEqual({ sent: 1, failed: 0, skipped: 1, deferred: 1 });
    expect(resendSend.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([`order-email/${ORDER_EMAIL_ID}`]);
  });

  it("answers a generic 500 when the run itself breaks, and never echoes the cause", async () => {
    configure();
    createClient.mockImplementationOnce(() => {
      throw new Error("bad key sb_secret_fixture_only");
    });
    const response = await get(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ ok: false }));
  });

  it("never writes an address, name or reference to the log", async () => {
    configure();
    oneDueRowEach();
    await get(`Bearer ${SECRET}`);
    const logged = JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    expect(logged).toContain("worker_run");
    expect(logged).not.toMatch(/example\.com|Sam|Rivers|Ana|BB-1A2B|6c1f7f8e|9d7c2a10/);
  });
});
