import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/leads/route";
import { FORM_COPY } from "@/components/forms/form-copy";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
import { clientKeyFromHeaders } from "@/lib/leads/http";

vi.mock("server-only", () => ({}));

/** Every RPC the route makes, in order, through the mocked Supabase client. */
const { rpcCalls, rpcAnswers, createClient } = vi.hoisted(() => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpcAnswers: Record<string, () => { data: unknown; error: { code?: string; message: string } | null }> = {};
  const createClient = vi.fn((url: string, key: string, options: unknown) => {
    void url; void key; void options;
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push([fn, args]);
        const answer = rpcAnswers[fn];
        return Promise.resolve(answer ? answer() : { data: null, error: { code: "42883", message: "missing" } });
      },
    };
  });
  return { rpcCalls, rpcAnswers, createClient };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const LEAD_ID = "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11";
const EVENT_ID = "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f";
const CLIENT_IP = "203.0.113.9";
const { successMessage, errorMessage } = SAFE_FALLBACK_CONTENT.lead;

function configureSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
  vi.stubEnv("LEAD_IP_HASH_SECRET", "fixture-hash-secret");
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://127.0.0.1:3000/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const VALID = { email: "Parent@Example.com", consent: true, firstName: "Ana", ageBand: "6-8", website: "", source: "landing" };

beforeEach(() => {
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcAnswers)) delete rpcAnswers[key];
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET", "RESEND_API_KEY", "RESEND_FROM", "RESEND_REPLY_TO", "STAFF_NOTIFICATION_EMAIL", "NEXT_PUBLIC_SANITY_PROJECT_ID", "NEXT_PUBLIC_SANITY_DATASET"]) vi.stubEnv(name, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/leads without Supabase", () => {
  it("answers 503 with the CMS error message and claims nothing", async () => {
    const response = await post(VALID);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: errorMessage });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("stays unconfigured while the address-hashing secret is missing", async () => {
    configureSupabase();
    vi.stubEnv("LEAD_IP_HASH_SECRET", "");
    const response = await post(VALID);
    expect(response.status).toBe(503);
    expect(rpcCalls).toEqual([]);
  });

  it("still rejects a honeypot hit with a generic 400", async () => {
    const response = await post({ ...VALID, website: "http://spam.example" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: errorMessage });
  });

  it("returns field errors for an invalid body before anything else", async () => {
    const response = await post({ email: "nope", consent: false });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false, persisted: false, acknowledgementQueued: false,
      message: FORM_COPY.outcome.checkDetails,
      fieldErrors: { email: "invalid", consent: "required" },
    });
  });
});

describe("POST /api/leads request handling", () => {
  it("accepts JSON only", async () => {
    const response = await post("email=parent%40example.com&consent=yes", { "content-type": "application/x-www-form-urlencoded" });
    expect(response.status).toBe(415);
    expect((await response.json()).persisted).toBe(false);
  });

  it("rejects malformed JSON with the CMS error message", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, persisted: false, message: errorMessage });
  });

  it("rejects an oversized body without parsing it", async () => {
    const response = await post({ ...VALID, firstName: "a".repeat(20_000) });
    expect(response.status).toBe(413);
    expect((await response.json()).persisted).toBe(false);
  });
});

describe("POST /api/leads with Supabase configured (mocked)", () => {
  beforeEach(() => {
    configureSupabase();
    rpcAnswers.consume_rate_limit = () => ({ data: [{ allowed: true, remaining: 4, retry_after_seconds: 0 }], error: null });
    rpcAnswers.submit_lead = () => ({ data: [{ lead_id: LEAD_ID, created: true }], error: null });
    rpcAnswers.enqueue_lead_delivery = () => ({ data: [{ event_id: EVENT_ID, status: "pending", created: true }], error: null });
    rpcAnswers.record_lead_delivery_attempt = () => ({ data: true, error: null });
  });

  it("limits, stores and queues the acknowledgement through service-role RPCs, then reports the signup stored", async () => {
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: successMessage });
    expect(rpcCalls.map(([fn]) => fn)).toEqual(["consume_rate_limit", "submit_lead", "enqueue_lead_delivery"]);
    expect(rpcCalls[1]?.[1]).toMatchObject({ p_email: "parent@example.com", p_consent: true, p_consent_version: "1", p_age_band: "6-8" });
    // Resend is not configured, so the outbox row stays pending for the retry worker.
    expect(rpcCalls[2]?.[1]).toEqual({ p_lead_id: LEAD_ID, p_kind: "acknowledgement", p_claim: false });
  });

  it("creates the Supabase client with the server-only key and no browser session", async () => {
    await post(VALID);
    expect(createClient).toHaveBeenCalledWith("https://bibo-test.supabase.co", "sb_secret_fixture_only", expect.objectContaining({
      auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
    }));
  });

  it("never sends the raw IP address to the database", async () => {
    await post(VALID);
    const serialized = JSON.stringify(rpcCalls);
    expect(serialized).not.toContain(CLIENT_IP);
    const bucket = rpcCalls[0]?.[1].bucket_key;
    expect(bucket).toMatch(/^lead:[0-9a-f]{64}$/);
  });

  it("answers 429 with a Retry-After header when the shared limit is spent", async () => {
    rpcAnswers.consume_rate_limit = () => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 321 }], error: null });
    const response = await post(VALID);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: FORM_COPY.outcome.rateLimited });
    expect(rpcCalls.map(([fn]) => fn)).toEqual(["consume_rate_limit"]);
  });

  it("reports the CMS error when the database refuses the write", async () => {
    rpcAnswers.submit_lead = () => ({ data: null, error: { code: "57P01", message: "terminating connection" } });
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: errorMessage });
  });

  it("reports the signup stored even when the outbox write fails afterwards", async () => {
    rpcAnswers.enqueue_lead_delivery = () => ({ data: null, error: { code: "53300", message: "too many connections" } });
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, persisted: true, acknowledgementQueued: false, message: successMessage });
  });
});

describe("client key", () => {
  it("is a keyed hash of the first forwarded address, never the address itself", () => {
    const key = clientKeyFromHeaders(new Headers({ "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1` }), "secret-a");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(CLIENT_IP);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": CLIENT_IP }), "secret-a")).toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-real-ip": CLIENT_IP }), "secret-a")).toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": CLIENT_IP }), "secret-b")).not.toBe(key);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.4" }), "secret-a")).not.toBe(key);
  });
});
