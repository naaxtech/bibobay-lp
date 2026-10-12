import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { draftMode } from "next/headers";

import { getSanityClient } from "@/lib/sanity/client";
import { handleDraftModeEnable } from "@/lib/sanity/draft-mode";

/**
 * Entry point for Sanity Presentation (ruling R33). Set the Studio's presentationTool
 * `previewMode.enable` to this path. Without SANITY_API_READ_TOKEN it answers 503.
 */
export async function GET(request: Request) {
  const draft = await draftMode();
  return handleDraftModeEnable(request, {
    client: getSanityClient({ preview: true }),
    validate: validatePreviewUrl,
    enable: () => draft.enable(),
  });
}
