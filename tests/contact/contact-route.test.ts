import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/contact/route";
import { clientKeyFromHeaders } from "@/lib/leads/http";

vi.mock("server-only", () => ({}));

/** Every RPC the route makes, in order, through the mocked Supabase client. */
const { rpcCalls, rpcAnswers, createClient } = vi.hoisted(() => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpcAnswers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }> = {};
  const createClient = vi.fn((url: string, key: string, options: unknown) => {
    void url; void key; void options;
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push([fn, args]);
        const answer = rpcAnswers[fn];
        return Promise.resolve(answer ? answer(args) : { data: null, error: { code: "42883", message: "missing" } });
      },
    };
  });
  return { rpcCalls, rpcAnswers, createClient };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));

/** Work the route hands to `after()`: it runs once the response is sent, so tests run it by hand. */
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => unknown> }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

/** Sentry is reached only through lib/observability/report. */
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/observability/report", () => ({ reportError, reportEvent: vi.fn() }));

/** The Resend SDK, so no test can reach the real API. */
const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const MESSAGE_ID = "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11";
const DELIVERY_ID = "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f";
const CLIENT_IP = "203.0.113.9";
const HASH_SECRET = "fixture-hash-secret-0123456789abcdef";
const STAFF = "staff@bibobay.example";
const VALID = { name: "Ada", email: "Ada@Example.com", topic: "partnerships", message: "Hello from a parent.", website: "" };

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
  vi.stubEnv("LEAD_IP_HASH_SECRET", HASH_SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_fixture_only");
  vi.stubEnv("RESEND_FROM", "BIBO Bay <hello@bibobay.example>");
  vi.stubEnv("STAFF_NOTIFICATION_EMAIL", STAFF);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://127.0.0.1:3000/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const allowed = { allowed: true, remaining: 2, retry_after_seconds: 0 };

beforeEach(() => {
  rpcCalls.length = 0;
  afterTasks.length = 0;
  reportError.mockReset();
  resendSend.mockReset();
  resendSend.mockResolvedValue({ data: { id: "re_contact_1" }, error: null, headers: null });
  for (const key of Object.keys(rpcAnswers)) delete rpcAnswers[key];
  rpcAnswers.consume_rate_limit = () => ({ data: [allowed], error: null });
  rpcAnswers.submit_contact_message = () => ({ data: [{ message_id: MESSAGE_ID, delivery_id: DELIVERY_ID }], error: null });
  rpcAnswers.claim_contact_deliveries = () => ({
    data: {
      claimed: [{ id: DELIVERY_ID, kind: "contact_staff_alert", attempt: 1, name: "Ada", email: "ada@example.com", topic: "partnerships", message: "Hello from a parent.", receivedAt: "2026-10-21T09:30:12.345+00:00" }],
      skipped: 0,
      expired: 0,
    },
    error: null,
  });
  rpcAnswers.record_contact_delivery_attempt = () => ({ data: true, error: null });
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET", "LEAD_ACK_SEND_LIMIT_PER_HOUR", "RESEND_API_KEY", "RESEND_FROM", "RESEND_REPLY_TO", "STAFF_NOTIFICATION_EMAIL"]) vi.stubEnv(name, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/contact request handling", () => {
  it("accepts JSON only", async () => {
    configure();
    const response = await post("name=Ada", { "content-type": "application/x-www-form-urlencoded" });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "The message could not be saved. Please try again." });
  });

  it("answers 413 for a declared body above 32 KB and for a streamed one", async () => {
    configure();
    const declared = await post(VALID, { "content-length": String(32 * 1024 + 1) });
    expect(declared.status).toBe(413);
    const streamed = await post(JSON.stringify({ ...VALID, message: "a".repeat(32 * 1024 + 1) }));
    expect(streamed.status).toBe(413);
    expect(rpcCalls).toEqual([]);
  });

  it("answers 400 for a body that is not JSON", async () => {
    configure();
    expect((await post("{not json")).status).toBe(400);
  });

  it("answers the generic 400 for a filled honeypot and stores nothing", async () => {
    configure();
    const response = await post({ ...VALID, website: "http://spam.example" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "The message could not be saved. Please try again." });
    expect(rpcCalls).toEqual([]);
  });

  it("answers 400 with field errors", async () => {
    configure();
    const response = await post({ name: "", email: "nope", topic: "other", message: "short" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      persisted: false,
      message: "Please check the highlighted fields and try again.",
      fieldErrors: { name: "required", email: "invalid", topic: "invalid", message: "too_short" },
    });
  });
});

describe("POST /api/contact storing a message", () => {
  it("makes exactly these RPC calls in this order, and sends one alert to the staff address", async () => {
    configure();
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, persisted: true, message: "Message received." });
    expect(response.headers.get("cache-control")).toBe("no-store");

    const clientKey = clientKeyFromHeaders(new Headers({ "x-forwarded-for": CLIENT_IP }), HASH_SECRET);
    expect(rpcCalls.map(([fn, args]) => [fn, args.bucket_key ?? null])).toEqual([
      ["consume_rate_limit", `contact:${clientKey}`],
      ["consume_rate_limit", "contact:global"],
      ["submit_contact_message", null],
    ]);
    expect(rpcCalls[2]![1]).toEqual({ p_name: "Ada", p_email: "ada@example.com", p_topic: "partnerships", p_message: "Hello from a parent." });
    expect(resendSend).not.toHaveBeenCalled();

    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(rpcCalls.slice(3).map(([fn, args]) => [fn, args.bucket_key ?? null])).toEqual([
      ["claim_contact_deliveries", null],
      ["consume_rate_limit", "send:contact_staff_alert"],
      ["record_contact_delivery_attempt", null],
    ]);
    expect(rpcCalls[3]![1]).toEqual({ p_limit: 1, p_message_id: MESSAGE_ID });
    expect(rpcCalls[5]![1]).toMatchObject({ p_delivery_id: DELIVERY_ID, p_status: "sent", p_provider_message_id: "re_contact_1" });
    expect(resendSend).toHaveBeenCalledTimes(1);
    const [payload, options] = resendSend.mock.calls[0]!;
    expect(payload).toMatchObject({ to: [STAFF], replyTo: "ada@example.com", subject: "New BIBO Bay message: Partnerships" });
    expect(options).toMatchObject({ idempotencyKey: `contact-delivery/${DELIVERY_ID}` });
  });

  it("shares one contact bucket between two IPv6 addresses in one /64 (R203)", async () => {
    configure();
    await post(VALID, { "x-forwarded-for": "2001:db8:1:2:aaaa::1" });
    await post(VALID, { "x-forwarded-for": "2001:db8:1:2:bbbb::9" });
    const buckets = rpcCalls.filter(([fn, args]) => fn === "consume_rate_limit" && args.bucket_key !== "contact:global").map(([, args]) => args.bucket_key);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toBe(buckets[1]);
  });

  it("applies 3 per 10 minutes per client, and overall the alert's own hourly send cap (60 by default; R212)", async () => {
    configure();
    await post(VALID);
    const limits = rpcCalls.filter(([fn]) => fn === "consume_rate_limit").map(([, args]) => [args.max_hits, args.window_seconds]);
    expect(limits).toEqual([[3, 600], [60, 3600]]);
  });

  it("takes the overall limit from LEAD_ACK_SEND_LIMIT_PER_HOUR, the same number and window as the alert's send budget (R212)", async () => {
    configure();
    vi.stubEnv("LEAD_ACK_SEND_LIMIT_PER_HOUR", "25");
    await post(VALID);
    await afterTasks[0]!();
    const limits = rpcCalls.filter(([fn]) => fn === "consume_rate_limit").map(([, args]) => [args.bucket_key, args.max_hits, args.window_seconds]);
    expect(limits).toEqual([
      [expect.stringMatching(/^contact:[0-9a-f]{64}$/), 3, 600],
      ["contact:global", 25, 3600],
      ["send:contact_staff_alert", 25, 3600],
    ]);
  });

  it("answers 429 with retry-after when a limit is spent, with no-store", async () => {
    configure();
    rpcAnswers.consume_rate_limit = () => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 421 }], error: null });
    const response = await post(VALID);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("421");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpcCalls.map(([fn]) => fn)).toEqual(["consume_rate_limit"]);
  });

  it("answers 500 when the write fails, and sends nothing", async () => {
    configure();
    rpcAnswers.submit_contact_message = () => ({ data: null, error: { code: "22023", message: "message too short Ada" } });
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "The message could not be saved. Please try again." });
    expect(afterTasks).toEqual([]);
  });

  it("answers 503 when the limiter fails, without saying closed", async () => {
    configure();
    rpcAnswers.consume_rate_limit = () => ({ data: null, error: { code: "57P01", message: "down" } });
    const response = await post(VALID);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "The message could not be saved. Please try again." });
  });
});

describe("POST /api/contact while the form is closed (R205)", () => {
  const CLOSED = { ok: false, persisted: false, closed: true, message: "The contact form is not open, so nothing was saved." };

  it("answers 503 closed while STAFF_NOTIFICATION_EMAIL is unset, though storage and email are configured", async () => {
    configure();
    vi.stubEnv("STAFF_NOTIFICATION_EMAIL", "");
    const response = await post(VALID);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(CLOSED);
    expect(rpcCalls).toEqual([]);
  });

  it("answers 503 closed with a 31-character LEAD_IP_HASH_SECRET", async () => {
    configure();
    vi.stubEnv("LEAD_IP_HASH_SECRET", "x".repeat(31));
    expect(await (await post(VALID)).json()).toEqual(CLOSED);
    expect(rpcCalls).toEqual([]);
  });

  it("answers 503 closed without email sending, and with nothing configured", async () => {
    configure();
    vi.stubEnv("RESEND_API_KEY", "");
    const withoutEmail = await post(VALID);
    expect(withoutEmail.status).toBe(503);
    expect(await withoutEmail.json()).toEqual(CLOSED);
    vi.unstubAllEnvs();
    expect(await (await post(VALID)).json()).toEqual(CLOSED);
    expect(rpcCalls).toEqual([]);
  });
});

describe("POST /api/contact failure and privacy", () => {
  it("an unexpected throw answers 500 and is reported under area contact", async () => {
    configure();
    createClient.mockImplementationOnce(() => {
      throw new Error("bad key sb_secret_fixture_only");
    });
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "The message could not be saved. Please try again." });
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { area: "contact", event: "contact_route_failed" });
  });

  it("never writes the name, the address or the message to the log", async () => {
    configure();
    await post({ ...VALID, name: "Zelda Fitzgerald", email: "zelda@private.example", message: "A very private sentence." });
    await afterTasks[0]!();
    rpcAnswers.submit_contact_message = () => ({ data: null, error: { code: "22023", message: "A very private sentence." } });
    await post({ ...VALID, name: "Zelda Fitzgerald", email: "zelda@private.example", message: "A very private sentence." });
    const logged = JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    expect(logged).toContain("contact_stored");
    expect(logged).toContain("contact_store_failed");
    expect(logged).not.toMatch(/Zelda|zelda|private|Fitzgerald/);
  });
});

describe("POST /api/contact bot check", () => {
  it("passes a 403 through with no-store and touches no storage", async () => {
    configure();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    const fetchSpy = vi.fn(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    vi.stubGlobal("fetch", fetchSpy);
    const response = await post({ ...VALID, botCheckToken: "XXXX.DUMMY.TOKEN.XXXX" });
    vi.unstubAllGlobals();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, persisted: false, message: "We couldn't confirm this came from a person. Please try again." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toEqual([]);
  });

  it("with both keys unset a body without a token is stored as before", async () => {
    configure();
    const response = await post(VALID);
    expect(response.status).toBe(200);
  });
});
