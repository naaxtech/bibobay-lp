import { afterEach, describe, expect, it } from "vitest";

import { classifyClick } from "@/lib/analytics/classify";

/** What a click means, read from the page itself: no tracking attributes to keep in step. */
afterEach(() => {
  document.body.innerHTML = "";
});

const mount = (html: string) => {
  document.body.innerHTML = html;
};
const el = (selector: string) => document.querySelector(selector)!;

describe("classifyClick", () => {
  it("tells channel, subscribe and video links to YouTube apart, with the section they sit in", () => {
    mount(`
      <header><a id="sub" href="https://www.youtube.com/channel/UCFruHuRQ2eOrq9NOyx0K1GA?sub_confirmation=1"><svg data-youtube-mark></svg>Subscribe on YouTube<span class="sr-only"> (opens in a new tab)</span></a></header>
      <section data-section="hero"><a id="channel" href="https://www.youtube.com/@bibobay-tv">Watch on YouTube</a></section>
      <section data-section="episodes"><a id="video" href="https://www.youtube.com/watch?v=3birY6XZ3_c"><span class="storybook__play"></span><span id="inner">Watch on YouTube</span></a></section>`);
    expect(classifyClick(el("#sub"))).toEqual({ event: "youtube_clicked", properties: { kind: "subscribe", section: "header", label: "Subscribe on YouTube" } });
    expect(classifyClick(el("#channel"))).toEqual({ event: "youtube_clicked", properties: { kind: "channel", section: "hero", label: "Watch on YouTube" } });
    expect(classifyClick(el("#inner"))).toEqual({ event: "youtube_clicked", properties: { kind: "video", video_id: "3birY6XZ3_c", section: "episodes", label: "Watch on YouTube" } });
  });

  it("counts a download of a file this site serves", () => {
    mount(`<section data-section="lead"><a id="pack" href="/freebies/bibo-bay-activity-pack.pdf" download><svg></svg>Download the free pack<span class="sr-only">: Bibo Bay Activity Pack</span></a></section>`);
    expect(classifyClick(el("#pack"))).toEqual({ event: "freebie_downloaded", properties: { file: "/freebies/bibo-bay-activity-pack.pdf", section: "lead", label: "Download the free pack: Bibo Bay Activity Pack" } });
  });

  it("records other links as calls to action with where they lead", () => {
    mount(`
      <section data-section="hero"><a id="anchor" href="#characters">Meet Tula, Bob &amp; Lumi</a></section>
      <footer><a id="privacy" href="/privacy">Privacy</a><a id="mail" href="mailto:hello@bibobay.example">hello@bibobay.example</a></footer>`);
    expect(classifyClick(el("#anchor"))).toEqual({ event: "cta_clicked", properties: { destination: "anchor", section: "hero", label: "Meet Tula, Bob & Lumi" } });
    expect(classifyClick(el("#privacy"))).toEqual({ event: "cta_clicked", properties: { destination: "internal", section: "footer", label: "Privacy" } });
    // A mail link names an address: it is not counted at all.
    expect(classifyClick(el("#mail"))).toBeNull();
  });

  it("counts a chosen tab, an opened question and the menu, and ignores plain clicks", () => {
    mount(`
      <section data-section="characters"><div role="tablist"><button id="tab" role="tab" aria-selected="false"><img alt="" />Bob the Fish</button></div></section>
      <section data-section="faq"><details id="d0" open><summary id="q0" class="faq-item__question">What is BIBO Bay?</summary></details><details id="d1"><summary id="q1" class="faq-item__question">Is it free?</summary></details></section>
      <header><button id="menu" class="menu-button" aria-haspopup="dialog">Menu</button></header>
      <p id="plain">Just words</p>`);
    expect(classifyClick(el("#tab"))).toEqual({ event: "tab_selected", properties: { section: "characters", label: "Bob the Fish" } });
    expect(classifyClick(el("#q1"))).toEqual({ event: "faq_opened", properties: { index: 1, section: "faq" } });
    // Closing an open question is not "opened".
    expect(classifyClick(el("#q0"))).toBeNull();
    expect(classifyClick(el("#menu"))).toEqual({ event: "menu_opened", properties: { section: "header" } });
    expect(classifyClick(el("#plain"))).toBeNull();
  });
});

describe("classifier edges (review M13)", () => {
  it("treats only the site's own pack names as a free download, like the CMS rule", () => {
    document.body.innerHTML = `<section data-section="lead"><a id="odd" href="/freebies/Pack_1.pdf">Pack</a><a id="ok" href="/freebies/bibo-bay-activity-pack.pdf">Pack</a></section>`;
    expect(classifyClick(document.getElementById("odd")!)?.event).toBe("cta_clicked");
    expect(classifyClick(document.getElementById("ok")!)?.event).toBe("freebie_downloaded");
  });

  it("does not count a click on the tab that is already showing", () => {
    document.body.innerHTML = `<section data-section="characters"><button role="tab" aria-selected="true" id="on">Tula</button><button role="tab" aria-selected="false" id="off">Bob</button></section>`;
    expect(classifyClick(document.getElementById("on")!)).toBeNull();
    expect(classifyClick(document.getElementById("off")!)?.event).toBe("tab_selected");
  });
});
