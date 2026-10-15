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
  /** Visit statistics (ruling R70): the footer's choices dialog. */
  analytics: {
    choices: "Analytics choices",
    explainer: [
      "BIBO Bay counts visits to learn which pages, videos and activities families use, and how they find us: the page, the site or campaign that sent you, your browser and device type, and which buttons and links you choose.",
      "It uses no cookies and builds no profile of you. It never records what you type into the form. A browser that sends Global Privacy Control or Do Not Track is not counted.",
      "If you turn statistics off, this browser remembers that choice on your device.",
    ],
    statusOn: "Visit statistics are on for this browser.",
    statusOff: "Visit statistics are off for this browser.",
    turnOff: "Turn statistics off",
    turnOn: "Turn statistics on",
  },
  /** The download card's button; the file's own title follows for assistive technology. */
  downloadFreebie: "Download the free pack",
  /** The repository pack's format line, from its real page count and size. */
  freebieMeta: (pages: number, bytes: number) => `PDF · ${pages} pages · ${Math.max(0.1, Math.round(bytes / 104857.6) / 10)} MB`,
  /** Joins a video's title to its way out, for assistive technology ("Watch on YouTube: <title>"). */
  videoLinkTitle: (title: string) => `: ${title}`,
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
