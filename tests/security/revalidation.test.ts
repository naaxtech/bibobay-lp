import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_WEBHOOK_BODY_BYTES,
  REPLAY_WINDOW_MS,
  REVALIDATION_TAGS,
  SIGNATURE_HEADER,
  handleRevalidationRequest,
  signWebhookPayload,
  tagsForDocumentType,
  verifyWebhookSignature,
} from "@/lib/security/revalidation";

vi.mock("server-only", () => ({}));

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag }));

/*
 * Golden vector produced with the official toolkit, @sanity/webhook 4.0.4
 * (`encodeSignatureHeader(body, 1760000000000, secret)`; `isValidSignature` returned true). It pins
 * the wire format Sanity sends: `t=<unix ms>,v1=<base64url HMAC-SHA256 of "<t>.<raw body>">`.
 */
const GOLDEN = {
  secret: "fixture-webhook-secret-for-tests",
  body: JSON.stringify({ _id: "landingPage", _type: "landingPage" }),
  timestamp: 1760000000000,
  header: "t=1760000000000,v1=33I81YJ42k51nB6kAeSaYZzvJ3W2KWpSAmR84cCLqJU",
};

function signedRequest(body: string, { timestamp = GOLDEN.timestamp, secret = GOLDEN.secret, header }: { timestamp?: number; secret?: string; header?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  const value = header === undefined ? `t=${timestamp},v1=${signWebhookPayload(body, timestamp, secret)}` : header;
  if (value !== null) headers.set(SIGNATURE_HEADER, value);
  return new Request("https://bibo.example/api/revalidate", { method: "POST", headers, body });
}

const deps = (overrides: Partial<Parameters<typeof handleRevalidationRequest>[1]> = {}) => {
  const revalidated: string[] = [];
  return {
    revalidated,
    deps: { secret: GOLDEN.secret, now: () => GOLDEN.timestamp, revalidate: (tag: string) => { revalidated.push(tag); }, ...overrides },
  };
};

describe("webhook signature (Sanity format)", () => {
  it("reproduces the official toolkit's signature for the golden vector", () => {
    expect(`t=${GOLDEN.timestamp},v1=${signWebhookPayload(GOLDEN.body, GOLDEN.timestamp, GOLDEN.secret)}`).toBe(GOLDEN.header);
  });

  it("accepts the golden header inside the replay window", () => {
    expect(verifyWebhookSignature({ body: GOLDEN.body, header: GOLDEN.header, secret: GOLDEN.secret, now: GOLDEN.timestamp + 60_000 })).toEqual({ ok: true, timestamp: GOLDEN.timestamp });
  });

  it.each([
    ["no header", null, "missing"],
    ["an empty header", "", "missing"],
    ["no version field", `t=${GOLDEN.timestamp}`, "malformed"],
    ["a non-numeric timestamp", "t=yesterday,v1=abc", "malformed"],
    ["a v0 scheme", `t=${GOLDEN.timestamp},v0=33I81YJ42k51nB6kAeSaYZzvJ3W2KWpSAmR84cCLqJU`, "malformed"],
  ])("rejects %s", (_label, header, reason) => {
    expect(verifyWebhookSignature({ body: GOLDEN.body, header, secret: GOLDEN.secret, now: GOLDEN.timestamp })).toEqual({ ok: false, reason });
  });

  it("rejects a signature made with another secret", () => {
    const header = `t=${GOLDEN.timestamp},v1=${signWebhookPayload(GOLDEN.body, GOLDEN.timestamp, "some-other-secret")}`;
    expect(verifyWebhookSignature({ body: GOLDEN.body, header, secret: GOLDEN.secret, now: GOLDEN.timestamp })).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a body changed after signing", () => {
    const tampered = JSON.stringify({ _id: "landingPage", _type: "siteSettings" });
    expect(verifyWebhookSignature({ body: tampered, header: GOLDEN.header, secret: GOLDEN.secret, now: GOLDEN.timestamp })).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a timestamp moved without re-signing", () => {
    const moved = GOLDEN.header.replace(String(GOLDEN.timestamp), String(GOLDEN.timestamp + 1000));
    expect(verifyWebhookSignature({ body: GOLDEN.body, header: moved, secret: GOLDEN.secret, now: GOLDEN.timestamp })).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a genuine signature replayed after the five-minute window", () => {
    expect(REPLAY_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(verifyWebhookSignature({ body: GOLDEN.body, header: GOLDEN.header, secret: GOLDEN.secret, now: GOLDEN.timestamp + REPLAY_WINDOW_MS + 1 })).toEqual({ ok: false, reason: "expired" });
    expect(verifyWebhookSignature({ body: GOLDEN.body, header: GOLDEN.header, secret: GOLDEN.secret, now: GOLDEN.timestamp + REPLAY_WINDOW_MS })).toEqual({ ok: true, timestamp: GOLDEN.timestamp });
  });

  it("rejects a timestamp from more than five minutes in the future", () => {
    expect(verifyWebhookSignature({ body: GOLDEN.body, header: GOLDEN.header, secret: GOLDEN.secret, now: GOLDEN.timestamp - REPLAY_WINDOW_MS - 1 })).toEqual({ ok: false, reason: "expired" });
  });
});

describe("document type to cache tag mapping", () => {
  it("maps exactly the tags lib/sanity/fetch.ts assigns, one tag per document type", () => {
    expect(REVALIDATION_TAGS).toEqual({
      siteSettings: ["siteSettings"],
      landingPage: ["landingPage"],
      character: ["character"],
      episodePreview: ["episodePreview"],
      brandPillar: ["brandPillar"],
      ecosystemEntry: ["ecosystemEntry"],
      testimonial: ["testimonial"],
      faqItem: ["faqItem"],
      legalSettings: ["legalSettings"],
      product: ["product"],
      productCategory: ["productCategory"],
      // Not fetched on its own: the landing query dereferences it (`lead.leadMagnet->`), so a change
      // to a download must expire the landing page read (Task 9 review I1).
      leadMagnet: ["landingPage"],
    });
  });

  it("covers every document type the Studio schema defines, so no published edit is silently ignored", () => {
    const schemaDir = join(process.cwd(), "studio", "schemaTypes", "documents");
    const documentTypes = readdirSync(schemaDir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => [...readFileSync(join(schemaDir, file), "utf8").matchAll(/defineType\(\{\s*name:\s*"(\w+)"[^]*?type:\s*"document"/g)].map((match) => match[1]!));
    // 3 singletons + 9 collections today; guards against the pattern silently matching nothing.
    expect(documentTypes.length).toBeGreaterThanOrEqual(12);
    for (const type of documentTypes) {
      expect(tagsForDocumentType(type), `document type ${type}`).not.toEqual([]);
    }
  });

  it("covers every document the published queries dereference", () => {
    const queries = readFileSync(join(process.cwd(), "lib", "sanity", "queries.ts"), "utf8");
    expect(queries).toMatch(/leadMagnet->/);
    expect(tagsForDocumentType("leadMagnet")).toEqual(["landingPage"]);
  });

  it.each(["unknownType", "sanity.imageAsset", "__proto__", "constructor", "toString", "", 42, null])("ignores %s", (type) => {
    expect(tagsForDocumentType(type)).toEqual([]);
  });

  it("returns a copy, so a caller cannot change the mapping", () => {
    tagsForDocumentType("landingPage").push("everything");
    expect(tagsForDocumentType("landingPage")).toEqual(["landingPage"]);
  });
});

describe("revalidation request handling", () => {
  it("revalidates the mapped tag for a correctly signed request", async () => {
    const { deps: d, revalidated } = deps();
    const response = await handleRevalidationRequest(signedRequest(GOLDEN.body), d);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ revalidated: true, tags: ["landingPage"] });
    expect(revalidated).toEqual(["landingPage"]);
  });

  it.each([
    ["missing", null],
    ["malformed", "nonsense"],
    ["forged", `t=${GOLDEN.timestamp},v1=${"A".repeat(43)}`],
  ])("answers 401 for a %s signature and revalidates nothing", async (_label, header) => {
    const { deps: d, revalidated } = deps();
    const response = await handleRevalidationRequest(signedRequest(GOLDEN.body, { header }), d);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ revalidated: false, error: "invalid_signature" });
    expect(revalidated).toEqual([]);
  });

  it("answers 401 to a replay of a request signed six minutes ago", async () => {
    const { deps: d, revalidated } = deps({ now: () => GOLDEN.timestamp + 6 * 60 * 1000 });
    const response = await handleRevalidationRequest(signedRequest(GOLDEN.body), d);
    expect(response.status).toBe(401);
    expect(revalidated).toEqual([]);
  });

  it("answers 400 to a correctly signed body that is not JSON", async () => {
    const { deps: d, revalidated } = deps();
    const response = await handleRevalidationRequest(signedRequest("{not json"), d);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ revalidated: false, error: "malformed_body" });
    expect(revalidated).toEqual([]);
  });

  it.each([["an array", "[]"], ["no _type", JSON.stringify({ _id: "x" })], ["a numeric _type", JSON.stringify({ _type: 3 })]])("answers 400 to a signed body with %s", async (_label, body) => {
    const { deps: d, revalidated } = deps();
    expect((await handleRevalidationRequest(signedRequest(body), d)).status).toBe(400);
    expect(revalidated).toEqual([]);
  });

  it("answers 200 without revalidating for a signed but unknown document type", async () => {
    const { deps: d, revalidated } = deps();
    const response = await handleRevalidationRequest(signedRequest(JSON.stringify({ _type: "sanity.imageAsset" })), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: false, tags: [] });
    expect(revalidated).toEqual([]);
  });

  it("answers 503 and checks nothing when the secret is not configured", async () => {
    for (const secret of [undefined, "", "   "]) {
      const { deps: d, revalidated } = deps({ secret });
      const response = await handleRevalidationRequest(signedRequest(GOLDEN.body), d);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ revalidated: false, error: "not_configured" });
      expect(revalidated).toEqual([]);
    }
  });

  it("refuses an oversized body before verifying it", async () => {
    const { deps: d, revalidated } = deps();
    const body = JSON.stringify({ _type: "landingPage", padding: "x".repeat(MAX_WEBHOOK_BODY_BYTES) });
    const response = await handleRevalidationRequest(signedRequest(body), d);
    expect(response.status).toBe(413);
    expect(revalidated).toEqual([]);
  });

  it("never echoes the body or the secret in a response", async () => {
    const { deps: d } = deps();
    const body = JSON.stringify({ _type: "landingPage", title: "private draft title" });
    for (const request of [signedRequest(body), signedRequest(body, { header: "bad" }), signedRequest("{oops")]) {
      const text = await (await handleRevalidationRequest(request, d)).text();
      expect(text).not.toContain("private draft title");
      expect(text).not.toContain(GOLDEN.secret);
    }
  });
});

describe("POST /api/revalidate", () => {
  const original = process.env.SANITY_REVALIDATE_SECRET;
  beforeEach(() => {
    revalidateTag.mockReset();
    process.env.SANITY_REVALIDATE_SECRET = GOLDEN.secret;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(GOLDEN.timestamp + 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env.SANITY_REVALIDATE_SECRET;
    else process.env.SANITY_REVALIDATE_SECRET = original;
  });

  it("expires the mapped tag immediately with Next 16's two-argument revalidateTag", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const response = await POST(signedRequest(JSON.stringify({ _id: "x", _type: "legalSettings" })));
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("legalSettings", { expire: 0 });
  });

  it("does not revalidate on a bad signature and writes nothing to the console", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const { POST } = await import("@/app/api/revalidate/route");
    const response = await POST(signedRequest(GOLDEN.body, { secret: "wrong-secret" }));
    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
