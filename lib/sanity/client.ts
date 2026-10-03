import "server-only";
import { createClient } from "next-sanity";
import { getSanityEnvironment } from "./env";

/** The only read-token access point; do not import into a Client Component. */
export function getSanityClient(options: { preview?: boolean } = {}) {
  const env = getSanityEnvironment();
  if (!env) return null;
  const token = options.preview ? process.env.SANITY_API_READ_TOKEN?.trim() : undefined;
  if (options.preview && !token) return null;
  // Tagged revalidation must bypass Sanity's independent CDN layer.
  return createClient({ ...env, useCdn: false, perspective: options.preview ? "drafts" : "published", ...(token ? { token } : {}) });
}
