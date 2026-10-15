import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import { Dialog } from "@/components/ui/Dialog";
import type { LandingPageContent, SectionId, SiteSettings } from "@/lib/content/types";
import { landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

afterEach(() => {
  cleanup();
});

function renderPage(content: LandingPageContent = landingContent(), settings: SiteSettings = siteSettings()) {
  return render(<LandingPage content={content} settings={settings} />);
}

const section = (id: SectionId) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`section #${id} is not rendered`);
  return element;
};

const visiblePanelHeading = (id: SectionId) =>
  within(within(section(id)).getByRole("tabpanel")).getByRole("heading", { level: 3 }).textContent;

describe("landmarks and headings", () => {
  it("has one banner, main and contentinfo, and names each navigation region distinctly", () => {
    renderPage();
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    const names = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.every((name) => !!name?.trim())).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has exactly one h1, the hero title, and never skips a heading level", () => {
    renderPage();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s.map((heading) => heading.textContent)).toEqual([landingContent().hero.title]);
    const levels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((heading) => Number(heading.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((level, index) => expect(level - levels[index]!, `heading #${index + 2}`).toBeLessThanOrEqual(1));
  });

  it("labels every section by a heading inside it", () => {
    renderPage();
    const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    expect(roots).toHaveLength(11);
    for (const root of roots) {
      const heading = document.getElementById(root.getAttribute("aria-labelledby") ?? "");
      expect(heading, root.id).not.toBeNull();
      expect(root.contains(heading), root.id).toBe(true);
      expect(heading!.tagName, root.id).toMatch(/^H[12]$/);
    }
  });

  it("keeps a single h1 named for the site when the CMS hides the hero", () => {
    renderPage(landingContent((draft) => {
      for (const entry of draft.sections) if (entry.id === "hero") entry.visible = false;
    }));
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["BIBO Bay"]);
  });

  it("never renders an empty navigation landmark or a Menu with nowhere to go", () => {
    const hide = (ids: SectionId[]) => landingContent((draft) => {
      for (const entry of draft.sections) if (ids.includes(entry.id)) entry.visible = false;
    });
    const { unmount } = renderPage(hide(["characters", "episodes"]));
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    // The founding-family call to action still lives in the menu.
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Menu" })).toBeTruthy();
    unmount();
    renderPage(hide(["characters", "episodes", "lead"]));
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Menu" })).toBeNull();
  });

  it("starts with a skip link to the main content", () => {
    renderPage();
    const first = document.querySelector("a[href]");
    expect(first?.textContent).toBe("Skip to content");
    expect(first?.getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");
  });
});

describe("character selector", () => {
  const friends = landingContent().characters;
  const last = friends.length - 1;
  const characterTabs = () =>
    within(within(section("characters")).getByRole("tablist", { name: landingContent().charactersIntro.heading })).getAllByRole("tab");

  it("names each friend's tab with name and role, and a status only for an unfinished concept", () => {
    renderPage();
    const names = characterTabs().map((tab) => tab.textContent?.replace(/\s+/g, " ").trim());
    expect(names).toEqual(["Tula the Turtle The fruit finder", "Bob the Fish The little spotter", "Lumi The song and dance friend"]);
    expect(screen.getByRole("tab", { name: "Tula the Turtle The fruit finder" })).toBe(characterTabs()[0]);
  });

  it("still stamps a friend the CMS marks as an unfinished concept", () => {
    renderPage(landingContent((draft) => { draft.characters[0]!.status = "concept"; }));
    expect(characterTabs()[0]!.textContent).toContain("Concept");
    expect(within(within(section("characters")).getByRole("tabpanel")).getByText("Concept")).toBeTruthy();
  });

  it("selects the first friend and ties every tab to its own panel", () => {
    renderPage();
    characterTabs().forEach((tab, index) => {
      expect(tab.getAttribute("aria-selected")).toBe(index === 0 ? "true" : "false");
      expect(tab.tabIndex).toBe(index === 0 ? 0 : -1);
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel?.hasAttribute("inert"), "only the chosen friend can be reached").toBe(index !== 0);
    });
    expect(visiblePanelHeading("characters")).toBe(friends[0]!.name);
    expect(within(within(section("characters")).getByRole("tabpanel")).queryByText("Concept"), "published friends carry no concept stamp").toBeNull();
  });

  it("moves selection and focus with the arrow keys, wrapping at both ends", () => {
    renderPage();
    const tabs = characterTabs();
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("false");
    expect(tabs[0]!.tabIndex).toBe(-1);
    expect(visiblePanelHeading("characters")).toBe(friends[1]!.name);

    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[last]);
    expect(visiblePanelHeading("characters")).toBe(friends[last]!.name);

    fireEvent.keyDown(tabs[last]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(tabs[last]);
  });

  it("jumps to the first and last friend with Home and End", () => {
    renderPage();
    const tabs = characterTabs();
    tabs[1]!.focus();
    fireEvent.keyDown(tabs[1]!, { key: "End" });
    expect(document.activeElement).toBe(tabs[last]);
    expect(tabs[last]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[last]!, { key: "Home" });
    expect(document.activeElement).toBe(tabs[0]);
    expect(visiblePanelHeading("characters")).toBe(friends[0]!.name);
  });

  it("selects a friend on click", () => {
    renderPage();
    fireEvent.click(characterTabs()[2]!);
    expect(characterTabs()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(visiblePanelHeading("characters")).toBe("Lumi");
  });

  it("draws an abstract placeholder rather than pretend character art", () => {
    renderPage();
    const panel = within(section("characters")).getByRole("tabpanel");
    expect(panel.querySelector("img")).toBeNull();
    const art = panel.querySelector("svg");
    expect(art?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("video selector", () => {
  const videos = landingContent().episodes;
  const storyTabs = () =>
    within(within(section("episodes")).getByRole("tablist", { name: landingContent().episodesIntro.heading })).getAllByRole("tab");

  it("names each video tab by its title, and marks only an unfinished story as a concept", () => {
    renderPage();
    expect(storyTabs().map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual(videos.map((video) => video.title));
    expect(visiblePanelHeading("episodes")).toBe(videos[0]!.title);
  });

  it("still marks a story the CMS keeps as a concept", () => {
    renderPage(landingContent((draft) => { draft.episodes[0]!.status = "concept"; }));
    expect(storyTabs()[0]!.textContent?.replace(/\s+/g, " ").trim()).toBe(`${videos[0]!.title} Story concept`);
  });

  it("moves through the videos with the arrow keys and links out to YouTube instead of playing in the page", () => {
    renderPage();
    const tabs = storyTabs();
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(visiblePanelHeading("episodes")).toBe(videos[1]!.title);
    fireEvent.keyDown(tabs[1]!, { key: "End" });
    expect(visiblePanelHeading("episodes")).toBe(videos[videos.length - 1]!.title);
    const panel = within(section("episodes")).getByRole("tabpanel");
    expect(within(panel).queryByRole("button")).toBeNull();
    expect(panel.querySelector("video, audio, iframe")).toBeNull();
    const watch = within(panel).getByRole("link", { name: /watch/i });
    expect(watch.getAttribute("href")).toBe(videos[videos.length - 1]!.mediaUrl);
    expect(watch.getAttribute("target")).toBe("_blank");
    expect(watch.getAttribute("rel")).toContain("noopener");
  });
});

/*
 * Spec §7 "no layout jump": every panel of a selector stays laid out (the stage is as tall as its
 * tallest panel), so choosing another one cannot change the page's height. Only the chosen panel is
 * shown, reachable from the keyboard or announced; the rest are inert and hidden from assistive
 * technology, which is what the `hidden` attribute used to do while also taking them out of layout.
 */
describe("tab panels of both selectors", () => {
  const panelsOf = (id: SectionId) => Array.from(section(id).querySelectorAll<HTMLElement>("[role='tabpanel']"));

  it.each(["characters", "episodes"] as const)("%s: keeps every panel laid out and exposes only the chosen one", (id) => {
    renderPage();
    const tabs = within(section(id)).getAllByRole("tab");
    const expectChosen = (selected: number) => {
      const panels = panelsOf(id);
      expect(panels).toHaveLength(tabs.length);
      panels.forEach((panel, index) => {
        const chosen = index === selected;
        const which = `${id} panel ${index + 1} with tab ${selected + 1} chosen`;
        expect(panel.hidden, `${which}: stays in the layout`).toBe(false);
        expect(panel.hasAttribute("inert"), `${which}: inert`).toBe(!chosen);
        expect(panel.getAttribute("aria-hidden"), `${which}: aria-hidden`).toBe(chosen ? null : "true");
        expect(panel.tabIndex, `${which}: tab stop`).toBe(chosen ? 0 : -1);
        expect(panel.querySelector("h3")?.textContent, `${which}: content is rendered`).toBeTruthy();
      });
      expect(within(section(id)).getAllByRole("tabpanel"), "assistive technology sees the chosen panel only").toEqual([panels[selected]]);
    };

    expectChosen(0);
    fireEvent.click(tabs[2]!);
    expectChosen(2);
    tabs[2]!.focus();
    fireEvent.keyDown(tabs[2]!, { key: "ArrowLeft" });
    expectChosen(1);
    fireEvent.keyDown(tabs[1]!, { key: "Home" });
    expectChosen(0);
  });
});

describe("FAQ accordion", () => {
  it("puts every question in a native disclosure that holds its answer", () => {
    const content = landingContent();
    renderPage(content);
    const items = Array.from(section("faq").querySelectorAll("details"));
    expect(items).toHaveLength(content.faqs.length);
    items.forEach((item, index) => {
      const summary = item.querySelector(":scope > summary");
      expect(summary?.textContent).toBe(content.faqs[index]!.question);
      expect(item.textContent).toContain(content.faqs[index]!.answer);
      // The browser owns the expanded state; a static aria-expanded would go stale without JS.
      expect(summary?.hasAttribute("aria-expanded")).toBe(false);
    });
  });

  it("opens the first answer and toggles each question on activation", () => {
    renderPage();
    const items = Array.from(section("faq").querySelectorAll("details"));
    expect(items.map((item) => item.open)).toEqual(landingContent().faqs.map((_, index) => index === 0));
    fireEvent.click(items[1]!.querySelector("summary")!);
    expect(items[1]!.open).toBe(true);
    fireEvent.click(items[0]!.querySelector("summary")!);
    expect(items[0]!.open).toBe(false);
  });
});

describe("Dialog", () => {
  function DialogHarness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open menu
        </button>
        <a href="#elsewhere">Behind the dialog</a>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
          title="Site menu"
        >
          <a href="#first">First stop</a>
          <button type="button">Last stop</button>
        </Dialog>
      </div>
    );
  }

  const openDialog = () => {
    const trigger = screen.getByRole("button", { name: "Open menu" });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: screen.getByRole("dialog", { name: "Site menu" }) };
  };

  it("renders nothing while closed", () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("First stop")).toBeNull();
  });

  it("opens as a labelled modal and moves focus inside", () => {
    render(<DialogHarness />);
    const { dialog } = openDialog();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("link", { name: "First stop" }));
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    render(<DialogHarness />);
    const { dialog } = openDialog();
    const first = within(dialog).getByRole("link", { name: "First stop" });
    const last = within(dialog).getByRole("button", { name: "Last stop" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape and returns focus to the element that opened it", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const { trigger } = openDialog();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("locks page scroll and makes the page behind it inert while open", () => {
    const { container } = render(<DialogHarness />);
    openDialog();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(container.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.documentElement.style.overflow).toBe("");
    expect(container.hasAttribute("inert")).toBe(false);
  });
});

describe("mobile navigation menu", () => {
  const menuButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Menu" });
  const openMenu = () => {
    const button = menuButton();
    button.focus();
    fireEvent.click(button);
    return { button, dialog: screen.getByRole("dialog", { name: "Menu" }) };
  };

  it("opens the site menu as a dialog holding every destination", () => {
    renderPage();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(menuButton().getAttribute("aria-haspopup")).toBe("dialog");
    const { button, dialog } = openMenu();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog).getByRole("link", { name: "Meet the friends" }).getAttribute("href")).toBe("#characters");
    expect(within(dialog).getByRole("link", { name: "Watch" }).getAttribute("href")).toBe("#episodes");
    expect(within(dialog).getByRole("link", { name: "Join the list" }).getAttribute("href")).toBe("#lead");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closes when a destination is chosen", () => {
    renderPage();
    const { dialog } = openMenu();
    fireEvent.click(within(dialog).getByRole("link", { name: "Watch" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from its Close button and on Escape, returning focus to Menu", () => {
    renderPage();
    const first = openMenu();
    fireEvent.click(within(first.dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(first.button);
    const second = openMenu();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(second.button);
  });
});
