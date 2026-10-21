import { stegaCleanText } from "./stega";
import type { BrandPillar, Character, SectionId } from "./types";

/*
 * Repository brand art (ruling R58): stills cut from the Bibo Bay channel's own published videos,
 * and those videos' YouTube thumbnails, served from this site (public/brand/art/). Every art slot
 * resolves CMS image → this art → the drawn placeholder. When marketing's official files arrive they
 * replace these slot for slot.
 *
 * How a still is cut (so it can be cut again): take the frame at the stated moment from the video's
 * 1080p stream (`ffmpeg -ss <m:ss> -i <video> -frames:v 1`), crop the stated box from the 1920x1080
 * frame, resize with Lanczos to the registered width, and save as WebP (quality 78; the pre-sized
 * variants at quality 80). Thumbnails are the videos' own YouTube thumbnails at 960 px.
 *
 * Each still also ships pre-sized at every standard width below its own (`<name>-<width>.webp`), and
 * the page offers them as a srcset (ruling R65): static files any host serves from its CDN, with no
 * resizing at request time. (Next's runtime optimiser in `next start` 16.3.8 can leave a size hung
 * for good when a browser abandons its first request for it, so it is not used for this art.)
 *
 * `source` names the channel video each still comes from: its youtube.com id, the moment in it and
 * the crop box (`x,y wxh`) in the 1920x1080 frame. Thumbnails and the small value stickers sit beside
 * their own title or value, so they are decorative (empty alt); every other still is described.
 */
/** The pre-sized widths every still ships at, where smaller than the still itself. */
export const VARIANT_WIDTHS = [160, 320, 480, 640, 960, 1280] as const;

export interface BrandArt {
  /** Path under public/ of the full-size still. */
  src: string;
  width: number;
  height: number;
  /** Every pre-sized file and the still itself, smallest first, as an `<img srcset>` value. */
  srcSet: string;
  /** Alt text; "" when the art sits beside words that already say what it shows. */
  alt: string;
  /** CSS object-position that keeps the subject in view when a frame crops the still. */
  position?: string;
  source: string;
}

const variantWidths = (width: number) => VARIANT_WIDTHS.filter((size) => size < width);

const art = (name: string, width: number, height: number, alt: string, source: string, position?: string): BrandArt => ({
  src: `/brand/art/${name}.webp`,
  width,
  height,
  srcSet: [...variantWidths(width).map((size) => `/brand/art/${name}-${size}.webp ${size}w`), `/brand/art/${name}.webp ${width}w`].join(", "),
  alt,
  source,
  ...(position ? { position } : {}),
});

const FRIENDS = {
  tula: art("friend-tula", 1160, 870, "Tula the Turtle, a smiling green sea turtle, swimming through bubbles on the reef.", "V4HEDvQD7vg at 0:17, crop 260,120 1160x870", "50% 30%"),
  bob: art("friend-bob", 1200, 900, "Bob the Fish, an orange-and-white clownfish, swimming past pink coral.", "CvQeoCVk_mc at 0:03, crop 270,105 1200x900"),
  lumi: art("friend-lumi", 1200, 900, "Lumi, a lilac octopus, waving among the bubbles with Bob and Tula beside her.", "3birY6XZ3_c at 0:36, crop 440,100 1200x900", "50% 35%"),
} as const;

const PILLARS = {
  bright: art("pillar-bright", 480, 480, "", "CvQeoCVk_mc at 0:45, crop 420,0 1080x1080"),
  kind: art("pillar-kind", 480, 480, "", "1pp8G-bKeik at 1:06, crop 420,0 1080x1080"),
  feelings: art("pillar-feelings", 480, 480, "", "V4HEDvQD7vg at 0:45, crop 340,0 1080x1080"),
  capable: art("pillar-capable", 480, 480, "", "yrpyvb5dVbA at 0:24, crop 420,0 1080x1080"),
  imagine: art("pillar-imagine", 480, 480, "", "V4HEDvQD7vg at 1:24, crop 340,0 1080x1080"),
  planet: art("pillar-planet", 480, 480, "", "yrpyvb5dVbA at 0:30, crop 500,0 1080x1080"),
} as const;

const VIDEO_IDS = ["3birY6XZ3_c", "1pp8G-bKeik", "6URNMNeC_3Y", "RNfHUxM-Bso", "CvQeoCVk_mc", "yrpyvb5dVbA", "V4HEDvQD7vg"] as const;

export const BRAND_ART = {
  sections: {
    hero: art("hero-trio", 1600, 880, "Tula the turtle, Bob the clownfish and Lumi the octopus on the sandy floor of a sunlit coral reef.", "3birY6XZ3_c at 0:48, crop 160,180 1600x880", "50% 45%"),
    promise: art("theme-babies", 1200, 800, "Five smiling babies in sea-creature onesies sitting together on the sand under the sea.", "V4HEDvQD7vg at 0:12, crop 240,0 1620x1080"),
    offline: art("theme-explorer", 800, 800, "Tula in an explorer's hat, setting off along a sunny jungle path.", "yrpyvb5dVbA at 0:42, crop 560,80 1000x1000", "50% 40%"),
    pillars: art("theme-fruits", 1000, 750, "A smiling red apple with a little round door, from Tula's fruit adventure.", "RNfHUxM-Bso at 0:02, crop 400,60 1240x930"),
    lead: art("theme-baby", 1000, 750, "A laughing baby in a lilac octopus hood under the sea.", "V4HEDvQD7vg at 0:09, crop 360,0 1440x1080", "50% 30%"),
    finalCta: art("finale-reef", 1600, 758, "Bob, Lumi and Tula under sunbeams on the reef floor of Bibo Bay.", "3birY6XZ3_c at 0:06, crop 0,170 1920x910", "50% 60%"),
  } satisfies Partial<Record<SectionId, BrandArt>>,
  friends: FRIENDS,
  pillars: PILLARS,
  videos: Object.fromEntries(VIDEO_IDS.map((id) => [id, art(`video-${id}`, 960, 540, "", `${id} thumbnail`)])) as Record<(typeof VIDEO_IDS)[number], BrandArt>,
};

/** Every registered still, once each. */
export function brandArtEntries(): BrandArt[] {
  return [...Object.values(BRAND_ART.sections), ...Object.values(FRIENDS), ...Object.values(PILLARS), ...Object.values(BRAND_ART.videos)];
}

/** Every file the stills ship as (each pre-sized width, then the still), with its pixel size. */
export function brandArtFiles(): Array<{ src: string; width: number; height: number }> {
  return brandArtEntries().flatMap((still) => [
    ...variantWidths(still.width).map((width) => ({
      src: still.src.replace(/\.webp$/, `-${width}.webp`),
      width,
      height: Math.round((still.height * width) / still.width),
    })),
    { src: still.src, width: still.width, height: still.height },
  ]);
}

const own = <T extends object>(table: T, key: string): T[keyof T] | undefined =>
  Object.hasOwn(table, key) ? table[key as keyof T] : undefined;

/** A Studio document id without its type prefix (`character-tula` → `tula`). */
const bareId = (id: string, type: string) => (id.startsWith(`${type}-`) ? id.slice(type.length + 1) : id);

/**
 * A friend's portrait, by first name: the portrait's alt text names the friend, so it may only ever
 * stand beside that friend. A seeded document an editor renames for someone else gets none (and keeps
 * the drawn placeholder) rather than another friend's face.
 */
export function friendArt(friend: Pick<Character, "id" | "name">): BrandArt | undefined {
  // In a Studio preview the name carries a click-to-edit payload (R160); the lookup reads the plain name.
  const firstName = stegaCleanText(friend.name).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return own(FRIENDS, firstName);
}

/** A value's sticker, by Studio id. */
export function pillarArt(pillar: Pick<BrandPillar, "id">): BrandArt | undefined {
  return own(PILLARS, bareId(pillar.id, "brandPillar"));
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID = /^[\w-]{11}$/;

/** The video id in a YouTube watch, short or share link; nothing for any other link. */
export function youtubeVideoId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  let id: string | null | undefined;
  if (parsed.hostname === "youtu.be") id = parsed.pathname.split("/")[1];
  else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
    id = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : /^\/shorts\/([^/]+)/.exec(parsed.pathname)?.[1];
  }
  return id && VIDEO_ID.test(id) ? id : undefined;
}

/** The thumbnail of a channel video this site carries, from any YouTube link to it. */
export function videoArt(url: string | undefined): BrandArt | undefined {
  const id = youtubeVideoId(url);
  return id ? own(BRAND_ART.videos, id) : undefined;
}
