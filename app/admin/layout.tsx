import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminFrame } from "@/components/admin/AdminFrame";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { staffPageAccess } from "@/lib/admin/access";

/**
 * The staff frame around every page under /admin (Task 8c, ruling R101). It asks who is looking
 * (the pages ask again, but the answer is shared per request) only to decide whether the sign-out
 * button shows; each page does its own redirect or notice. lib/security/headers.ts sends this path
 * with no-store, no referrer and noindex; the metadata says noindex too, and every title starts
 * with "Staff". The root layout's cookieless visit statistics stay as they are.
 */
export const metadata: Metadata = {
  title: { default: PAGE_COPY.frame.titleDefault, template: PAGE_COPY.frame.titleTemplate },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await staffPageAccess();
  return <AdminFrame signedIn={access.kind === "staff"}>{children}</AdminFrame>;
}
