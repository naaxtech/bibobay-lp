import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import { LeadForm, type LeadFormCopy } from "@/components/forms/LeadForm";
import { FORM_COPY } from "@/components/forms/form-copy";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

vi.mock("server-only", () => ({}));

const CMS: LeadFormCopy = {
  buttonLabel: "Join the Bay list",
  consentCopy: "I am an adult and agree to receive BIBO Bay updates.",
  successMessage: "You're on the founding-family list.",
  errorMessage: "We could not save that. Please try again.",
};

/** Words that would claim an email reached someone or promise a file. */
const DELIVERY_CLAIM = /\b(sent|deliver(ed|y)?|inbox|check your (email|mail)|we('ve| have) emailed|download)\b/i;

type Answer = { status: number; body: unknown } | "network-error";
let answers: Answer[] = [];
const requests: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  answers = [];
  requests.length = 0;
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

function renderForm(copy: LeadFormCopy = CMS) {
  return render(<LeadForm copy={copy} />);
}

const form = () => screen.getByRole("form", { name: FORM_COPY.formLabel });
const emailInput = () => screen.getByLabelText(FORM_COPY.email.label) as HTMLInputElement;
const consentBox = () => screen.getByRole("checkbox", { name: CMS.consentCopy }) as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: CMS.buttonLabel }) as HTMLButtonElement;
const status = () => screen.getByRole("status");

async function submit() {
  await act(async () => {
    fireEvent.submit(form());
  });
}

function fillValid() {
  fireEvent.change(emailInput(), { target: { value: "  Parent@Example.com " } });
  fireEvent.click(consentBox());
}

describe("fields and labels", () => {
  it("labels every field for an adult and asks for no child details beyond a broad age range", () => {
    renderForm();
    expect(emailInput().type).toBe("email");
    expect(emailInput().autocomplete).toBe("email");
    expect(emailInput().required).toBe(true);
    const firstName = screen.getByLabelText(FORM_COPY.firstName.label) as HTMLInputElement;
    expect(firstName.autocomplete).toBe("given-name");
    expect(firstName.required).toBe(false);
    const ageBand = screen.getByLabelText(FORM_COPY.ageBand.label) as HTMLSelectElement;
    expect(ageBand.required).toBe(false);
    expect(Array.from(ageBand.options).map((option) => option.value)).toEqual(["", "under-3", "3-5", "6-8", "9-12", "prefer-not-to-say"]);
    expect(Array.from(ageBand.options).slice(1).map((option) => option.textContent)).toEqual(Object.values(FORM_COPY.ageBands));
    const names = Array.from(form().querySelectorAll<HTMLInputElement>("input, select, textarea")).map((field) => field.name).sort();
    expect(names).toEqual(["ageBand", "consent", "email", "firstName", "website"]);
  });

  it("uses the CMS consent copy and button label, with consent unticked and required", () => {
    renderForm();
    expect(consentBox().checked).toBe(false);
    expect(consentBox().required).toBe(true);
    expect(submitButton().type).toBe("submit");
  });

  it("links to the privacy notice without prefetching it", () => {
    renderForm();
    const link = screen.getByRole("link", { name: FORM_COPY.privacyLink });
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("hides the honeypot from people and assistive technology", () => {
    renderForm();
    const trap = form().querySelector<HTMLInputElement>('input[name="website"]');
    expect(trap?.tabIndex).toBe(-1);
    expect(trap?.autocomplete).toBe("off");
    expect(trap?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("starts with an empty polite status region, so no outcome is shown before submitting", () => {
    renderForm();
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
  });

  it("never posts as a plain GET form, so an email cannot land in a URL", () => {
    renderForm();
    expect(form().getAttribute("method")).toBe("post");
  });
});

describe("client validation", () => {
  it("lists every problem, ties each to its field and moves focus to the summary, without sending", async () => {
    renderForm();
    await submit();
    expect(requests).toEqual([]);
    const summary = screen.getByRole("heading", { name: FORM_COPY.errorSummaryTitle }).closest<HTMLElement>("[tabindex='-1']");
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    const items = within(summary!).getAllByRole("link").map((link) => link.textContent);
    expect(items).toEqual([FORM_COPY.errors.email.required, FORM_COPY.errors.consent.required]);
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
    const describedBy = emailInput().getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent)).toContain(FORM_COPY.errors.email.required);
    expect(consentBox().getAttribute("aria-invalid")).toBe("true");
    expect(status().textContent).not.toBe(CMS.successMessage);
  });

  it("requires consent even with a valid email", async () => {
    renderForm();
    fireEvent.change(emailInput(), { target: { value: "parent@example.com" } });
    await submit();
    expect(requests).toEqual([]);
    expect(screen.getAllByText(FORM_COPY.errors.consent.required).length).toBeGreaterThan(0);
    expect(emailInput().getAttribute("aria-invalid")).toBeNull();
  });

  it("rejects a malformed email before sending", async () => {
    renderForm();
    fireEvent.change(emailInput(), { target: { value: "parent@" } });
    fireEvent.click(consentBox());
    await submit();
    expect(requests).toEqual([]);
    expect(screen.getAllByText(FORM_COPY.errors.email.invalid).length).toBeGreaterThan(0);
  });

  it("focuses the field when its summary entry is chosen", async () => {
    renderForm();
    await submit();
    fireEvent.click(screen.getByRole("link", { name: FORM_COPY.errors.consent.required }));
    expect(document.activeElement).toBe(consentBox());
  });
});

describe("submission outcomes", () => {
  it("sends only the adult's details as JSON and shows the CMS success message once the server reports the record stored", async () => {
    renderForm();
    fillValid();
    fireEvent.change(screen.getByLabelText(FORM_COPY.firstName.label), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(FORM_COPY.ageBand.label), { target: { value: "6-8" } });
    answers.push({ status: 200, body: { ok: true, persisted: true, acknowledgementQueued: false, message: "server text" } });
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.successMessage));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/leads");
    expect(requests[0]?.init.method).toBe("POST");
    expect(new Headers(requests[0]?.init.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(String(requests[0]?.init.body));
    expect(body).toMatchObject({ email: "Parent@Example.com", firstName: "Ana", ageBand: "6-8", consent: true, website: "", source: "landing" });
    expect(Object.keys(body).sort().every((key) => ["ageBand", "consent", "email", "firstName", "locale", "source", "utm", "website"].includes(key))).toBe(true);
    expect(consentBox().checked).toBe(false);
  });

  it("does not show success for a response that is ok but not persisted", async () => {
    renderForm();
    fillValid();
    answers.push({ status: 200, body: { ok: true, persisted: false, acknowledgementQueued: false, message: "odd" } });
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.errorMessage));
  });

  it("shows the CMS error message when storage is unavailable (503)", async () => {
    renderForm();
    fillValid();
    answers.push({ status: 503, body: { ok: false, persisted: false, acknowledgementQueued: false, message: SAFE_FALLBACK_CONTENT.lead.errorMessage } });
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.errorMessage));
    expect(status().textContent).not.toContain(CMS.successMessage);
  });

  it("shows the CMS error message when the network fails", async () => {
    renderForm();
    fillValid();
    answers.push("network-error");
    await submit();
    await waitFor(() => expect(status().textContent).toBe(CMS.errorMessage));
  });

  it("explains a rate limit in plain words", async () => {
    renderForm();
    fillValid();
    answers.push({ status: 429, body: { ok: false, persisted: false, acknowledgementQueued: false, message: FORM_COPY.outcome.rateLimited } });
    await submit();
    await waitFor(() => expect(status().textContent).toBe(FORM_COPY.outcome.rateLimited));
  });

  it("shows the server's field errors in the summary", async () => {
    renderForm();
    fillValid();
    answers.push({ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: FORM_COPY.outcome.checkDetails, fieldErrors: { email: "invalid" } } });
    await submit();
    await waitFor(() => expect(screen.getByRole("heading", { name: FORM_COPY.errorSummaryTitle })).toBeTruthy());
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("disables the button and marks it busy while sending, says so in the status line, then restores it", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    renderForm();
    fillValid();
    await submit();
    const button = form().querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    // The label stays put (no size change); the polite status line announces the wait.
    expect(button.textContent).toBe(CMS.buttonLabel);
    expect(status().textContent).toBe(FORM_COPY.sending);
    await act(async () => {
      release(new Response(JSON.stringify({ ok: true, persisted: true, acknowledgementQueued: true, message: "x" }), { status: 200 }));
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(status().textContent).toBe(CMS.successMessage);
  });

  it("keeps every outcome message out of the DOM text until it is the outcome", () => {
    renderForm();
    const text = form().textContent ?? "";
    for (const message of [CMS.successMessage, CMS.errorMessage, FORM_COPY.outcome.rateLimited, FORM_COPY.sending]) {
      expect(text).not.toContain(message);
    }
    // The height spacers carry them as attributes only, outside the accessibility tree.
    const spacers = Array.from(form().querySelectorAll<HTMLElement>(".lead-form__outcome"));
    expect(spacers.flatMap((element) => [element.dataset.reserveA, element.dataset.reserveB]).sort()).toEqual(
      [CMS.successMessage, CMS.errorMessage, FORM_COPY.outcome.rateLimited, FORM_COPY.sending].sort(),
    );
  });
});

describe("truthful copy", () => {
  it("keeps every form string free of delivery and download claims", () => {
    const strings: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(FORM_COPY);
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) expect(text, text).not.toMatch(DELIVERY_CLAIM);
  });

  it("never asks for a child's name, birthday, school, photo or location", () => {
    renderForm();
    const visible = form().textContent ?? "";
    expect(visible).not.toMatch(/child'?s (name|birthday|school|photo)|date of birth|postcode|address\b(?! like)/i);
  });
});

describe("landing page integration", () => {
  it("hosts the founding-family form in the lead section, using the CMS lead copy", async () => {
    render(await Home());
    const lead = document.getElementById("lead");
    expect(lead).not.toBeNull();
    const signup = within(lead!).getByRole("form", { name: FORM_COPY.formLabel });
    expect(within(signup).getByRole("button", { name: SAFE_FALLBACK_CONTENT.lead.buttonLabel })).toBeTruthy();
    expect(within(signup).getByRole("checkbox", { name: SAFE_FALLBACK_CONTENT.lead.consentCopy })).toBeTruthy();
    expect(within(signup).getByRole("status").textContent).toBe("");
  });
});
