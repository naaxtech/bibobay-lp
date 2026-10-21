import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm, type ContactFormCopy } from "@/components/forms/ContactForm";
import { CONTACT_FORM_COPY } from "@/components/forms/contact-copy";
import type { BotCheckTokenResult } from "@/components/forms/bot-check/useBotCheck";
import { BOT_CHECK_MESSAGES, BOT_CHECK_TOKEN_FIELD } from "@/lib/bot-check/fields";
import { HONEYPOT_FIELD } from "@/lib/contact/fields";

const bot = vi.hoisted(() => ({
  prepare: vi.fn(),
  reset: vi.fn(),
  token: vi.fn(),
  enabled: true,
}));

vi.mock("@/components/forms/bot-check/useBotCheck", () => ({
  useBotCheck: (siteKey: string | null) => ({
    enabled: siteKey !== null && bot.enabled,
    containerRef: { current: null },
    visible: false,
    prepare: bot.prepare,
    token: bot.token,
    reset: bot.reset,
  }),
}));

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

const CMS: ContactFormCopy = {
  buttonLabel: "Send message",
  successMessage: "Thank you. We have received your message.",
  errorMessage: "We could not save your message. Please try again.",
  closedMessage: "The contact form is not open yet, so no message can be saved from this page.",
};

let answers: Array<{ status: number; body: unknown } | "network"> = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  answers = [];
  bot.prepare.mockReset();
  bot.reset.mockReset();
  bot.token.mockReset();
  bot.token.mockResolvedValue({ token: "t1" } satisfies BotCheckTokenResult);
  fetchMock = vi.fn(async () => {
    const answer = answers.shift();
    if (answer === "network" || !answer) throw new TypeError("network down");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = () => ({ status: 200, body: { ok: true, persisted: true, message: "server text" } });
const form = () => screen.getByRole("form", { name: CONTACT_FORM_COPY.formLabel });
const button = () => screen.getByRole("button", { name: CMS.buttonLabel });
const status = () => screen.getByRole("status");

function fillAll() {
  fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.name.label), { target: { value: "Ana Reyes" } });
  fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.email.label), { target: { value: "ana@example.com" } });
  fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.topic.label), { target: { value: "press" } });
  fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.message.label), { target: { value: "Hello team, a question about the pack." } });
}

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

async function send(siteKey: string | null, answer?: { status: number; body: unknown } | "network") {
  if (answer) answers.push(answer);
  render(<ContactForm copy={CMS} botCheckSiteKey={siteKey} />);
  fillAll();
  await submit();
}

const sentBody = (call = 0) => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string) as Record<string, unknown>;

describe("the contact form's bot check", () => {
  it("off: the body is unchanged and the check is never asked", async () => {
    await send(null, ok());
    expect(Object.keys(sentBody()).sort()).toEqual(["email", "message", "name", "topic", HONEYPOT_FIELD]);
    expect(bot.token).not.toHaveBeenCalled();
    expect(bot.reset).not.toHaveBeenCalled();
    expect(screen.queryByText(BOT_CHECK_MESSAGES.refused)).toBeNull();
  });

  it("on: the token joins the body", async () => {
    await send("site-key", ok());
    expect(sentBody()).toEqual({
      name: "Ana Reyes",
      email: "ana@example.com",
      topic: "press",
      message: "Hello team, a question about the pack.",
      [HONEYPOT_FIELD]: "",
      [BOT_CHECK_TOKEN_FIELD]: "t1",
    });
  });

  it.each([
    ["interactive", BOT_CHECK_MESSAGES.interactive],
    ["unavailable", BOT_CHECK_MESSAGES.notLoaded],
  ] as const)("%s: shows the copy, posts nothing and returns focus to the button", async (problem, text) => {
    bot.token.mockResolvedValue({ problem });
    await send("site-key");
    expect(status().textContent).toBe(text);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button());
    expect(bot.reset).not.toHaveBeenCalled();
  });

  it("does not ask for a token while the fields are invalid", async () => {
    render(<ContactForm copy={CMS} botCheckSiteKey="site-key" />);
    await submit();
    expect(bot.token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 403 shows the refused copy", async () => {
    await send("site-key", { status: 403, body: { ok: false, persisted: false, message: "server text" } });
    expect(status().textContent).toBe(BOT_CHECK_MESSAGES.refused);
  });

  it("a 503 with no closed flag keeps the CMS error", async () => {
    await send("site-key", { status: 503, body: { ok: false, persisted: false, message: BOT_CHECK_MESSAGES.unavailable } });
    expect(status().textContent).toBe(CMS.errorMessage);
  });

  it.each([
    ["a 200", ok()],
    ["a 429", { status: 429, body: { ok: false, persisted: false, message: "x" } }],
    ["a network rejection", "network" as const],
  ])("resets the check once after %s", async (_label, answer) => {
    await send("site-key", answer);
    expect(bot.reset).toHaveBeenCalledTimes(1);
  });

  it("a retry carries a fresh token", async () => {
    bot.token.mockResolvedValueOnce({ token: "t1" }).mockResolvedValueOnce({ token: "t2" });
    answers.push({ status: 429, body: { ok: false, persisted: false, message: "x" } }, ok());
    render(<ContactForm copy={CMS} botCheckSiteKey="site-key" />);
    fillAll();
    await submit();
    await submit();
    expect([sentBody(0)[BOT_CHECK_TOKEN_FIELD], sentBody(1)[BOT_CHECK_TOKEN_FIELD]]).toEqual(["t1", "t2"]);
  });

  it("prepares on intent: focus and pointer-down inside the form", () => {
    render(<ContactForm copy={CMS} botCheckSiteKey="site-key" />);
    fireEvent.focus(screen.getByLabelText(CONTACT_FORM_COPY.name.label));
    expect(bot.prepare).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByLabelText(CONTACT_FORM_COPY.message.label));
    expect(bot.prepare).toHaveBeenCalledTimes(2);
  });

  it("keeps exactly one role=status and reserves the new strings", () => {
    const { container } = render(<ContactForm copy={CMS} botCheckSiteKey="site-key" />);
    expect(within(form()).getAllByRole("status")).toHaveLength(1);
    const reserved = [...container.querySelectorAll(".lead-form__outcome")].flatMap((node) => [node.getAttribute("data-reserve-a"), node.getAttribute("data-reserve-b")]);
    for (const text of [BOT_CHECK_MESSAGES.refused, BOT_CHECK_MESSAGES.interactive, BOT_CHECK_MESSAGES.notLoaded]) expect(reserved).toContain(text);
  });

  it("off: the outcome wrappers are unchanged (two)", () => {
    const { container } = render(<ContactForm copy={CMS} botCheckSiteKey={null} />);
    expect(container.querySelectorAll(".lead-form__outcome")).toHaveLength(2);
  });
});
