import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_ART, VARIANT_WIDTHS, brandArtEntries, brandArtFiles, friendArt, pillarArt, videoArt, youtubeVideoId } from "@/lib/content/brand-art";
import { BIBO_VIDEO_IDS, SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

// Ruling R58: repository art is cut from the Bibo Bay channel's own published videos, lives in
// public/brand/art/, and fills every art slot the CMS leaves empty.

const ART_DIR = join(process.cwd(), "public", "brand", "art");
const BUDGET_BYTES = 128 * 1024;

/** Pixel size from a WebP header: lossy (VP8), lossless (VP8L) or extended (VP8X). */
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

describe("repository brand art (ruling R58)", () => {
  const entries = brandArtEntries();

  it("ships every registered still and each of its sizes as a WebP of the stated size, inside the weight budget", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const file of brandArtFiles()) {
      expect(file.src, file.src).toMatch(/^\/brand\/art\/[\w-]+\.webp$/);
      const bytes = readFileSync(join(ART_DIR, file.src.replace("/brand/art/", "")));
      expect(webpSize(bytes), file.src).toEqual({ width: file.width, height: file.height });
      expect(bytes.length, `${file.src} weighs ${bytes.length} bytes`).toBeLessThanOrEqual(BUDGET_BYTES);
    }
  });

  it("offers every standard width below a still's own as a pre-sized file, so no server resizes at request time", () => {
    for (const art of entries) {
      const widths = art.srcSet.split(", ").map((candidate) => Number(/ (\d+)w$/.exec(candidate)?.[1]));
      expect(widths, art.src).toEqual([...VARIANT_WIDTHS.filter((width) => width < art.width), art.width]);
      expect(art.srcSet.endsWith(`${art.src} ${art.width}w`), art.src).toBe(true);
    }
  });

  it("ships no file the registry does not know, so nothing unreviewed reaches the site", () => {
    const registered = new Set(brandArtFiles().map((file) => file.src.replace("/brand/art/", "")));
    expect(readdirSync(ART_DIR).filter((file) => !registered.has(file))).toEqual([]);
  });

  it("cuts every still from one of the channel's verified videos", () => {
    const verified = Object.values(BIBO_VIDEO_IDS);
    for (const art of entries) {
      expect(verified.some((id) => art.source.includes(id)), `${art.src}: ${art.source}`).toBe(true);
    }
  });

  it("records where each still was cut, so it can be cut again (rebrand review M4)", () => {
    for (const art of entries) {
      if (art.source.endsWith("thumbnail")) continue;
      // `<video id> at m:ss, crop x,y wxh` in the 1920x1080 frame, scaled to the still's own shape.
      const crop = /^[\w-]{11} at \d+:\d{2}, crop (\d+),(\d+) (\d+)x(\d+)$/.exec(art.source);
      expect(crop, `${art.src}: ${art.source}`).not.toBeNull();
      const [x, y, w, h] = crop!.slice(1).map(Number) as [number, number, number, number];
      expect(x + w, art.src).toBeLessThanOrEqual(1920);
      expect(y + h, art.src).toBeLessThanOrEqual(1080);
      expect(Math.abs(w / h - art.width / art.height), art.src).toBeLessThan(0.01);
    }
  });

  it("gives every fallback friend, video and value its own art", () => {
    for (const friend of SAFE_FALLBACK_CONTENT.characters) expect(friendArt(friend), friend.name).toBeDefined();
    for (const video of SAFE_FALLBACK_CONTENT.episodes) expect(videoArt(video.mediaUrl), video.title).toBeDefined();
    for (const pillar of SAFE_FALLBACK_CONTENT.pillars) expect(pillarArt(pillar), pillar.title).toBeDefined();
    for (const slot of ["hero", "promise", "offline", "pillars", "lead", "finalCta"] as const) expect(BRAND_ART.sections[slot], slot).toBeDefined();
  });

  it("describes every friend and scene; only thumbnails and value stickers beside their own words are decorative", () => {
    for (const friend of SAFE_FALLBACK_CONTENT.characters) {
      const firstName = friend.name.split(" ")[0]!;
      expect(friendArt(friend)!.alt, friend.name).toContain(firstName);
    }
    for (const art of Object.values(BRAND_ART.sections)) expect(art.alt.length, art.src).toBeGreaterThan(20);
    for (const art of [...Object.values(BRAND_ART.videos), ...Object.values(BRAND_ART.pillars)]) expect(art.alt, art.src).toBe("");
  });

  it("finds a video's thumbnail from any YouTube link to it, and nothing for any other link", () => {
    const id = BIBO_VIDEO_IDS.countToTen;
    for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=10`, `https://m.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://www.youtube.com/shorts/${id}`]) {
      expect(youtubeVideoId(url), url).toBe(id);
      expect(videoArt(url)?.src, url).toBe(`/brand/art/video-${id}.webp`);
    }
    for (const url of [undefined, "", "not a url", `https://example.com/watch?v=${id}`, "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=AAAAAAAAAAA"]) {
      expect(videoArt(url), String(url)).toBeUndefined();
    }
    expect(youtubeVideoId(`https://evil.example/?u=https://youtu.be/${id}`)).toBeUndefined();
  });

  it("matches a friend by first name, and never shows one friend's portrait for another (rebrand review M2)", () => {
    expect(friendArt({ id: "character-bob", name: "Bob the Fish" })).toBe(BRAND_ART.friends.bob);
    expect(friendArt({ id: "6f1c2b3a", name: "Lumi" })).toBe(BRAND_ART.friends.lumi);
    expect(friendArt({ id: "tula", name: "Tula the Turtle" })).toBe(BRAND_ART.friends.tula);
    // A seeded document renamed for someone else gets no portrait: its alt text would name the wrong friend.
    expect(friendArt({ id: "character-bob", name: "Pip the Squid" })).toBeUndefined();
    expect(friendArt({ id: "character-pip", name: "Pip the Little Squid" })).toBeUndefined();
    // Inherited object keys are never a match.
    expect(friendArt({ id: "constructor", name: "toString" })).toBeUndefined();
    expect(pillarArt({ id: "brandPillar-kind" })).toBe(BRAND_ART.pillars.kind);
    expect(pillarArt({ id: "unknown" })).toBeUndefined();
  });
});
