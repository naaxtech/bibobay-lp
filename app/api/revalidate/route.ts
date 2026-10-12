import { revalidateTag } from "next/cache";

import { handleRevalidationRequest } from "@/lib/security/revalidation";

/**
 * Sanity GROQ-powered webhook (ruling R32). Configure it in Sanity with this URL, method POST,
 * projection `{_type, _id}`, and the same secret as SANITY_REVALIDATE_SECRET.
 */
export async function POST(request: Request) {
  return handleRevalidationRequest(request, {
    secret: process.env.SANITY_REVALIDATE_SECRET,
    now: () => Date.now(),
    // src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md · next 16.3.8 · 2026-10-13
    // Next 16 takes a second argument. From a webhook (not a Server Action) `{ expire: 0 }` expires the
    // data at once, so the next visitor sees the published change instead of a stale page.
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  });
}
