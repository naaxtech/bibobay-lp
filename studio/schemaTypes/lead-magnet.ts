/*
 * The download's "Coming soon" switch (ruling R240). The Studio is built and installed on its own,
 * so it keeps its own copy of the wording the site shows when a coming-soon field is left empty
 * (lib/content/fallback.ts COMING_SOON_FALLBACK); tests/content/activity-pack-coming-soon.test.tsx
 * pins the two copies together.
 */

/** What the site says while the download is coming soon and its own wording is left empty. No word promises the file. */
export const COMING_SOON_DEFAULTS = {
  note: "We are putting the finishing touches on it. Join the list to hear about it first.",
  description: "Sign up with your email to hear first about new adventures in the Bay. Our free activity pack is coming soon.",
  buttonLabel: "Join the list",
} as const;

/** A coming-soon card shows the download's title, so it needs one. */
export function comingSoonProblem(comingSoon: unknown, title: unknown): true | string {
  if (comingSoon !== true) return true;
  return typeof title === "string" && title.trim() !== "" ? true : "Give the download a title before showing it as coming soon";
}
