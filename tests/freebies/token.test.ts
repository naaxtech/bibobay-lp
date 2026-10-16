// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { DOWNLOAD_ROUTE } from "@/lib/content/freebie-path";
import { downloadPath, signDownloadToken, TOKEN_QUERY, verifyDownloadToken } from "@/lib/freebies/token";

vi.mock("server-only", () => ({}));

const FILE = "/freebies/bibo-bay-activity-pack.pdf";
const SECRET = "s".repeat(40);
const env = { LEAD_IP_HASH_SECRET: SECRET };
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

const encode = (value: string) => Buffer.from(value).toString("base64url");
function tokenWithPayload(payload: string): string {
  return `${encode(payload)}.${createHmac("sha256", "x").update(encode(payload)).digest("base64url")}`;
}

describe("signed download tokens (ruling R140)", () => {
  it("round-trips a file name under a 40-character secret", () => {
    const token = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW);
    expect(token).not.toBeNull();
    expect(verifyDownloadToken(token, env, NOW + 1000)).toEqual({ ok: true, fileUrl: FILE });
  });

  it("carries only the file name and an expiry", () => {
    const token = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW)!;
    const payload = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(payload).toEqual({ f: FILE, e: Math.floor(NOW / 1000) + 60 });
  });

  it("signs nothing without a secret or with a 31-character one, and then verifies as unconfigured", () => {
    expect(signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, {}, NOW)).toBeNull();
    expect(signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, { LEAD_IP_HASH_SECRET: "s".repeat(31) }, NOW)).toBeNull();
    const token = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW);
    expect(verifyDownloadToken(token, {}, NOW)).toEqual({ ok: false, reason: "unconfigured" });
    expect(verifyDownloadToken(token, { LEAD_IP_HASH_SECRET: "s".repeat(31) }, NOW)).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("refuses a file name that is not a repository freebie", () => {
    expect(signDownloadToken({ fileUrl: "/etc/passwd", ttlSeconds: 60 }, env, NOW)).toBeNull();
    expect(signDownloadToken({ fileUrl: "https://x/y.pdf", ttlSeconds: 60 }, env, NOW)).toBeNull();
  });

  it("rejects a tampered payload and a tampered signature", () => {
    const [payload, signature] = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW)!.split(".") as [string, string];
    const other = encode(JSON.stringify({ f: "/freebies/other.pdf", e: Math.floor(NOW / 1000) + 60 }));
    expect(verifyDownloadToken(`${other}.${signature}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifyDownloadToken(`${payload}.${flipped}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifyDownloadToken(`${payload}.${signature.slice(0, 10)}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("expires at the stated second", () => {
    const token = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW);
    expect(verifyDownloadToken(token, env, NOW + 59_000).ok).toBe(true);
    expect(verifyDownloadToken(token, env, NOW + 61_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("calls anything that is not a well-formed token malformed", () => {
    const forged = (f: string, e: unknown) => tokenWithPayload(JSON.stringify({ f, e }));
    for (const token of ["abc", "", "a.b.c", null, undefined, tokenWithPayload("not json"), forged("/etc/passwd", 9999999999), forged("https://x/y.pdf", 9999999999), forged(FILE, "soon")]) {
      expect(verifyDownloadToken(token, env, NOW), String(token)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("does not verify a token under a different secret", () => {
    const token = signDownloadToken({ fileUrl: FILE, ttlSeconds: 60 }, env, NOW);
    expect(verifyDownloadToken(token, { LEAD_IP_HASH_SECRET: "t".repeat(40) }, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("builds the route path", () => {
    expect(TOKEN_QUERY).toBe("t");
    expect(downloadPath("x")).toBe("/api/freebies/download?t=x");
    expect(downloadPath("x").startsWith(DOWNLOAD_ROUTE)).toBe(true);
  });
});
