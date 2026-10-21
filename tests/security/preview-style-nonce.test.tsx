import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewBoundary } from "@/components/preview/PreviewBoundary";
import { STYLE_NONCE_META, shareStyleNonce } from "@/components/preview/style-nonce";

/*
 * Ruling R169: the site's CSP allows a <style> element only with the request's nonce
 * (`style-src-elem 'self' 'nonce-…'`, R34). Visual Editing draws its overlays with styled-components,
 * which reads the nonce from <meta property="csp-nonce">; without it every overlay style is blocked,
 * styled-components throws (its error 17) and the preview fell over to the error page. The nonce is
 * copied from Next's own scripts, in the browser, only inside the Studio's chunk.
 */

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function nextScript(nonce: string) {
  const script = document.createElement("script");
  script.setAttribute("nonce", nonce);
  document.body.append(script);
}

describe("the overlay's style nonce (R169)", () => {
  it("copies the nonce Next stamped on its scripts into the meta styled-components reads", () => {
    nextScript("abc123+/==");
    expect(shareStyleNonce(document)).toBe("abc123+/==");
    const meta = document.head.querySelectorAll<HTMLMetaElement>(STYLE_NONCE_META);
    expect(meta).toHaveLength(1);
    expect(meta[0]!.nonce || meta[0]!.getAttribute("nonce")).toBe("abc123+/==");
  });

  it("adds one meta however often it runs", () => {
    nextScript("abc123");
    shareStyleNonce(document);
    shareStyleNonce(document);
    expect(document.head.querySelectorAll(STYLE_NONCE_META)).toHaveLength(1);
  });

  it("adds nothing without a nonce, or with a value that is not a nonce", () => {
    expect(shareStyleNonce(document)).toBeNull();
    nextScript("not a nonce\"><script>");
    expect(shareStyleNonce(document)).toBeNull();
    expect(document.head.querySelectorAll(STYLE_NONCE_META)).toHaveLength(0);
  });

  it("styled-components stamps that nonce on the style elements it injects", async () => {
    nextScript("n0nce");
    shareStyleNonce(document);
    vi.resetModules();
    const { default: styled } = await import("styled-components");
    const Box = styled.div`
      color: rgb(1, 2, 3);
    `;
    render(<Box>overlay</Box>);
    const styles = Array.from(document.head.querySelectorAll("style[data-styled]"));
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((style) => style.getAttribute("nonce") === "n0nce")).toBe(true);
  });
});

describe("the overlay never takes the page down (R169)", () => {
  it("renders nothing in place of an overlay that throws, and keeps its siblings", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("styled-components error 17");
    }
    render(
      <main>
        <h1>Page</h1>
        <PreviewBoundary>
          <Broken />
        </PreviewBoundary>
      </main>,
    );
    expect(screen.getByRole("heading", { name: "Page" })).toBeDefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
