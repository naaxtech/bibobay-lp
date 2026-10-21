import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { cookies, draftMode } from "next/headers";

import { getSanityClient } from "@/lib/sanity/client";
import { handleDraftModeEnable } from "@/lib/sanity/draft-mode";

/**
 * Entry point for Sanity Presentation (ruling R33). Set the Studio's presentationTool
 * `previewMode.enable` to this path. Without SANITY_API_READ_TOKEN it answers 503. It also keeps the
 * draft cookie alive in the Studio's cross-site iframe and stores the Studio's perspective (R162, R163).
 */
export async function GET(request: Request) {
  const draft = await draftMode();
  return handleDraftModeEnable(request, {
    client: getSanityClient({ preview: true }),
    validate: validatePreviewUrl,
    enable: () => draft.enable(),
    cookies: await cookies(),
    secure: process.env.NODE_ENV === "production",
  });
}
