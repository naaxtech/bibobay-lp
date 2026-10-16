import { DOWNLOAD_ROUTE, FREEBIE_PATH } from "../content/freebie-path";
import type { AnalyticsEvent, AnalyticsProperties } from "./events";

/**
 * What a click on the page means, read from the page itself (ruling R70): links to YouTube, the
 * free download, calls to action, tabs, questions and the menu. No tracking attributes to keep in
 * step with the markup; the section comes from the nearest `[data-section]` landmark.
 */
export interface ClassifiedClick {
  event: AnalyticsEvent;
  properties: AnalyticsProperties;
}

const NEW_TAB_NOTE = /\s*\(opens in a new tab\)\s*$/;

/** Where on the page an element sits. */
export function sectionOf(element: Element): string {
  const section = element.closest<HTMLElement>("[data-section]")?.dataset.section;
  if (section) return section;
  if (element.closest("[role='dialog']")) return "menu";
  if (element.closest("header")) return "header";
  if (element.closest("footer")) return "footer";
  return "page";
}

/** The words an element shows (with any "(opens in a new tab)" note removed). */
function label(element: Element): string {
  const text = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.replace(NEW_TAB_NOTE, "").trim().slice(0, 80);
}

function youtube(url: URL): { kind: string; video_id?: string } | null {
  if (url.protocol !== "https:" || !(url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com") || url.hostname === "youtu.be")) return null;
  if (url.searchParams.get("sub_confirmation") === "1") return { kind: "subscribe" };
  const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : null;
  return id && /^[\w-]{11}$/.test(id) ? { kind: "video", video_id: id } : { kind: "channel" };
}

function classifyLink(link: HTMLAnchorElement): ClassifiedClick | null {
  const href = link.getAttribute("href") ?? "";
  const section = sectionOf(link);
  const words = label(link);
  if (href.startsWith("#")) return { event: "cta_clicked", properties: { destination: "anchor", section, label: words } };
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return null;
  const video = youtube(url);
  if (video) return { event: "youtube_clicked", properties: { ...video, section, label: words } };
  // The signed route carries a secret token in its query string: only the pathname is ever recorded (R140).
  if (url.origin === window.location.origin && (FREEBIE_PATH.test(url.pathname) || url.pathname === DOWNLOAD_ROUTE)) {
    return { event: "freebie_downloaded", properties: { file: url.pathname, section, label: words } };
  }
  const destination = url.origin === window.location.origin ? "internal" : "external";
  return { event: "cta_clicked", properties: { destination, section, label: words } };
}

export function classifyClick(target: Element): ClassifiedClick | null {
  const tab = target.closest("[role='tab']");
  if (tab) {
    // Clicking the tab already showing changes nothing, so it is not counted.
    if (tab.getAttribute("aria-selected") === "true") return null;
    return { event: "tab_selected", properties: { section: sectionOf(tab), label: label(tab) } };
  }
  const question = target.closest("summary");
  if (question) {
    const details = question.parentElement;
    if (!(details instanceof HTMLDetailsElement) || details.open) return null;
    const list = details.parentElement ? Array.from(details.parentElement.querySelectorAll(":scope > details")) : [details];
    return { event: "faq_opened", properties: { index: list.indexOf(details), section: sectionOf(details) } };
  }
  const menu = target.closest("button[aria-haspopup='dialog']");
  if (menu) return { event: "menu_opened", properties: { section: sectionOf(menu) } };
  const link = target.closest("a[href]");
  return link instanceof HTMLAnchorElement ? classifyLink(link) : null;
}
