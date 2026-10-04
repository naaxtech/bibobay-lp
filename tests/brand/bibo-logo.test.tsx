import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BiboLogo } from "@/components/brand/BiboLogo";
import { readSvg, viewBoxOf } from "./svg-geometry";

afterEach(() => {
  cleanup();
});

describe("BiboLogo", () => {
  it("renders the canonical file rather than inline geometry", () => {
    const { container } = render(<BiboLogo />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/bibo-logo.svg");
    expect(container.querySelector("svg, path")).toBeNull();
  });

  it("uses the derived files for the mark and monochrome variants", () => {
    const { rerender } = render(<BiboLogo variant="mark" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/brand/bibo-mark.svg");
    rerender(<BiboLogo variant="monochrome" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/brand/bibo-logo-monochrome.svg");
  });

  it("declares each file's own intrinsic size so the layout never jumps", () => {
    for (const variant of ["full", "mark", "monochrome"] as const) {
      const { unmount } = render(<BiboLogo variant={variant} />);
      const image = screen.getByRole("img");
      const [, , w, h] = viewBoxOf(readSvg(join("public", image.getAttribute("src") ?? "")));
      expect([Number(image.getAttribute("width")), Number(image.getAttribute("height"))], variant).toEqual([w, h]);
      unmount();
    }
  });

  it("is announced as BIBO when it stands alone", () => {
    render(<BiboLogo />);
    expect(screen.getByRole("img", { name: "BIBO" })).toBeTruthy();
  });

  it("stays silent when it sits beside visible brand text", () => {
    const { container } = render(<BiboLogo decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("shows the tagline as real text only when asked", () => {
    const { rerender } = render(<BiboLogo />);
    expect(screen.queryByText("Bright minds. Kind hearts. Better humans.")).toBeNull();
    rerender(<BiboLogo showTagline />);
    expect(screen.getByText("Bright minds. Kind hearts. Better humans.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "BIBO" })).toBeTruthy();
  });

  it("loads eagerly at high fetch priority with priority and lazily otherwise", () => {
    const { rerender } = render(<BiboLogo />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("lazy");
    expect(screen.getByRole("img").getAttribute("fetchpriority")).toBeNull();
    rerender(<BiboLogo priority />);
    const image = screen.getByRole("img");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.getAttribute("fetchpriority")).toBe("high");
  });

  it("passes className to its outer element", () => {
    const { container } = render(<BiboLogo className="site-logo" />);
    expect(container.firstElementChild?.classList.contains("site-logo")).toBe(true);
  });
});
