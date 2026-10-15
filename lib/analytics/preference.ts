/**
 * A visitor's analytics choice (ruling R70). Statistics are on unless the visitor turns them off
 * (footer "Analytics choices") or the browser sends Global Privacy Control or Do Not Track. An
 * explicit choice made on this site wins over the browser signal. The choice is kept on this
 * device only, in local storage, because it has to survive a reload; nothing else is stored.
 */
export const ANALYTICS_PREFERENCE_KEY = "bibo.analytics.v1";

export type AnalyticsChoice = "on" | "off";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChoice(): AnalyticsChoice | null {
  try {
    const value = storage()?.getItem(ANALYTICS_PREFERENCE_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

export function writeChoice(choice: AnalyticsChoice): void {
  try {
    storage()?.setItem(ANALYTICS_PREFERENCE_KEY, choice);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
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
