"use client";

import { useRef, useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { Dialog } from "@/components/ui/Dialog";
import { resumeAnalytics, stopAnalytics } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import { analyticsAllowed } from "@/lib/analytics/preference";

/**
 * The footer's "Analytics choices" (ruling R70): what visit statistics count, and a switch to turn
 * them off or on again for this device. Offered only when analytics are configured (ruling R49):
 * a choice about statistics that cannot run would be a false statement.
 */
export function AnalyticsChoices({ config }: { config: AnalyticsConfig | null }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (!config) return null;

  const show = () => {
    setOn(analyticsAllowed());
    setOpen(true);
  };

  return (
    <>
      <button ref={buttonRef} type="button" className="footer-link footer-link--button" onClick={show}>
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
            <button
              type="button"
              className="btn btn-paper"
              onClick={() => {
                stopAnalytics();
                setOn(false);
              }}
            >
              {UI_COPY.analytics.turnOff}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void resumeAnalytics(config);
                setOn(true);
              }}
            >
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
