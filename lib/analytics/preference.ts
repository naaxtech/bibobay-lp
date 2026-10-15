/**
 * A visitor's analytics choice (ruling R70). Statistics are on unless the visitor turns them off
 * (footer "Analytics choices") or the browser sends Global Privacy Control or Do Not Track. An
 * explicit choice made on this site wins over the browser signal. The choice is kept on this
 * device only, in local storage, because it has to survive a reload; nothing else is stored.
 */
export const ANALYTICS_PREFERENCE_KEY = "bibo.analytics.v1";

export type AnalyticsChoice = "on" | "off";

/**
 * Review M3: this page's own choice, for browsers that block storage. Without it, "off" would
 * read back as "on" and a Global Privacy Control visitor could never turn statistics on.
 */
let pageChoice: AnalyticsChoice | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored choice (it may come from another tab), else the one made on this page. */
export function readChoice(): AnalyticsChoice | null {
  try {
    const value = storage()?.getItem(ANALYTICS_PREFERENCE_KEY);
    if (value === "on" || value === "off") return value;
  } catch {
    // Storage is blocked: fall back to this page's choice.
  }
  return pageChoice;
}

export function writeChoice(choice: AnalyticsChoice): void {
  pageChoice = choice;
  try {
    storage()?.setItem(ANALYTICS_PREFERENCE_KEY, choice);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export function forgetChoiceForTests(): void {
  pageChoice = null;
}

/** Global Privacy Control, or the older Do Not Track header, counts as "off". */
export function declinedByBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const signals = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return signals.globalPrivacyControl === true || signals.doNotTrack === "1" || signals.msDoNotTrack === "1";
}

export function analyticsAllowed(): boolean {
  const choice = readChoice();
  return choice === null ? !declinedByBrowser() : choice === "on";
}
