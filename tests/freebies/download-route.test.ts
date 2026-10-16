// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/freebies/download/route";
import { ACTIVITY_PACK } from "@/lib/content/freebie";
import { freebieFilePath } from "@/lib/freebies/file";
import { signDownloadToken } from "@/lib/freebies/token";

vi.mock("server-only", () => ({}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/report", () => ({ reportError }));

const SECRET = "r".repeat(40);
const FILE = ACTIVITY_PACK.fileUrl;
const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/content/activity-pack.manifest.json"), "utf8")) as { bytes: number };

const call = (token?: string) => GET(new Request(`https://bibobay.example/api/freebies/download${token === undefined ? "" : `?t=${token}`}`));
const sign = (fileUrl: string = FILE, ttlSeconds = 60, nowMs?: number) => signDownloadToken({ fileUrl, ttlSeconds }, { LEAD_IP_HASH_SECRET: SECRET }, nowMs)!;

afterEach(() => {
  vi.unstubAllEnvs();
  reportError.mockClear();
});

describe("GET /api/freebies/download (ruling R140)", () => {
  it("serves the pack for a valid token", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
    const response = await call(sign());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="bibo-bay-activity-pack.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(manifest.bytes);
    expect(response.headers.get("content-length")).toBe(String(manifest.bytes));
    expect(Buffer.from(body.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("answers 404 for a missing, garbage or tampered token", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
    const good = sign();
    for (const token of [undefined, "", "garbage", `${good.slice(0, -2)}xx`]) {
      const response = await call(token);
      expect(response.status, String(token)).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await response.text()).toBe("Not found");
    }
  });

  it("answers 410 for an expired token", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
    const response = await call(sign(FILE, 1, Date.now() - 60_000));
    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("This download link has expired. Sign up again on the page to get a new one.");
  });

  it("answers 503 when no secret is configured, and 404 when there is no token at all", async () => {
    const token = sign();
    vi.stubEnv("LEAD_IP_HASH_SECRET", "");
    const withToken = await call(token);
    expect(withToken.status).toBe(503);
    expect(withToken.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(withToken.headers.get("cache-control")).toBe("private, no-store");
    expect(await withToken.text()).toBe("Downloads are not open yet.");
    expect((await call()).status).toBe(404);
  });

  it("answers 404 for a valid token naming a file that is not on disk", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
    const response = await call(sign("/freebies/nothing-here.pdf"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(reportError).toHaveBeenCalledTimes(1);
    const [error, context] = reportError.mock.calls[0] as [Error, Record<string, string>];
    expect(context).toEqual({ area: "freebies", event: "freebie_file_unreadable", code: "ENOENT" });
    expect(JSON.stringify([error.message, context])).not.toContain("nothing-here");
  });

  it("reports nothing for a served file or a refused token", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", SECRET);
    await call(sign());
    await call("garbage");
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("freebieFilePath", () => {
  it("resolves a repository freebie under content/freebies", () => {
    expect(freebieFilePath(FILE, "/srv/app")?.replaceAll("\\", "/")).toMatch(/\/srv\/app\/content\/freebies\/bibo-bay-activity-pack\.pdf$/);
  });
  it("refuses everything else", () => {
    for (const url of ["/etc/passwd", "https://x/y.pdf", "/freebies/../x.pdf", "/freebies/A.pdf", "/freebies/a.pdf?x=1", "/freebies/%2e.pdf", "", "freebies/a.pdf"]) {
      expect(freebieFilePath(url, "/srv/app"), url).toBeNull();
    }
  });
});
