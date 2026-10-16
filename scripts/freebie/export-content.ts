/**
 * Prints the site copy the activity pack is built from, as JSON on stdout, so the printable pack
 * and the website always tell the same story (the pack generator runs this through tsx).
 * Usage: npx tsx scripts/freebie/export-content.ts
 */
import { BIBO_YOUTUBE_CHANNEL_URL, BIBO_YOUTUBE_SUBSCRIBE_URL, SAFE_FALLBACK_CONTENT } from "../../lib/content/fallback";

const { characters, episodes } = SAFE_FALLBACK_CONTENT;

process.stdout.write(
  JSON.stringify({
    channelUrl: BIBO_YOUTUBE_CHANNEL_URL,
    subscribeUrl: BIBO_YOUTUBE_SUBSCRIBE_URL,
    characters: characters.map(({ id, name, species, role, description }) => ({ id, name, species, role, description })),
    episodes: episodes.map(({ id, title, summary, mediaUrl }) => ({ id, title, summary, mediaUrl })),
  }),
);
