import Link from "next/link";
import type { ReactNode } from "react";

import { PAGE_COPY } from "./page-copy";
import { SignOutButton } from "./SignOutButton";

export interface AdminFrameProps {
  /** True while an active staff session exists: the site name then links to the orders and sign-out shows. */
  signedIn: boolean;
  /** True when a staff session cookie is on the request, whether or not it could be checked: sign-out then shows too. */
  canSignOut?: boolean;
  children: ReactNode;
}

/**
 * The staff frame (Task 8c, ruling R101): a skip link, a plain header with the site's name and a
 * "Staff" label, and the page's one `<main>`. No marketing navigation, no footer, no order pad, no
 * motion layer. Rendered by app/admin/layout.tsx, so every staff page has it and no page renders it
 * itself. A server component: only the sign-out button is a client component.
 */
export function AdminFrame({ signedIn, canSignOut = false, children }: AdminFrameProps) {
  const name = (
    <>
      <span className="admin-header__site">{PAGE_COPY.frame.siteTitle}</span>
      <span className="admin-header__label">{PAGE_COPY.frame.staffLabel}</span>
    </>
  );
  return (
    <div className="admin-shell" data-ground="paper">
      <a href="#main-content" className="skip-link">
        {PAGE_COPY.frame.skipToContent}
      </a>
      <header className="admin-header">
        <div className="landing-container admin-header__inner">
          {signedIn ? (
            <Link href="/admin/orders" className="admin-header__name">
              {name}
            </Link>
          ) : (
            <p className="admin-header__name">{name}</p>
          )}
          {signedIn || canSignOut ? <SignOutButton /> : null}
        </div>
      </header>
      <main id="main-content" className="admin-main">
        <div className="landing-container">{children}</div>
      </main>
    </div>
  );
}
