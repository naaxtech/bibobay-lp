"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";

import { useOrderPad } from "@/components/shop/OrderPadProvider";
import type { CountryOption } from "@/lib/orders/countries";
import {
  HONEYPOT_FIELD,
  ORDER_FIELD_ORDER,
  ORDER_REFERENCE_PATTERN,
  TRACKING_TOKEN_PATTERN,
  checkOrderFields,
  newSubmissionKey,
  type OrderField,
  type OrderFieldErrorCode,
  type OrderFieldErrors,
  type OrderFieldValues,
} from "@/lib/orders/fields";
import { ORDER_COPY, orderFieldErrorMessage } from "./order-copy";

/** What the order page shows once the server stored the request. */
export interface OrderReceipt {
  reference: string;
  /** The private tracking token: only for a newly stored order, and only while tracking is on. */
  trackingToken?: string;
  /** A retry of a request already stored (R81): no new token exists. */
  duplicate: boolean;
}

export interface OrderFormProps {
  /** The order consent sentence (R82), paired on the server with the version an order records. */
  consentCopy: string;
  /** The countries the form offers (R85), already in display order. */
  countries: readonly CountryOption[];
  /** The products the page lists by name; only these pad lines are sent. */
  listedIds: readonly string[];
  onReceived: (receipt: OrderReceipt) => void;
  /** Where the order is posted; tests and the route share the default. */
  endpoint?: string;
}

type TextField = "contactName" | "email" | "phone" | "addressLine1" | "addressLine2" | "city" | "region" | "postalCode";

interface TextFieldSpec {
  type: "text" | "email" | "tel";
  autoComplete: string;
  required: boolean;
  inputMode?: "email" | "tel";
  autoCapitalize?: "none" | "words" | "characters";
}

/** Autocomplete tokens from the HTML standard, so browsers and password managers can fill in. */
const TEXT_FIELDS: Record<TextField, TextFieldSpec> = {
  contactName: { type: "text", autoComplete: "name", required: true, autoCapitalize: "words" },
  email: { type: "email", autoComplete: "email", required: true, inputMode: "email", autoCapitalize: "none" },
  phone: { type: "tel", autoComplete: "tel", required: false, inputMode: "tel" },
  addressLine1: { type: "text", autoComplete: "address-line1", required: true },
  addressLine2: { type: "text", autoComplete: "address-line2", required: false },
  city: { type: "text", autoComplete: "address-level2", required: true },
  region: { type: "text", autoComplete: "address-level1", required: false },
  postalCode: { type: "text", autoComplete: "postal-code", required: false, autoCapitalize: "characters" },
};

const FIELD_CODES = new Set<OrderFieldErrorCode>(["required", "invalid", "too_long"]);

/** True once React has hydrated; false in server HTML. No effect, so no extra render pass. */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The server's field errors, keeping only known fields and codes. */
function serverFieldErrors(body: unknown): OrderFieldErrors {
  const errors: OrderFieldErrors = {};
  const raw = isRecord(body) && isRecord(body.fieldErrors) ? body.fieldErrors : {};
  for (const field of ORDER_FIELD_ORDER) {
    const code = raw[field];
    if (typeof code === "string" && FIELD_CODES.has(code as OrderFieldErrorCode)) errors[field] = code as OrderFieldErrorCode;
  }
  return errors;
}

/** A stored order, read strictly: anything less is never shown as a success. */
function receiptFrom(body: unknown): OrderReceipt | null {
  if (!isRecord(body) || body.ok !== true || body.persisted !== true) return null;
  if (typeof body.reference !== "string" || !ORDER_REFERENCE_PATTERN.test(body.reference)) return null;
  const duplicate = body.duplicate === true;
  const token = !duplicate && typeof body.trackingToken === "string" && TRACKING_TOKEN_PATTERN.test(body.trackingToken) ? body.trackingToken : undefined;
  return { reference: body.reference, ...(token ? { trackingToken: token } : {}), duplicate };
}

/** The message for every answer that is neither a stored order nor field problems. */
function refusalMessage(status: number, body: unknown): string {
  if (status === 429) return ORDER_COPY.outcome.rateLimited;
  if (status === 503) return ORDER_COPY.outcome.busy;
  if (status === 404) return ORDER_COPY.outcome.unavailable;
  if (status === 400 && isRecord(body) && body.message === ORDER_COPY.outcome.productsUnavailable) return ORDER_COPY.outcome.productsUnavailable;
  return ORDER_COPY.outcome.notConfirmed;
}

/**
 * The order request form (Task 7c, spec §10 step 4). Adults only: contact and delivery details,
 * optional notes and the order consent tick; nothing about a child, no price, no payment.
 *
 * It posts the pad's product ids and quantities (never names or prices) with one random submission
 * key per order attempt (ruling R81), made on the first send and sent again on every retry of the
 * same request until the server stores the order, so a request whose answer was lost is never stored
 * twice. The key belongs to what is sent (ruling R93, Task 7c review M1): when anything changes
 * (a corrected email or address, another quantity) the next send gets a new key, because the server
 * answers a repeated key with the first order and would otherwise drop the correction, or refuse a
 * different email for ever. If a product can no longer be ordered, the page is fetched again
 * (`router.refresh()`) so the pad is pruned against the current catalogue (review M4). On a stored
 * order it hands the receipt to the page and empties the pad through the provider (`pad.clear()`),
 * so every open page sees it. Every other answer keeps the pad and everything typed.
 *
 * Accessibility follows components/forms/LeadForm.tsx: visible labels, hints and errors tied by
 * `aria-describedby`, an error summary (a named group) that takes focus and links to each field, one
 * polite status line whose height is reserved for every message it can show, and a submit button
 * disabled only while sending (and before hydration, so a native submit never posts the form).
 */
export function OrderForm({ consentCopy, countries, listedIds, onReceived, endpoint = "/api/orders" }: OrderFormProps) {
  const pad = useOrderPad();
  const id = useId();
  const fieldId = (field: OrderField) => `${id}-${field}`;
  const hintId = (field: OrderField) => `${id}-${field}-hint`;
  const errorId = (field: OrderField) => `${id}-${field}-error`;
  const summaryTitleId = `${id}-summary-title`;

  const hydrated = useHydrated();
  const [errors, setErrors] = useState<OrderFieldErrors>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [buttonFocus, setButtonFocus] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  /** R81/R93: this order attempt's key and the content it was made for; null until the first send. */
  const keyRef = useRef<{ key: string; content: string } | null>(null);
  const router = useRouter();
  const listed = useMemo(() => new Set(listedIds), [listedIds]);
  const countryCodes = useMemo(() => countries.map((country) => country.code), [countries]);

  // Each failed check moves focus to the summary, even when the same problems repeat.
  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  // Runs after the render that re-enabled the button, so the button can take focus again.
  useEffect(() => {
    if (buttonFocus === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === submitRef.current) submitRef.current?.focus();
  }, [buttonFocus]);

  const showFieldErrors = (found: OrderFieldErrors) => {
    setErrors(found);
    setSummaryFocus((count) => count + 1);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !pad) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const values: OrderFieldValues = {
      contactName: text("contactName"),
      email: text("email"),
      phone: text("phone"),
      addressLine1: text("addressLine1"),
      addressLine2: text("addressLine2"),
      city: text("city"),
      region: text("region"),
      postalCode: text("postalCode"),
      country: text("country"),
      notes: text("notes"),
      consent: data.get("consent") !== null,
    };
    const lines = (pad.lines ?? []).filter((line) => listed.has(line.productId)).map(({ productId, quantity }) => ({ productId, quantity }));

    setOutcome(null);
    const found = checkOrderFields(values, countryCodes);
    if (lines.length === 0) found.lines = "required";
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }
    setErrors({});

    const optional = (name: keyof OrderFieldValues, value: string) => (value.trim() ? { [name]: value.trim() } : {});
    const content = {
      contactName: values.contactName.trim(),
      email: values.email.trim(),
      ...optional("phone", values.phone),
      addressLine1: values.addressLine1.trim(),
      ...optional("addressLine2", values.addressLine2),
      city: values.city.trim(),
      ...optional("region", values.region),
      ...optional("postalCode", values.postalCode),
      country: values.country.trim().toUpperCase(),
      ...optional("notes", values.notes),
      consent: true,
      lines,
    };
    // The server stores the email lower-cased, so letter case alone is not a change (R93).
    const sent = JSON.stringify({ ...content, email: content.email.toLowerCase() });
    if (keyRef.current?.content !== sent) keyRef.current = { key: newSubmissionKey(), content: sent };
    const body = {
      ...content,
      submissionKey: keyRef.current.key,
      // Sent as found: a person leaves it empty, and the server turns anything else away.
      [HONEYPOT_FIELD]: text(HONEYPOT_FIELD),
    };

    pendingRef.current = true;
    setPending(true);
    let returnFocus = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const answer: unknown = await response.json().catch(() => null);
      const receipt = response.ok ? receiptFrom(answer) : null;
      const fieldErrors = response.status === 400 ? serverFieldErrors(answer) : {};
      if (receipt) {
        keyRef.current = null;
        returnFocus = false;
        // The page shows the receipt first, then the pad empties everywhere it is open.
        onReceived(receipt);
        pad.clear();
      } else if (Object.keys(fieldErrors).length > 0) {
        returnFocus = false;
        showFieldErrors(fieldErrors);
      } else {
        const message = refusalMessage(response.status, answer);
        setOutcome(message);
        // Review M4: the page's catalogue may be older than the server's; read it again.
        if (message === ORDER_COPY.outcome.productsUnavailable) router.refresh();
      }
    } catch {
      setOutcome(ORDER_COPY.outcome.notConfirmed);
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (returnFocus) setButtonFocus((count) => count + 1);
    }
  }

  const focusField = (field: OrderField) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(fieldId(field))?.focus();
  };

  const describedBy = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ") || undefined;
  const errorText = (field: OrderField) => {
    const code = errors[field];
    return code ? orderFieldErrorMessage(field, code) : null;
  };
  const errorLine = (field: OrderField) =>
    errors[field] ? (
      <p id={errorId(field)} className="lead-form__error">
        {errorText(field)}
      </p>
    ) : null;
  const listedErrors = ORDER_FIELD_ORDER.filter((field) => errors[field]);

  const textField = (field: TextField) => {
    const spec = TEXT_FIELDS[field];
    const copy: { label: string; hint?: string } = ORDER_COPY.form[field];
    return (
      <div className={`lead-form__field order-form__field order-form__field--${field}`}>
        <label htmlFor={fieldId(field)} className="lead-form__label">
          {copy.label}
        </label>
        {copy.hint ? (
          <p id={hintId(field)} className="lead-form__hint">
            {copy.hint}
          </p>
        ) : null}
        <input
          id={fieldId(field)}
          name={field}
          type={spec.type}
          autoComplete={spec.autoComplete}
          inputMode={spec.inputMode}
          autoCapitalize={spec.autoCapitalize}
          spellCheck={field === "email" ? false : undefined}
          required={spec.required}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={describedBy(copy.hint && hintId(field), errors[field] && errorId(field))}
          className="lead-form__input"
        />
        {errorLine(field)}
      </div>
    );
  };

  return (
    <form className="lead-form order-form" aria-label={ORDER_COPY.form.label} method="post" noValidate onSubmit={handleSubmit}>
      {listedErrors.length > 0 ? (
        // role="group": a generic <div> may not be named (ARIA 1.2), so its title might never be
        // announced when it takes focus.
        <div ref={summaryRef} role="group" className="lead-form__summary" tabIndex={-1} aria-labelledby={summaryTitleId}>
          <h2 id={summaryTitleId} className="lead-form__summary-title">
            {ORDER_COPY.form.errorSummaryTitle}
          </h2>
          <ul className="lead-form__summary-list">
            {listedErrors.map((field) => (
              <li key={field}>
                {field === "lines" ? (
                  errorText(field)
                ) : (
                  <a href={`#${fieldId(field)}`} onClick={focusField(field)} className="text-link">
                    {errorText(field)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="order-form__group">
        <legend className="order-form__legend">{ORDER_COPY.form.contactTitle}</legend>
        {textField("contactName")}
        {textField("email")}
        {textField("phone")}
      </fieldset>

      <fieldset className="order-form__group">
        <legend className="order-form__legend">{ORDER_COPY.form.deliveryTitle}</legend>
        {textField("addressLine1")}
        {textField("addressLine2")}
        <div className="order-form__row">
          {textField("city")}
          {textField("region")}
        </div>
        <div className="order-form__row">
          {textField("postalCode")}
          <div className="lead-form__field order-form__field">
            <label htmlFor={fieldId("country")} className="lead-form__label">
              {ORDER_COPY.form.country.label}
            </label>
            <p id={hintId("country")} className="lead-form__hint">
              {ORDER_COPY.form.country.hint}
            </p>
            <select
              id={fieldId("country")}
              name="country"
              autoComplete="country"
              defaultValue=""
              required
              aria-invalid={errors.country ? true : undefined}
              aria-describedby={describedBy(hintId("country"), errors.country && errorId("country"))}
              className="lead-form__input lead-form__select"
            >
              <option value="">{ORDER_COPY.form.country.placeholder}</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
            {errorLine("country")}
          </div>
        </div>
      </fieldset>

      <div className="lead-form__field">
        <label htmlFor={fieldId("notes")} className="lead-form__label">
          {ORDER_COPY.form.notes.label}
        </label>
        <p id={hintId("notes")} className="lead-form__hint">
          {ORDER_COPY.form.notes.hint}
        </p>
        <textarea
          id={fieldId("notes")}
          name="notes"
          rows={4}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={describedBy(hintId("notes"), errors.notes && errorId("notes"))}
          className="lead-form__input order-form__notes"
        />
        {errorLine("notes")}
      </div>

      <div className="lead-form__field lead-form__consent">
        <div className="lead-form__check">
          <input
            id={fieldId("consent")}
            name="consent"
            type="checkbox"
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={describedBy(errors.consent && errorId("consent"))}
            className="lead-form__checkbox"
          />
          <label htmlFor={fieldId("consent")} className="lead-form__check-label">
            {consentCopy}
          </label>
        </div>
        {errorLine("consent")}
        {/* src: https://nextjs.org/docs/app/api-reference/components/link#prefetch · next 16.3.8 · 2026-10-12 — the privacy page ships in Task 9; no prefetch of a route that may not exist yet. */}
        <Link href="/privacy" prefetch={false} className="text-link lead-form__privacy">
          {ORDER_COPY.form.privacyLink}
        </Link>
      </div>

      {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. */}
      <div className="lead-form__trap" aria-hidden="true">
        <label htmlFor={`${id}-website`}>{ORDER_COPY.form.honeypotLabel}</label>
        <input id={`${id}-website`} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <button ref={submitRef} type="submit" className="btn btn-primary lead-form__submit" disabled={pending || !hydrated} aria-busy={pending}>
        {ORDER_COPY.form.submit}
      </button>

      {/*
       * The status line never changes height: three wrappers stack six invisible pseudo-elements in
       * its grid cell, one per message it can show (lead-form.css), held in data attributes so no
       * message is read or announced before it applies.
       */}
      <div className="lead-form__outcome" data-reserve-a={ORDER_COPY.form.sending} data-reserve-b={ORDER_COPY.outcome.rateLimited}>
        <div className="lead-form__outcome" data-reserve-a={ORDER_COPY.outcome.notConfirmed} data-reserve-b={ORDER_COPY.outcome.busy}>
          <div className="lead-form__outcome" data-reserve-a={ORDER_COPY.outcome.unavailable} data-reserve-b={ORDER_COPY.outcome.productsUnavailable}>
            <p role="status" aria-live="polite" aria-atomic="true" className="lead-form__status" data-tone={pending ? "pending" : outcome ? "error" : undefined}>
              {pending ? ORDER_COPY.form.sending : (outcome ?? "")}
            </p>
          </div>
        </div>
      </div>

      <noscript>
        <p className="lead-form__noscript">{ORDER_COPY.form.noScript}</p>
      </noscript>
    </form>
  );
}
