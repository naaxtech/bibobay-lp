import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BotCheckConfig } from "@/lib/bot-check/config";
import { createTurnstileVerifier, SITEVERIFY_URL } from "@/lib/bot-check/turnstile";

type OnConfig = Extract<BotCheckConfig, { state: "on" }>;

const REAL: OnConfig = {
  state: "on",
  siteKey: "0x4AAAAAAAreal_site-key01",
  secretKey: "0x4AAAAAAAreal_secret-key-0123456789",
  testKeys: false,
  expectedHostname: "www.bibobay.com",
};
const TEST: OnConfig = {
  state: "on",
  siteKey: "1x00000000000000000000AA",
  secretKey: "1x0000000000000000000000000000000AA",
  testKeys: true,
  expectedHostname: "www.bibobay.com",
};

interface Call {
  url: string;
  init: RequestInit;
}

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function fakeFetch(...steps: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)] ?? new Error("no step");
    if (step instanceof Error) throw step;
    return new Response(await step.clone().text(), { status: step.status });
  }) as typeof fetch;
  return { fn, calls };
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

const GOOD = { success: true, hostname: "www.bibobay.com", action: "lead" };

function verifier(config: OnConfig, ...steps: Array<Response | Error>) {
  const f = fakeFetch(...steps);
  let keysIssued = 0;
  return {
    calls: f.calls,
    keysIssued: () => keysIssued,
    v: createTurnstileVerifier(config, { fetch: f.fn, retryDelayMs: 0, idempotencyKey: () => `key-${++keysIssued}` }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("createTurnstileVerifier", () => {
  it("missing token sends nothing", async () => {
    const { v, calls } = verifier(REAL, reply(GOOD));
    expect(await v.verify(undefined, "lead")).toEqual({ outcome: "refused", reason: "missing_token" });
    expect(await v.verify("", "lead")).toEqual({ outcome: "refused", reason: "missing_token" });
    expect(calls).toHaveLength(0);
  });

  it("request shape", async () => {
    const { v, calls } = verifier(REAL, reply(GOOD));
    await v.verify("tok", "lead");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SITEVERIFY_URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(Object.keys(bodyOf(calls[0])).sort()).toEqual(["idempotency_key", "response", "secret"]);
    expect(bodyOf(calls[0])).toEqual({ secret: REAL.secretKey, response: "tok", idempotency_key: "key-1" });
  });

  it("passes on success with matching hostname and action", async () => {
    const { v } = verifier(REAL, reply(GOOD));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "passed" });
  });

  it("a different hostname is our configuration error, unavailable/hostname_mismatch", async () => {
    const { v, calls } = verifier(REAL, reply({ ...GOOD, hostname: "evil.example" }));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "hostname_mismatch" });
    expect(calls).toHaveLength(1);
  });

  it("a missing hostname with real keys is unavailable/hostname_mismatch", async () => {
    const { v } = verifier(REAL, reply({ success: true, action: "lead" }));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "hostname_mismatch" });
  });

  it("a missing action with real keys is refused/action", async () => {
    const { v } = verifier(REAL, reply({ success: true, hostname: "www.bibobay.com" }));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "refused", reason: "action" });
  });

  it("action mismatch", async () => {
    const { v } = verifier(REAL, reply(GOOD));
    expect(await v.verify("tok", "order")).toEqual({ outcome: "refused", reason: "action" });
  });

  it("skips the hostname check when no expected hostname is known", async () => {
    const { v } = verifier({ ...REAL, expectedHostname: null }, reply({ ...GOOD, hostname: "anything.example" }));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "passed" });
  });

  it("test keys skip hostname and action", async () => {
    const { v } = verifier(
      TEST,
      reply({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }),
    );
    expect(await v.verify("tok", "order")).toEqual({ outcome: "passed" });
  });

  it("absent or non-array error-codes is refused/rejected", async () => {
    for (const failure of [{ success: false }, { success: false, "error-codes": "invalid-input-secret" }]) {
      const { v } = verifier(REAL, reply(failure));
      expect(await v.verify("tok", "lead")).toEqual({ outcome: "refused", reason: "rejected" });
    }
  });

  it("maps failure codes", async () => {
    const cases: Array<[string[], unknown]> = [
      [["timeout-or-duplicate"], { outcome: "refused", reason: "rejected" }],
      [["invalid-input-response"], { outcome: "refused", reason: "rejected" }],
      [["something-new"], { outcome: "refused", reason: "rejected" }],
      [[], { outcome: "refused", reason: "rejected" }],
      [["invalid-input-secret"], { outcome: "unavailable", reason: "secret_rejected" }],
      [["missing-input-secret"], { outcome: "unavailable", reason: "secret_rejected" }],
      [["bad-request"], { outcome: "unavailable", reason: "bad_request" }],
    ];
    for (const [codes, verdict] of cases) {
      const { v } = verifier(REAL, reply({ success: false, "error-codes": codes }));
      expect(await v.verify("tok", "lead")).toEqual(verdict);
    }
  });

  it("internal-error twice is unavailable after the same key was retried", async () => {
    const { v, calls, keysIssued } = verifier(REAL, reply({ success: false, "error-codes": ["internal-error"] }));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "internal_error" });
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0]).idempotency_key).toBe("key-1");
    expect(bodyOf(calls[1]).idempotency_key).toBe("key-1");
    expect(keysIssued()).toBe(1);
  });

  it("retries once after a network error, with the same key", async () => {
    const { v, calls, keysIssued } = verifier(REAL, new TypeError("fetch failed"), reply(GOOD));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "passed" });
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0]).idempotency_key).toBe("key-1");
    expect(bodyOf(calls[1]).idempotency_key).toBe("key-1");
    expect(keysIssued()).toBe(1);
  });

  it("a network error twice is unavailable/network", async () => {
    const { v, calls } = verifier(REAL, new TypeError("fetch failed"));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "network" });
    expect(calls).toHaveLength(2);
  });

  it("a 503 twice is unavailable/http after 2 calls", async () => {
    const { v, calls } = verifier(REAL, reply("down", 503));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "http" });
    expect(calls).toHaveLength(2);
  });

  it("a 400 is unavailable/http after 1 call", async () => {
    const { v, calls } = verifier(REAL, reply("no", 400));
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "http" });
    expect(calls).toHaveLength(1);
  });

  it("malformed replies are unavailable/malformed_reply", async () => {
    const html = verifier(REAL, reply("<html>"));
    expect(await html.v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "malformed_reply" });
    expect(html.calls).toHaveLength(1);
    const noFlag = verifier(REAL, reply({ success: "yes" }));
    expect(await noFlag.v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "malformed_reply" });
  });

  it("times out when fetch never settles, and aborts it", async () => {
    const signals: AbortSignal[] = [];
    const hang = ((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const v = createTurnstileVerifier(REAL, { fetch: hang, timeoutMs: 20, retryDelayMs: 0 });
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "timeout" });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("times out when fetch rejects on the abort signal, and aborts it", async () => {
    const signals: AbortSignal[] = [];
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal) signals.push(init.signal);
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const v = createTurnstileVerifier(REAL, { fetch: hang, timeoutMs: 20, retryDelayMs: 0 });
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "timeout" });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("times out when the body stalls after the headers arrive", async () => {
    const signals: AbortSignal[] = [];
    const stalled = ((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 }));
    }) as typeof fetch;
    const v = createTurnstileVerifier(REAL, { fetch: stalled, timeoutMs: 20, retryDelayMs: 0 });
    expect(await v.verify("tok", "lead")).toEqual({ outcome: "unavailable", reason: "timeout" });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const failing = verifier(REAL, new TypeError("fetch failed"));
    await failing.v.verify("tok", "lead");
    const rejected = verifier(REAL, reply({ success: false, "error-codes": ["invalid-input-secret"] }));
    await rejected.v.verify("tok", "lead");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
