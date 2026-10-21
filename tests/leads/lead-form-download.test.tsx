import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeadForm, type LeadFormCopy } from "@/components/forms/LeadForm";
import { acceptDownload } from "@/components/forms/download-link";
import { FORM_COPY } from "@/components/forms/form-copy";

const CMS: LeadFormCopy = {
  buttonLabel: "Get the free pack",
  consentCopy: "I am an adult and agree to receive BIBO Bay updates.",
  successMessage: "You joined the founding-family list.",
  errorMessage: "We could not save your request. Please try again.",
};

const SIGNED = { url: "/api/freebies/download?t=abc", title: "Bibo Bay Activity Pack" };
let answers: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  answers = [];
  vi.stubGlobal("fetch", vi.fn(async () => {
    const answer = answers.shift()!;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (extra: Record<string, unknown> = {}) => ({ status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: "server text", ...extra } });

async function submitForm() {
  fireEvent.change(screen.getByLabelText(FORM_COPY.email.label), { target: { value: "parent@example.com" } });
  const consent = screen.getByRole("checkbox", { name: CMS.consentCopy }) as HTMLInputElement;
  if (!consent.checked) fireEvent.click(consent);
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: FORM_COPY.formLabel }));
  });
}

async function signUp(answer: { status: number; body: unknown }) {
  answers.push(answer);
  render(<LeadForm copy={CMS} botCheckSiteKey={null} />);
  await submitForm();
}

const downloadLink = () => screen.queryByRole("link", { name: /^Download the free pack/ });

const downloadStatus = () => document.querySelector("[data-download-announcement]")!;

describe("the download announcement", () => {
  it("is an always-mounted polite region with no role, empty before any signup", () => {
    render(<LeadForm copy={CMS} botCheckSiteKey={null} />);
    const region = downloadStatus();
    expect(region.hasAttribute("role")).toBe(false);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent).toBe("");
  });

  it("names the download once a signup is stored", async () => {
    await signUp(ok({ download: SIGNED }));
    expect(downloadStatus().textContent).toBe(`${FORM_COPY.downloadReady} Download the free pack: ${SIGNED.title}`);
  });

  it("stays empty when the answer carries no download", async () => {
    await signUp(ok());
    expect(downloadStatus().textContent).toBe("");
  });
});

describe("the form's download button", () => {
  it("is the anchor target of the card", () => {
    render(<LeadForm copy={CMS} botCheckSiteKey={null} />);
    expect(screen.getByRole("form", { name: FORM_COPY.formLabel }).id).toBe("lead-form");
  });

  it("shows a download link after a confirmed signup, outside the live status line", async () => {
    await signUp(ok({ download: SIGNED }));
    const link = downloadLink()!;
    expect(link.getAttribute("href")).toBe(SIGNED.url);
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.getAttribute("aria-label")).toBe("Download the free pack: Bibo Bay Activity Pack");
    expect(screen.getByText(FORM_COPY.downloadReady)).toBeTruthy();
    const outcome = screen.getByRole("status");
    expect(outcome.textContent).toBe(CMS.successMessage);
    expect(outcome.contains(link)).toBe(false);
  });

  it("shows nothing when the answer carries no download", async () => {
    await signUp(ok());
    expect(downloadLink()).toBeNull();
    expect(screen.queryByText(FORM_COPY.downloadReady)).toBeNull();
  });

  it.each(["javascript:alert(1)", "//evil.example/x.pdf", "/anything-else", "http://example.com/x.pdf", "https://user:pw@example.com/x.pdf"])("refuses the url %s", async (url) => {
    await signUp(ok({ download: { url, title: "Pack" } }));
    expect(downloadLink()).toBeNull();
  });

  it("accepts an https file, with no download attribute", async () => {
    await signUp(ok({ download: { url: "https://cdn.sanity.io/files/a/b/sheet.pdf", title: "Sheet" } }));
    const link = downloadLink()!;
    expect(link.getAttribute("href")).toBe("https://cdn.sanity.io/files/a/b/sheet.pdf");
    expect(link.hasAttribute("download")).toBe(false);
  });

  it("shows no link on a 503 even when a download is present", async () => {
    await signUp({ status: 503, body: { ok: false, persisted: false, message: "Signups are not open yet.", download: SIGNED } });
    expect(downloadLink()).toBeNull();
  });

  it("shows no link when the signup was not persisted", async () => {
    await signUp({ status: 200, body: { ok: true, persisted: false, message: "x", download: SIGNED } });
    expect(downloadLink()).toBeNull();
  });

  it("clears the link when a new submit starts and the next answer has none", async () => {
    answers.push(ok({ download: SIGNED }));
    render(<LeadForm copy={CMS} botCheckSiteKey={null} />);
    await submitForm();
    expect(downloadLink()).not.toBeNull();
    answers.push({ status: 503, body: { ok: false, persisted: false, message: "Signups are not open yet." } });
    await submitForm();
    expect(downloadLink()).toBeNull();
  });
});

describe("acceptDownload", () => {
  it("requires an object, a non-empty title and a safe url", () => {
    expect(acceptDownload(SIGNED)).toEqual({ ...SIGNED, sameOrigin: true });
    expect(acceptDownload(null)).toBeNull();
    expect(acceptDownload("x")).toBeNull();
    expect(acceptDownload({ url: SIGNED.url, title: "  " })).toBeNull();
    expect(acceptDownload({ url: SIGNED.url })).toBeNull();
    expect(acceptDownload({ url: 5, title: "T" })).toBeNull();
    expect(acceptDownload({ url: "https://example.com/a.pdf", title: "T" })).toEqual({ url: "https://example.com/a.pdf", title: "T", sameOrigin: false });
    expect(acceptDownload({ url: "/api/freebies/download", title: "T" })).toBeNull();
  });
});
