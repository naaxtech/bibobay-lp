"use client";

import { useEffect, useRef, useState } from "react";

import { isAdminSuccess, apiMessage, sendAdminRequest } from "./admin-request";
import { goTo } from "./navigate";
import { PAGE_COPY } from "./page-copy";

/**
 * Ends the staff session (Task 8c, ruling R102): DELETE /api/admin/session as same-origin JSON,
 * then a full page load of the sign-in page, so the frame drops the button. When the request does
 * not succeed the session may still be open, so the button says so in its polite live region
 * (never focused, so nothing is announced twice) and works again.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [focusReturn, setFocusReturn] = useState(0);
  const pendingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Disabling the focused button drops focus to <body>; after a failure it returns to the button.
  useEffect(() => {
    if (focusReturn === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) buttonRef.current?.focus();
  }, [focusReturn]);

  async function signOut() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    const answer = await sendAdminRequest("DELETE", "/api/admin/session");
    if (isAdminSuccess(answer)) {
      // Stay disabled while the browser leaves.
      goTo("/admin/login");
      return;
    }
    pendingRef.current = false;
    setPending(false);
    setMessage(apiMessage(answer.body) ?? PAGE_COPY.signOut.failed);
    setFocusReturn((count) => count + 1);
  }

  return (
    <div className="admin-signout">
      <button ref={buttonRef} type="button" className="admin-button" onClick={signOut} disabled={pending} aria-busy={pending}>
        {PAGE_COPY.signOut.label}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className="admin-signout__status admin-status">
        {message}
      </p>
    </div>
  );
}
