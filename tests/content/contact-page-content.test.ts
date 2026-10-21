import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELIVERY_CLAIM_PATTERN } from "@/lib/content/claims";
import { SAFE_FALLBACK_CONTACT_PAGE, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { normalizeContactPage, normalizeSiteSettings } from "@/lib/content/normalize";
import { getContactPage } from "@/lib/sanity/fetch";
import { getSanityClient } from "@/lib/sanity/client";
import { CONTACT_PAGE_QUERY } from "@/lib/sanity/queries";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sanity/client", () => ({ getSanityClient: vi.fn(() => null) }));

const FULL = {
  seo: { title: "  Write to us  ", description: " A short description. " },
  heading: " Say hello ",
  description: " Grown-ups only, please. ",
  buttonLabel: " Write to the team ",
  successMessage: " Thank you, we have your message. ",
  errorMessage: " That did not save. ",
  closedMessage: " Closed for now. ",
  emailIntro: " Write to: ",
};

const strings = (page: typeof SAFE_FALLBACK_CONTACT_PAGE): string[] => [page.seo.title, page.seo.description, page.heading, page.description, page.buttonLabel, page.successMessage, page.errorMessage, page.closedMessage, page.emailIntro];

beforeEach(() => { vi.mocked(getSanityClient).mockReturnValue(null); });

describe("the contact page content (R190, R195)", () => {
  it("normalises a full document, trimming text", () => {
    expect(normalizeContactPage(FULL)).toEqual({
      seo: { title: "Write to us", description: "A short description." },
      heading: "Say hello",
      description: "Grown-ups only, please.",
      buttonLabel: "Write to the team",
      successMessage: "Thank you, we have your message.",
      errorMessage: "That did not save.",
      closedMessage: "Closed for now.",
      emailIntro: "Write to:",
    });
  });

  it("falls back field by field", () => {
    const page = normalizeContactPage({ heading: "Only a heading", buttonLabel: "   ", errorMessage: 4 });
    expect(page.heading).toBe("Only a heading");
    expect(page).toEqual({ ...SAFE_FALLBACK_CONTACT_PAGE, heading: "Only a heading" });
  });

  it("answers the fallback for an empty, missing or malformed document", () => {
    for (const raw of [undefined, null, {}, [], "text", 7]) expect(normalizeContactPage(raw)).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
  });

  it("replaces a CMS success message that claims delivery with the fallback", () => {
    for (const claim of ["We emailed the team", "Your message was sent.", "Delivered to our inbox", "Check your email soon", "We've emailed you"]) {
      expect(normalizeContactPage({ ...FULL, successMessage: claim }).successMessage, claim).toBe(SAFE_FALLBACK_CONTACT_PAGE.successMessage);
    }
    expect(normalizeContactPage(FULL).successMessage).toBe("Thank you, we have your message.");
  });

  it("writes fallback copy for grown-ups that asks to leave out child details and claims no delivery", () => {
    expect(SAFE_FALLBACK_CONTACT_PAGE.description).toMatch(/parent, carer or professional/);
    expect(SAFE_FALLBACK_CONTACT_PAGE.description).toMatch(/leave out any details about a child/);
    for (const value of strings(SAFE_FALLBACK_CONTACT_PAGE)) expect(DELIVERY_CLAIM_PATTERN.test(value), value).toBe(false);
  });

  it("keeps the fallback strings word for word as the contract gives them", () => {
    expect(SAFE_FALLBACK_CONTACT_PAGE).toEqual({
      seo: { title: "Contact BIBO Bay", description: "Write to the BIBO Bay team with a question, a partnership idea or a press enquiry." },
      heading: "Contact us",
      description: "Questions, ideas and press enquiries from grown-ups are welcome. Please write as a parent, carer or professional, and leave out any details about a child.",
      buttonLabel: "Send message",
      successMessage: "Thank you. We have received your message.",
      errorMessage: "We could not save your message. Please try again.",
      closedMessage: "The contact form is not open yet, so no message can be saved from this page. Please check back soon.",
      emailIntro: "The contact form is not open yet. You can write to us at:",
    });
  });

  it("keeps a CMS noIndex on the page's SEO", () => {
    expect(normalizeContactPage({ seo: { title: "T", description: "D", noIndex: true } }).seo.noIndex).toBe(true);
  });
});

describe("the footer's contact page link label", () => {
  it("falls back to Contact us and keeps the existing contact label", () => {
    expect(SAFE_FALLBACK_SETTINGS.footer.contactPageLabel).toBe("Contact us");
    expect(SAFE_FALLBACK_SETTINGS.footer.contactLabel).toBe("Contact");
    expect(normalizeSiteSettings({ title: "BIBO Bay", footer: { text: "x" } }).footer.contactPageLabel).toBe("Contact us");
  });

  it("normalises an editor's label", () => {
    expect(normalizeSiteSettings({ title: "BIBO Bay", footer: { contactPageLabel: "  Write to us " } }).footer.contactPageLabel).toBe("Write to us");
  });
});

describe("getContactPage", () => {
  it("answers the fallback without Sanity, in draft preview too", async () => {
    expect(await getContactPage()).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
    expect(await getContactPage({ preview: true })).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
  });

  it("reads the singleton by id with the contactPage tag, and a draft read with no store", async () => {
    expect(CONTACT_PAGE_QUERY).toBe('*[_id == "contactPage"][0]{...}');
    const fetch = vi.fn().mockResolvedValue(FULL);
    vi.mocked(getSanityClient).mockReturnValue({ fetch } as never);
    expect((await getContactPage()).heading).toBe("Say hello");
    expect(fetch).toHaveBeenCalledWith(CONTACT_PAGE_QUERY, {}, expect.objectContaining({ next: expect.objectContaining({ tags: ["contactPage"], revalidate: false }), perspective: "published" }));
    await getContactPage({ preview: true });
    expect(fetch).toHaveBeenLastCalledWith(CONTACT_PAGE_QUERY, {}, expect.objectContaining({ cache: "no-store", perspective: "drafts" }));
  });

  it("answers the fallback when the read fails or finds no document", async () => {
    vi.mocked(getSanityClient).mockReturnValue({ fetch: vi.fn().mockRejectedValue(new Error("offline")) } as never);
    expect(await getContactPage()).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
    vi.mocked(getSanityClient).mockReturnValue({ fetch: vi.fn().mockResolvedValue(null) } as never);
    expect(await getContactPage()).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
  });
});
