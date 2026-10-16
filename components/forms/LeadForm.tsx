"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";
import { track } from "@/lib/analytics/client";

import {
  AGE_BANDS,
  HONEYPOT_FIELD,
  LEAD_FIELD_ORDER,
  checkLeadFields,
  safeLocale,
  utmFromSearch,
  type LeadField,
  type LeadFieldErrorCode,
  type LeadFieldErrors,
} from "@/lib/leads/fields";
import { FORM_COPY, fieldErrorMessage } from "./form-copy";

/** The CMS lead copy the form shows (spec §8: every sentence about BIBO comes from Sanity). */
export interface LeadFormCopy {
  buttonLabel: string;
  consentCopy: string;
  successMessage: string;
  errorMessage: string;
}

export interface LeadFormProps {
  copy: LeadFormCopy;
  /** Where the signup is posted; tests and the route share the default. */
  endpoint?: string;
}

type Outcome = { tone: "success" | "error"; text: string } | null;

/** Where focus goes once a request completes, unless the person has already moved it (review M6). */
type FocusReturn = { target: "button" | "status"; request: number } | null;

const LEAD_SOURCE = "landing";
const FIELD_CODES = new Set<LeadFieldErrorCode>(["required", "invalid", "too_long"]);

/** True once React has hydrated; false in server HTML. No effect, so no extra render pass. */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The server's field errors, keeping only known fields and codes. */
function serverFieldErrors(body: unknown): LeadFieldErrors {
  const errors: LeadFieldErrors = {};
  const raw = isRecord(body) && isRecord(body.fieldErrors) ? body.fieldErrors : {};
  for (const field of LEAD_FIELD_ORDER) {
    const code = raw[field];
    if (typeof code === "string" && FIELD_CODES.has(code as LeadFieldErrorCode)) errors[field] = code as LeadFieldErrorCode;
  }
  return errors;
}

/**
 * The founding-family signup form (spec §9, §13). Adults only: an email, an optional first name,
 * an optional broad age range and the required consent tick; nothing else about a child.
 *
 * Truthful outcomes: the CMS success message appears only when the server answers
 * `persisted: true`. A 503 shows the server's own message (signups can be closed on purpose, Ruling
 * R125); a rate limit (429) is explained in plain words; every other answer (500, a 503 without a
 * message, network failure) shows the CMS error message. Nothing here says an email was sent.
 * After any outcome except field errors, focus returns to the submit button, never the status line.
 *
 * Accessibility: labels above fields, hints and errors tied by `aria-describedby`, an error summary
 * (a named group, so its title is announced) that takes focus on a failed submit and links to each
 * field, one polite live region for the result, and a submit button that is disabled and
 * `aria-busy` while saving. Disabling the focused button drops focus to <body> in Chromium, so once
 * the request completes focus returns to the button after a failure, or moves to the outcome after
 * a success, unless the person has moved it elsewhere meanwhile. The status line keeps its height
 * and the button keeps its width between states, so nothing jumps. Before hydration the button
 * stays disabled, so a native submit can never post the form somewhere unintended.
 */
export function LeadForm({ copy, endpoint = "/api/leads" }: LeadFormProps) {
  const id = useId();
  const ids = {
    email: `${id}-email`,
    emailHint: `${id}-email-hint`,
    firstName: `${id}-first-name`,
    ageBand: `${id}-age-band`,
    ageBandHint: `${id}-age-band-hint`,
    consent: `${id}-consent`,
    trap: `${id}-website`,
    summaryTitle: `${id}-summary-title`,
  };
  const fieldId: Record<LeadField, string> = { email: ids.email, firstName: ids.firstName, ageBand: ids.ageBand, consent: ids.consent };
  const errorId = (field: LeadField) => `${fieldId[field]}-error`;

  const hydrated = useHydrated();
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, setPending] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [focusReturn, setFocusReturn] = useState<FocusReturn>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const pendingRef = useRef(false);

  // Each failed submit moves focus to the summary, even when the same problems repeat.
  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  // Runs after the render that re-enabled the button, so the button can take focus again.
  useEffect(() => {
    if (!focusReturn) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === submitRef.current;
    if (lost) (focusReturn.target === "status" ? statusRef.current : submitRef.current)?.focus();
  }, [focusReturn]);

  const showFieldErrors = (found: LeadFieldErrors) => {
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
    const values = { email: text("email"), firstName: text("firstName"), ageBand: text("ageBand"), consent: data.get("consent") !== null };

    setOutcome(null);
    const found = checkLeadFields(values);
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }
    setErrors({});

    const firstName = values.firstName.trim();
    const ageBand = values.ageBand.trim();
    const utm = utmFromSearch(window.location.search);
    const locale = safeLocale(navigator.language);
    const body = {
      email: values.email.trim(),
      consent: true,
      ...(firstName ? { firstName } : {}),
      ...(ageBand ? { ageBand } : {}),
      source: LEAD_SOURCE,
      ...(locale ? { locale } : {}),
      ...(utm ? { utm } : {}),
      // Sent as found: a person leaves it empty, and the server turns anything else away.
      [HONEYPOT_FIELD]: text(HONEYPOT_FIELD),
    };

    pendingRef.current = true;
    setPending(true);
    // Field errors move focus to the summary instead; every other outcome returns it (review M6).
    let returnFocusTo: "button" | "status" | null = "button";
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
        // Ruling R70: the outcome only; nothing the visitor typed.
        track("lead_submitted", { persisted: true, acknowledgementQueued: answer.acknowledgementQueued === true });
        form.reset();
        // Task 5 N4: focus returns to the button, never the live status line (a focused live region is read out as well as announced).
      } else if (response.status === 503 && isRecord(answer) && typeof answer.message === "string" && answer.message.trim() !== "") {
        // Signups can be closed on purpose (no removal channel yet, Ruling R125): say what the server says.
        setOutcome({ tone: "error", text: answer.message });
      } else if (response.status === 429) {
        setOutcome({ tone: "error", text: FORM_COPY.outcome.rateLimited });
      } else if (response.status === 400 && Object.keys(serverFieldErrors(answer)).length > 0) {
        showFieldErrors(serverFieldErrors(answer));
        returnFocusTo = null;
      } else {
        setOutcome({ tone: "error", text: copy.errorMessage });
      }
    } catch {
      setOutcome({ tone: "error", text: copy.errorMessage });
    } finally {
      pendingRef.current = false;
      setPending(false);
      const target = returnFocusTo;
      if (target) setFocusReturn((previous) => ({ target, request: (previous?.request ?? 0) + 1 }));
    }
  }

  const focusField = (field: LeadField) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(fieldId[field])?.focus();
  };

  const describedBy = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ") || undefined;
  const errorText = (field: LeadField) => {
    const code = errors[field];
    return code ? fieldErrorMessage(field, code) : null;
  };
  const listed = LEAD_FIELD_ORDER.filter((field) => errors[field]);

  return (
    <form className="lead-form" aria-label={FORM_COPY.formLabel} method="post" noValidate onSubmit={handleSubmit}>
      {listed.length > 0 ? (
        // role="group": a generic <div> may not be named (ARIA 1.2), so its title might never be
        // announced when it takes focus (review M5).
        <div ref={summaryRef} role="group" className="lead-form__summary" tabIndex={-1} aria-labelledby={ids.summaryTitle}>
          <h3 id={ids.summaryTitle} className="lead-form__summary-title">
            {FORM_COPY.errorSummaryTitle}
          </h3>
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
        <label htmlFor={ids.email} className="lead-form__label">
          {FORM_COPY.email.label}
        </label>
        <p id={ids.emailHint} className="lead-form__hint">
          {FORM_COPY.email.hint}
        </p>
        <input
          id={ids.email}
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
        <label htmlFor={ids.firstName} className="lead-form__label">
          {FORM_COPY.firstName.label}
        </label>
        <input
          id={ids.firstName}
          name="firstName"
          type="text"
          autoComplete="given-name"
          aria-invalid={errors.firstName ? true : undefined}
          aria-describedby={describedBy(errors.firstName && errorId("firstName"))}
          className="lead-form__input"
        />
        {errors.firstName ? (
          <p id={errorId("firstName")} className="lead-form__error">
            {errorText("firstName")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field">
        <label htmlFor={ids.ageBand} className="lead-form__label">
          {FORM_COPY.ageBand.label}
        </label>
        <p id={ids.ageBandHint} className="lead-form__hint">
          {FORM_COPY.ageBand.hint}
        </p>
        <select
          id={ids.ageBand}
          name="ageBand"
          defaultValue=""
          aria-invalid={errors.ageBand ? true : undefined}
          aria-describedby={describedBy(ids.ageBandHint, errors.ageBand && errorId("ageBand"))}
          className="lead-form__input lead-form__select"
        >
          <option value="">{FORM_COPY.ageBand.placeholder}</option>
          {AGE_BANDS.map((band) => (
            <option key={band} value={band}>
              {FORM_COPY.ageBands[band]}
            </option>
          ))}
        </select>
        {errors.ageBand ? (
          <p id={errorId("ageBand")} className="lead-form__error">
            {errorText("ageBand")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field lead-form__consent">
        <div className="lead-form__check">
          <input
            id={ids.consent}
            name="consent"
            type="checkbox"
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={describedBy(errors.consent && errorId("consent"))}
            className="lead-form__checkbox"
          />
          <label htmlFor={ids.consent} className="lead-form__check-label">
            {copy.consentCopy}
          </label>
        </div>
        {errors.consent ? (
          <p id={errorId("consent")} className="lead-form__error">
            {errorText("consent")}
          </p>
        ) : null}
        {/* src: https://nextjs.org/docs/app/api-reference/components/link#prefetch · next 16.3.8 · 2026-10-12 — the privacy page ships in Task 9; no prefetch of a route that may not exist yet. */}
        <Link href="/privacy" prefetch={false} className="text-link lead-form__privacy">
          {FORM_COPY.privacyLink}
        </Link>
      </div>

      {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. */}
      <div className="lead-form__trap" aria-hidden="true">
        <label htmlFor={ids.trap}>{FORM_COPY.honeypotLabel}</label>
        <input id={ids.trap} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <button ref={submitRef} type="submit" className="btn btn-primary lead-form__submit" disabled={pending || !hydrated} aria-busy={pending}>
        {copy.buttonLabel}
      </button>

      {/*
       * The outcome line never changes height (spec §13 "no layout jump"). Its two wrappers stack
       * four invisible CSS pseudo-elements in the status's grid cell, one per message the line can
       * show (lead-form.css), so the cell is always as tall as the longest one at the current width.
       * The texts sit in data attributes, not in the DOM text or the accessibility tree, so the
       * success message cannot be read or announced before the server reports the signup stored.
       */}
      <div className="lead-form__outcome" data-reserve-a={copy.successMessage} data-reserve-b={copy.errorMessage}>
        <div className="lead-form__outcome" data-reserve-a={FORM_COPY.outcome.rateLimited} data-reserve-b={FORM_COPY.sending}>
          {/* Never focused (Task 5 N4): a focused live region is read out as well as announced. */}
          <p ref={statusRef} role="status" aria-live="polite" aria-atomic="true" className="lead-form__status" data-tone={pending ? "pending" : outcome?.tone}>
            {pending ? FORM_COPY.sending : (outcome?.text ?? "")}
          </p>
        </div>
      </div>

      <noscript>
        <p className="lead-form__noscript">{FORM_COPY.noScript}</p>
      </noscript>
    </form>
  );
}
