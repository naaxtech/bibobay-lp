import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeadForm, type LeadFormCopy } from "@/components/forms/LeadForm";
import { FORM_COPY } from "@/components/forms/form-copy";
import { BOT_CHECK_MESSAGES } from "@/lib/bot-check/fields";

vi.mock("server-only", () => ({}));

type TokenResult = { token: string } | { problem: "interactive" | "unavailable" };
const bot = vi.hoisted(() => ({
  prepare: vi.fn(),
  reset: vi.fn(),
  token: vi.fn(),
  siteKeys: [] as Array<string | null>,
}));

vi.mock("@/components/forms/bot-check/useBotCheck", () => ({
  useBotCheck: (siteKey: string | null) => {
    bot.siteKeys.push(siteKey);
    return { enabled: siteKey !== null, containerRef: createRef<HTMLDivElement>(), prepare: bot.prepare, token: bot.token, reset: bot.reset };
  },
}));

const CMS: LeadFormCopy = {
  buttonLabel: "Join the Bay list",
  consentCopy: "I am an adult and agree to receive BIBO Bay updates.",
  successMessage: "You're on the founding-family list.",
  errorMessage: "We could not save that. Please try again.",
};

type Answer = { status: number; body: unknown } | "network-error";
let answers: Answer[] = [];
const requests: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  answers = [];
  requests.length = 0;
  bot.prepare.mockReset();
  bot.reset.mockReset();
  bot.token.mockReset();
  bot.siteKeys.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const answer = answers.shift() ?? { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: "server text" } };
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const form = () => screen.getByRole("form", { name: FORM_COPY.formLabel });
const emailInput = () => screen.getByLabelText(FORM_COPY.email.label) as HTMLInputElement;
const consentBox = () => screen.getByRole("checkbox", { name: CMS.consentCopy }) as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: CMS.buttonLabel }) as HTMLButtonElement;
const status = () => screen.getByRole("status");

const renderForm = (siteKey: string | null) => render(<LeadForm copy={CMS} botCheckSiteKey={siteKey} />);

function fillValid() {
  fireEvent.change(emailInput(), { target: { value: "parent@example.com" } });
  fireEvent.click(consentBox());
}

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

const sentBody = (index = 0) => JSON.parse(String(requests[index]?.init.body)) as Record<string, unknown>;
const tokenIs = (result: TokenResult) => bot.token.mockResolvedValue(result);

describe("lead form bot check", () => {
  it("off: sends no token field and never asks for one", async () => {
    renderForm(null);
    fillValid();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.successMessage));
    expect(sentBody()).toMatchObject({ email: "parent@example.com", consent: true, source: "landing", website: "" });
    expect(sentBody()).not.toHaveProperty("botCheckToken");
    expect(bot.token).not.toHaveBeenCalled();
    expect(bot.reset).not.toHaveBeenCalled();
  });

  it("on: puts the token in the body next to the existing fields", async () => {
    tokenIs({ token: "t1" });
    renderForm("site-key");
    fillValid();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.successMessage));
    expect(sentBody()).toMatchObject({ email: "parent@example.com", consent: true, source: "landing", website: "", botCheckToken: "t1" });
  });

  it.each([
    ["interactive", BOT_CHECK_MESSAGES.interactive],
    ["unavailable", BOT_CHECK_MESSAGES.notLoaded],
  ] as const)("a %s problem shows its copy, posts nothing and returns focus to the button", async (problem, copy) => {
    tokenIs({ problem });
    renderForm("site-key");
    fillValid();
    submitButton().blur();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(copy));
    expect(requests).toHaveLength(0);
    expect(bot.reset).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(submitButton()));
  });

  it("does not ask for a token while the fields have errors", async () => {
    renderForm("site-key");
    await submit();
    expect(bot.token).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("group", { name: FORM_COPY.errorSummaryTitle }));
  });

  it("a 403 shows the refused copy", async () => {
    tokenIs({ token: "t1" });
    answers.push({ status: 403, body: { ok: false, persisted: false, acknowledgementQueued: false, message: "server words" } });
    renderForm("site-key");
    fillValid();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(BOT_CHECK_MESSAGES.refused));
  });

  it("a 503 still shows the server's own message", async () => {
    tokenIs({ token: "t1" });
    answers.push({ status: 503, body: { ok: false, persisted: false, acknowledgementQueued: false, message: BOT_CHECK_MESSAGES.unavailable } });
    renderForm("site-key");
    fillValid();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(BOT_CHECK_MESSAGES.unavailable));
  });

  it.each([
    ["a 200", { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: "x" } } as Answer],
    ["a 429", { status: 429, body: { ok: false, persisted: false, acknowledgementQueued: false, message: "x" } } as Answer],
    ["a network failure", "network-error" as Answer],
  ])("resets the check once after %s", async (_name, answer) => {
    tokenIs({ token: "t1" });
    answers.push(answer);
    renderForm("site-key");
    fillValid();
    await submit();
    await waitFor(() => expect(bot.reset).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
  });

  it("a retry after a 429 carries a fresh token", async () => {
    bot.token.mockResolvedValueOnce({ token: "t1" }).mockResolvedValueOnce({ token: "t2" });
    answers.push({ status: 429, body: { ok: false, persisted: false, acknowledgementQueued: false, message: "x" } });
    renderForm("site-key");
    fillValid();
    await submit();
    await waitFor(() => expect(status().textContent).toBe(FORM_COPY.outcome.rateLimited));
    await submit();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(sentBody(0).botCheckToken).toBe("t1");
    expect(sentBody(1).botCheckToken).toBe("t2");
  });

  it("prepares on the first focus inside the form", () => {
    renderForm("site-key");
    fireEvent.focus(emailInput());
    expect(bot.prepare).toHaveBeenCalledTimes(1);
  });

  it("passes the site key to the hook and keeps exactly one role=status", () => {
    renderForm("site-key");
    expect(bot.siteKeys.every((key) => key === "site-key")).toBe(true);
    expect(form().querySelectorAll("[role='status']")).toHaveLength(1);
  });

  it("holds the new messages in the height reserve, not in the DOM text", () => {
    renderForm("site-key");
    const text = form().textContent ?? "";
    const reserved = Array.from(form().querySelectorAll<HTMLElement>(".lead-form__outcome")).flatMap((element) => [element.dataset.reserveA, element.dataset.reserveB]);
    for (const message of Object.values(BOT_CHECK_MESSAGES)) {
      expect(text).not.toContain(message);
      expect(reserved).toContain(message);
    }
  });
});
