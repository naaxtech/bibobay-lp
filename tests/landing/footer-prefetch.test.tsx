import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Footer } from "@/components/landing/Footer";
import { siteSettings } from "./fixtures";

/** Props every `next/link` receives, recorded by a wrapper that still renders the real Link. */
const linkProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  const { createElement } = await import("react");
  const RealLink = actual.default;
  function RecordingLink(props: Parameters<typeof RealLink>[0]) {
    linkProps.push({ ...props });
    return createElement(RealLink, props);
  }
  return { ...actual, default: RecordingLink };
});

afterEach(() => {
  cleanup();
  linkProps.length = 0;
});

describe("footer legal links (Task 9, deferral from Task 4A)", () => {
  it("prefetch /privacy and /terms normally now that both pages exist", () => {
    render(<Footer settings={siteSettings()} />);
    const legal = linkProps.filter((props) => props.href === "/privacy" || props.href === "/terms");
    expect(legal.map((props) => props.href)).toEqual(["/privacy", "/terms"]);
    for (const props of legal) expect(props.prefetch, String(props.href)).toBeUndefined();
  });

  it("still never prefetches a CMS route this site may not have", () => {
    render(<Footer settings={siteSettings((s) => { s.footer.legalLinks = [...s.footer.legalLinks, { label: "Cookies", href: "/cookies" }]; })} />);
    expect(linkProps.find((props) => props.href === "/cookies")?.prefetch).toBe(false);
  });
});
