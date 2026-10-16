import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminNotice } from "@/components/admin/AdminNotice";
import { staffMetadata } from "@/components/admin/metadata";
import { OrderControls } from "@/components/admin/OrderControls";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { LocalTime } from "@/components/orders/LocalTime";
import { staffPageAccess } from "@/lib/admin/access";
import { reportError } from "@/lib/observability/report";
import { getOrder, type AdminOrderDetail } from "@/lib/orders/admin";
import { ORDER_REFERENCE_PATTERN } from "@/lib/orders/fields";
import { formatMinor } from "@/lib/orders/quote-money";

/**
 * One order for staff (Task 8c, rulings R100 and R102-R104). A server component reading through the
 * signed-in member's own database client (row level security): the contact and delivery details,
 * notes, consent, products, the current quote, the email rows, the history, and the controls. A
 * visitor who is signed out goes to the sign-in page; a malformed reference is a 404 and is never
 * looked up; so is a reference no order has (./not-found.tsx).
 *
 * Params are read as the framework gives them (a Promise in this Next version). The payment link is
 * shown as plain text, never as a link, and the tracking token is never read here (only its expiry).
 */
const normalised = (reference: string) => reference.trim().toUpperCase();

export async function generateMetadata({ params }: { params: Promise<{ reference: string }> }): Promise<Metadata> {
  const { reference } = await params;
  const wanted = normalised(reference);
  return staffMetadata(ORDER_REFERENCE_PATTERN.test(wanted) ? `${PAGE_COPY.detail.pageTitle} ${wanted}` : PAGE_COPY.detail.pageTitle);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="admin-section">
      <h2 id={id} className="admin-section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="admin-facts">
      {items.map(([label, value]) => (
        <div key={label} className="admin-facts__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const optional = (value: string | null): ReactNode => value || PAGE_COPY.detail.values.notGiven;
const words = (code: string) => code.replace(/_/g, " ");

export default async function OrderPage({ params }: { params: Promise<{ reference: string }> }) {
  const access = await staffPageAccess();
  if (access.kind === "signed_out") redirect("/admin/login");
  if (access.kind === "unconfigured") return <AdminNotice {...PAGE_COPY.notices.unconfigured} />;
  if (access.kind === "unavailable") return <AdminNotice {...PAGE_COPY.notices.unavailable} />;

  const { reference } = await params;
  if (!ORDER_REFERENCE_PATTERN.test(normalised(reference))) notFound();
  let order: AdminOrderDetail | null;
  try {
    order = await getOrder(access.db, reference);
  } catch (error) {
    reportError(error, { area: "admin", event: "admin_order_read_failed" });
    return <AdminNotice {...PAGE_COPY.notices.loadFailed} />;
  }
  if (!order) notFound();

  const copy = PAGE_COPY.detail;
  const labels = copy.labels;
  const money = (minor: number | null) => (minor === null || !order.currency ? copy.values.notGiven : formatMinor(minor, order.currency));
  const hasQuote = order.quoteRevision > 0 || order.currency !== null;
  const summary: Array<readonly [string, ReactNode]> = [
    [copy.statusLabel, <span key="status" className="admin-badge" data-status={order.status}>{PAGE_COPY.statusNames[order.status]}</span>],
    [labels.submitted, <LocalTime key="created" iso={order.createdAt} />],
    [labels.statusChanged, <LocalTime key="changed" iso={order.statusChangedAt} />],
    [labels.trackingExpires, <LocalTime key="expires" iso={order.trackingTokenExpiresAt} />],
  ];
  if (order.trackingTokenRotatedAt) summary.push([labels.trackingReplaced, <LocalTime key="rotated" iso={order.trackingTokenRotatedAt} />]);

  return (
    <div className="admin-page admin-order">
      <p className="admin-back">
        <Link href="/admin/orders" className="text-link">
          {copy.backToOrders}
        </Link>
      </p>
      <h1 className="admin-page-title">
        {copy.headingPrefix} {order.reference}
      </h1>
      <Facts items={summary} />

      <Section id="order-contact" title={copy.sections.contact}>
        <Facts
          items={[
            [labels.name, order.contactName],
            [labels.email, order.email],
            [labels.phone, optional(order.phone)],
            [
              labels.address,
              <>
                <span className="admin-line">{order.addressLine1}</span>
                {order.addressLine2 ? <span className="admin-line">{order.addressLine2}</span> : null}
              </>,
            ],
            [labels.city, order.city],
            [labels.region, optional(order.region)],
            [labels.postalCode, optional(order.postalCode)],
            [labels.country, order.country],
          ]}
        />
      </Section>

      <Section id="order-notes" title={copy.sections.notes}>
        {order.notes ? <p className="admin-notes">{order.notes}</p> : <p>{copy.noNotes}</p>}
      </Section>

      <Section id="order-consent" title={copy.sections.consent}>
        <Facts
          items={[
            [labels.consentVersion, order.consentVersion],
            [labels.consentGiven, <LocalTime key="given" iso={order.consentGrantedAt} />],
          ]}
        />
      </Section>

      <Section id="order-lines" title={copy.sections.lines}>
        <div className="admin-table-wrap" role="group" aria-label={copy.sections.lines} tabIndex={0}>
          <table className="admin-table">
            <thead>
              <tr>
                {Object.values(copy.lineColumns).map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.lineNumber}>
                  <th scope="row">{line.title}</th>
                  <td>{line.sku ?? ""}</td>
                  <td>{line.variant ?? ""}</td>
                  <td>{line.pack ?? ""}</td>
                  <td>{line.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="order-quote" title={copy.sections.quote}>
        {hasQuote ? (
          <Facts
            items={[
              [copy.quote.currency, order.currency ?? copy.values.notGiven],
              [copy.quote.subtotal, money(order.subtotalMinor)],
              [copy.quote.freight, money(order.freightMinor)],
              [copy.quote.paymentLink, <span key="url" className="admin-url">{order.paymentUrl ?? copy.values.notGiven}</span>],
              [copy.quote.revision, order.quoteRevision],
              [
                copy.quote.emailAccepted,
                order.quoteSentAt ? (
                  <>
                    {copy.quote.values.accepted} <LocalTime iso={order.quoteSentAt} />
                  </>
                ) : (
                  copy.quote.values.notAccepted
                ),
              ],
            ]}
          />
        ) : (
          <p>{copy.quote.none}</p>
        )}
      </Section>

      <Section id="order-emails" title={copy.sections.emails}>
        {order.emails.length === 0 ? (
          <p>{copy.emails.none}</p>
        ) : (
          <div className="admin-table-wrap" role="group" aria-label={copy.sections.emails} tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  {Object.values(copy.emails.columns).map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.emails.map((email, index) => (
                  <tr key={`${email.createdAt}-${index}`}>
                    <th scope="row">{copy.emails.kinds[email.kind]}</th>
                    <td>{email.quoteRevision ?? ""}</td>
                    <td>{copy.emails.statuses[email.status]}</td>
                    <td>{email.attempts}</td>
                    <td>{email.lastAttemptAt ? <LocalTime iso={email.lastAttemptAt} /> : ""}</td>
                    <td>{email.nextAttemptAt ? <LocalTime iso={email.nextAttemptAt} /> : ""}</td>
                    <td>{email.lastErrorCode ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="order-events" title={copy.sections.events}>
        {order.events.length === 0 ? (
          <p>{copy.events.none}</p>
        ) : (
          <ol className="admin-events">
            {order.events.map((event, index) => (
              <li key={`${event.createdAt}-${index}`} className="admin-events__item">
                <span className="admin-events__what">
                  {copy.events.actors[event.actor]}: {words(event.eventType)}
                </span>
                {event.newStatus ? (
                  <span className="admin-events__status">
                    {`${copy.events.statusChange}: ${event.oldStatus ? `${PAGE_COPY.statusNames[event.oldStatus]} ${copy.events.statusTo} ` : ""}${PAGE_COPY.statusNames[event.newStatus]}`}
                  </span>
                ) : null}
                <LocalTime iso={event.createdAt} />
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="order-controls" title={copy.sections.controls}>
        <OrderControls
          reference={order.reference}
          status={order.status}
          quote={{ revision: order.quoteRevision, currency: order.currency, subtotalMinor: order.subtotalMinor, freightMinor: order.freightMinor, paymentUrl: order.paymentUrl }}
        />
      </Section>
    </div>
  );
}
