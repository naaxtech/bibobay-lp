import "server-only";
import { createClient } from "@sanity/client";
import { securityEnvironment } from "../security/headers";
import { getSanityEnvironment } from "./env";

/** The only read-token access point; do not import into a Client Component. */
export function getSanityClient(options: { preview?: boolean } = {}) {
  const env = getSanityEnvironment();
  if (!env) return null;
  const token = options.preview ? process.env.SANITY_API_READ_TOKEN?.trim() : undefined;
  if (options.preview && !token) return null;
  // Ruling R159: a Studio preview encodes click-to-edit links into its text (stega), pointing at the
  // verified Studio (SANITY_STUDIO_ORIGIN, the origin CSP lets frame the site). Published reads
  // never ask for source maps, and a preview without a verified Studio encodes nothing.
  const studioUrl = options.preview ? securityEnvironment().studioOrigin : null;
  // Tagged revalidation must bypass Sanity's independent CDN layer.
  return createClient({
    ...env,
    useCdn: false,
    perspective: options.preview ? "drafts" : "published",
    ...(token ? { token } : {}),
    stega: studioUrl ? { enabled: true, studioUrl } : { enabled: false },
  });
}
