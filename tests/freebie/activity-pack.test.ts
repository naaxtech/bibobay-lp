import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BIBO_VIDEO_IDS, BIBO_YOUTUBE_CHANNEL_URL, BIBO_YOUTUBE_SUBSCRIBE_URL, SAFE_FALLBACK_CONTENT, youtubeWatchUrl } from "@/lib/content/fallback";
import { ACTIVITY_PACK, absoluteFileUrl, activityPackPreviews } from "@/lib/content/freebie";

/**
 * The free printable activity pack (rulings R66-R69): a real file in the repository, built by
 * scripts/freebie/build_activity_pack.py from the site's own copy, linking only to the channel.
 */
const root = process.cwd();
const fromPublic = (path: string) => readFileSync(join(root, "public", path));
const manifest = JSON.parse(readFileSync(join(root, "lib/content/activity-pack.manifest.json"), "utf8")) as {
  sha256: string; bytes: number; pages: string[]; links: string[]; qr?: Array<{ page: number; url: string }>;
  videos: Array<{ id: string; title: string; url: string }>; characters: string[];
};

function webpSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("the Bibo Bay activity pack (freebie)", () => {
  const pdf = fromPublic(ACTIVITY_PACK.fileUrl);
  const body = pdf.toString("latin1");

  it("is a real PDF in the repository, inside its weight budget, exactly as the generator recorded it", () => {
    expect(body.startsWith("%PDF-")).toBe(true);
    expect(pdf.length).toBe(ACTIVITY_PACK.bytes);
    expect(pdf.length).toBe(manifest.bytes);
    expect(pdf.length).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(manifest.sha256);
  });

  it("has the number of pages the site states", () => {
    const pages = body.match(/\/Type\s*\/Page(?![a-z])/g) ?? [];
    expect(pages).toHaveLength(ACTIVITY_PACK.pages);
    expect(manifest.pages).toHaveLength(ACTIVITY_PACK.pages);
  });

  it("links only to the channel, its subscribe prompt and the channel's verified videos, and to every one of those videos", () => {
    const uris = [...body.matchAll(/\/URI\s*\((.*?)\)/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
    expect(uris.length).toBeGreaterThan(0);
    const videos = Object.values(BIBO_VIDEO_IDS).map(youtubeWatchUrl);
    const allowed = new Set([BIBO_YOUTUBE_CHANNEL_URL, BIBO_YOUTUBE_SUBSCRIBE_URL, ...videos]);
    for (const uri of uris) expect(allowed.has(uri), uri).toBe(true);
    for (const video of videos) expect(uris, video).toContain(video);
    expect(uris).toContain(BIBO_YOUTUBE_SUBSCRIBE_URL);
    expect(new Set(uris)).toEqual(new Set(manifest.links));
  });

  it("encodes in its QR codes only the channel, its subscribe prompt and verified videos, each also a link (review M8)", () => {
    const videos = Object.values(BIBO_VIDEO_IDS).map(youtubeWatchUrl);
    const allowed = new Set([BIBO_YOUTUBE_CHANNEL_URL, BIBO_YOUTUBE_SUBSCRIBE_URL, ...videos]);
    const qr = manifest.qr ?? [];
    expect(qr.length).toBeGreaterThanOrEqual(videos.length + 1);
    const uris = new Set([...body.matchAll(/\/URI\s*\((.*?)\)/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1")));
    for (const { page, url } of qr) {
      expect(allowed.has(url), `page ${page}: ${url}`).toBe(true);
      expect(uris.has(url), `page ${page}: ${url} is also a link`).toBe(true);
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(ACTIVITY_PACK.pages);
    }
  });

  it("pins its inputs: fonts by commit and checksum, Python packages by exact version (review M7)", () => {
    const script = readFileSync(join(root, "scripts/freebie/build_activity_pack.py"), "utf8");
    const fonts = [...script.matchAll(/"(https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[^"]+)",\s*"([0-9a-f]*)"/g)];
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    for (const [, url, sha] of fonts) {
      expect(url, url).toMatch(/\/google\/fonts\/[0-9a-f]{40}\//);
      expect(sha, url).toMatch(/^[0-9a-f]{64}$/);
    }
    const dependencies = /# dependencies = \[([\s\S]*?)# \]/.exec(script)?.[1] ?? "";
    const pins = dependencies.split(/\r?\n/).map((line) => line.replace(/^#\s*/, "").trim()).filter(Boolean);
    expect(pins.length).toBeGreaterThanOrEqual(5);
    for (const pin of pins) expect(pin).toMatch(/^"[a-z0-9-]+==[0-9][0-9.]*",?$/);
  });

  it("prints the site's own video titles and friends, so the pack and the page never disagree", () => {
    expect(manifest.videos).toEqual(SAFE_FALLBACK_CONTENT.episodes.map(({ id, title, mediaUrl }) => ({ id, title, url: mediaUrl })));
    expect(manifest.characters).toEqual(SAFE_FALLBACK_CONTENT.characters.map(({ name }) => name));
  });

  it("ships every preview page as a WebP of its registered size", () => {
    const previews = activityPackPreviews();
    expect(previews.length).toBeGreaterThanOrEqual(3);
    for (const preview of previews) {
      expect(preview.alt.length).toBeGreaterThan(10);
      for (const variant of preview.variants) {
        const size = webpSize(fromPublic(variant.src));
        expect(size, variant.src).toEqual({ width: variant.width, height: variant.height });
        expect(fromPublic(variant.src).length, variant.src).toBeLessThanOrEqual(160 * 1024);
      }
    }
  });

  it("is what the site's fallback copy offers, available and free", () => {
    expect(SAFE_FALLBACK_CONTENT.lead.leadMagnet).toEqual({
      title: "Bibo Bay Activity Pack",
      description: expect.stringMatching(/printable pages/),
      fileUrl: ACTIVITY_PACK.fileUrl,
      available: true,
    });
  });
});

describe("absoluteFileUrl (for the acknowledgement email)", () => {
  const origin = new URL("https://bibobay.example/");
  it("resolves a repository file against the site's verified origin", () => {
    expect(absoluteFileUrl(ACTIVITY_PACK.fileUrl, origin)).toBe("https://bibobay.example/freebies/bibo-bay-activity-pack.pdf");
  });
  it("keeps an https file as it is, and gives nothing for a repository file while the origin is unknown", () => {
    expect(absoluteFileUrl("https://cdn.sanity.io/files/abc/production/sheet.pdf", null)).toBe("https://cdn.sanity.io/files/abc/production/sheet.pdf");
    expect(absoluteFileUrl(ACTIVITY_PACK.fileUrl, null)).toBeNull();
    expect(absoluteFileUrl("javascript:alert(1)", origin)).toBeNull();
    expect(absoluteFileUrl("//evil.example/x.pdf", origin)).toBeNull();
  });
});
