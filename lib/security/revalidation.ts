import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signed Sanity webhooks (ruling R32).
 *
 * Wire format, confirmed against the official toolkit @sanity/webhook 4.0.4 (dist/index.mjs:
 * `SIGNATURE_HEADER_NAME`, `decodeSignatureHeader`, `createHS256Signature`) and pinned by a golden
 * vector in tests/security/revalidation.test.ts:
 *
 *   sanity-webhook-signature: t=<unix ms>,v1=<base64url HMAC-SHA256 of "<t>.<raw body>" keyed by the secret>
 *
 * The toolkit is not a dependency: these few lines with node:crypto and a constant-time compare
 * are the whole check. Unlike the toolkit, a signature older (or newer) than the replay window is
 * refused too. A replay inside the window only re-expires the same tags, which is harmless.
 */

export const SIGNATURE_HEADER = "sanity-webhook-signature";
/** Five minutes either way: covers Sanity's delivery retries and clock skew, refuses old captures. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;
/**
 * Bodies above this are refused before any work. Configure the webhook projection as
 * `{_type, _id}` so the body stays tiny; a whole document fits too.
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/** Same pattern the toolkit uses (`SIGNATURE_HEADER_REGEX`). */
const SIGNATURE_PATTERN = /^t=(\d+)[, ]+v1=([^, ]+)$/;
/** The toolkit's floor (`MINIMUM_TIMESTAMP`): a seconds-precision value is not a valid timestamp. */
const MINIMUM_TIMESTAMP = 1_609_459_200_000;

/**
 * Cache tags per Sanity document type: exactly the tags lib/sanity/fetch.ts assigns. Each type
 * expires only its own tag; every read that depends on the type carries that tag.
 */
export const REVALIDATION_TAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
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
});

/** The tags for a document type; an unknown or odd value maps to nothing. */
export function tagsForDocumentType(type: unknown): string[] {
  if (typeof type !== "string" || !Object.hasOwn(REVALIDATION_TAGS, type)) return [];
  return [...REVALIDATION_TAGS[type]!];
}

/** The base64url signature Sanity computes for a body sent at `timestamp`. */
export function signWebhookPayload(body: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("base64url");
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: "missing" | "malformed" | "invalid" | "expired" };

export function verifyWebhookSignature({ body, header, secret, now }: { body: string; header: string | null | undefined; secret: string; now: number }): SignatureCheck {
  if (!header || !header.trim()) return { ok: false, reason: "missing" };
  const match = SIGNATURE_PATTERN.exec(header.trim());
  if (!match) return { ok: false, reason: "malformed" };
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || timestamp < MINIMUM_TIMESTAMP) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(signWebhookPayload(body, timestamp, secret), "utf8");
  const received = Buffer.from(match[2]!, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "invalid" };
  // Only a genuine signature reaches the window check, so "expired" always means a real but old request.
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) return { ok: false, reason: "expired" };
  return { ok: true, timestamp };
}

export interface RevalidationDependencies {
  /** SANITY_REVALIDATE_SECRET; blank means the webhook is not configured. */
  secret: string | undefined;
  now: () => number;
  revalidate: (tag: string) => void;
}

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * The whole webhook contract. Answers never echo the body, the signature or the secret, and
 * nothing is logged: a forged request learns only that it failed.
 */
export async function handleRevalidationRequest(request: Request, deps: RevalidationDependencies): Promise<Response> {
  const secret = deps.secret?.trim();
  if (!secret) return json(503, { revalidated: false, error: "not_configured" });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) return json(413, { revalidated: false, error: "too_large" });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BODY_BYTES) return json(413, { revalidated: false, error: "too_large" });

  const check = verifyWebhookSignature({ body, header: request.headers.get(SIGNATURE_HEADER), secret, now: deps.now() });
  if (!check.ok) return json(401, { revalidated: false, error: "invalid_signature" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { revalidated: false, error: "malformed_body" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { _type?: unknown })._type !== "string") {
    return json(400, { revalidated: false, error: "malformed_body" });
  }

  // A signed request for a type this site does not render (an image asset, a Studio-only type) is
  // a success with nothing to do, so Sanity does not keep retrying it.
  const tags = tagsForDocumentType((parsed as { _type: string })._type);
  for (const tag of tags) deps.revalidate(tag);
  return json(200, { revalidated: tags.length > 0, tags });
}
