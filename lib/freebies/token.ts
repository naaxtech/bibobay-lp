import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { DOWNLOAD_ROUTE, FREEBIE_PATH } from "@/lib/content/freebie-path";
import { hashSecretFrom } from "@/lib/security/secrets";

/**
 * Signed download tokens (ruling R140, 2026-10-16, which overrides R66's "the link is the file").
 *
 * The activity pack is not a public file: the signup answer and the acknowledgement email carry a
 * link to the download route with one of these tokens. A token holds only the repository file name
 * and an expiry, so it names no visitor and no lead: `base64url(JSON {f, e})` + "." +
 * `base64url(HMAC-SHA256(key, payload))`.
 *
 * The key is derived (HKDF) from `LEAD_IP_HASH_SECRET`, which every configured deployment already
 * has, so there is no new environment variable. Read through lib/security/secrets (import-free), not
 * lib/leads/dependencies, so the route does not pull the database client into its import graph.
 */
export const IMMEDIATE_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;
export const EMAIL_DOWNLOAD_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TOKEN_QUERY = "t";

type Env = Record<string, string | undefined>;

// src: https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen · node 24 · 2026-10-16
// hkdfSync returns an ArrayBuffer; the info string keeps this key apart from every other use of the secret.
const KEY_INFO = "bibobay freebie download v1";

function signingKey(env: Env): Buffer | null {
  const secret = hashSecretFrom(env);
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, 32));
}

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function signDownloadToken(
  input: { fileUrl: string; ttlSeconds: number },
  env: Env = process.env,
  nowMs: number = Date.now(),
): string | null {
  if (!FREEBIE_PATH.test(input.fileUrl)) return null;
  const key = signingKey(env);
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({ f: input.fileUrl, e: Math.floor(nowMs / 1000) + input.ttlSeconds })).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

export type TokenVerdict = { ok: true; fileUrl: string } | { ok: false; reason: "unconfigured" | "malformed" | "signature" | "expired" };

const bad = (reason: "unconfigured" | "malformed" | "signature" | "expired"): TokenVerdict => ({ ok: false, reason });

function parsePayload(payload: string): { f: string; e: number } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { f, e } = value as Record<string, unknown>;
    if (typeof f !== "string" || !FREEBIE_PATH.test(f)) return null;
    if (typeof e !== "number" || !Number.isFinite(e)) return null;
    return { f, e };
  } catch {
    return null;
  }
}

/** Order: shape, then configuration, then signature, then expiry, so a forged token never learns whether it was current. */
export function verifyDownloadToken(token: string | null | undefined, env: Env = process.env, nowMs: number = Date.now()): TokenVerdict {
  if (!token) return bad("malformed");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return bad("malformed");
  const [payload, signature] = parts as [string, string];
  const claims = parsePayload(payload);
  if (!claims) return bad("malformed");
  const key = signingKey(env);
  if (!key) return bad("unconfigured");
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return bad("signature");
  if (Math.floor(nowMs / 1000) >= claims.e) return bad("expired");
  return { ok: true, fileUrl: claims.f };
}

/** `/api/freebies/download?t=<token>` */
export function downloadPath(token: string): string {
  return `${DOWNLOAD_ROUTE}?${TOKEN_QUERY}=${token}`;
}
