"use client";

import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";

import { QUOTE_CURRENCIES, currencyExponent, formatMajorInput, parseMajorAmount, type MajorAmountRefusal } from "@/lib/orders/quote-money";
import { PAGE_COPY } from "./page-copy";
import type { Perform } from "./useOrderAction";

/** The order's current quote as the server rendered it. `revision` 0 means none is saved. */
export interface QuoteFigures {
  revision: number;
  currency: string | null;
  subtotalMinor: number | null;
  freightMinor: number | null;
  paymentUrl: string | null;
}

type Field = "currency" | "subtotal" | "freight" | "paymentUrl";
const FIELD_ORDER: readonly Field[] = ["currency", "subtotal", "freight", "paymentUrl"];
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const COPY = PAGE_COPY.controls.quote;
const DEFAULT_CURRENCY = "PHP";

/** The form's values for the figures the server rendered: what staff would type to leave the quote unchanged. */
function valuesFor(quote: QuoteFigures): Values {
  const listed = QUOTE_CURRENCIES.some((currency) => currency.code === quote.currency);
  const currency = listed && quote.currency ? quote.currency : DEFAULT_CURRENCY;
  return {
    currency,
    subtotal: listed ? formatMajorInput(quote.subtotalMinor, currency) : "",
    freight: listed ? formatMajorInput(quote.freightMinor, currency) : "",
    paymentUrl: quote.paymentUrl ?? "",
  };
}

const signatureOf = (quote: QuoteFigures) => JSON.stringify([quote.revision, quote.currency, quote.subtotalMinor, quote.freightMinor, quote.paymentUrl]);

const AMOUNT_MESSAGES: Record<MajorAmountRefusal, string> = {
  required: COPY.errors.required,
  invalid: COPY.errors.invalid,
  negative: COPY.errors.negative,
  too_many_decimals: COPY.errors.tooManyDecimals,
  too_large: COPY.errors.tooLarge,
};

/** The API's code for a payment link problem, in our words. */
const PAYMENT_MESSAGES: Record<string, string> = {
  required: COPY.errors.required,
  invalid: COPY.errors.invalid,
  not_https: COPY.errors.notHttps,
  credentials: COPY.errors.credentials,
  port: COPY.errors.port,
  ip_literal: COPY.errors.ipLiteral,
  too_long: COPY.errors.tooLong,
  host_not_allowed: COPY.errors.hostNotAllowed,
  no_allowed_hosts: COPY.errors.noAllowedHosts,
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The API's `fieldErrors` of a 400, mapped onto this form's inputs (revision and intent have no input). */
function serverErrors(body: unknown): Errors {
  const raw = isRecord(body) && isRecord(body.fieldErrors) ? body.fieldErrors : {};
  const code = (name: string) => (typeof raw[name] === "string" ? (raw[name] as string) : null);
  const errors: Errors = {};
  const currency = code("currency");
  if (currency) errors.currency = COPY.errors.currency;
  const amount = (name: string) => {
    const found = code(name);
    return found === "required" ? COPY.errors.required : found ? COPY.errors.invalid : undefined;
  };
  const subtotal = amount("subtotalMinor");
  if (subtotal) errors.subtotal = subtotal;
  const freight = amount("freightMinor");
  if (freight) errors.freight = freight;
  const payment = code("paymentUrl");
  if (payment) errors.paymentUrl = PAYMENT_MESSAGES[payment] ?? COPY.errors.invalid;
  return errors;
}

export interface QuoteFormProps {
  quote: QuoteFigures;
  /** True while any request of the order controls is in flight. */
  busy: boolean;
  perform: Perform;
  /** Clears the controls' live region (a check that stops before any request). */
  clearMessage: () => void;
}

/**
 * The staff quote form (Task 8c, rulings R102 and R103): save the figures, then queue the saved
 * revision for email. Staff type decimal text in the currency's main unit; the API gets whole minor
 * units, converted by integer string arithmetic (lib/orders/quote-money.ts). The initial values are
 * the order's current figures, and the `revision` sent is the one rendered. When the server
 * renders different figures (a refresh after a save, or after another member of staff saved one)
 * the form takes them, so a stale form cannot be saved over a newer quote by mistake.
 *
 * Problems sit next to their inputs (`aria-invalid`, `aria-describedby`) and the first one takes
 * focus. The live region lives in OrderControls and is never focused. Nothing here says the quote
 * was emailed: "Queue quote email" asks the server to queue it, and the server says what happened.
 */
export function QuoteForm({ quote, busy, perform, clearMessage }: QuoteFormProps) {
  const id = useId();
  const [values, setValues] = useState<Values>(() => valuesFor(quote));
  const [errors, setErrors] = useState<Errors>({});
  const [seen, setSeen] = useState(() => signatureOf(quote));
  const [focus, setFocus] = useState<{ field: Field; count: number } | null>(null);

  // The server rendered other figures: start again from them. (React's "adjust state while
  // rendering" pattern: no effect, no flash of the old values.)
  const signature = signatureOf(quote);
  if (signature !== seen) {
    setSeen(signature);
    setValues(valuesFor(quote));
    setErrors({});
  }

  // Runs after the render that carries the errors (and re-enabled the inputs).
  useEffect(() => {
    if (focus) document.getElementById(`${id}-${focus.field}`)?.focus();
  }, [focus, id]);

  const initial = valuesFor(quote);
  const dirty = FIELD_ORDER.some((field) => values[field].trim() !== initial[field]);
  const sendReason = quote.revision < 1 ? COPY.needsQuote : dirty ? COPY.needsSave : null;

  const ids = { hint: `${id}-amount-hint`, urlHint: `${id}-url-hint`, sendReason: `${id}-send-reason` };
  const fieldId = (field: Field) => `${id}-${field}`;
  const errorId = (field: Field) => `${id}-${field}-error`;
  const describedBy = (field: Field, ...extra: string[]) => [...extra, errors[field] ? errorId(field) : ""].filter(Boolean).join(" ") || undefined;

  const showErrors = (found: Errors) => {
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) setFocus((previous) => ({ field: first, count: (previous?.count ?? 0) + 1 }));
  };

  const edit = (field: Field) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found: Errors = {};
    const subtotal = parseMajorAmount(values.subtotal, values.currency);
    const freight = parseMajorAmount(values.freight, values.currency);
    const paymentUrl = values.paymentUrl.trim();
    if (currencyExponent(values.currency) === null) found.currency = COPY.errors.currency;
    if (!subtotal.ok) found.subtotal = AMOUNT_MESSAGES[subtotal.reason];
    if (!freight.ok) found.freight = AMOUNT_MESSAGES[freight.reason];
    if (!paymentUrl) found.paymentUrl = COPY.errors.required;
    if (!subtotal.ok || !freight.ok || found.currency || found.paymentUrl) {
      clearMessage();
      showErrors(found);
      return;
    }
    setErrors({});
    const result = await perform("quote", {
      intent: "save",
      revision: quote.revision,
      currency: values.currency,
      subtotalMinor: subtotal.minor,
      freightMinor: freight.minor,
      paymentUrl,
    });
    if (result && result.answer.status === 400) showErrors(serverErrors(result.answer.body));
  }

  async function send() {
    if (busy || sendReason) return;
    await perform("quote", { intent: "send", revision: quote.revision });
  }

  const headingId = `${id}-heading`;
  return (
    <form className="lead-form admin-form admin-quote" aria-labelledby={headingId} noValidate onSubmit={save}>
      <h3 id={headingId} className="admin-section-title">
        {COPY.heading}
      </h3>
      <p className="admin-hint">{COPY.lead}</p>
      <p className="admin-hint">
        {COPY.savedRevision}: <strong>{quote.revision < 1 ? COPY.noneSaved : quote.revision}</strong>
      </p>

      <div className="lead-form__field">
        <label htmlFor={fieldId("currency")} className="lead-form__label">
          {COPY.currencyLabel}
        </label>
        <select
          id={fieldId("currency")}
          name="currency"
          value={values.currency}
          onChange={edit("currency")}
          disabled={busy}
          aria-invalid={errors.currency ? true : undefined}
          aria-describedby={describedBy("currency")}
          className="lead-form__input lead-form__select"
        >
          {QUOTE_CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code}
            </option>
          ))}
        </select>
        {errors.currency ? (
          <p id={errorId("currency")} className="lead-form__error">
            {errors.currency}
          </p>
        ) : null}
      </div>

      <p id={ids.hint} className="admin-hint">
        {COPY.amountHint}
      </p>
      {(["subtotal", "freight"] as const).map((field) => (
        <div className="lead-form__field" key={field}>
          <label htmlFor={fieldId(field)} className="lead-form__label">
            {field === "subtotal" ? COPY.subtotalLabel : COPY.freightLabel}
          </label>
          <input
            id={fieldId(field)}
            name={field}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values[field]}
            onChange={edit(field)}
            disabled={busy}
            aria-invalid={errors[field] ? true : undefined}
            aria-describedby={describedBy(field, ids.hint)}
            className="lead-form__input"
          />
          {errors[field] ? (
            <p id={errorId(field)} className="lead-form__error">
              {errors[field]}
            </p>
          ) : null}
        </div>
      ))}

      <div className="lead-form__field">
        <label htmlFor={fieldId("paymentUrl")} className="lead-form__label">
          {COPY.paymentUrlLabel}
        </label>
        <p id={ids.urlHint} className="lead-form__hint">
          {COPY.paymentUrlHint}
        </p>
        <input
          id={fieldId("paymentUrl")}
          name="paymentUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={values.paymentUrl}
          onChange={edit("paymentUrl")}
          disabled={busy}
          aria-invalid={errors.paymentUrl ? true : undefined}
          aria-describedby={describedBy("paymentUrl", ids.urlHint)}
          className="lead-form__input"
        />
        {errors.paymentUrl ? (
          <p id={errorId("paymentUrl")} className="lead-form__error">
            {errors.paymentUrl}
          </p>
        ) : null}
      </div>

      <div className="admin-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {COPY.save}
        </button>
        <button type="button" className="admin-button" onClick={send} disabled={busy || sendReason !== null} aria-describedby={sendReason ? ids.sendReason : undefined}>
          {COPY.send}
        </button>
      </div>
      {sendReason ? (
        <p id={ids.sendReason} className="admin-hint">
          {sendReason}
        </p>
      ) : null}
    </form>
  );
}
