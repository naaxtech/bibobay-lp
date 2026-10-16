import type { RemovalChannel } from "@/lib/leads/removal-channel";

/**
 * Wording for how a person asks to be removed from the founding-family list (Ruling R125). Every
 * sentence names only the channel that exists: the acknowledgement email's reply, or the configured
 * contact address. With neither, nothing is promised (and /api/leads keeps signups closed).
 */

/** "by replying to the acknowledgement email" / "by writing to <address>", or null with no channel. */
export function removalPhrase(channel: RemovalChannel): string | null {
  if (channel === null) return null;
  return channel.kind === "email" ? "by replying to the acknowledgement email" : `by writing to ${channel.email}`;
}

/** The consent sentence plus the removal channel that exists; unchanged when there is none. */
export function consentWithRemoval(consent: string, channel: RemovalChannel): string {
  const phrase = removalPhrase(channel);
  return phrase ? `${consent} I can ask to be removed ${phrase}.` : consent;
}
