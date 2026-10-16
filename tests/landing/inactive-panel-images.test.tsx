import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import { landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

afterEach(() => {
  cleanup();
});

const section = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`section #${id} is not rendered`);
  return element;
};

/** Every panel of a tabbed section, chosen or not (the unchosen ones are inert and aria-hidden). */
const panels = (id: string) => Array.from(section(id).querySelectorAll<HTMLElement>('[role="tabpanel"]'));

/** The big art of a panel: a video cover or a friend's still, not the small tab thumbnails. */
const stageImages = (panel: HTMLElement) => panel.querySelectorAll("img").length;

/*
 * Task 4 carry (final review P-M2 follow-up): every panel stays laid out in one grid cell, so a lazy
 * image in an unchosen panel still loads once the section nears (about 0.4 MB of video covers on a
 * phone). The big art of a panel is therefore rendered only once the panel has been chosen.
 */
describe.each([
  ["episodes", 7],
  ["characters", 3],
])("%s: the art of unchosen panels", (id, count) => {
  it("is not rendered until the panel is chosen", () => {
    render(<LandingPage content={landingContent()} settings={siteSettings()} />);
    const all = panels(id);
    expect(all).toHaveLength(count);
    expect(stageImages(all[0]!), "the chosen panel shows its art at once").toBeGreaterThan(0);
    for (const panel of all.slice(1)) expect(stageImages(panel), "an unchosen panel loads nothing").toBe(0);
  });

  it("appears when the panel is chosen and stays once it has been seen", () => {
    render(<LandingPage content={landingContent()} settings={siteSettings()} />);
    const tabs = within(section(id)).getAllByRole("tab");
    fireEvent.click(tabs[1]!);
    expect(stageImages(panels(id)[1]!)).toBeGreaterThan(0);
    expect(stageImages(panels(id)[2]!)).toBe(0);
    fireEvent.click(tabs[0]!);
    expect(stageImages(panels(id)[1]!), "left behind, not reloaded").toBeGreaterThan(0);
  });
});
