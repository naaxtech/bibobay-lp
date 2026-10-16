"use client";

import { useId, useRef, useState } from "react";

import { LocalTime } from "@/components/orders/LocalTime";
import { TRACKING_TOKEN_PATTERN } from "@/lib/orders/fields";
import { PAGE_COPY } from "./page-copy";
import type { Perform, Tone } from "./useOrderAction";

const COPY = PAGE_COPY.controls.tracking;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The `/orders/<token>` path the API answers with, or null for anything else. */
function trackingPathFrom(body: unknown): string | null {
  if (!isRecord(body) || typeof body.trackingPath !== "string") return null;
  const match = /^\/orders\/([^/]+)$/.exec(body.trackingPath);
  return match && TRACKING_TOKEN_PATTERN.test(match[1]!) ? body.trackingPath : null;
}

export interface TrackingLinkControlProps {
  busy: boolean;
  perform: Perform;
  announce: (text: string, tone: Tone) => void;
}

/**
 * Replaces the order's private tracking link (Task 8c, ruling R104). The API creates a new link,
 * answers with its path once and keeps only a hash of it, so this control shows the link in an
 * `<output>` with a Copy button and holds it only in this component's state: reloading the page
 * loses it for good, and a new link has to be made. The link is not put in the live region, so it
 * is not read out. It is `${window.location.origin}/orders/<token>`, so on a preview deployment
 * it is a preview link.
 */
export function TrackingLinkControl({ busy, perform, announce }: TrackingLinkControlProps) {
  const headingId = useId();
  const outputId = useId();
  const outputRef = useRef<HTMLOutputElement>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);

  async function rotate() {
    const result = await perform("tracking-link", {});
    if (!result?.ok) return;
    const path = trackingPathFrom(result.answer.body);
    if (!path) {
      setLink(null);
      return;
    }
    const expiresAt = isRecord(result.answer.body) && typeof result.answer.body.expiresAt === "string" ? result.answer.body.expiresAt : null;
    setLink({ url: `${window.location.origin}${path}`, expiresAt });
  }

  function selectLink() {
    const output = outputRef.current;
    const selection = window.getSelection();
    if (!output || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(output);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy() {
    if (!link) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link.url);
      announce(COPY.copied, "success");
    } catch {
      selectLink();
      announce(COPY.copyFailed, "error");
    }
  }

  return (
    <div className="admin-tracking" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="admin-section-title">
        {COPY.heading}
      </h3>
      <p className="admin-hint">{COPY.lead}</p>
      <div className="admin-actions">
        <button type="button" className="admin-button" onClick={() => void rotate()} disabled={busy}>
          {COPY.create}
        </button>
      </div>
      {link ? (
        <div className="admin-tracking__link">
          <label id={`${outputId}-label`} htmlFor={outputId} className="lead-form__label">
            {COPY.linkLabel}
          </label>
          {/* role="group": an <output> is a live region by default, and the secret link must not be announced. */}
          <output ref={outputRef} id={outputId} role="group" aria-labelledby={`${outputId}-label`} className="admin-tracking__url">
            {link.url}
          </output>
          <div className="admin-actions">
            <button type="button" className="admin-button" onClick={() => void copy()} disabled={busy}>
              {COPY.copy}
            </button>
          </div>
          {link.expiresAt ? (
            <p className="admin-hint">
              {COPY.worksUntil} <LocalTime iso={link.expiresAt} />.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
