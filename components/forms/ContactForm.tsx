"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";

import { track } from "@/lib/analytics/client";
import {
  CONTACT_API_PATH,
  CONTACT_FIELD_ORDER,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  HONEYPOT_FIELD,
  checkContactFields,
  isContactTopic,
  normalizeMessage,
  type ContactField,
  type ContactFieldErrorCode,
  type ContactFieldErrors,
} from "@/lib/contact/fields";
import { normalizeEmail } from "@/lib/leads/fields";
import { CONTACT_FORM_COPY, contactFieldErrorMessage } from "./contact-copy";

/** The CMS copy the form shows (R158, R163): the button label and the three messages. */
export interface ContactFormCopy {
  buttonLabel: string;
  successMessage: string;
  errorMessage: string;
  closedMessage: string;
}

export interface ContactFormProps {
  copy: ContactFormCopy;
  /** Where the message is posted; tests and the route share the default. */
  endpoint?: string;
}

type Outcome = { tone: "success" | "error"; text: string } | null;

const FIELD_CODES = new Set<ContactFieldErrorCode>(["required", "invalid", "too_short", "too_long"]);

/** True once React has hydrated; false in server HTML. No effect, so no extra render pass. */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The server's field errors, keeping only known fields and codes. */
function serverFieldErrors(body: unknown): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  const raw = isRecord(body) && isRecord(body.fieldErrors) ? body.fieldErrors : {};
  for (const field of CONTACT_FIELD_ORDER) {
    const code = raw[field];
    if (typeof code === "string" && FIELD_CODES.has(code as ContactFieldErrorCode)) errors[field] = code as ContactFieldErrorCode;
  }
  return errors;
}

/**
 * The contact form (R158-R167). Grown-ups only: a name, an email address, a topic and a message;
 * nothing about a child, and the hint says to leave child details out.
 *
 * Truthful outcomes: the CMS success message appears only when the server answers
 * `persisted: true`, and it says the message was received, never emailed. A 503 with `closed: true`
 * shows the CMS closed message (the form can close after the page rendered); a rate limit (429) is
 * explained in plain words; every other answer (500, any other 503, a network failure) shows the CMS
 * error message. The API's own `message` strings are never shown, so every visible string is CMS or
 * chrome. The browser checks with the same `checkContactFields` the server's schema is pinned to.
 *
 * Accessibility and layout mirror LeadForm: labels above fields, hints and errors tied by
 * `aria-describedby`, an error summary (a named group) that takes focus on a failed submit, one polite
 * live region, a button disabled and `aria-busy` while saving that takes focus back afterwards, and an
 * outcome line that keeps its height (its reserve holds the four long messages; the saving line is
 * the shortest). Before hydration the button stays disabled.
 */
export function ContactForm({ copy, endpoint = CONTACT_API_PATH }: ContactFormProps) {
  const id = useId();
  const fieldId: Record<ContactField, string> = {
    name: `${id}-name`,
    email: `${id}-email`,
    topic: `${id}-topic`,
    message: `${id}-message`,
  };
  const ids = {
    emailHint: `${id}-email-hint`,
    messageHint: `${id}-message-hint`,
    trap: `${id}-trap`,
    summaryTitle: `${id}-summary-title`,
  };
  const errorId = (field: ContactField) => `${fieldId[field]}-error`;

  const hydrated = useHydrated();
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, setPending] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [focusReturn, setFocusReturn] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);

  // Each failed submit moves focus to the summary, even when the same problems repeat.
  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  // Runs after the render that re-enabled the button, so the button can take focus again.
  useEffect(() => {
    if (focusReturn === 0) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === submitRef.current;
    if (lost) submitRef.current?.focus();
  }, [focusReturn]);

  const showFieldErrors = (found: ContactFieldErrors) => {
    setErrors(found);
    setSummaryFocus((count) => count + 1);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const values = { name: text("name"), email: text("email"), topic: text("topic"), message: text("message") };

    setOutcome(null);
    const found = checkContactFields(values);
    const topic = values.topic.trim();
    if (Object.keys(found).length > 0 || !isContactTopic(topic)) {
      showFieldErrors(found);
      return;
    }
    setErrors({});

    const body = {
      name: values.name.trim(),
      email: normalizeEmail(values.email),
      topic,
      message: normalizeMessage(values.message),
      // Sent as found: a person leaves it empty, and the server turns anything else away.
      [HONEYPOT_FIELD]: text(HONEYPOT_FIELD),
    };

    pendingRef.current = true;
    setPending(true);
    // Field errors move focus to the summary instead; every other outcome returns it to the button.
    let returnFocus = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const answer: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(answer) && answer.ok === true && answer.persisted === true) {
        setOutcome({ tone: "success", text: copy.successMessage });
        // R166: the outcome and the topic only; nothing the visitor typed.
        track("contact_submitted", { persisted: true, topic });
        form.reset();
      } else if (response.status === 503 && isRecord(answer) && answer.closed === true) {
        setOutcome({ tone: "error", text: copy.closedMessage });
      } else if (response.status === 429) {
        setOutcome({ tone: "error", text: CONTACT_FORM_COPY.outcome.rateLimited });
      } else if (response.status === 400 && Object.keys(serverFieldErrors(answer)).length > 0) {
        showFieldErrors(serverFieldErrors(answer));
        returnFocus = false;
      } else {
        setOutcome({ tone: "error", text: copy.errorMessage });
      }
    } catch {
      setOutcome({ tone: "error", text: copy.errorMessage });
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (returnFocus) setFocusReturn((count) => count + 1);
    }
  }

  const focusField = (field: ContactField) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(fieldId[field])?.focus();
  };

  const describedBy = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ") || undefined;
  const errorText = (field: ContactField) => {
    const code = errors[field];
    return code ? contactFieldErrorMessage(field, code) : null;
  };
  const listed = CONTACT_FIELD_ORDER.filter((field) => errors[field]);

  return (
    <form id="contact-form" className="lead-form" aria-label={CONTACT_FORM_COPY.formLabel} method="post" noValidate onSubmit={handleSubmit}>
      {listed.length > 0 ? (
        <div ref={summaryRef} role="group" className="lead-form__summary" tabIndex={-1} aria-labelledby={ids.summaryTitle}>
          {/* h2: the form sits under the /contact page's h1 with no h2 between (as OrderForm's summary). */}
          <h2 id={ids.summaryTitle} className="lead-form__summary-title">
            {CONTACT_FORM_COPY.errorSummaryTitle}
          </h2>
          <ul className="lead-form__summary-list">
            {listed.map((field) => (
              <li key={field}>
                <a href={`#${fieldId[field]}`} onClick={focusField(field)} className="text-link">
                  {errorText(field)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="lead-form__field">
        <label htmlFor={fieldId.name} className="lead-form__label">
          {CONTACT_FORM_COPY.name.label}
        </label>
        <input
          id={fieldId.name}
          name="name"
          type="text"
          autoComplete="name"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(errors.name && errorId("name"))}
          className="lead-form__input"
        />
        {errors.name ? (
          <p id={errorId("name")} className="lead-form__error">
            {errorText("name")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field">
        <label htmlFor={fieldId.email} className="lead-form__label">
          {CONTACT_FORM_COPY.email.label}
        </label>
        <p id={ids.emailHint} className="lead-form__hint">
          {CONTACT_FORM_COPY.email.hint}
        </p>
        <input
          id={fieldId.email}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy(ids.emailHint, errors.email && errorId("email"))}
          className="lead-form__input"
        />
        {errors.email ? (
          <p id={errorId("email")} className="lead-form__error">
            {errorText("email")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field">
        <label htmlFor={fieldId.topic} className="lead-form__label">
          {CONTACT_FORM_COPY.topic.label}
        </label>
        <select
          id={fieldId.topic}
          name="topic"
          defaultValue=""
          required
          aria-invalid={errors.topic ? true : undefined}
          aria-describedby={describedBy(errors.topic && errorId("topic"))}
          className="lead-form__input lead-form__select"
        >
          <option value="">{CONTACT_FORM_COPY.topic.placeholder}</option>
          {CONTACT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {CONTACT_TOPIC_LABELS[topic]}
            </option>
          ))}
        </select>
        {errors.topic ? (
          <p id={errorId("topic")} className="lead-form__error">
            {errorText("topic")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field">
        <label htmlFor={fieldId.message} className="lead-form__label">
          {CONTACT_FORM_COPY.message.label}
        </label>
        <p id={ids.messageHint} className="lead-form__hint">
          {CONTACT_FORM_COPY.message.hint}
        </p>
        <textarea
          id={fieldId.message}
          name="message"
          rows={6}
          required
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy(ids.messageHint, errors.message && errorId("message"))}
          className="lead-form__input lead-form__textarea"
        />
        {errors.message ? (
          <p id={errorId("message")} className="lead-form__error">
            {errorText("message")}
          </p>
        ) : null}
      </div>

      {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. */}
      <div className="lead-form__trap" aria-hidden="true">
        <label htmlFor={ids.trap}>{CONTACT_FORM_COPY.honeypotLabel}</label>
        <input id={ids.trap} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <button ref={submitRef} type="submit" className="btn btn-primary lead-form__submit" disabled={pending || !hydrated} aria-busy={pending}>
        {copy.buttonLabel}
      </button>

      {/* src: https://nextjs.org/docs/app/api-reference/components/link#prefetch · next 16.3.8 · 2026-10-21 (same link as the lead form; the legal page is not prefetched) */}
      <Link href="/privacy" prefetch={false} className="text-link lead-form__privacy">
        {CONTACT_FORM_COPY.privacyLink}
      </Link>

      {/*
       * The outcome line never changes height. Its two wrappers stack four invisible CSS
       * pseudo-elements in the status's grid cell (lead-form.css), one per long message the line can
       * show. The texts sit in data attributes, not in the DOM text or the accessibility tree, so the
       * success message cannot be read or announced before the server reports the message stored.
       */}
      <div className="lead-form__outcome" data-reserve-a={copy.successMessage} data-reserve-b={copy.errorMessage}>
        <div className="lead-form__outcome" data-reserve-a={copy.closedMessage} data-reserve-b={CONTACT_FORM_COPY.outcome.rateLimited}>
          {/* The form's only role="status" (R167); never focused, as a focused live region is read out as well as announced. */}
          <p role="status" aria-live="polite" aria-atomic="true" className="lead-form__status" data-tone={pending ? "pending" : outcome?.tone}>
            {pending ? CONTACT_FORM_COPY.sending : (outcome?.text ?? "")}
          </p>
        </div>
      </div>

      <noscript>
        <p className="lead-form__noscript">{CONTACT_FORM_COPY.noScript}</p>
      </noscript>
    </form>
  );
}
