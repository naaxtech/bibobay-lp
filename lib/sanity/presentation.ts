// Route map for Studio Presentation (the Studio itself belongs to Task 2B).
const singletonRoutes: Record<string, string> = { landingPage: "/", siteSettings: "/", legalSettings: "/privacy" };
export function resolvePresentationUrl(type: string, slug?: string): string | null {
  if (Object.hasOwn(singletonRoutes, type)) return singletonRoutes[type]!;
  if (type === "productCategory") return "/shop";
  if (type === "product" && slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return `/shop/${slug}`;
  return null;
}
