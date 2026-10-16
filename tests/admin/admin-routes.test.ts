import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Next's request cookie store, for the route modules (route handlers may write cookies). */
const { store } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const store = {
    values,
    writes: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
    set(name: string, value: string, options: Record<string, unknown> = {}) {
      store.writes.push({ name, value, options });
      values.set(name, value);
    },
  };
  return { store };
});
vi.mock("next/headers", () => ({ cookies: async () => store }));

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import * as quoteRoute from "@/app/api/admin/orders/[reference]/quote/route";
import * as statusRoute from "@/app/api/admin/orders/[reference]/status/route";
import * as trackingRoute from "@/app/api/admin/orders/[reference]/tracking-link/route";
import * as sessionRoute from "@/app/api/admin/session/route";

/*
 * The staff route modules as Next runs them (Task 8b), wired from the environment: Node runtime,
 * never cached, the same-origin rule first, 503 while unconfigured, 401 without a session (decided
 * without a network call), and the sign-in limiter keyed by hashes only, called with the server key.
 */
const ORIGIN = "https://bibobay.example";
const REFERENCE = "BB-1A2B-3C4D";
const params = { params: Promise.resolve({ reference: REFERENCE }) };
const SECRET = "lead-ip-hash-fixture-secret-0123456789";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });

const ORDER_ROUTES = [
  ["quote", (request: Request) => quoteRoute.POST(request, params), { intent: "send", revision: 1 }],
  ["status", (request: Request) => statusRoute.POST(request, params), { from: "new", to: "confirmed" }],
  ["tracking-link", (request: Request) => trackingRoute.POST(request, params), {}],
] as const;

let fetchCalls: Array<{ url: string; body: string; apikey: string | null; authorization: string | null }>;

beforeEach(() => {
  store.values.clear();
  store.writes.length = 0;
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      fetchCalls.push({ url, body: typeof init?.body === "string" ? init.body : "", apikey: headers.get("apikey"), authorization: headers.get("authorization") });
      if (url.includes("/rest/v1/rpc/consume_rate_limit")) return Response.json([{ allowed: true, remaining: 4, retry_after_seconds: 0 }]);
      if (url.includes("/auth/v1/token")) return Response.json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 });
      return Response.json({ message: "unexpected" }, { status: 500 });
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function configure({ admin = true }: { admin?: boolean } = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
  if (admin) {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
  }
}

describe("the staff route modules", () => {
  it("run on Node and are never cached", () => {
    for (const route of [quoteRoute, statusRoute, trackingRoute, sessionRoute]) {
      expect(route.runtime).toBe("nodejs");
      expect(route.dynamic).toBe("force-dynamic");
    }
    expect(Object.keys(sessionRoute).filter((name) => /^[A-Z]+$/.test(name)).sort()).toEqual(["DELETE", "POST"]);
    for (const route of [quoteRoute, statusRoute, trackingRoute]) expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it.each(ORDER_ROUTES)("%s: 403 for a cross-site request, whatever the configuration", async (_name, call, body) => {
    const response = await call(post("/x", body, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: ADMIN_COPY.api.forbidden });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(ORDER_ROUTES)("%s: 503 while Supabase is not configured", async (_name, call, body) => {
    const response = await call(post("/x", body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, message: ADMIN_COPY.api.unconfigured });
    expect(fetchCalls).toEqual([]);
  });

  it.each(ORDER_ROUTES)("%s: 401 without a staff session, decided without asking anyone", async (_name, call, body) => {
    configure();
    const response = await call(post("/x", body));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, message: ADMIN_COPY.api.signedOut });
    expect(fetchCalls).toEqual([]);
  });

  it("sign-in: 503 without the shared limiter (server key and hashing secret), trying nothing", async () => {
    configure({ admin: false });
    const response = await sessionRoute.POST(post("/api/admin/session", { email: "staff@example.com", password: "x" }));
    expect(response.status).toBe(503);
    expect(fetchCalls).toEqual([]);
  });

  it("sign-in: counts the attempt with the server key under hashed keys only, then refuses a wrong password generically", async () => {
    configure();
    const response = await sessionRoute.POST(post("/api/admin/session", { email: "Staff@Example.com", password: "wrong" }, { "x-forwarded-for": "203.0.113.7" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, message: ADMIN_COPY.session.refused });

    const limits = fetchCalls.filter((call) => call.url.includes("/rpc/consume_rate_limit"));
    expect(limits).toHaveLength(2);
    const keys = limits.map((call) => (JSON.parse(call.body) as { bucket_key: string }).bucket_key);
    expect(keys[0]).toMatch(/^staff-login:[0-9a-f]{64}$/);
    expect(keys[1]).toMatch(/^staff-login-email:[0-9a-f]{64}$/);
    expect(JSON.stringify(limits)).not.toMatch(/staff@|example\.com|203\.0\.113/i);
    for (const call of limits) expect(call.apikey).toBe("sb_secret_fixture_only");

    const token = fetchCalls.find((call) => call.url.includes("/auth/v1/token"));
    expect(token?.apikey).toBe("sb_publishable_fixture_only");
    expect(JSON.parse(token!.body)).toMatchObject({ email: "staff@example.com", password: "wrong" });
    expect(store.writes.filter((write) => write.value !== "")).toEqual([]);
  });

  it("sign-out: 200 and nothing to clear when no one is signed in; 403 cross-site", async () => {
    configure();
    const signOut = (headers: Record<string, string> = {}) =>
      sessionRoute.DELETE(new Request(`${ORIGIN}/api/admin/session`, { method: "DELETE", headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers } }));
    const response = await signOut();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: ADMIN_COPY.session.signedOut });
    expect((await signOut({ origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
});
