"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

import { apiMessage, isAdminSuccess, sendAdminRequest, type AdminAnswer } from "./admin-request";
import { goTo } from "./navigate";
import { PAGE_COPY } from "./page-copy";

/**
 * How the order controls call the staff order API (Task 8c, ruling R102), shared by the quote form,
 * the status buttons and the tracking-link control so that one request runs at a time and one
 * message is shown:
 *   200  the API's message, then router.refresh(): the figures, revision, events and emails come
 *        back from the server, and nothing is computed here
 *   409  the API's message, then router.refresh() (the order changed under the person)
 *   401  the API's message, then the sign-in page (a full page load: the session is gone)
 *   any other answer: the API's message, or the status's own words when the answer is not the API's
 * The message is the API's, whole; it is shown in the one live region, which is never focused.
 */
export type OrderEndpoint = "quote" | "status" | "tracking-link";
export type Tone = "pending" | "success" | "error";

export interface ActionResult {
  /** True only for the API's own success body. */
  ok: boolean;
  answer: AdminAnswer;
}

export type Perform = (endpoint: OrderEndpoint, body: unknown) => Promise<ActionResult | null>;

/** The words for an answer that carries none of the API's own. */
function fallbackFor(status: number): string {
  const f = PAGE_COPY.controls.fallback;
  switch (status) {
    case 400:
      return f.checkDetails;
    case 401:
      return f.signedOut;
    case 403:
      return f.forbidden;
    case 404:
      return f.notFound;
    case 409:
      return f.stale;
    case 500:
      return f.failed;
    case 502:
    case 503:
    case 504:
      return f.unavailable;
    default:
      return f.notReached;
  }
}

export function useOrderAction(reference: string) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  // The refresh runs in a transition: the controls stay off until the server's new page has landed.
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const busyRef = useRef(false);

  const perform: Perform = useCallback(
    async (endpoint, body) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setRequesting(true);
      setMessage({ text: PAGE_COPY.controls.working, tone: "pending" });
      const answer = await sendAdminRequest("POST", `/api/admin/orders/${encodeURIComponent(reference)}/${endpoint}`, body);
      busyRef.current = false;

      const ok = isAdminSuccess(answer);
      // A 200 that is not the API's success body (a proxy page, say) is not trusted.
      const text = answer.status === 200 && !ok ? PAGE_COPY.controls.fallback.notReached : (apiMessage(answer.body) ?? (ok ? PAGE_COPY.controls.fallback.done : fallbackFor(answer.status)));
      setMessage({ text, tone: ok ? "success" : "error" });
      if (answer.status === 401) {
        // Stay disabled while the browser leaves for the sign-in page.
        goTo("/admin/login");
        return { ok, answer };
      }
      setRequesting(false);
      if (ok || answer.status === 409) startRefresh(() => router.refresh());
      return { ok, answer };
    },
    [reference, router],
  );

  /** Shows a message of the component's own (copying the link), in the same live region. */
  const announce = useCallback((text: string, tone: Tone) => setMessage({ text, tone }), []);
  const clear = useCallback(() => setMessage(null), []);

  const busy = requesting || refreshing;

  return { busy, message, perform, announce, clear };
}
