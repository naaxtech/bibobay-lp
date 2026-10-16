import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AdminFrame } from "@/components/admin/AdminFrame";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { staffPageAccess } from "@/lib/admin/access";
import { STAFF_SESSION_COOKIE } from "@/lib/supabase/staff-session";

/**
 * The staff frame around every page under /admin (Task 8c, ruling R101). It asks who is looking
 * (the pages ask again, but the answer is shared per request) only to decide whether the sign-out
 * button shows (a staff session cookie also shows it); each page does its own redirect or notice. lib/security/headers.ts sends this path
 * with no-store, no referrer and noindex; the metadata says noindex too, and every title starts
 * with "Staff". The root layout's cookieless visit statistics stay as they are.
 */
export const metadata: Metadata = {
  title: { default: PAGE_COPY.frame.titleDefault, template: PAGE_COPY.frame.titleTemplate },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await staffPageAccess();
  // Sign-out clears the session cookies even when Auth is down (R111), so it shows whenever the
  // request carries one, not only when the staff check succeeded. A read: this layout never writes.
  const hasSessionCookie = (await cookies()).getAll().some(({ name }) => STAFF_SESSION_COOKIE.test(name));
  return (
    <AdminFrame signedIn={access.kind === "staff"} canSignOut={hasSessionCookie}>
      {children}
    </AdminFrame>
  );
}
