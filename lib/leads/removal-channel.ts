import { getEmailEnvironment } from "@/lib/email/client";
import type { SiteSettings } from "@/lib/content/types";

/**
 * How a person who joined the founding-family list can ask to be removed (Ruling R125): by replying
 * to the acknowledgement email when email sending is configured, by writing to the configured
 * contact address, or not at all, in which case signups stay closed and nothing is promised.
 */
export type RemovalChannel = { kind: "email" } | { kind: "contact"; email: string } | null;

const ADDRESS_PATTERN = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;

export function removalChannelFrom(
  settings: Pick<SiteSettings, "contactEmail">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RemovalChannel {
  if (getEmailEnvironment({ ...env })) return { kind: "email" };
  const contact = settings.contactEmail?.trim();
  return contact && ADDRESS_PATTERN.test(contact) ? { kind: "contact", email: contact } : null;
}
