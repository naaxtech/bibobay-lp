import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm, type ContactFormCopy } from "@/components/forms/ContactForm";
import { CONTACT_FORM_COPY } from "@/components/forms/contact-copy";
import { CONTACT_API_PATH, CONTACT_FIELD_ORDER, CONTACT_TOPICS, HONEYPOT_FIELD, CONTACT_TOPIC_LABELS } from "@/lib/contact/fields";

const analytics = vi.hoisted(() => ({ tracked: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/analytics/client", () => ({
  track: (event: string, properties: Record<string, unknown>) => analytics.tracked.push([event, properties]),
}));

const CMS: ContactFormCopy = {
  buttonLabel: "Send message",
  successMessage: "Thank you. We have received your message.",
  errorMessage: "We could not save your message. Please try again.",
  closedMessage: "The contact form is not open yet, so no message can be saved from this page.",
};

const GOOD_MESSAGE = "Hello team, a question about the pack.";
let answers: Array<{ status: number; body: unknown } | "network"> = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  answers = [];
  analytics.tracked.length = 0;
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

function fill(values: { name?: string; email?: string; topic?: string; message?: string }) {
  if (values.name !== undefined) fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.name.label), { target: { value: values.name } });
  if (values.email !== undefined) fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.email.label), { target: { value: values.email } });
  if (values.topic !== undefined) fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.topic.label), { target: { value: values.topic } });
  if (values.message !== undefined) fireEvent.change(screen.getByLabelText(CONTACT_FORM_COPY.message.label), { target: { value: values.message } });
}

const fillAll = () => fill({ name: "  Ana Reyes ", email: " Ana@Example.com ", topic: "press", message: GOOD_MESSAGE });

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

async function send(answer: { status: number; body: unknown } | "network") {
  answers.push(answer);
  render(<ContactForm copy={CMS} />);
  fillAll();
  await submit();
}

const status = () => screen.getByRole("status");

describe("the contact form's structure", () => {
  it("labels every field and ties hints and errors through aria-describedby", async () => {
    render(<ContactForm copy={CMS} />);
    const name = screen.getByLabelText(CONTACT_FORM_COPY.name.label);
    const email = screen.getByLabelText(CONTACT_FORM_COPY.email.label);
    const topic = screen.getByLabelText(CONTACT_FORM_COPY.topic.label);
    const message = screen.getByLabelText(CONTACT_FORM_COPY.message.label);
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(email.getAttribute("type")).toBe("email");
    expect(topic.tagName).toBe("SELECT");
    expect((topic as HTMLSelectElement).options[0]!.value).toBe("");
    expect([...(topic as HTMLSelectElement).options].slice(1).map((option) => [option.value, option.textContent])).toEqual(
      CONTACT_TOPICS.map((value) => [value, CONTACT_TOPIC_LABELS[value]]),
    );
    expect(message.tagName).toBe("TEXTAREA");
    expect(message.classList.contains("lead-form__textarea")).toBe(true);
    expect(document.getElementById(email.getAttribute("aria-describedby")!)!.textContent).toBe(CONTACT_FORM_COPY.email.hint);
    expect(document.getElementById(message.getAttribute("aria-describedby")!)!.textContent).toBe(CONTACT_FORM_COPY.message.hint);
    expect(name.hasAttribute("aria-describedby")).toBe(false);

    await submit();
    for (const field of [name, email, topic, message]) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      const errorIds = field.getAttribute("aria-describedby")!.split(" ");
      const error = document.getElementById(errorIds[errorIds.length - 1]!)!;
      expect(error.id.endsWith("-error")).toBe(true);
      expect(error.textContent!.length).toBeGreaterThan(0);
    }
    expect(email.getAttribute("aria-describedby")!.split(" ")).toHaveLength(2);
    expect(name.getAttribute("aria-describedby")!.split(" ")).toHaveLength(1);
  });

  it("keeps exactly one role=status element in the form (R199)", async () => {
    render(<ContactForm copy={CMS} />);
    expect(within(form()).getAllByRole("status")).toHaveLength(1);
    await submit();
    expect(within(form()).getAllByRole("status")).toHaveLength(1);
  });

  it("the honeypot is aria-hidden, out of the tab order, with autocomplete off", () => {
    const { container } = render(<ContactForm copy={CMS} />);
    const trap = container.querySelector<HTMLInputElement>(`input[name=${HONEYPOT_FIELD}]`)!;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap.getAttribute("tabindex")).toBe("-1");
    expect(trap.getAttribute("autocomplete")).toBe("off");
    expect(trap.closest(".lead-form__trap")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: CONTACT_FORM_COPY.honeypotLabel })).toBeNull();
  });

  it("the privacy link follows the submit button", () => {
    render(<ContactForm copy={CMS} />);
    const link = screen.getByRole("link", { name: CONTACT_FORM_COPY.privacyLink });
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(button().compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is the C9 form: fixed id, post method, no native validation", () => {
    render(<ContactForm copy={CMS} />);
    expect(form().id).toBe("contact-form");
    expect(form().getAttribute("method")).toBe("post");
    expect(form().hasAttribute("novalidate")).toBe(true);
  });

  it("server HTML has the button disabled until hydration", () => {
    const html = renderToString(<ContactForm copy={CMS} />);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
});

describe("browser checks", () => {
  it("an empty submit lists name, email, topic and message in that order, focuses the named summary and calls fetch zero times", async () => {
    render(<ContactForm copy={CMS} />);
    await submit();
    const summary = screen.getByRole("group", { name: CONTACT_FORM_COPY.errorSummaryTitle });
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute("tabindex")).toBe("-1");
    expect(within(summary).getAllByRole("link").map((link) => link.textContent)).toEqual([
      CONTACT_FORM_COPY.errors.name.required,
      CONTACT_FORM_COPY.errors.email.required,
      CONTACT_FORM_COPY.errors.topic.required,
      CONTACT_FORM_COPY.errors.message.required,
    ]);
    expect(CONTACT_FIELD_ORDER).toEqual(["name", "email", "topic", "message"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("titles the summary with an h2, the next level under the /contact page's h1, as the order form does", async () => {
    render(<ContactForm copy={CMS} />);
    await submit();
    const summary = screen.getByRole("group", { name: CONTACT_FORM_COPY.errorSummaryTitle });
    expect(within(summary).getByRole("heading", { level: 2, name: CONTACT_FORM_COPY.errorSummaryTitle })).toBeTruthy();
  });

  it("a summary link moves focus to its field", async () => {
    render(<ContactForm copy={CMS} />);
    await submit();
    fireEvent.click(within(screen.getByRole("group", { name: CONTACT_FORM_COPY.errorSummaryTitle })).getAllByRole("link")[0]!);
    expect(document.activeElement).toBe(screen.getByLabelText(CONTACT_FORM_COPY.name.label));
  });

  it("a 9-character message is refused in the browser with the too-short message", async () => {
    render(<ContactForm copy={CMS} />);
    fill({ name: "Ana", email: "ana@example.com", topic: "general", message: "123456789" });
    await submit();
    expect(screen.getByText(CONTACT_FORM_COPY.errors.message.too_short, { selector: "p" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  it("posts exactly the five fields as JSON to the contact endpoint, trimmed and normalised", async () => {
    answers.push(ok());
    render(<ContactForm copy={CMS} />);
    fill({ name: "  Ana Reyes ", email: " Ana@Example.com ", topic: "press", message: `  Hello\r\nteam, a question about the pack.\r\n ` });
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONTACT_API_PATH);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["email", "message", "name", "topic", HONEYPOT_FIELD]);
    expect(body).toEqual({ name: "Ana Reyes", email: "ana@example.com", topic: "press", message: "Hello\nteam, a question about the pack.", [HONEYPOT_FIELD]: "" });
  });

  it("posts to a given endpoint", async () => {
    answers.push(ok());
    render(<ContactForm copy={CMS} endpoint="/api/elsewhere" />);
    fillAll();
    await submit();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/elsewhere");
  });

  it("ignores a second submit while saving: one fetch, a disabled aria-busy button, the saving status", async () => {
    let release: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    render(<ContactForm copy={CMS} />);
    fillAll();
    await submit();
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe(CONTACT_FORM_COPY.sending);
    await act(async () => {
      release(new Response(JSON.stringify(ok().body), { status: 200 }));
    });
    expect(status().textContent).toBe(CMS.successMessage);
  });
});

describe("the outcomes", () => {
  it("shows the CMS success message only for ok and persisted, resets the form, returns focus to the button and tracks contact_submitted once", async () => {
    await send(ok());
    expect(status().textContent).toBe(CMS.successMessage);
    expect((screen.getByLabelText(CONTACT_FORM_COPY.name.label) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(CONTACT_FORM_COPY.message.label) as HTMLTextAreaElement).value).toBe("");
    expect(document.activeElement).toBe(button());
    expect(analytics.tracked).toEqual([["contact_submitted", { persisted: true, topic: "press" }]]);
    expect(JSON.stringify(analytics.tracked)).not.toMatch(/ana|example\.com|Hello/i);
  });

  it("never claims the message was emailed", async () => {
    await send(ok());
    expect(document.body.textContent).not.toMatch(/\b(emailed|sent|delivered)\b/i);
  });

  it("a 200 without persisted: true shows the CMS error and tracks nothing", async () => {
    await send({ status: 200, body: { ok: true, persisted: false, message: "x" } });
    expect(status().textContent).toBe(CMS.errorMessage);
    expect(analytics.tracked).toEqual([]);
  });

  it("a 503 with closed: true shows the CMS closed message; a 503 without it shows the CMS error", async () => {
    await send({ status: 503, body: { ok: false, persisted: false, closed: true, message: "server closed text" } });
    expect(status().textContent).toBe(CMS.closedMessage);
    cleanup();
    await send({ status: 503, body: { ok: false, persisted: false, message: "server text" } });
    expect(status().textContent).toBe(CMS.errorMessage);
    expect(analytics.tracked).toEqual([]);
  });

  it("429 shows the chrome rate-limit message; 500 and a network failure show the CMS error; none tracks", async () => {
    await send({ status: 429, body: { ok: false, persisted: false, message: "server text" } });
    expect(status().textContent).toBe(CONTACT_FORM_COPY.outcome.rateLimited);
    cleanup();
    await send({ status: 500, body: { ok: false, persisted: false, message: "server text" } });
    expect(status().textContent).toBe(CMS.errorMessage);
    cleanup();
    await send("network");
    expect(status().textContent).toBe(CMS.errorMessage);
    expect(analytics.tracked).toEqual([]);
    expect(document.activeElement).toBe(button());
  });

  it("keeps what was typed after a failed request", async () => {
    await send({ status: 500, body: { ok: false, persisted: false, message: "x" } });
    expect((screen.getByLabelText(CONTACT_FORM_COPY.message.label) as HTMLTextAreaElement).value).toBe(GOOD_MESSAGE);
  });

  it("server field errors move focus to the summary and drop unknown fields", async () => {
    await send({ status: 400, body: { ok: false, persisted: false, message: "x", fieldErrors: { email: "invalid", message: "too_long", bogus: "required" } } });
    const summary = screen.getByRole("group", { name: CONTACT_FORM_COPY.errorSummaryTitle });
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getAllByRole("link").map((link) => link.textContent)).toEqual([CONTACT_FORM_COPY.errors.email.invalid, CONTACT_FORM_COPY.errors.message.too_long]);
    expect(analytics.tracked).toEqual([]);
  });
});
