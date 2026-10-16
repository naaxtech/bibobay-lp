import { getSiteSettings } from "@/lib/sanity/fetch";

/**
 * /studio (spec §5): the Studio is deployed separately. Redirect (307) to the https Studio URL from
 * site settings; without one, there is no Studio here (404). Never redirects to anything else.
 */
export async function GET() {
  const { studioUrl } = await getSiteSettings();
  let target: string | null = null;
  try {
    const url = new URL(studioUrl ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) target = url.href;
  } catch {
    target = null;
  }
  if (!target) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(null, { status: 307, headers: { location: target, "cache-control": "no-store" } });
}
