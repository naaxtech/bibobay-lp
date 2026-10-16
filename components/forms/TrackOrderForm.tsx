"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";

import { OrderStatusView } from "@/components/orders/OrderStatusView";
import { ORDER_STATUSES } from "@/lib/orders/constants";
import { EMAIL_PATTERN, ORDER_LIMITS, ORDER_REFERENCE_PATTERN } from "@/lib/orders/fields";
import type { TrackedOrder } from "@/lib/orders/track";
import { ORDER_COPY } from "./order-copy";

type TrackField = "reference" | "email";
type TrackErrors = Partial<Record<TrackField, "required" | "invalid">>;
const TRACK_FIELDS: readonly TrackField[] = ["reference", "email"];

/** True once React has hydrated; false in server HTML. No effect, so no extra render pass. */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const optionalText = (value: unknown) => value === null || typeof value === "string";

/** The locked tracking payload (lib/orders/track.ts), read strictly; anything else is a failure. */
function trackedOrderFrom(body: unknown): TrackedOrder | null {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.order)) return null;
  const order = body.order;
  const lines = Array.isArray(order.lines) ? order.lines : null;
  if (
    typeof order.reference !== "string" || !ORDER_REFERENCE_PATTERN.test(order.reference) ||
    !(ORDER_STATUSES as readonly unknown[]).includes(order.status) ||
    typeof order.submittedAt !== "string" || typeof order.statusChangedAt !== "string" ||
    !lines ||
    !lines.every((line) => isRecord(line) && typeof line.title === "string" && optionalText(line.variant) && optionalText(line.pack) && Number.isInteger(line.quantity) && (line.quantity as number) > 0)
  ) {
    return null;
  }
  return body.order as unknown as TrackedOrder;
}

function checkTrackFields(reference: string, email: string): TrackErrors {
  const errors: TrackErrors = {};
  if (!reference) errors.reference = "required";
  else if (!ORDER_REFERENCE_PATTERN.test(reference)) errors.reference = "invalid";
  const normalised = email.trim().toLowerCase();
  if (!normalised) errors.email = "required";
  else if (normalised.length > ORDER_LIMITS.email || !EMAIL_PATTERN.test(normalised)) errors.email = "invalid";
  return errors;
}

/**
 * Find an order by its reference and the email it was placed with (Task 7c, spec §10 step 11).
 * Found: the order's status view below the form, which takes focus. Every miss, whatever the
 * reason, reads the same (ORDER_COPY.tracking.notFound); 429 and failures have their own lines.
 * The fields are checked here first (a reference like BB-1A2B-3C4D, an email), with the same
 * summary, inline errors and focus handling as the order form.
 */
export function TrackOrderForm({ endpoint = "/api/orders/track" }: { endpoint?: string }) {
  const id = useId();
  const fieldId = (field: TrackField) => `${id}-${field}`;
  const hintId = (field: TrackField) => `${id}-${field}-hint`;
  const errorId = (field: TrackField) => `${id}-${field}-error`;
  const summaryTitleId = `${id}-summary-title`;

  const hydrated = useHydrated();
  const [errors, setErrors] = useState<TrackErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [pending, setPending] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [resultFocus, setResultFocus] = useState(0);
  const [buttonFocus, setButtonFocus] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  // A found order takes focus at its heading, so its status is read next.
  useEffect(() => {
    if (resultFocus > 0) resultRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [resultFocus]);

  useEffect(() => {
    if (buttonFocus === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === submitRef.current) submitRef.current?.focus();
  }, [buttonFocus]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const reference = text("reference").trim().toUpperCase();
    const email = text("email").trim();

    setMessage(null);
    setOrder(null);
    const found = checkTrackFields(reference, email);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setSummaryFocus((count) => count + 1);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    let next: "result" | "button" = "button";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reference, email }),
        credentials: "same-origin",
      });
      const answer: unknown = await response.json().catch(() => null);
      const tracked = response.ok ? trackedOrderFrom(answer) : null;
      if (tracked) {
        setOrder(tracked);
        next = "result";
      } else if (response.status === 404) {
        setMessage(ORDER_COPY.tracking.notFound);
      } else if (response.status === 429) {
        setMessage(ORDER_COPY.tracking.rateLimited);
      } else {
        setMessage(ORDER_COPY.tracking.failed);
      }
    } catch {
      setMessage(ORDER_COPY.tracking.failed);
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (next === "result") setResultFocus((count) => count + 1);
      else setButtonFocus((count) => count + 1);
    }
  }

  const focusField = (field: TrackField) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(fieldId(field))?.focus();
  };
  const errorText = (field: TrackField) => {
    const code = errors[field];
    return code ? ORDER_COPY.track.errors[field][code] : null;
  };
  const describedBy = (field: TrackField) => [hintId(field), errors[field] && errorId(field)].filter(Boolean).join(" ");
  const listedErrors = TRACK_FIELDS.filter((field) => errors[field]);

  return (
    <div className="track-order">
      <form className="lead-form track-form" aria-label={ORDER_COPY.track.formLabel} method="post" noValidate onSubmit={handleSubmit}>
        {listedErrors.length > 0 ? (
          <div ref={summaryRef} role="group" className="lead-form__summary" tabIndex={-1} aria-labelledby={summaryTitleId}>
            <h2 id={summaryTitleId} className="lead-form__summary-title">
              {ORDER_COPY.track.errorSummaryTitle}
            </h2>
            <ul className="lead-form__summary-list">
              {listedErrors.map((field) => (
                <li key={field}>
                  <a href={`#${fieldId(field)}`} onClick={focusField(field)} className="text-link">
                    {errorText(field)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="lead-form__field">
          <label htmlFor={fieldId("reference")} className="lead-form__label">
            {ORDER_COPY.track.reference.label}
          </label>
          <p id={hintId("reference")} className="lead-form__hint">
            {ORDER_COPY.track.reference.hint}
          </p>
          <input
            id={fieldId("reference")}
            name="reference"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-invalid={errors.reference ? true : undefined}
            aria-describedby={describedBy("reference")}
            className="lead-form__input track-form__reference"
          />
          {errors.reference ? (
            <p id={errorId("reference")} className="lead-form__error">
              {errorText("reference")}
            </p>
          ) : null}
        </div>

        <div className="lead-form__field">
          <label htmlFor={fieldId("email")} className="lead-form__label">
            {ORDER_COPY.track.email.label}
          </label>
          <p id={hintId("email")} className="lead-form__hint">
            {ORDER_COPY.track.email.hint}
          </p>
          <input
            id={fieldId("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email")}
            className="lead-form__input"
          />
          {errors.email ? (
            <p id={errorId("email")} className="lead-form__error">
              {errorText("email")}
            </p>
          ) : null}
        </div>

        <button ref={submitRef} type="submit" className="btn btn-primary lead-form__submit" disabled={pending || !hydrated} aria-busy={pending}>
          {ORDER_COPY.track.submit}
        </button>

        {/* The status line keeps the height of its longest message (lead-form.css), so nothing jumps. */}
        <div className="lead-form__outcome" data-reserve-a={ORDER_COPY.track.searching} data-reserve-b={ORDER_COPY.tracking.notFound}>
          <div className="lead-form__outcome" data-reserve-a={ORDER_COPY.tracking.rateLimited} data-reserve-b={ORDER_COPY.tracking.failed}>
            <p role="status" aria-live="polite" aria-atomic="true" className="lead-form__status" data-tone={pending ? "pending" : message ? "error" : undefined}>
              {pending ? ORDER_COPY.track.searching : (message ?? "")}
            </p>
          </div>
        </div>
      </form>

      <div ref={resultRef} className="track-order__result">
        {order ? <OrderStatusView order={order} /> : null}
      </div>
    </div>
  );
}
