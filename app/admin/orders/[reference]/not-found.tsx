import Link from "next/link";

import { staffMetadata } from "@/components/admin/metadata";
import { PAGE_COPY } from "@/components/admin/page-copy";

/** Titled and noindex like every staff page; the frame comes from app/admin/layout.tsx. */
export const metadata = staffMetadata(PAGE_COPY.detail.notFoundPageTitle);

/**
 * The 404 for /admin/orders/<reference> (Task 8c): a malformed reference and one no order has look
 * the same. Only a signed-in member of staff gets here, since a visitor who is signed out is sent to
 * the sign-in page first.
 */
export default function OrderNotFound() {
  return (
    <section className="admin-notice" aria-labelledby="admin-notice-title">
      <h1 id="admin-notice-title" className="admin-page-title">
        {PAGE_COPY.detail.notFoundTitle}
      </h1>
      <p className="admin-notice__body">{PAGE_COPY.detail.notFoundBody}</p>
      <p>
        <Link href="/admin/orders" className="text-link">
          {PAGE_COPY.detail.backToOrders}
        </Link>
      </p>
    </section>
  );
}
