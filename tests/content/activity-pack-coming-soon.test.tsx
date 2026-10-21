import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadForm } from "@/components/forms/LeadForm";
import { LandingPage } from "@/components/landing/LandingPage";
import { COMING_SOON_FALLBACK, SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { normalizeLandingContent } from "@/lib/content/normalize";
import { stegaCleanText } from "@/lib/content/stega";
import type { LandingPageContent } from "@/lib/content/types";
import { immediateDownloadFrom, leadMagnetFrom } from "@/lib/leads/dependencies";
import { schemaTypes } from "@/studio/schemaTypes";
import { COMING_SOON_DEFAULTS, comingSoonProblem } from "@/studio/schemaTypes/lead-magnet";
import { encodeString, STEGA_CHARACTER } from "@/tests/support/stega";
import { siteSettings } from "../landing/fixtures";

/*
 * Ruling R240: the activity pack's "Coming soon" switch (Studio: the download's document). On, the
 * page shows the pack as coming soon, nobody is given the file (not on the page after signing up,
 * not in the acknowledgement email), and the signup section's two sentences that promise the file
 * (its description and button label) are swapped for coming-soon wording. Off, nothing changes.
 */

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
});

const PACK = "/freebies/bibo-bay-activity-pack.pdf";
const SECRET_ENV = { LEAD_IP_HASH_SECRET: "fixture-only-not-a-real-secret-0123456789", NEXT_PUBLIC_APP_URL: "https://bibobay.example" };

const lead = (magnet: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  normalizeLandingContent({ lead: { heading: "Print, play and learn.", description: "Sign up and the pack is yours to download straight away.", buttonLabel: "Get the free pack", leadMagnet: { title: "Bibo Bay Activity Pack", description: "Eight printable pages.", fileUrl: PACK, available: true, ...magnet }, ...extra } }).lead;

describe("the coming-soon switch in the normalizer (R240)", () => {
  it("off: the pack is offered exactly as before, with the section's own wording", () => {
    const off = lead({ comingSoon: false, comingSoonNote: "Not shown", comingSoonDescription: "Not shown", comingSoonButtonLabel: "Not shown" });
    expect(off.leadMagnet).toEqual({ title: "Bibo Bay Activity Pack", description: "Eight printable pages.", fileUrl: PACK, available: true });
    expect(off.description).toBe("Sign up and the pack is yours to download straight away.");
    expect(off.buttonLabel).toBe("Get the free pack");
    // A document saved before the switch existed has no field at all: off.
    expect(lead({}).leadMagnet?.available).toBe(true);
  });

  it("on: the pack is never available, carries its note, and the promising wording is swapped", () => {
    const on = lead({ comingSoon: true, comingSoonNote: "We are drawing the last pages.", comingSoonDescription: "Join the list to hear first.", comingSoonButtonLabel: "Join the list" });
    expect(on.leadMagnet).toEqual({ title: "Bibo Bay Activity Pack", description: "Eight printable pages.", fileUrl: PACK, available: false, comingSoon: { note: "We are drawing the last pages." } });
    expect(on.description).toBe("Join the list to hear first.");
    expect(on.buttonLabel).toBe("Join the list");
    // Untouched: the heading and everything else in the section.
    expect(on.heading).toBe("Print, play and learn.");
  });

  it("on, with the coming-soon wording left empty: the repository's coming-soon wording, never the download promise", () => {
    const on = lead({ comingSoon: true, comingSoonNote: "  ", comingSoonDescription: "" });
    expect(on.leadMagnet?.comingSoon).toEqual({ note: COMING_SOON_FALLBACK.note });
    expect(on.description).toBe(COMING_SOON_FALLBACK.description);
    expect(on.buttonLabel).toBe(COMING_SOON_FALLBACK.buttonLabel);
    for (const sentence of Object.values(COMING_SOON_FALLBACK)) expect(sentence).not.toMatch(/download|yours|straight away|get the free/i);
  });

  it("on wins over 'File exists and may be offered', and needs no file", () => {
    expect(lead({ comingSoon: true, available: true }).leadMagnet?.available).toBe(false);
    const fileless = lead({ comingSoon: true, available: false, fileUrl: undefined });
    expect(fileless.leadMagnet).toMatchObject({ title: "Bibo Bay Activity Pack", available: false, comingSoon: { note: COMING_SOON_FALLBACK.note } });
    expect(fileless.leadMagnet?.fileUrl).toBeUndefined();
  });

  it("on, without a title: no card, and still no download promise", () => {
    const untitled = lead({ comingSoon: true, title: "" });
    expect(untitled.leadMagnet).toBeUndefined();
    expect(untitled.description).toBe(COMING_SOON_FALLBACK.description);
  });

  it("keeps the click-to-edit links on the swapped wording in a Studio preview, and decides on clean values", () => {
    const on = lead({ comingSoon: true, comingSoonNote: encodeString("Soon."), comingSoonDescription: encodeString("Hear first."), comingSoonButtonLabel: encodeString("Join") });
    expect(STEGA_CHARACTER.test(on.description)).toBe(true);
    expect(STEGA_CHARACTER.test(on.leadMagnet?.comingSoon?.note ?? "")).toBe(true);
    expect(stegaCleanText(on.buttonLabel)).toBe("Join");
  });

  it("the repository fallback (Sanity unreachable) is the offered pack, unchanged", () => {
    expect(normalizeLandingContent({}).lead.leadMagnet).toEqual(SAFE_FALLBACK_CONTENT.lead.leadMagnet);
    expect(SAFE_FALLBACK_CONTENT.lead.leadMagnet?.comingSoon).toBeUndefined();
  });
});

describe("nobody is given the file while the pack is coming soon (R240)", () => {
  const comingSoon = lead({ comingSoon: true });
  // Even a hand-built value that claims both cannot hand out the file.
  const contradictory = { ...comingSoon, leadMagnet: { ...comingSoon.leadMagnet!, available: true, fileUrl: PACK } };

  it("not on the page after a signup", () => {
    expect(immediateDownloadFrom(comingSoon, SECRET_ENV)).toBeNull();
    expect(immediateDownloadFrom(contradictory, SECRET_ENV)).toBeNull();
    expect(immediateDownloadFrom(lead({ comingSoon: false }), SECRET_ENV)).not.toBeNull();
  });

  it("not in the acknowledgement email", () => {
    expect(leadMagnetFrom(comingSoon, SAFE_FALLBACK_SETTINGS, SECRET_ENV)).toBeNull();
    expect(leadMagnetFrom(contradictory, SAFE_FALLBACK_SETTINGS, SECRET_ENV)).toBeNull();
    expect(leadMagnetFrom(lead({ comingSoon: false }), SAFE_FALLBACK_SETTINGS, SECRET_ENV)).not.toBeNull();
  });
});

describe("the coming-soon card (R240)", () => {
  function renderLead(next: LandingPageContent["lead"]) {
    const content: LandingPageContent = { ...structuredClone(SAFE_FALLBACK_CONTENT), lead: next };
    const { buttonLabel, consentCopy, successMessage, errorMessage } = next;
    render(<LandingPage content={content} settings={siteSettings()} leadForm={<LeadForm copy={{ buttonLabel, consentCopy, successMessage, errorMessage }} botCheckSiteKey={null} />} />);
    const section = document.getElementById("lead");
    if (!section) throw new Error("no lead section");
    return section;
  }

  it("says Coming soon, shows the note and the pack's real pages, and offers no download", () => {
    const section = renderLead(lead({ comingSoon: true, comingSoonNote: "We are drawing the last pages." }));
    const card = section.querySelector<HTMLElement>("[data-freebie]");
    expect(card).not.toBeNull();
    expect(card!.dataset.freebie).toBe("coming-soon");
    expect(within(card!).getByText("Coming soon")).toBeTruthy();
    expect(within(card!).getByRole("heading", { name: "Bibo Bay Activity Pack" })).toBeTruthy();
    expect(within(card!).getByText("We are drawing the last pages.")).toBeTruthy();
    expect(within(card!).getByRole("img", { name: /activity pack/i })).toBeTruthy();
    // No way to the file, no "free for everyone on the list", no format line.
    expect(within(card!).queryByRole("link")).toBeNull();
    expect(within(card!).queryByText(/Free for everyone/)).toBeNull();
    expect(within(card!).queryByText(/^PDF ·/)).toBeNull();
    // The section's wording and the form's button follow the switch.
    expect(within(section).getByText(COMING_SOON_FALLBACK.description)).toBeTruthy();
    expect(within(section).getByRole("button", { name: COMING_SOON_FALLBACK.buttonLabel })).toBeTruthy();
    expect(within(section).queryByText(/download straight away/)).toBeNull();
    expect(within(section).queryByRole("button", { name: /free pack/i })).toBeNull();
  });

  it("shows no previews for a coming-soon download that is not the repository's pack", () => {
    const section = renderLead(lead({ comingSoon: true, fileUrl: undefined, title: "Bay colouring sheet" }));
    expect(within(section).getByRole("heading", { name: "Bay colouring sheet" })).toBeTruthy();
    expect(within(section).queryByRole("img", { name: /activity pack/i })).toBeNull();
  });

  it("off: the offered card as before", () => {
    const section = renderLead(lead({ comingSoon: false }));
    expect(section.querySelector<HTMLElement>("[data-freebie]")!.dataset.freebie).toBe("offered");
    expect(within(section).queryByText("Coming soon")).toBeNull();
    expect(within(section).getByRole("link", { name: /^Get the free pack/ }).getAttribute("href")).toBe("#lead-form");
  });
});

describe("the Studio switch (R240)", () => {
  type Field = { name: string; type: string; hidden?: unknown; validation?: unknown; initialValue?: unknown; placeholder?: string };
  const fields = new Map(((schemaTypes as Array<{ name: string; fields?: Field[] }>).find((type) => type.name === "leadMagnet")?.fields ?? []).map((field) => [field.name, field]));

  it("is a switch, off by default, with its wording fields shown only while it is on", () => {
    expect(fields.get("comingSoon")).toMatchObject({ type: "boolean", initialValue: false });
    for (const name of ["comingSoonNote", "comingSoonDescription", "comingSoonButtonLabel"]) {
      const field = fields.get(name);
      expect(field, name).toBeDefined();
      const hidden = field!.hidden as (context: { document?: Record<string, unknown> }) => boolean;
      expect(hidden({ document: { comingSoon: false } }), name).toBe(true);
      expect(hidden({ document: { comingSoon: true } }), name).toBe(false);
    }
  });

  it("shows the wording the site uses when a field is left empty, the same words as the site's", () => {
    expect(COMING_SOON_DEFAULTS).toEqual(COMING_SOON_FALLBACK);
    expect(fields.get("comingSoonNote")?.placeholder).toBe(COMING_SOON_DEFAULTS.note);
    expect(fields.get("comingSoonDescription")?.placeholder).toBe(COMING_SOON_DEFAULTS.description);
    expect(fields.get("comingSoonButtonLabel")?.placeholder).toBe(COMING_SOON_DEFAULTS.buttonLabel);
  });

  it("refuses to publish a coming-soon download without a title", () => {
    expect(comingSoonProblem(true, "Bibo Bay Activity Pack")).toBe(true);
    expect(comingSoonProblem(false, "")).toBe(true);
    expect(comingSoonProblem(undefined, undefined)).toBe(true);
    expect(comingSoonProblem(true, "  ")).toMatch(/title/);
    expect(comingSoonProblem(true, undefined)).toMatch(/title/);
    expect(String(fields.get("comingSoon")?.validation)).toContain("comingSoonProblem");
  });
});
