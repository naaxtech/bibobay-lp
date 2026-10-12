import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import type { LandingPageContent } from "@/lib/content/types";
import { landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

// Spec §7 "Episode previews: timeline-style progress" (ruling R22): a quiet marker of which story
// concept of N is open. It follows the tabs; it never plays, counts down or advances by itself.

afterEach(() => {
  cleanup();
});

function renderPage(content: LandingPageContent = landingContent()) {
  return render(<LandingPage content={content} settings={siteSettings()} />);
}

const episodes = () => document.getElementById("episodes")!;
const progress = () => episodes().querySelector<HTMLElement>("[data-story-progress]");
const stops = () => Array.from(progress()!.querySelectorAll<HTMLElement>("li"));
const states = () => stops().map((stop) => stop.dataset.state);
const storyTabs = () => within(episodes()).getAllByRole("tab");
/** The sentence assistive technology hears for the open panel. */
const describedPosition = () => {
  const panel = within(episodes()).getByRole("tabpanel");
  const id = panel.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
};

describe("story concept progress", () => {
  it("shows one position per story concept, with the first one open", () => {
    renderPage();
    expect(progress()).not.toBeNull();
    expect(stops()).toHaveLength(3);
    expect(states()).toEqual(["current", "upcoming", "upcoming"]);
    expect(progress()!.textContent).toContain("1 of 3");
  });

  it("counts however many concepts the CMS has", () => {
    renderPage(landingContent((draft) => {
      draft.episodes.push({ ...draft.episodes[0]!, id: "tide", title: "The Tide Pool Riddle" });
    }));
    expect(stops()).toHaveLength(4);
    expect(progress()!.textContent).toContain("1 of 4");
  });

  it("follows the story tabs by click and by keyboard", () => {
    renderPage();
    fireEvent.click(storyTabs()[2]!);
    expect(states()).toEqual(["past", "past", "current"]);
    expect(progress()!.textContent).toContain("3 of 3");

    storyTabs()[2]!.focus();
    fireEvent.keyDown(storyTabs()[2]!, { key: "ArrowLeft" });
    expect(states()).toEqual(["past", "current", "upcoming"]);
    expect(progress()!.textContent).toContain("2 of 3");

    fireEvent.keyDown(storyTabs()[1]!, { key: "Home" });
    expect(states()).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("tells assistive technology which concept of how many is open, without repeating the ticks", () => {
    renderPage();
    expect(describedPosition()).toBe("1 of 3");
    fireEvent.click(storyTabs()[1]!);
    expect(describedPosition()).toBe("2 of 3");
    // The ticks are a picture of the same fact: hidden from assistive technology, not focusable.
    expect(progress()!.querySelector("ol")?.getAttribute("aria-hidden")).toBe("true");
    expect(progress()!.querySelectorAll("a, button, [tabindex]")).toHaveLength(0);
  });

  it("carries no playback or timing meaning", () => {
    renderPage();
    const marker = progress()!;
    expect(within(marker).queryByRole("progressbar")).toBeNull();
    expect(marker.querySelector("[aria-valuenow]")).toBeNull();
    expect(marker.textContent).not.toMatch(/\d+:\d\d|\bmin|\bsec|%/i);
  });

  it("is absent when there is only one story concept", () => {
    renderPage(landingContent((draft) => {
      draft.episodes = [draft.episodes[0]!];
    }));
    expect(episodes()).toBeTruthy();
    expect(progress()).toBeNull();
    expect(episodes().textContent).not.toContain("1 of 1");
    expect(within(episodes()).getByRole("tabpanel").hasAttribute("aria-describedby")).toBe(false);
  });
});
