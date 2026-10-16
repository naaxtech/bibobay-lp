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
  /** The order pad (Task 6): shown only while commerce is enabled. */
  orderPad: {
    add: "Add to order",
    /** Names the new quantity, so a repeated add is announced again. */
    added: (quantity: number) => (quantity === 1 ? "Added to your order." : `Added to your order: ${quantity} now.`),
    notSaved: "This browser could not save it, so it lasts only while this page is open.",
    atMost: (quantity: number) => `Your order already has ${quantity} of this, the most one order can hold.`,
    full: (lines: number) => `Your order already holds ${lines} different products, the most it can. Remove one to add another.`,
    title: "Your order",
    empty: "Nothing on your order yet.",
    quantity: "Quantity",
    remove: "Remove",
    review: "Review your order",
  },
  /**
   * The shop (Task 7b): shown only while commerce is enabled. The shop's own heading is the CMS
   * label of the shop link (`navigation.commerceLabel`). No prices exist anywhere in the shop:
   * orders are requests, and staff reply by email with a quote (spec §10).
   */
  shop: {
    intro: "Choose what you would like and send us an order request. No prices are shown here and nothing is charged: we reply by email with a quote and a payment link.",
    metaDescription: "Choose BIBO Bay products and send an order request. Nothing is charged on this website.",
    empty: "There is nothing in the shop just now.",
    backHome: "Back to the home page",
    /** Heading for listed products without a category, when other products have one. */
    moreProducts: "More from the shop",
    soldOut: "Sold out",
    soldOutNote: "This product is sold out, so it cannot be added to an order at the moment.",
    details: "Details",
    facts: { sku: "Product code", variant: "Variant", pack: "Pack" },
    /** Names the list of a product's further pictures for assistive technology. */
    morePictures: (name: string) => `More pictures of ${name}`,
    backToShop: "Back to the shop",
  },
  /** The last-resort error page (app/global-error.tsx): no internal detail. */
  globalError: {
    title: "Something went wrong",
    body: "Sorry, this page could not be shown just now. Please try again in a moment.",
    retry: "Try again",
    home: "Back to Bibo Bay",
  },
  /** Visit statistics (ruling R70): the footer's choices dialog. */
  analytics: {
    choices: "Analytics choices",
    explainer: [
      "BIBO Bay counts visits to learn which pages, videos and activities families use, and how they find us: the page, the site or campaign that sent you, your browser, operating system and device type, your browser's language and time zone, how far you scroll and how long you stay, and which buttons and links you choose.",
      "It uses no cookies and builds no profile of you. To count visitors, PostHog combines your network address and browser details with a value that changes every day, and does not keep the address. It never records what you type into the form. A browser that sends Global Privacy Control or Do Not Track is not counted.",
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
