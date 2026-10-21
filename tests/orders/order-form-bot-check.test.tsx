import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotCheckHandle, BotCheckTokenResult } from "@/components/forms/bot-check/useBotCheck";
import { ORDER_COPY } from "@/components/forms/order-copy";
import { OrderForm } from "@/components/forms/OrderForm";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { BOT_CHECK_MESSAGES, BOT_CHECK_TOKEN_FIELD } from "@/lib/bot-check/fields";
import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { countryOptions } from "@/lib/orders/countries";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const prepare = vi.fn();
const reset = vi.fn();
let tokens: BotCheckTokenResult[] = [];
const token = vi.fn(async (): Promise<BotCheckTokenResult> => tokens.shift() ?? { token: "t1" });
let enabled = true;
vi.mock("@/components/forms/bot-check/useBotCheck", () => ({
  useBotCheck: (): BotCheckHandle => ({ enabled, containerRef: { current: null }, prepare, token, reset }),
}));

const CONSENT = "I am an adult and agree to the order terms.";
const COUNTRIES = countryOptions(["PH", "AU", "NZ"]);
const PAD = [{ productId: "product-tula", quantity: 2 }];
const STORED = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: "BB-1A2B-3C4D", trackingToken: "0123456789abcdef".repeat(4) } };

type Answer = { status: number; body: unknown } | "network-error";
let answers: Answer[] = [];
const requests: Array<{ init: RequestInit }> = [];

beforeEach(() => {
  enabled = true;
  tokens = [];
  prepare.mockClear();
  reset.mockClear();
  token.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: PAD }));
  answers = [];
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requests.push({ init });
    const answer = answers.shift() ?? STORED;
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(botCheckSiteKey: string | null = "site-key") {
  render(
    <OrderPadProvider>
      <OrderForm consentCopy={CONSENT} countries={COUNTRIES} listedIds={["product-tula"]} onReceived={vi.fn()} botCheckSiteKey={botCheckSiteKey} />
    </OrderPadProvider>,
  );
}

const form = () => screen.getByRole("form", { name: ORDER_COPY.form.label });
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const button = () => screen.getByRole("button", { name: ORDER_COPY.form.submit }) as HTMLButtonElement;
const body = (index = 0) => JSON.parse(String(requests[index]?.init.body)) as Record<string, unknown>;

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

function fillValid() {
  fireEvent.change(input(ORDER_COPY.form.contactName.label), { target: { value: "Sam Rivers" } });
  fireEvent.change(input(ORDER_COPY.form.email.label), { target: { value: "parent@example.com" } });
  fireEvent.change(input(ORDER_COPY.form.addressLine1.label), { target: { value: "12 Harbour Road" } });
  fireEvent.change(input(ORDER_COPY.form.city.label), { target: { value: "Seaside" } });
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.country.label), { target: { value: "AU" } });
  fireEvent.click(screen.getByRole("checkbox", { name: CONSENT }));
}

describe("order form bot check", () => {
  it("off: the body carries no token field", async () => {
    enabled = false;
    renderForm(null);
    fillValid();
    await submit();
    expect(requests).toHaveLength(1);
    expect(Object.keys(body())).not.toContain(BOT_CHECK_TOKEN_FIELD);
    expect(token).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("on: the token is in the body", async () => {
    renderForm();
    fillValid();
    await submit();
    expect(body()[BOT_CHECK_TOKEN_FIELD]).toBe("t1");
  });

  it.each([
    ["interactive", BOT_CHECK_MESSAGES.interactive],
    ["unavailable", BOT_CHECK_MESSAGES.notLoaded],
  ] as const)("%s: shows its copy, posts nothing and returns focus to the button", async (problem, copy) => {
    tokens = [{ problem }];
    renderForm();
    fillValid();
    await submit();
    expect(screen.getByRole("status").textContent).toBe(copy);
    expect(requests).toHaveLength(0);
    expect(document.activeElement).toBe(button());
  });

  it("a 403 shows the refused copy", async () => {
    answers = [{ status: 403, body: { ok: false, persisted: false, acknowledgementQueued: false, message: BOT_CHECK_MESSAGES.refused } }];
    renderForm();
    fillValid();
    await submit();
    expect(screen.getByRole("status").textContent).toBe(BOT_CHECK_MESSAGES.refused);
  });

  it.each([
    ["a 200", STORED],
    ["a 429", { status: 429, body: { ok: false } }],
    ["a network rejection", "network-error"],
  ] as const)("resets the token once after %s", async (_name, answer) => {
    answers = [answer];
    renderForm();
    fillValid();
    await submit();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("a retry after a 503 keeps the submissionKey and sends a fresh token", async () => {
    answers = [{ status: 503, body: { ok: false } }];
    tokens = [{ token: "t1" }, { token: "t2" }];
    renderForm();
    fillValid();
    await submit();
    await submit();
    expect(requests).toHaveLength(2);
    expect(body(0)[BOT_CHECK_TOKEN_FIELD]).toBe("t1");
    expect(body(1)[BOT_CHECK_TOKEN_FIELD]).toBe("t2");
    expect(body(1).submissionKey).toBe(body(0).submissionKey);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("prepares on intent", () => {
    renderForm();
    fireEvent.focus(input(ORDER_COPY.form.contactName.label));
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly one status region", () => {
    renderForm();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
