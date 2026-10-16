/**
 * A visitor's answer about visit statistics (ruling R144, which replaces R70's opt-out). Statistics
 * are opt-in: nothing is counted until the visitor says yes, in the consent notice or under the
 * footer's "Analytics choices". A browser that sends Global Privacy Control or Do Not Track is not
 * asked (ruling R147), and an explicit answer made on this site wins over the browser signal. The
 * answer is kept on this device only, in local storage, because it has to survive a reload and is
 * what stops the notice from asking again; nothing else is stored.
 */
export const ANALYTICS_PREFERENCE_KEY = "bibo.analytics.v1";

export type AnalyticsChoice = "on" | "off";

/**
 * Review M3: this page's own choice, for browsers that block storage. Without it, a "yes" would read
 * back as no answer, so such a visitor could never turn statistics on and would be asked again.
 */
let pageChoice: AnalyticsChoice | null = null;
/** True while the device refused this page's latest choice: then the page's choice wins. */
let unsaved = false;

/** Everything on this page that follows the answer: the consent notice and the provider. */
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

/**
 * Another tab wrote the answer, or cleared the site's storage (a null key). The browser fires
 * `storage` only in the other tabs, so this one learns of the change here and reads the answer
 * again. After a clear, an answer this page gave itself still stands (`readChoice` falls back to
 * it; clearing site data is not a "no"); a page that only had the stored answer now has none.
 */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === ANALYTICS_PREFERENCE_KEY) notify();
}

/** The stored choice (it may come from another tab), else the one made on this page. */
export function readChoice(): AnalyticsChoice | null {
  if (unsaved) return pageChoice;
  try {
    const value = storage()?.getItem(ANALYTICS_PREFERENCE_KEY);
    if (value === "on" || value === "off") return value;
  } catch {
    // Storage is blocked: fall back to this page's choice.
  }
  return pageChoice;
}

/** Keeps the answer on this device (or for this page, when the device refuses it) and tells the listeners. */
export function writeChoice(choice: AnalyticsChoice): void {
  pageChoice = choice;
  unsaved = true;
  try {
    const device = storage();
    if (device) {
      device.setItem(ANALYTICS_PREFERENCE_KEY, choice);
      unsaved = false;
    }
  } catch {
    // Storage blocked or full: the choice lasts for this page, ahead of any older stored one.
  }
  notify();
}

/**
 * Calls `listener` after every `writeChoice` on this page and after a `storage` event for the key
 * (an answer given in another tab). Returns the unsubscribe. Shaped for `useSyncExternalStore`.
 */
export function subscribeChoice(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function forgetChoiceForTests(): void {
  pageChoice = null;
  unsaved = false;
  listeners.clear();
  if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
}

/** Global Privacy Control, or the older Do Not Track header: such a browser is not asked. */
export function declinedByBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const signals = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return signals.globalPrivacyControl === true || signals.doNotTrack === "1" || signals.msDoNotTrack === "1";
}

/** Opt-in (ruling R144): true only for a stored or page answer of "on". */
export function analyticsAllowed(): boolean {
  return readChoice() === "on";
}
