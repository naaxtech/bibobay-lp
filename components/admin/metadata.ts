import type { Metadata } from "next";

/**
 * The metadata of one staff page (Task 8c, ruling R101): its own title, which app/admin/layout.tsx
 * puts into the "Staff | ..." template, and no indexing. The layout says the same for every page
 * under it; a page repeats it so a page moved out of the layout is still never indexed.
 */
export function staffMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}
