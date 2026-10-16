"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { Dialog } from "@/components/ui/Dialog";
import { resumeAnalytics, stopAnalytics } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import { readChoice, subscribeChoice } from "@/lib/analytics/preference";

/** The server knows no answer: the answer lives in the browser (and the dialog only opens there). */
const noAnswerOnTheServer = () => null;

/**
 * The footer's "Analytics choices": what visit statistics count, and a switch to turn them on or
 * off for this device, at any time. Statistics are opt-in (ruling R144): off until the visitor says
 * yes, here or in the consent notice. The status follows the stored answer, so it stays true while
 * the dialog is open, even when the visitor answers in another tab. Both actions are the same kind
 * of button as "Close": turning statistics on is not the louder choice (ruling R148). Offered only
 * when analytics are configured (ruling R49): a choice about statistics that cannot run would be a
 * false statement.
 */
export function AnalyticsChoices({ config }: { config: AnalyticsConfig | null }) {
  const [open, setOpen] = useState(false);
  const on = useSyncExternalStore(subscribeChoice, readChoice, noAnswerOnTheServer) === "on";
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (!config) return null;

  return (
    <>
      <button ref={buttonRef} type="button" className="footer-link footer-link--button" onClick={() => setOpen(true)}>
        {UI_COPY.analytics.choices}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={UI_COPY.analytics.choices} returnFocusRef={buttonRef} className="analytics-dialog">
        {UI_COPY.analytics.explainer.map((line) => (
          <p key={line} className="analytics-dialog__text">
            {line}
          </p>
        ))}
        <p className="analytics-dialog__status" role="status">
          {on ? UI_COPY.analytics.statusOn : UI_COPY.analytics.statusOff}
        </p>
        <div className="analytics-dialog__actions">
          {on ? (
            <button type="button" className="btn btn-paper" onClick={() => stopAnalytics()}>
              {UI_COPY.analytics.turnOff}
            </button>
          ) : (
            <button type="button" className="btn btn-paper" onClick={() => void resumeAnalytics(config)}>
              {UI_COPY.analytics.turnOn}
            </button>
          )}
          <button type="button" className="btn btn-paper" onClick={() => setOpen(false)}>
            {UI_COPY.close}
          </button>
        </div>
      </Dialog>
    </>
  );
}
