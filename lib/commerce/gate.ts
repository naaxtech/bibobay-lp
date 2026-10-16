import type { SiteSettings } from "@/lib/content/types";

/**
 * The commerce gate (Task 6, spec §10 "Server gating"). The shop, the order pad, order
 * submission and tracking exist only while the CMS switches commerce on; anything that is not a
 * literal `true` counts as off. Tracking also needs its own flag. Server routes call
 * `assertCommerceEnabled` before doing any work, so a disabled shop answers the same way whatever
 * is asked of it.
 */
type CommerceFlags = Partial<Pick<SiteSettings, "commerceEnabled" | "trackingEnabled">> | null | undefined;

export class CommerceDisabledError extends Error {
  constructor() {
    super("Commerce is not enabled");
    this.name = "CommerceDisabledError";
  }
}

export function isCommerceEnabled(settings: CommerceFlags): boolean {
  return settings?.commerceEnabled === true;
}

export function assertCommerceEnabled(settings: CommerceFlags): void {
  if (!isCommerceEnabled(settings)) throw new CommerceDisabledError();
}

/** Order tracking pages and lookups: commerce on and tracking on. */
export function isTrackingEnabled(settings: CommerceFlags): boolean {
  return isCommerceEnabled(settings) && settings?.trackingEnabled === true;
}
