import Link from "next/link";

import { LocalTime } from "@/components/orders/LocalTime";
import type { AdminOrderSummary } from "@/lib/orders/admin";
import { PAGE_COPY } from "./page-copy";

const COPY = PAGE_COPY.orders;

/**
 * The staff order list (Task 8c, ruling R100), newest first as the read returns it: reference (a
 * link to the order), status, when it was submitted and last changed, the contact's name, country,
 * the quote's revision and whether the mail service has accepted that revision's quote email
 * (`quoteSentAt` is set only for the current revision, fix wave C-I1, and the cell names it; nothing
 * here says it was delivered). A server component; the times are
 * LocalTime, UTC in the server HTML and the viewer's zone once hydrated. The table scrolls inside
 * its own focusable region on a narrow screen, so the page itself never scrolls sideways.
 */
export function OrdersTable({ orders }: { orders: readonly AdminOrderSummary[] }) {
  return (
    <div className="admin-table-wrap" role="region" aria-label={COPY.tableCaption} tabIndex={0}>
      <table className="admin-table">
        <caption className="sr-only">{COPY.tableCaption}</caption>
        <thead>
          <tr>
            {Object.values(COPY.columns).map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <th scope="row">
                <Link href={`/admin/orders/${encodeURIComponent(order.reference)}`} className="text-link">
                  {order.reference}
                </Link>
              </th>
              <td>
                <span className="admin-badge" data-status={order.status}>
                  {PAGE_COPY.statusNames[order.status]}
                </span>
              </td>
              <td>
                <LocalTime iso={order.createdAt} />
              </td>
              <td>
                <LocalTime iso={order.statusChangedAt} />
              </td>
              <td>{order.contactName}</td>
              <td>{order.country}</td>
              <td>{order.quoteRevision < 1 ? COPY.values.noQuote : `${COPY.values.revision} ${order.quoteRevision}`}</td>
              <td>
                {order.quoteSentAt ? (
                  <>
                    {`${COPY.values.accepted} (${COPY.values.revision.toLowerCase()} ${order.quoteRevision})`} <LocalTime iso={order.quoteSentAt} />
                  </>
                ) : (
                  COPY.values.notYet
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
