import type { Character, EcosystemEntry, SocialPlatform } from "@/lib/content/types";

/**
 * Interface chrome the Sanity content contract does not carry (Task 4 ruling R12): control labels,
 * landmark names and status names only. Every sentence about BIBO itself comes from Sanity.
 * Keep this list short; moving a string into Sanity is a schema change, not an edit here.
 */
export const UI_COPY = {
  skipToContent: "Skip to content",
  mainNavigation: "Main",
  footerNavigation: "Footer",
  menu: "Menu",
  close: "Close",
  opensInNewTab: "(opens in a new tab)",
  /** Only unfinished friends carry a status; an approved friend needs no badge. */
  characterStatus: { concept: "Concept" } satisfies Partial<Record<Character["status"], string>>,
  ecosystemStatus: {
    idea: "Idea",
    "in-development": "In development",
    available: "Available",
  } satisfies Record<EcosystemEntry["status"], string>,
  favoriteActivity: "Favourite thing to do",
  explores: "Explores",
  featuring: "Featuring",
  themes: "Themes",
  tryTogether: "Try together",
  watchStory: "Watch the story",
  /** A published video's way out, when it lives on YouTube (ruling R57: no embed). */
  watchOnYouTube: "Watch on YouTube",
  /** Which story concept of how many is open (read by assistive technology with the open story). */
  storyPosition: (current: number, total: number) => `${current} of ${total}`,
  socialPlatforms: {
    instagram: "Instagram",
    youtube: "YouTube",
    facebook: "Facebook",
    tiktok: "TikTok",
    pinterest: "Pinterest",
  } satisfies Record<SocialPlatform, string>,
} as const;
