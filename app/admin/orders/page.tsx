import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminNotice } from "@/components/admin/AdminNotice";
import { staffMetadata } from "@/components/admin/metadata";
import { OrdersTable } from "@/components/admin/OrdersTable";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { staffPageAccess } from "@/lib/admin/access";
import { reportError } from "@/lib/observability/report";
import { listOrders, type AdminOrderSummary } from "@/lib/orders/admin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/constants";

/**
 * The staff order list (Task 8c, rulings R100 and R114). A server component that reads through the
 * signed-in member's own database client (row level security), newest first. A visitor who is
 * signed out goes to the sign-in page (no `next` parameter); an unconfigured or unreachable Supabase
 * shows its notice; a failed read shows the could-not-load notice and is reported (the message
 * says nothing about why). `?status=` filters by one status; anything that is not exactly one of
 * the known statuses (another spelling, a repeated parameter) means no filter.
 */
export const metadata = staffMetadata(PAGE_COPY.orders.pageTitle);

/** The most orders one page lists (listOrders' default); a full list says it may be cut off. */
const LIST_LIMIT = 100;

const knownStatus = (value: string | string[] | undefined): OrderStatus | undefined =>
  typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : undefined;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await staffPageAccess();
  if (access.kind === "signed_out") redirect("/admin/login");
  if (access.kind === "unconfigured") return <AdminNotice {...PAGE_COPY.notices.unconfigured} />;
  if (access.kind === "unavailable") return <AdminNotice {...PAGE_COPY.notices.unavailable} />;

  const status = knownStatus((await searchParams).status);
  let orders: AdminOrderSummary[];
  try {
    orders = await listOrders(access.db, { limit: LIST_LIMIT, ...(status ? { status } : {}) });
  } catch (error) {
    reportError(error, { area: "admin", event: "admin_orders_list_failed" });
    return <AdminNotice {...PAGE_COPY.notices.loadFailed} />;
  }

  const copy = PAGE_COPY.orders;
  return (
    <div className="admin-page">
      <h1 className="admin-page-title">{copy.heading}</h1>
      <p className="admin-lead">{copy.lead}</p>
      <nav aria-label={copy.filterLabel} className="admin-filter">
        <ul className="admin-filter__list">
          <li>
            <Link href="/admin/orders" className="admin-filter__link" aria-current={status ? undefined : "page"}>
              {copy.filterAll}
            </Link>
          </li>
          {ORDER_STATUSES.map((name) => (
            <li key={name}>
              <Link href={`/admin/orders?status=${name}`} className="admin-filter__link" aria-current={status === name ? "page" : undefined}>
                {PAGE_COPY.statusNames[name]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {orders.length === 0 ? (
        <div className="admin-empty">
          <p>{status ? copy.emptyFiltered : copy.empty}</p>
          {status ? (
            <Link href="/admin/orders" className="text-link">
              {copy.showAll}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <OrdersTable orders={orders} />
          {orders.length >= LIST_LIMIT ? <p className="admin-hint">{copy.limitNote}</p> : null}
        </>
      )}
    </div>
  );
}
