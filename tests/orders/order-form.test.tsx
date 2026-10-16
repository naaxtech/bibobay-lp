import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY, orderFieldErrorMessage } from "@/components/forms/order-copy";
import { OrderForm, type OrderReceipt } from "@/components/forms/OrderForm";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { countryOptions } from "@/lib/orders/countries";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/*
 * Task 7c: the order form. Adults only (spec §3 ruling 2): contact and delivery details, notes and
 * the order consent tick (R82). It posts the pad's ids and quantities with one submission key per
 * order attempt (R81), and never claims an order was received unless the server stored it.
 */
const CONSENT = "I am an adult and agree to the order terms.";
const COUNTRIES = countryOptions(["PH", "AU", "NZ"]);
const PAD = [
  { productId: "product-tula", quantity: 2 },
  { productId: "product-bob", quantity: 1 },
];
const REFERENCE = "BB-1A2B-3C4D";
const TOKEN = "0123456789abcdef".repeat(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STORED = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN } };

type Answer = { status: number; body: unknown } | "network-error";
let answers: Answer[] = [];
const requests: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  refresh.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: PAD }));
  answers = [];
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const answer = answers.shift() ?? STORED;
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(listedIds: readonly string[] = ["product-tula", "product-bob"]) {
  const onReceived = vi.fn<(receipt: OrderReceipt) => void>();
  render(
    <OrderPadProvider>
      <OrderForm consentCopy={CONSENT} countries={COUNTRIES} listedIds={listedIds} onReceived={onReceived} />
    </OrderPadProvider>,
  );
  return onReceived;
}

const form = () => screen.getByRole("form", { name: ORDER_COPY.form.label });
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const country = () => screen.getByLabelText(ORDER_COPY.form.country.label) as HTMLSelectElement;
const consent = () => screen.getByRole("checkbox", { name: CONSENT }) as HTMLInputElement;
const button = () => screen.getByRole("button", { name: ORDER_COPY.form.submit }) as HTMLButtonElement;
const status = () => screen.getByRole("status");
const summary = () => screen.getByRole("group", { name: ORDER_COPY.form.errorSummaryTitle });
const body = (index = 0) => JSON.parse(String(requests[index]?.init.body)) as Record<string, unknown>;
const storedPad = () => window.localStorage.getItem(ORDER_PAD_STORAGE_KEY);

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

function fillValid() {
  fireEvent.change(input(ORDER_COPY.form.contactName.label), { target: { value: "  Sam Rivers " } });
  fireEvent.change(input(ORDER_COPY.form.email.label), { target: { value: " parent@example.com " } });
  fireEvent.change(input(ORDER_COPY.form.addressLine1.label), { target: { value: "12 Harbour Road" } });
  fireEvent.change(input(ORDER_COPY.form.city.label), { target: { value: "Seaside" } });
  fireEvent.change(country(), { target: { value: "AU" } });
  fireEvent.click(consent());
}

describe("fields", () => {
  it("asks an adult for contact and delivery details, with autocomplete tokens and nothing about a child", () => {
    renderForm();
    const expected: Array<[string, string, boolean]> = [
      [ORDER_COPY.form.contactName.label, "name", true],
      [ORDER_COPY.form.email.label, "email", true],
      [ORDER_COPY.form.phone.label, "tel", false],
      [ORDER_COPY.form.addressLine1.label, "address-line1", true],
      [ORDER_COPY.form.addressLine2.label, "address-line2", false],
      [ORDER_COPY.form.city.label, "address-level2", true],
      [ORDER_COPY.form.region.label, "address-level1", false],
      [ORDER_COPY.form.postalCode.label, "postal-code", false],
      [ORDER_COPY.form.country.label, "country", true],
    ];
    for (const [label, token, required] of expected) {
      const field = input(label);
      expect(field.getAttribute("autocomplete"), label).toBe(token);
      expect(field.required, label).toBe(required);
    }
    expect(input(ORDER_COPY.form.email.label).type).toBe("email");
    expect(input(ORDER_COPY.form.email.label).inputMode).toBe("email");
    expect(input(ORDER_COPY.form.phone.label).type).toBe("tel");
    expect(input(ORDER_COPY.form.phone.label).inputMode).toBe("tel");
    expect(input(ORDER_COPY.form.notes.label).tagName).toBe("TEXTAREA");
    const names = Array.from(form().querySelectorAll<HTMLInputElement>("input, select, textarea")).map((field) => field.name).sort();
    expect(names).toEqual(["addressLine1", "addressLine2", "city", "consent", "contactName", "country", "email", "notes", "phone", "postalCode", "region", "website"]);
  });

  it("ties each hint to its field", () => {
    renderForm();
    for (const [label, hint] of [
      [ORDER_COPY.form.email.label, ORDER_COPY.form.email.hint],
      [ORDER_COPY.form.country.label, ORDER_COPY.form.country.hint],
      [ORDER_COPY.form.notes.label, ORDER_COPY.form.notes.hint],
    ] as const) {
      const ids = input(label).getAttribute("aria-describedby")?.split(" ") ?? [];
      expect(ids.map((id) => document.getElementById(id)?.textContent), label).toContain(hint);
    }
  });

  it("offers the given countries by English name, alphabetically, with none chosen (R85)", () => {
    renderForm();
    const options = Array.from(country().options);
    expect(options.map((option) => option.value)).toEqual(["", "AU", "NZ", "PH"]);
    expect(options.map((option) => option.textContent)).toEqual([ORDER_COPY.form.country.placeholder, "Australia", "New Zealand", "Philippines"]);
    expect(country().value).toBe("");
  });

  it("shows the order consent sentence it is given, unticked and required (R82), with the privacy notice", () => {
    renderForm();
    expect(consent().checked).toBe(false);
    expect(consent().required).toBe(true);
    expect(screen.getByRole("link", { name: ORDER_COPY.form.privacyLink }).getAttribute("href")).toBe("/privacy");
  });

  it("hides the honeypot from people and assistive technology", () => {
    renderForm();
    const trap = form().querySelector<HTMLInputElement>('input[name="website"]');
    expect(trap?.tabIndex).toBe(-1);
    expect(trap?.autocomplete).toBe("off");
    expect(trap?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("starts with an empty polite status line", () => {
    renderForm();
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
  });
});

describe("checking before sending", () => {
  it("lists every problem in a summary that takes focus and links each field; nothing is sent", async () => {
    renderForm();
    await submit();
    expect(requests).toEqual([]);
    expect(document.activeElement).toBe(summary());
    const links = within(summary()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      orderFieldErrorMessage("contactName", "required"),
      orderFieldErrorMessage("email", "required"),
      orderFieldErrorMessage("addressLine1", "required"),
      orderFieldErrorMessage("city", "required"),
      orderFieldErrorMessage("country", "required"),
      orderFieldErrorMessage("consent", "required"),
    ]);
    fireEvent.click(links[1]!);
    expect(document.activeElement).toBe(input(ORDER_COPY.form.email.label));
  });

  it("marks each field with its problem, tied by aria-describedby", async () => {
    renderForm();
    fillValid();
    fireEvent.change(input(ORDER_COPY.form.email.label), { target: { value: "not-an-email" } });
    fireEvent.change(input(ORDER_COPY.form.phone.label), { target: { value: "call me" } });
    await submit();
    expect(requests).toEqual([]);
    for (const [label, field] of [[ORDER_COPY.form.email.label, "email"], [ORDER_COPY.form.phone.label, "phone"]] as const) {
      const element = input(label);
      expect(element.getAttribute("aria-invalid"), label).toBe("true");
      const described = (element.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
      expect(described, label).toContain(orderFieldErrorMessage(field, "invalid"));
    }
    expect(input(ORDER_COPY.form.contactName.label).getAttribute("aria-invalid")).toBeNull();
  });
});

describe("sending", () => {
  it("posts adult details, the pad's ids and quantities and a submission key, and nothing else (R81)", async () => {
    renderForm();
    fillValid();
    await submit();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/orders");
    expect(requests[0]?.init.method).toBe("POST");
    expect(new Headers(requests[0]?.init.headers).get("content-type")).toBe("application/json");
    expect(body()).toEqual({
      contactName: "Sam Rivers",
      email: "parent@example.com",
      addressLine1: "12 Harbour Road",
      city: "Seaside",
      country: "AU",
      consent: true,
      lines: PAD,
      submissionKey: expect.stringMatching(UUID),
      website: "",
    });
  });

  it("sends the optional details only when given", async () => {
    renderForm();
    fillValid();
    fireEvent.change(input(ORDER_COPY.form.phone.label), { target: { value: "+61 2 5550 1234" } });
    fireEvent.change(input(ORDER_COPY.form.addressLine2.label), { target: { value: "Unit 4" } });
    fireEvent.change(input(ORDER_COPY.form.region.label), { target: { value: "NSW" } });
    fireEvent.change(input(ORDER_COPY.form.postalCode.label), { target: { value: "2000" } });
    fireEvent.change(input(ORDER_COPY.form.notes.label), { target: { value: "Leave at the door.\nThank you." } });
    await submit();
    expect(body()).toMatchObject({ phone: "+61 2 5550 1234", addressLine2: "Unit 4", region: "NSW", postalCode: "2000", notes: "Leave at the door.\nThank you." });
  });

  it("sends only the pad lines the page lists", async () => {
    renderForm(["product-tula"]);
    fillValid();
    await submit();
    expect(body().lines).toEqual([{ productId: "product-tula", quantity: 2 }]);
  });

  it("disables the button only while sending, and says so in the status line", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    renderForm();
    expect(button().disabled).toBe(false);
    fillValid();
    await submit();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe(ORDER_COPY.form.sending);
    await act(async () => {
      release(new Response(JSON.stringify({ ok: false, message: "x" }), { status: 500 }));
    });
    expect(button().disabled).toBe(false);
    expect(status().textContent).toBe(ORDER_COPY.outcome.notConfirmed);
  });
});

describe("answers", () => {
  it("on a stored order empties the pad through the provider and hands over the reference and private token", async () => {
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(onReceived).toHaveBeenCalledWith({ reference: REFERENCE, trackingToken: TOKEN, duplicate: false });
    expect(storedPad()).toBeNull();
  });

  it("hands over a repeated request's reference with no token, and empties the pad (R81)", async () => {
    answers = [{ status: 200, body: { ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceived, reference: REFERENCE } }];
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(onReceived).toHaveBeenCalledWith({ reference: REFERENCE, duplicate: true });
    expect(storedPad()).toBeNull();
  });

  it("leaves out a token that is not one", async () => {
    answers = [{ status: 200, body: { ...STORED.body, trackingToken: "<script>" } }];
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(onReceived).toHaveBeenCalledWith({ reference: REFERENCE, duplicate: false });
  });

  it.each([
    ["not persisted", { ok: true, persisted: false, reference: REFERENCE }],
    ["no reference", { ok: true, persisted: true }],
    ["a malformed reference", { ok: true, persisted: true, reference: "BB-<b>" }],
  ])("never claims success on a 200 with %s", async (_case, answer) => {
    answers = [{ status: 200, body: answer }];
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(onReceived).not.toHaveBeenCalled();
    expect(status().textContent).toBe(ORDER_COPY.outcome.notConfirmed);
    expect(storedPad()).not.toBeNull();
  });

  it("maps the server's field problems onto the fields and focuses the summary", async () => {
    answers = [{ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.checkDetails, fieldErrors: { email: "invalid", country: "invalid", bogus: "invalid", city: "weird" } } }];
    renderForm();
    fillValid();
    await submit();
    expect(document.activeElement).toBe(summary());
    expect(within(summary()).getAllByRole("listitem").map((item) => item.textContent)).toEqual([orderFieldErrorMessage("email", "invalid"), orderFieldErrorMessage("country", "invalid")]);
    expect(country().getAttribute("aria-invalid")).toBe("true");
  });

  it("asks to review the order when a product cannot be ordered, keeping the pad and everything typed", async () => {
    answers = [{ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.productsUnavailable } }];
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(status().textContent).toBe(ORDER_COPY.outcome.productsUnavailable);
    expect(onReceived).not.toHaveBeenCalled();
    expect(storedPad()).not.toBeNull();
    expect(input(ORDER_COPY.form.contactName.label).value).toBe("  Sam Rivers ");
  });

  it.each([
    [429, ORDER_COPY.outcome.rateLimited],
    [500, ORDER_COPY.outcome.notConfirmed],
    [503, ORDER_COPY.outcome.busy],
    [404, ORDER_COPY.outcome.unavailable],
    ["network-error", ORDER_COPY.outcome.notConfirmed],
  ] as const)("answers %s with its message, keeps everything typed and returns focus to the button", async (code, message) => {
    answers = [code === "network-error" ? code : { status: code, body: { ok: false, persisted: false, acknowledgementQueued: false, message: "server words" } }];
    const onReceived = renderForm();
    fillValid();
    await submit();
    expect(status().textContent).toBe(message);
    expect(status().getAttribute("data-tone")).toBe("error");
    expect(onReceived).not.toHaveBeenCalled();
    expect(storedPad()).not.toBeNull();
    expect(input(ORDER_COPY.form.contactName.label).value).toBe("  Sam Rivers ");
    expect(input(ORDER_COPY.form.email.label).value).toBe("parent@example.com");
    expect(consent().checked).toBe(true);
    expect(document.activeElement).toBe(button());
  });

  it("sends the same submission key on every retry of one order attempt (R81)", async () => {
    answers = ["network-error", { status: 503, body: { ok: false } }, { status: 400, body: { ok: false, fieldErrors: { city: "too_long" } } }, STORED];
    const onReceived = renderForm();
    fillValid();
    await submit();
    await submit();
    await submit();
    await submit();
    expect(requests).toHaveLength(4);
    const keys = requests.map((_request, index) => body(index).submissionKey);
    expect(keys[0]).toMatch(UUID);
    expect(new Set(keys).size).toBe(1);
    expect(onReceived).toHaveBeenCalledTimes(1);
  });

  it("makes a new key for a new order attempt", async () => {
    answers = [{ status: 503, body: { ok: false } }];
    renderForm();
    fillValid();
    await submit();
    cleanup();
    renderForm();
    fillValid();
    await submit();
    expect(body(0).submissionKey).not.toBe(body(1).submissionKey);
  });
});

describe("the submission key follows what is sent (Task 7c review M1, ruling R93)", () => {
  it("makes a new key when the email is corrected after an answer was lost, so the corrected request can be stored", async () => {
    answers = ["network-error", STORED];
    renderForm();
    fillValid();
    await submit();
    fireEvent.change(input(ORDER_COPY.form.email.label), { target: { value: "parent.two@example.com" } });
    await submit();
    expect(requests).toHaveLength(2);
    expect(body(1).submissionKey).toMatch(UUID);
    expect(body(1).submissionKey).not.toBe(body(0).submissionKey);
  });

  it("makes a new key when the delivery address changes, so a correction is never answered with the first order", async () => {
    answers = ["network-error", STORED];
    renderForm();
    fillValid();
    await submit();
    fireEvent.change(input(ORDER_COPY.form.addressLine1.label), { target: { value: "14 Harbour Road" } });
    await submit();
    expect(body(1).submissionKey).not.toBe(body(0).submissionKey);
  });

  it("keeps the key when only the email's letter case or spacing differs (the server stores it lower-cased)", async () => {
    answers = ["network-error", STORED];
    renderForm();
    fillValid();
    await submit();
    fireEvent.change(input(ORDER_COPY.form.email.label), { target: { value: "  PARENT@Example.com " } });
    await submit();
    expect(body(1).submissionKey).toBe(body(0).submissionKey);
  });
});

describe("a product that can no longer be ordered (Task 7c review M4)", () => {
  it("asks the server for the page again, so the pad is pruned against the current catalogue", async () => {
    answers = [{ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.productsUnavailable } }];
    renderForm();
    fillValid();
    await submit();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the page for any other answer", async () => {
    answers = [{ status: 503, body: { ok: false } }, { status: 400, body: { ok: false, fieldErrors: { city: "too_long" } } }, STORED];
    renderForm();
    fillValid();
    await submit();
    await submit();
    await submit();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the name problem (Task 7c review M3)", () => {
  it("names the only rule there is (one line), and never asks for letters only", () => {
    const message = orderFieldErrorMessage("contactName", "invalid");
    expect(message).toMatch(/one line/i);
    expect(message).not.toMatch(/letters|spaces only/i);
  });
});
