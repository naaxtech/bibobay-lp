"use client";

import { useSyncExternalStore } from "react";

/** True once React has hydrated; false in server HTML (as components/forms/LeadForm.tsx). */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

/**
 * An order date in English with its time zone named: the visitor's own zone, or `timeZone` when
 * given ("October 14, 2026 at 9:30 AM UTC").
 */
export function formatOrderTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/**
 * A `<time>` for an order date (Task 7c). The server cannot know the visitor's time zone, so its
 * HTML says the time in UTC, named as such; once the page has hydrated the same element shows the
 * visitor's own zone. Nothing waits for the browser, and hydration matches the server HTML.
 */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return <time dateTime={iso}>{formatOrderTime(date, hydrated ? undefined : "UTC")}</time>;
}
