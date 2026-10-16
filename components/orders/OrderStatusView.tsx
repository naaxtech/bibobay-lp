import { ORDER_STATUS_COPY } from "@/components/forms/order-copy";
import type { OrderStatus } from "@/lib/orders/constants";
import type { TrackedOrder } from "@/lib/orders/track";
import { LocalTime } from "./LocalTime";

/** The steps an order moves through; a cancelled order leaves them (shown on its own). */
const STEPS: readonly OrderStatus[] = ["new", "confirmed", "paid", "dispatched", "closed"];

const stepState = (index: number, at: number) => (index < at ? "done" : index === at ? "current" : "upcoming");

/**
 * One order's progress at a glance (Task 7c), shared by /track and /orders/<token>: the reference,
 * the status with a one-line explanation, the steps from new to closed (a cancelled order shows no
 * steps, only its own state), each product with its variant, pack and quantity, and two dates.
 * Exactly the locked tracking payload (spec §11): never a price, an address or an email.
 *
 * The heading can take focus (tabIndex -1), so a lookup that finds the order can move focus to it.
 */
export function OrderStatusView({ order, headingLevel = 2 }: { order: TrackedOrder; headingLevel?: 2 | 3 }) {
  // No hooks: this renders on the server (/orders/<token>) and in the browser (/track). A page shows
  // one order at a time, and a reference is unique, so it makes the ids.
  const headingId = `order-${order.reference}-heading`;
  const linesId = `order-${order.reference}-lines`;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const Subheading = headingLevel === 2 ? "h3" : "h4";
  const at = STEPS.indexOf(order.status);
  return (
    <section className="order-status" aria-labelledby={headingId} data-status={order.status}>
      <Heading id={headingId} className="order-status__title" tabIndex={-1}>
        {ORDER_STATUS_COPY.heading(order.reference)}
      </Heading>
      <div className="order-status__now">
        <p className="order-status__current">
          {ORDER_STATUS_COPY.currentLabel}: <strong>{ORDER_STATUS_COPY.names[order.status]}</strong>
        </p>
        <p className="order-status__explanation">{ORDER_STATUS_COPY.explanations[order.status]}</p>
      </div>
      {at >= 0 ? (
        <ol className="order-steps" aria-label={ORDER_STATUS_COPY.progressLabel}>
          {STEPS.map((step, index) => (
            <li key={step} className="order-steps__step" data-state={stepState(index, at)} aria-current={index === at ? "step" : undefined}>
              {ORDER_STATUS_COPY.names[step]}
            </li>
          ))}
        </ol>
      ) : null}
      <dl className="order-status__dates">
        <div>
          <dt>{ORDER_STATUS_COPY.submittedLabel}</dt>
          <dd>
            <LocalTime iso={order.submittedAt} />
          </dd>
        </div>
        <div>
          <dt>{ORDER_STATUS_COPY.updatedLabel}</dt>
          <dd>
            <LocalTime iso={order.statusChangedAt} />
          </dd>
        </div>
      </dl>
      <Subheading id={linesId} className="order-status__lines-title">
        {ORDER_STATUS_COPY.linesTitle}
      </Subheading>
      <ul className="order-status__lines" aria-labelledby={linesId}>
        {order.lines.map((line, index) => (
          <li key={`${index}-${line.title}`} className="order-status__line">
            <span className="order-status__line-title">{line.title}</span>
            {line.variant ? (
              <span className="order-status__line-fact">
                {ORDER_STATUS_COPY.variantLabel}: {line.variant}
              </span>
            ) : null}
            {line.pack ? (
              <span className="order-status__line-fact">
                {ORDER_STATUS_COPY.packLabel}: {line.pack}
              </span>
            ) : null}
            <span className="order-status__line-quantity">{ORDER_STATUS_COPY.quantity(line.quantity)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
