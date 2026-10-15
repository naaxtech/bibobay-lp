/**
 * Analytics configuration (ruling R70). Both values are public by design: a PostHog project key
 * can only send events. Read on the server at request time and handed to the client as props, so
 * a deployment can switch analytics on or off without a rebuild. Absent or malformed: no analytics,
 * no request to PostHog, no "Analytics choices" link.
 */
export interface AnalyticsConfig {
  /** PostHog project key (`phc_…`). */
  key: string;
  /** Exact https origin events are sent to. */
  apiHost: string;
}

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

const PROJECT_KEY = /^phc_[A-Za-z0-9]{20,64}$/;

function exactHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function analyticsConfig(
  env: Record<string, string | undefined> = { NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST },
): AnalyticsConfig | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
  if (!PROJECT_KEY.test(key)) return null;
  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST;
  const apiHost = exactHttpsOrigin(host);
  return apiHost ? { key, apiHost } : null;
}
