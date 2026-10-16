import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/*
 * R140: the signed download as the built server actually serves it, headers included (the unit
 * tests call the handler directly, so they cannot see next.config.ts header rules).
 *
 * The token is minted here with node:crypto, duplicating lib/freebies/token.ts on purpose:
 * that module is server-only and cannot be imported into a Playwright spec, and a format drift
 * between the two must fail here. Format: base64url(JSON {f, e}) + "." + base64url(HMAC-SHA256(key,
 * payload text)), key = HKDF-SHA256(LEAD_IP_HASH_SECRET, empty salt, info "bibobay freebie download v1", 32 bytes).
 *
 * Runs only against a production build (E2E_PRODUCTION=1) started with the same LEAD_IP_HASH_SECRET
 * this process sees.
 */
const SECRET = process.env.LEAD_IP_HASH_SECRET;
const FILE = "/freebies/bibo-bay-activity-pack.pdf";
const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/content/activity-pack.manifest.json"), "utf8")) as { bytes: number };

function mint(expiresAtSeconds: number, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ f: FILE, e: expiresAtSeconds })).toString("base64url");
  const key = Buffer.from(hkdfSync("sha256", secret, "", "bibobay freebie download v1", 32));
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

test.describe("signed activity-pack download", () => {
  test.skip(process.env.E2E_PRODUCTION !== "1" || !SECRET, "needs E2E_PRODUCTION=1 and the server's LEAD_IP_HASH_SECRET in this environment");

  test("serves the PDF for a valid token, with the private headers as served", async ({ request }) => {
    const response = await request.get(`/api/freebies/download?t=${mint(inOneHour(), SECRET!)}`);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.length).toBe(manifest.bytes);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toBe('attachment; filename="bibo-bay-activity-pack.pdf"');
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("refuses a wrong signature, an expired token, junk and the old public path", async ({ request }) => {
    expect((await request.get(`/api/freebies/download?t=${mint(inOneHour(), `${SECRET}-other`)}`)).status()).toBe(404);
    expect((await request.get(`/api/freebies/download?t=${mint(Math.floor(Date.now() / 1000) - 60, SECRET!)}`)).status()).toBe(410);
    expect((await request.get("/api/freebies/download?t=abc")).status()).toBe(404);
    expect((await request.get(FILE)).status()).toBe(404);
  });
});
