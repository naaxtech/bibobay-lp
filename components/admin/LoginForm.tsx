"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { isAdminSuccess, apiMessage, sendAdminRequest, type AdminAnswer } from "./admin-request";
import { goTo } from "./navigate";
import { PAGE_COPY } from "./page-copy";

/** Where a successful sign-in always lands (R100): there is no `next` parameter. */
const AFTER_SIGN_IN = "/admin/orders";

/** True once React has hydrated; false in server HTML. No effect, so no extra render pass. */
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

/** The message for each answer, in the API's own words; our words only when the answer is not the API's. */
function messageFor(answer: AdminAnswer): string {
  const known = apiMessage(answer.body);
  if (known) return known;
  switch (answer.status) {
    case 400:
      return PAGE_COPY.login.fallback.checkDetails;
    case 401:
      return PAGE_COPY.login.fallback.refused;
    case 403:
      return PAGE_COPY.login.fallback.forbidden;
    case 429:
      return PAGE_COPY.login.fallback.rateLimited;
    case 500:
      return PAGE_COPY.login.fallback.failed;
    case 503:
    case 502:
    case 504:
      return PAGE_COPY.login.fallback.unavailable;
    default:
      return PAGE_COPY.login.notReached;
  }
}

type Field = "email" | "password";
type FocusTarget = "email" | "password" | "button";

/**
 * The staff sign-in form (Task 8c, rulings R100, R102, R105). Staff only: the owner creates the
 * accounts, so there is no sign-up, reset or magic link here. It posts { email, password } as
 * same-origin JSON to /api/admin/session and shows the API's own message in one polite live region;
 * the live region is never focused, so nothing is announced twice. A field left empty is named next
 * to its input and nothing is sent. The password lives only in the input and the request body.
 * The button stays off until hydration (a native submit would post the form to the page).
 */
export function LoginForm() {
  const id = useId();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [focus, setFocus] = useState<{ target: FocusTarget; count: number } | null>(null);
  const pendingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Runs after the render that re-enabled the controls. Disabling the focused button drops focus
  // to <body>, so after a request focus goes back to a control, unless staff already moved it.
  useEffect(() => {
    if (!focus) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === buttonRef.current;
    if (!lost && focus.target === "button") return;
    ({ email: emailRef, password: passwordRef, button: buttonRef })[focus.target].current?.focus();
  }, [focus]);

  const refocus = (target: FocusTarget) => setFocus((previous) => ({ target, count: (previous?.count ?? 0) + 1 }));
  const fieldError = (field: Field) => errors[field];
  const errorId = (field: Field) => `${id}-${field}-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || done) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const found: Partial<Record<Field, string>> = {};
    if (!email) found.email = PAGE_COPY.login.emailRequired;
    if (!password) found.password = PAGE_COPY.login.passwordRequired;
    setErrors(found);
    if (found.email || found.password) {
      setMessage("");
      refocus(found.email ? "email" : "password");
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setMessage(PAGE_COPY.login.sending);
    const answer = await sendAdminRequest("POST", "/api/admin/session", { email, password });
    pendingRef.current = false;

    if (isAdminSuccess(answer)) {
      // Stay disabled while the browser leaves for the orders page.
      setDone(true);
      setPending(false);
      setMessage(apiMessage(answer.body) ?? PAGE_COPY.login.signedIn);
      goTo(AFTER_SIGN_IN);
      return;
    }
    setPending(false);
    setMessage(answer.status === 200 || answer.status === 0 ? PAGE_COPY.login.notReached : messageFor(answer));
    if (answer.status === 401 && passwordRef.current) passwordRef.current.value = "";
    refocus(answer.status === 401 ? "password" : "button");
  }

  const describedBy = (field: Field) => (fieldError(field) ? errorId(field) : undefined);

  return (
    <form className="lead-form admin-form" aria-label={PAGE_COPY.login.formLabel} method="post" noValidate onSubmit={handleSubmit}>
      <div className="lead-form__field">
        <label htmlFor={`${id}-email`} className="lead-form__label">
          {PAGE_COPY.login.emailLabel}
        </label>
        <input
          ref={emailRef}
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={done}
          aria-invalid={fieldError("email") ? true : undefined}
          aria-describedby={describedBy("email")}
          className="lead-form__input"
        />
        {fieldError("email") ? (
          <p id={errorId("email")} className="lead-form__error">
            {fieldError("email")}
          </p>
        ) : null}
      </div>

      <div className="lead-form__field">
        <label htmlFor={`${id}-password`} className="lead-form__label">
          {PAGE_COPY.login.passwordLabel}
        </label>
        <input
          ref={passwordRef}
          id={`${id}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={done}
          aria-invalid={fieldError("password") ? true : undefined}
          aria-describedby={describedBy("password")}
          className="lead-form__input"
        />
        {fieldError("password") ? (
          <p id={errorId("password")} className="lead-form__error">
            {fieldError("password")}
          </p>
        ) : null}
      </div>

      <button ref={buttonRef} type="submit" className="btn btn-primary lead-form__submit" disabled={pending || done || !hydrated} aria-busy={pending}>
        {PAGE_COPY.login.submit}
      </button>

      <p role="status" aria-live="polite" aria-atomic="true" className="lead-form__status admin-status" data-tone={pending ? "pending" : done ? "success" : message ? "error" : undefined}>
        {message}
      </p>

      <noscript>
        <p className="lead-form__noscript">{PAGE_COPY.login.noScript}</p>
      </noscript>
    </form>
  );
}
