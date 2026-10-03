import { describe, expect, it } from "vitest";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS, SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";

describe("truthful offline content", () => {
  it("contains the six existing character concepts and labels all stories as concepts", () => {
    expect(SAFE_FALLBACK_CONTENT.characters.map((c) => c.name)).toEqual([
      "Ollie the Sea Otter", "Wally the Whale Shark", "Shelly the Sea Turtle", "Pip the Little Squid", "Finny the Clownfish", "Pearl in the Shell",
    ]);
    expect(SAFE_FALLBACK_CONTENT.episodes.length).toBeGreaterThan(0);
    expect(SAFE_FALLBACK_CONTENT.episodes.every((episode) => episode.status === "concept")).toBe(true);
    expect(SAFE_FALLBACK_CONTENT.ecosystem.map((entry) => entry.name)).toEqual([
      "BIBO Academy", "BIBO Lab", "BIBO Play", "BIBO Planet", "BIBO Makes", "BIBO Books", "BIBO at Home", "BIBO Shop",
    ]);
  });

  it("does not fabricate audience size, episode duration, media, delivery, expert proof, or testimonials", () => {
    const text = JSON.stringify(SAFE_FALLBACK_CONTENT).toLowerCase();
    expect(text).not.toMatch(/11.minute|12.minute|pilot episode|as seen on|educator.approved|created with early childhood educators|starter kit|download free|free printable|thousands of families/);
    expect(SAFE_FALLBACK_CONTENT.testimonials).toEqual([]);
    expect(SAFE_FALLBACK_CONTENT.sections.find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect(SAFE_FALLBACK_SETTINGS.socialLinks).toEqual([]);
    expect([SAFE_FALLBACK_SETTINGS.commerceEnabled, SAFE_FALLBACK_SETTINGS.trackingEnabled, SAFE_FALLBACK_SETTINGS.testimonialsEnabled]).toEqual([false, false, false]);
    expect(SAFE_FALLBACK_LEGAL.privacy).toEqual([]);
  });
});
