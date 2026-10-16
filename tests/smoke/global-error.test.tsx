import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GlobalError from "@/app/global-error";
import { UI_COPY } from "@/components/landing/ui-copy";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

/*
 * T-I5: the last-resort error page is rendered here, so what a visitor sees after an unrecoverable
 * error is proven by a test. It replaces the root layout, so it renders its own html and body.
 */
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  captureException.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

// React warns that <html> sits inside a <div> in jsdom; the page is a document root in production.
const renderPage = (reset: () => void) =>
  render(<GlobalError error={Object.assign(new Error("internal detail"), { digest: "d1" })} reset={reset} />, { container: document });

describe("app/global-error.tsx", () => {
  it("shows the calm branded copy, with no internal detail, and a full-page link home", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage(vi.fn());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UI_COPY.globalError.title);
    expect(screen.getByText(UI_COPY.globalError.body)).toBeTruthy();
    expect(document.body.textContent).not.toContain("internal detail");
    expect(screen.getByRole("link", { name: UI_COPY.globalError.home }).getAttribute("href")).toBe("/");
  });

  it("calls reset when the retry control is pressed", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    renderPage(reset);
    fireEvent.click(screen.getByRole("button", { name: UI_COPY.globalError.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not report to Sentry when no DSN is configured", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage(vi.fn());
    expect(captureException).not.toHaveBeenCalled();
  });
});
