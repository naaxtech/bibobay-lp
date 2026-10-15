import { describe, expect, it } from "vitest";
import { BIBO_YOUTUBE_SUBSCRIBE_URL, SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS, SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";

/*
 * The fallback copy follows the Bibo Bay YouTube channel (ruling R55). These ids are the channel's
 * real videos, each opened and checked on 2026-10-15; nothing else may be linked as media.
 */
const CHANNEL = "https://www.youtube.com/@bibobay-tv";
const VERIFIED_VIDEO_IDS = new Set(["3birY6XZ3_c", "1pp8G-bKeik", "6URNMNeC_3Y", "RNfHUxM-Bso", "CvQeoCVk_mc", "yrpyvb5dVbA", "V4HEDvQD7vg"]);

describe("truthful offline content", () => {
  it("introduces the channel's cast: Tula, Bob and Lumi, as published characters", () => {
    expect(SAFE_FALLBACK_CONTENT.characters.map((c) => [c.name, c.species])).toEqual([
      ["Tula the Turtle", "Sea turtle"], ["Bob the Fish", "Clownfish"], ["Lumi", "Octopus"],
    ]);
    expect(SAFE_FALLBACK_CONTENT.characters.every((c) => c.status === "published")).toBe(true);
    expect(SAFE_FALLBACK_CONTENT.ecosystem.map((entry) => entry.name)).toEqual([
      "BIBO Academy", "BIBO Lab", "BIBO Play", "BIBO Planet", "BIBO Makes", "BIBO Books", "BIBO at Home", "BIBO Shop",
    ]);
    expect(SAFE_FALLBACK_CONTENT.ecosystem.every((entry) => entry.status === "idea")).toBe(true);
  });

  it("links only real, published channel videos, each to its youtube.com watch page", () => {
    const { episodes } = SAFE_FALLBACK_CONTENT;
    expect(episodes.length).toBeGreaterThan(0);
    for (const episode of episodes) {
      expect(episode.status, episode.id).toBe("published");
      const match = /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})$/.exec(episode.mediaUrl ?? "");
      expect(match, `${episode.id} links a youtube.com watch page`).not.toBeNull();
      expect(VERIFIED_VIDEO_IDS.has(match![1]!), `${episode.id} is a verified channel video`).toBe(true);
    }
    expect(new Set(episodes.map((episode) => episode.mediaUrl)).size).toBe(episodes.length);
  });

  it("lists the owner-confirmed YouTube channel as its only social link", () => {
    expect(SAFE_FALLBACK_SETTINGS.socialLinks).toEqual([{ platform: "youtube", url: CHANNEL, verified: true }]);
    expect(SAFE_FALLBACK_CONTENT.hero.primaryCta).toEqual({ label: "Watch on YouTube", href: CHANNEL, external: true });
  });

  it("sends the page's calls to action to YouTube, where Bibo Bay is watched (owner directive 2026-10-15)", () => {
    // The channel id behind @bibobay-tv (its canonical /channel/ URL, read 2026-10-15). YouTube's
    // subscribe prompt is only reliable on /channel/<id> URLs, not on @handles.
    expect(BIBO_YOUTUBE_SUBSCRIBE_URL).toBe("https://www.youtube.com/channel/UCFruHuRQ2eOrq9NOyx0K1GA?sub_confirmation=1");
    const subscribe = { label: "Subscribe on YouTube", href: BIBO_YOUTUBE_SUBSCRIBE_URL, external: true };
    expect(SAFE_FALLBACK_SETTINGS.navigation.primaryCta).toEqual(subscribe);
    expect(SAFE_FALLBACK_CONTENT.episodesIntro.cta).toEqual(subscribe);
    expect(SAFE_FALLBACK_CONTENT.finalCta.cta).toEqual(subscribe);
    // One label per intent: every way to the channel says "Watch on YouTube", every subscribe link "Subscribe on YouTube".
    const ctas = JSON.stringify([SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS]).match(/"label":"[^"]*YouTube[^"]*"/g) ?? [];
    expect(new Set(ctas)).toEqual(new Set(['"label":"Watch on YouTube"', '"label":"Subscribe on YouTube"']));
    expect(SAFE_FALLBACK_CONTENT.hero.description).toMatch(/free to watch on YouTube/);
  });

  it("does not fabricate audience size, view counts, delivery, expert proof, or testimonials", () => {
    const text = JSON.stringify(SAFE_FALLBACK_CONTENT).toLowerCase();
    expect(text).not.toMatch(/11.minute|12.minute|pilot episode|as seen on|educator.approved|created with early childhood educators|starter kit|download free|free printable|thousands of families/);
    expect(text).not.toMatch(/\bsubscribers\b|\bviews\b|million|\d+k\b|award|#1|best.selling/);
    expect(SAFE_FALLBACK_CONTENT.testimonials).toEqual([]);
    expect(SAFE_FALLBACK_CONTENT.sections.find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect([SAFE_FALLBACK_SETTINGS.commerceEnabled, SAFE_FALLBACK_SETTINGS.trackingEnabled, SAFE_FALLBACK_SETTINGS.testimonialsEnabled]).toEqual([false, false, false]);
    expect(SAFE_FALLBACK_LEGAL.privacy).toEqual([]);
  });
});

describe("claims about the cast and values (rebrand review M1)", () => {
  it("states no habit the channel never shows: no 'always' or 'often' about a friend", () => {
    for (const friend of SAFE_FALLBACK_CONTENT.characters) expect(friend.description, friend.name).not.toMatch(/\b(?:always|often|never|every time)\b/i);
  });

  it("names only values the channel's own words support", () => {
    const titles = SAFE_FALLBACK_CONTENT.pillars.map(({ title }) => title);
    expect(titles.join(" ")).not.toMatch(/planet|protector|eco|climate/i);
  });
});
