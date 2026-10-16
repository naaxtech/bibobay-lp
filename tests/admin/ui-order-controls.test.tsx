import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense, use, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { OrderControls, type OrderControlsProps } from "@/components/admin/OrderControls";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { formatMajorInput } from "@/lib/orders/quote-money";

const goTo = vi.fn();
vi.mock("@/components/admin/navigate", () => ({ goTo: (path: string) => goTo(path) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/*
 * Task 8c, rulings R102-R104: the order controls (quote form, status buttons, tracking link). Every
 * request is same-origin JSON; the API's own message is shown in the one live region; after a 200
 * (and a 409) the page is refreshed so the figures, revision, events and emails come back from the
 * server; a 401 sends the browser to the sign-in page; controls are disabled while a request is in
 * flight; money is converted with integer arithmetic; cancelling confirms first; the rotated link
 * is shown once. Nothing here says an email was sent or a payment taken.
 */
const REFERENCE = "BB-12AB-34CD";
const TOKEN = "a".repeat(64);
const PAYMENT_URL = "https://pay.example.com/invoice/123";

type Answer = { status: number; body: unknown } | "network-error" | "never";
let answers: Answer[] = [];
const requests: Array<{ url: string; init: RequestInit; body: unknown }> = [];
let release: (() => void) | undefined;

beforeEach(() => {
  goTo.mockClear();
  refresh.mockClear();
  answers = [];
  requests.length = 0;
  release = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init, body: JSON.parse(String(init.body)) });
      const answer = answers.shift() ?? "network-error";
      if (answer === "network-error") throw new TypeError("fetch failed");
      if (answer === "never") {
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify({ ok: true, message: ADMIN_COPY.status.changed }), { status: 200 });
      }
      return new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const QUOTED = { revision: 2, currency: "PHP", subtotalMinor: 125050, freightMinor: 5000, paymentUrl: PAYMENT_URL } as const;
const FRESH = { revision: 0, currency: null, subtotalMinor: null, freightMinor: null, paymentUrl: null } as const;

function setup(overrides: Partial<OrderControlsProps> = {}) {
  const props: OrderControlsProps = { reference: REFERENCE, status: "new", quote: QUOTED, ...overrides };
  const view = render(<OrderControls {...props} />);
  return { ...view, props, again: (next: Partial<OrderControlsProps>) => view.rerender(<OrderControls {...props} {...next} />) };
}

const quoteForm = () => screen.getByRole("form", { name: PAGE_COPY.controls.quote.heading });
const currency = () => within(quoteForm()).getByLabelText(PAGE_COPY.controls.quote.currencyLabel) as HTMLSelectElement;
const subtotal = () => within(quoteForm()).getByLabelText(PAGE_COPY.controls.quote.subtotalLabel, { exact: false }) as HTMLInputElement;
const freight = () => within(quoteForm()).getByLabelText(PAGE_COPY.controls.quote.freightLabel, { exact: false }) as HTMLInputElement;
const paymentUrl = () => within(quoteForm()).getByLabelText(PAGE_COPY.controls.quote.paymentUrlLabel, { exact: false }) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: PAGE_COPY.controls.quote.save }) as HTMLButtonElement;
const sendButton = () => screen.getByRole("button", { name: PAGE_COPY.controls.quote.send }) as HTMLButtonElement;
const status = () => screen.getByRole("status");
const advanceButton = (to: keyof typeof PAGE_COPY.controls.status.advance) => screen.getByRole("button", { name: PAGE_COPY.controls.status.advance[to] }) as HTMLButtonElement;
const cancelButton = () => screen.getByRole("button", { name: PAGE_COPY.controls.status.cancel }) as HTMLButtonElement;
const trackingButton = () => screen.getByRole("button", { name: PAGE_COPY.controls.tracking.create }) as HTMLButtonElement;

const click = (element: HTMLElement) =>
  act(async () => {
    fireEvent.click(element);
  });

const quoteUrl = `/api/admin/orders/${REFERENCE}/quote`;
const statusUrl = `/api/admin/orders/${REFERENCE}/status`;
const trackingUrl = `/api/admin/orders/${REFERENCE}/tracking-link`;

describe("the quote form", () => {
  it("starts from the order's current figures in the currency's main unit", () => {
    setup();
    expect(currency().value).toBe("PHP");
    expect(subtotal().value).toBe(formatMajorInput(125050, "PHP"));
    expect(subtotal().value).toBe("1250.50");
    expect(freight().value).toBe("50.00");
    expect(paymentUrl().value).toBe(PAYMENT_URL);
    expect(within(quoteForm()).getByText(new RegExp(`^${PAGE_COPY.controls.quote.savedRevision}:`)).textContent).toContain("2");
  });

  it("starts empty, in pesos, for an order with no quote yet", () => {
    setup({ quote: FRESH });
    expect(currency().value).toBe("PHP");
    expect([subtotal().value, freight().value, paymentUrl().value]).toEqual(["", "", ""]);
    expect(within(quoteForm()).getByText(PAGE_COPY.controls.quote.noneSaved, { exact: false })).toBeTruthy();
  });

  it("offers exactly the fixed currency list", () => {
    setup();
    expect(Array.from(currency().options).map((option) => option.value)).toEqual(["PHP", "USD", "EUR", "GBP", "AUD", "SGD", "JPY"]);
  });

  it("labels every field and names the money format and the payment link rule", () => {
    setup();
    for (const input of [currency(), subtotal(), freight(), paymentUrl()]) expect(input.id).toBeTruthy();
    expect(subtotal().getAttribute("aria-describedby")).toBeTruthy();
    expect(paymentUrl().getAttribute("aria-describedby")).toBeTruthy();
    expect(paymentUrl().type).toBe("url");
    expect(subtotal().getAttribute("inputmode")).toBe("decimal");
  });

  it("saves the typed figures as whole minor units with the revision it shows, as same-origin JSON", async () => {
    answers = [{ status: 200, body: { ok: true, revision: 3, message: ADMIN_COPY.quote.saved } }];
    setup();
    fireEvent.change(subtotal(), { target: { value: "1999.99" } });
    fireEvent.change(freight(), { target: { value: "0" } });
    fireEvent.change(paymentUrl(), { target: { value: "https://pay.example.com/new" } });
    await click(saveButton());
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe(quoteUrl);
    expect(request!.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(request!.init.headers).get("content-type")).toBe("application/json");
    expect(request!.body).toEqual({ intent: "save", revision: 2, currency: "PHP", subtotalMinor: 199999, freightMinor: 0, paymentUrl: "https://pay.example.com/new" });
    expect(status().textContent).toBe(ADMIN_COPY.quote.saved);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never turns a decimal into the wrong amount (no floating point)", async () => {
    answers = [{ status: 200, body: { ok: true, revision: 1, message: ADMIN_COPY.quote.saved } }];
    setup({ quote: FRESH });
    fireEvent.change(subtotal(), { target: { value: "19.99" } });
    fireEvent.change(freight(), { target: { value: "1.1" } });
    fireEvent.change(paymentUrl(), { target: { value: PAYMENT_URL } });
    await click(saveButton());
    expect(requests[0]!.body).toMatchObject({ revision: 0, subtotalMinor: 1999, freightMinor: 110 });
  });

  it("uses the chosen currency's exponent (yen have none)", async () => {
    answers = [{ status: 200, body: { ok: true, revision: 1, message: ADMIN_COPY.quote.saved } }];
    setup({ quote: FRESH });
    fireEvent.change(currency(), { target: { value: "JPY" } });
    fireEvent.change(subtotal(), { target: { value: "1500" } });
    fireEvent.change(freight(), { target: { value: "300" } });
    fireEvent.change(paymentUrl(), { target: { value: PAYMENT_URL } });
    await click(saveButton());
    expect(requests[0]!.body).toMatchObject({ currency: "JPY", subtotalMinor: 1500, freightMinor: 300 });
  });

  const refused: Array<[string, string, string]> = [
    ["", "required", PAGE_COPY.controls.quote.errors.required],
    ["abc", "invalid", PAGE_COPY.controls.quote.errors.invalid],
    ["-5", "negative", PAGE_COPY.controls.quote.errors.negative],
    ["1.005", "too many decimals", PAGE_COPY.controls.quote.errors.tooManyDecimals],
    ["1000000.01", "too large", PAGE_COPY.controls.quote.errors.tooLarge],
  ];
  for (const [text, label, message] of refused) {
    it(`names ${label} money text next to the field, marks it invalid and sends nothing ("${text}")`, async () => {
      setup({ quote: { ...QUOTED } });
      fireEvent.change(subtotal(), { target: { value: text } });
      await click(saveButton());
      expect(requests).toHaveLength(0);
      expect(subtotal().getAttribute("aria-invalid")).toBe("true");
      const describedBy = subtotal().getAttribute("aria-describedby") ?? "";
      const error = describedBy.split(" ").map((id) => document.getElementById(id)).find((element) => element?.textContent === message);
      expect(error, "the error is one of the field's descriptions").toBeTruthy();
      expect(document.activeElement).toBe(subtotal());
      expect(freight().getAttribute("aria-invalid")).toBeNull();
    });
  }

  it("asks for the payment link before sending anything", async () => {
    setup({ quote: { ...QUOTED, paymentUrl: null } });
    await click(saveButton());
    expect(requests).toHaveLength(0);
    expect(paymentUrl().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(paymentUrl());
  });

  it("maps the API's field problems onto the inputs and shows its message", async () => {
    answers = [
      {
        status: 400,
        body: { ok: false, message: ADMIN_COPY.api.checkDetails, fieldErrors: { subtotalMinor: "invalid", paymentUrl: "host_not_allowed", currency: "invalid", freightMinor: "required" } },
      },
    ];
    setup();
    await click(saveButton());
    expect(status().textContent).toBe(ADMIN_COPY.api.checkDetails);
    expect(subtotal().getAttribute("aria-invalid")).toBe("true");
    expect(freight().getAttribute("aria-invalid")).toBe("true");
    expect(paymentUrl().getAttribute("aria-invalid")).toBe("true");
    expect(currency().getAttribute("aria-invalid")).toBe("true");
    const text = (input: HTMLElement) => (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(text(paymentUrl())).toContain(PAGE_COPY.controls.quote.errors.hostNotAllowed);
    expect(text(subtotal())).toContain(PAGE_COPY.controls.quote.errors.invalid);
    expect(text(freight())).toContain(PAGE_COPY.controls.quote.errors.required);
    expect(text(currency())).toContain(PAGE_COPY.controls.quote.errors.currency);
    expect(document.activeElement).toBe(currency());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the API's own words when no payment provider is allowed yet", async () => {
    answers = [{ status: 400, body: { ok: false, message: ADMIN_COPY.quote.noPaymentHosts, fieldErrors: { paymentUrl: "no_allowed_hosts" } } }];
    setup();
    await click(saveButton());
    expect(status().textContent).toBe(ADMIN_COPY.quote.noPaymentHosts);
    expect(paymentUrl().getAttribute("aria-invalid")).toBe("true");
  });

  it("clears a field's problem once the person edits it", async () => {
    setup({ quote: { ...QUOTED } });
    fireEvent.change(subtotal(), { target: { value: "" } });
    await click(saveButton());
    expect(subtotal().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(subtotal(), { target: { value: "10" } });
    expect(subtotal().getAttribute("aria-invalid")).toBeNull();
  });

  it("takes new figures from the server after a refresh (another member of staff saved a quote)", () => {
    const { again } = setup();
    fireEvent.change(subtotal(), { target: { value: "1" } });
    again({ quote: { revision: 3, currency: "USD", subtotalMinor: 9900, freightMinor: 100, paymentUrl: "https://pay.example.com/other" } });
    expect(currency().value).toBe("USD");
    expect(subtotal().value).toBe("99.00");
    expect(freight().value).toBe("1.00");
    expect(paymentUrl().value).toBe("https://pay.example.com/other");
  });
});

describe("queueing the saved quote", () => {
  it("posts the saved revision, shows the API's message and refreshes", async () => {
    answers = [{ status: 200, body: { ok: true, revision: 2, alreadyQueued: false, message: ADMIN_COPY.quote.queued } }];
    setup();
    await click(sendButton());
    expect(requests[0]!.url).toBe(quoteUrl);
    expect(requests[0]!.body).toEqual({ intent: "send", revision: 2 });
    expect(status().textContent).toBe(ADMIN_COPY.quote.queued);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the already-queued message as the API words it", async () => {
    answers = [{ status: 200, body: { ok: true, revision: 2, alreadyQueued: true, message: ADMIN_COPY.quote.alreadyQueued } }];
    setup();
    await click(sendButton());
    expect(status().textContent).toBe(ADMIN_COPY.quote.alreadyQueued);
  });

  it("cannot be used before a quote is saved, and says why", () => {
    setup({ quote: FRESH });
    expect(sendButton().disabled).toBe(true);
    const reason = document.getElementById(sendButton().getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(PAGE_COPY.controls.quote.needsQuote);
  });

  it("cannot be used while the form holds changes that are not saved, so it never queues figures the person did not see saved", () => {
    setup();
    expect(sendButton().disabled).toBe(false);
    fireEvent.change(freight(), { target: { value: "75.00" } });
    expect(sendButton().disabled).toBe(true);
    const reason = document.getElementById(sendButton().getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(PAGE_COPY.controls.quote.needsSave);
    fireEvent.change(freight(), { target: { value: "50.00" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("shows a 409 message and refreshes, so the page shows the order as it now is", async () => {
    answers = [{ status: 409, body: { ok: false, message: ADMIN_COPY.api.stale } }];
    setup();
    await click(sendButton());
    expect(status().textContent).toBe(ADMIN_COPY.api.stale);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("every answer the staff API gives", () => {
  const cases: Array<[number, string, boolean]> = [
    [400, ADMIN_COPY.api.badRequest, false],
    [403, ADMIN_COPY.api.forbidden, false],
    [404, ADMIN_COPY.api.notFound, false],
    [409, ADMIN_COPY.api.notAllowed, true],
    [409, ADMIN_COPY.api.stale, true],
    [500, ADMIN_COPY.api.failed, false],
    [503, ADMIN_COPY.api.unavailable, false],
    [503, ADMIN_COPY.api.unconfigured, false],
  ];
  for (const [code, message, refreshes] of cases) {
    it(`${code}: shows "${message.slice(0, 40)}..." and ${refreshes ? "refreshes" : "does not refresh"}, and the controls work again`, async () => {
      answers = [{ status: code, body: { ok: false, message } }];
      setup();
      await click(advanceButton("confirmed"));
      expect(status().textContent).toBe(message);
      expect(refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
      expect(goTo).not.toHaveBeenCalled();
      expect(advanceButton("confirmed").disabled).toBe(false);
    });
  }

  it("401: says so and sends the browser to the sign-in page, without a refresh", async () => {
    answers = [{ status: 401, body: { ok: false, message: ADMIN_COPY.api.signedOut } }];
    setup();
    await click(advanceButton("confirmed"));
    expect(status().textContent).toBe(ADMIN_COPY.api.signedOut);
    expect(goTo).toHaveBeenCalledWith("/admin/login");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to the status's words when the answer is not the API's (a proxy page, no body)", async () => {
    answers = [{ status: 502, body: "<html>Bad gateway</html>" }];
    setup();
    await click(advanceButton("confirmed"));
    expect(status().textContent).toBe(PAGE_COPY.controls.fallback.unavailable);
    expect(status().textContent).not.toContain("Bad gateway");
  });

  it("says nothing changed when the request never reached the server", async () => {
    answers = ["network-error"];
    setup();
    await click(advanceButton("confirmed"));
    expect(status().textContent).toBe(PAGE_COPY.controls.fallback.notReached);
    expect(status().textContent).toMatch(/nothing was changed/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not trust a 200 that is not the API's success body", async () => {
    answers = [{ status: 200, body: "<html>login</html>" }];
    setup();
    await click(advanceButton("confirmed"));
    expect(refresh).not.toHaveBeenCalled();
    expect(status().textContent).toBe(PAGE_COPY.controls.fallback.notReached);
  });
});

describe("while a request is in flight", () => {
  it("disables every control, marks the busy one and sends nothing twice", async () => {
    answers = ["never"];
    setup();
    await click(advanceButton("confirmed"));
    expect(requests).toHaveLength(1);
    for (const control of [saveButton(), sendButton(), advanceButton("confirmed"), cancelButton(), trackingButton(), currency(), subtotal(), freight(), paymentUrl()]) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled, control.outerHTML.slice(0, 60)).toBe(true);
    }
    expect(advanceButton("confirmed").getAttribute("aria-busy")).toBe("true");
    fireEvent.click(advanceButton("confirmed"));
    fireEvent.submit(quoteForm());
    expect(requests).toHaveLength(1);
    expect(status().textContent).toBe(PAGE_COPY.controls.working);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(advanceButton("confirmed").disabled).toBe(false));
    expect(status().textContent).toBe(ADMIN_COPY.status.changed);
  });

  it("keeps one polite live region, and never moves focus into it", async () => {
    answers = [{ status: 200, body: { ok: true, status: "confirmed", message: ADMIN_COPY.status.changed } }];
    setup();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status().getAttribute("aria-live")).toBe("polite");
    await click(advanceButton("confirmed"));
    expect(document.activeElement).not.toBe(status());
    expect(status().hasAttribute("tabindex")).toBe(false);
  });

  it("puts focus back on a control when the request completes and the focused button was disabled", async () => {
    answers = [{ status: 500, body: { ok: false, message: ADMIN_COPY.api.failed } }];
    setup();
    advanceButton("confirmed").focus();
    await click(advanceButton("confirmed"));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(advanceButton("confirmed"));
  });
});

describe("the status buttons", () => {
  const steps: Array<[Parameters<typeof setup>[0] & { status: OrderControlsProps["status"] }, string[]]> = [
    [{ status: "new" }, ["confirmed"]],
    [{ status: "confirmed" }, ["paid"]],
    [{ status: "paid" }, ["dispatched"]],
    [{ status: "dispatched" }, ["closed"]],
  ];
  for (const [overrides, expected] of steps) {
    it(`offers only the allowed next steps from ${overrides.status}, and cancelling`, () => {
      setup(overrides);
      const labels = within(screen.getByRole("group", { name: PAGE_COPY.controls.status.heading })).getAllByRole("button").map((button) => button.textContent);
      expect(labels).toEqual([...expected.map((to) => PAGE_COPY.controls.status.advance[to as keyof typeof PAGE_COPY.controls.status.advance]), PAGE_COPY.controls.status.cancel]);
    });
  }

  for (const finished of ["closed", "cancelled"] as const) {
    it(`shows no status or quote controls for a ${finished} order`, () => {
      setup({ status: finished });
      expect(screen.queryByRole("button", { name: PAGE_COPY.controls.status.cancel })).toBeNull();
      expect(screen.queryByRole("group", { name: PAGE_COPY.controls.status.heading })).toBeNull();
      expect(screen.queryByRole("form", { name: PAGE_COPY.controls.quote.heading })).toBeNull();
      expect(screen.getByText(PAGE_COPY.controls.status.finished)).toBeTruthy();
    });
  }

  it("posts { from, to } with the status that was rendered, then refreshes", async () => {
    answers = [{ status: 200, body: { ok: true, status: "paid", statusChangedAt: "2026-10-16T01:00:00.000Z", message: ADMIN_COPY.status.changed } }];
    setup({ status: "confirmed" });
    await click(advanceButton("paid"));
    expect(requests[0]!.url).toBe(statusUrl);
    expect(requests[0]!.body).toEqual({ from: "confirmed", to: "paid" });
    expect(requests[0]!.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(status().textContent).toBe(ADMIN_COPY.status.changed);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not show a status of its own after the answer: the status comes back from the server", async () => {
    answers = [{ status: 200, body: { ok: true, status: "confirmed", message: ADMIN_COPY.status.changed } }];
    setup({ status: "new" });
    await click(advanceButton("confirmed"));
    // Props did not change, so the buttons still belong to "new".
    expect(advanceButton("confirmed")).toBeTruthy();
  });

  it("shows the quote form only while a quote can be saved, and says why it is gone", () => {
    setup({ status: "paid" });
    expect(screen.queryByRole("form", { name: PAGE_COPY.controls.quote.heading })).toBeNull();
    expect(screen.getByText(PAGE_COPY.controls.quote.notAllowed)).toBeTruthy();
  });
});

describe("cancelling an order", () => {
  it("asks first, and sends nothing until it is confirmed", async () => {
    setup();
    await click(cancelButton());
    const dialog = screen.getByRole("dialog", { name: PAGE_COPY.controls.cancelDialog.title });
    expect(within(dialog).getByText(PAGE_COPY.controls.cancelDialog.body)).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("focuses the safe choice, and keeping the order closes the dialog with no request", async () => {
    setup();
    await click(cancelButton());
    const dialog = screen.getByRole("dialog");
    const keep = within(dialog).getByRole("button", { name: PAGE_COPY.controls.cancelDialog.keep });
    expect(document.activeElement).toBe(keep);
    await click(keep);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests).toHaveLength(0);
    expect(document.activeElement).toBe(cancelButton());
  });

  it("Escape closes the dialog with no request", async () => {
    setup();
    await click(cancelButton());
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("confirming posts { from, to: cancelled }, closes the dialog and refreshes", async () => {
    answers = [{ status: 200, body: { ok: true, status: "cancelled", message: ADMIN_COPY.status.changed } }];
    setup({ status: "paid" });
    await click(cancelButton());
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: PAGE_COPY.controls.cancelDialog.confirm }));
    expect(requests[0]!.body).toEqual({ from: "paid", to: "cancelled" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(status().textContent).toBe(ADMIN_COPY.status.changed);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and shows the API's message when the cancel is refused", async () => {
    answers = [{ status: 409, body: { ok: false, message: ADMIN_COPY.api.stale } }];
    setup();
    await click(cancelButton());
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: PAGE_COPY.controls.cancelDialog.confirm }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(status().textContent).toBe(ADMIN_COPY.api.stale);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the tracking link", () => {
  const rotated = { ok: true, trackingPath: `/orders/${TOKEN}`, expiresAt: "2027-01-16T00:00:00.000Z", message: ADMIN_COPY.trackingLink.rotated };

  it("posts an empty JSON body, then shows the new link once in an output with the API's message", async () => {
    answers = [{ status: 200, body: rotated }];
    setup();
    await click(trackingButton());
    expect(requests[0]!.url).toBe(trackingUrl);
    expect(requests[0]!.body).toEqual({});
    expect(requests[0]!.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    const output = screen.getByLabelText(PAGE_COPY.controls.tracking.linkLabel);
    expect(output.tagName).toBe("OUTPUT");
    expect(output.textContent).toBe(`${window.location.origin}/orders/${TOKEN}`);
    expect(status().textContent).toBe(ADMIN_COPY.trackingLink.rotated);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the secret link out of the live region, so it is not announced", async () => {
    answers = [{ status: 200, body: rotated }];
    setup();
    await click(trackingButton());
    expect(status().textContent).not.toContain(TOKEN);
  });

  it("is not shown before a rotation, and not after a fresh render (shown once)", async () => {
    answers = [{ status: 200, body: rotated }];
    const first = setup();
    expect(screen.queryByLabelText(PAGE_COPY.controls.tracking.linkLabel)).toBeNull();
    await click(trackingButton());
    expect(screen.getByLabelText(PAGE_COPY.controls.tracking.linkLabel)).toBeTruthy();
    first.unmount();
    setup();
    expect(screen.queryByLabelText(PAGE_COPY.controls.tracking.linkLabel)).toBeNull();
  });

  it("copies the link with the clipboard, says so, and offers no copy before there is a link", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    answers = [{ status: 200, body: rotated }];
    setup();
    expect(screen.queryByRole("button", { name: PAGE_COPY.controls.tracking.copy })).toBeNull();
    await click(trackingButton());
    await click(screen.getByRole("button", { name: PAGE_COPY.controls.tracking.copy }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/orders/${TOKEN}`);
    expect(status().textContent).toBe(PAGE_COPY.controls.tracking.copied);
  });

  it("selects the link for copying by hand when the clipboard is not available", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    answers = [{ status: 200, body: rotated }];
    setup();
    await click(trackingButton());
    await click(screen.getByRole("button", { name: PAGE_COPY.controls.tracking.copy }));
    expect(status().textContent).toBe(PAGE_COPY.controls.tracking.copyFailed);
    expect(window.getSelection()?.toString()).toBe(`${window.location.origin}/orders/${TOKEN}`);
  });

  it("selects the link when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    answers = [{ status: 200, body: rotated }];
    setup();
    await click(trackingButton());
    await click(screen.getByRole("button", { name: PAGE_COPY.controls.tracking.copy }));
    expect(status().textContent).toBe(PAGE_COPY.controls.tracking.copyFailed);
  });

  it("shows no link when the answer carries no usable path", async () => {
    answers = [{ status: 200, body: { ok: true, trackingPath: "https://elsewhere.example/steal", message: ADMIN_COPY.trackingLink.rotated } }];
    setup();
    await click(trackingButton());
    expect(screen.queryByLabelText(PAGE_COPY.controls.tracking.linkLabel)).toBeNull();
  });

  it("is still offered on a finished order (a customer may lose the link later)", () => {
    setup({ status: "closed" });
    expect(trackingButton()).toBeTruthy();
  });
});

describe("truth", () => {
  const claim = /\b(?:email|quote|link|message) (?:was |has been )?(?:sent|delivered)\b|\bwe (?:sent|emailed)\b|\b(?:has|have|was|been|is) paid\b|\bpayment (?:received|taken|confirmed|completed)\b/i;

  for (const orderStatus of ["new", "confirmed", "paid", "dispatched", "closed", "cancelled"] as const) {
    it(`says nothing was sent or paid anywhere in the controls of a ${orderStatus} order`, () => {
      setup({ status: orderStatus });
      expect(document.body.textContent).not.toMatch(claim);
    });
  }

  it("says nothing was sent or paid in any message it shows itself", async () => {
    answers = ["network-error", { status: 502, body: "x" }, { status: 200, body: "x" }];
    setup();
    const seen: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await click(advanceButton("confirmed"));
      seen.push(status().textContent ?? "");
    }
    expect(seen.every(Boolean)).toBe(true);
    for (const text of seen) expect(text).not.toMatch(claim);
  });
});

/*
 * Final fix wave 8c-M2: the controls stay disabled until the refresh has landed. router.refresh()
 * runs inside startTransition, so the transition stays pending while the server's new page renders;
 * the harness stands in for that render with a child that suspends on a promise the refresh starts.
 */
describe("until the refresh has landed", () => {
  it("keeps every control disabled while the transition is pending, then enables them", async () => {
    let settleRefresh: () => void = () => {};
    const landed = new Promise<void>((resolve) => (settleRefresh = resolve));
    const resolved = Promise.resolve();
    let startRefresh: () => void = () => {};

    function ServerRender({ pending }: { pending: boolean }) {
      use(pending ? landed : resolved);
      return null;
    }
    function Harness() {
      const [pending, setPending] = useState(false);
      startRefresh = () => setPending(true);
      return (
        <>
          <OrderControls reference={REFERENCE} status="new" quote={QUOTED} />
          <Suspense fallback={null}>
            <ServerRender pending={pending} />
          </Suspense>
        </>
      );
    }

    refresh.mockImplementation(() => startRefresh());
    try {
      answers = [{ status: 200, body: { ok: true, status: "confirmed", message: ADMIN_COPY.status.changed } }];
      render(<Harness />);
      await click(advanceButton("confirmed"));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(status().textContent).toBe(ADMIN_COPY.status.changed);
      for (const control of [saveButton(), sendButton(), advanceButton("confirmed"), cancelButton(), trackingButton(), subtotal()]) {
        expect((control as HTMLButtonElement | HTMLInputElement).disabled, control.outerHTML.slice(0, 60)).toBe(true);
      }
      fireEvent.click(advanceButton("confirmed"));
      expect(requests).toHaveLength(1);

      await act(async () => {
        settleRefresh();
      });
      await waitFor(() => expect(advanceButton("confirmed").disabled).toBe(false));
      expect(saveButton().disabled).toBe(false);
    } finally {
      refresh.mockReset();
    }
  });
});
