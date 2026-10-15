import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReefBackdrop } from "@/components/brand/ReefBackdrop";
import { brandTokens } from "@/lib/brand/tokens";

afterEach(() => {
  cleanup();
});

const renderReef = (className?: string) => {
  const { container } = render(<ReefBackdrop className={className} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("ReefBackdrop did not render an svg");
  return svg;
};

describe("ReefBackdrop", () => {
  it("is decorative and hidden from assistive technology", () => {
    const svg = renderReef();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title, desc, text")).toBeNull();
    expect(svg.textContent?.trim()).toBe("");
  });

  it("stacks the sunlit reef from the far light rays to the near sand, each layer nearer than the last", () => {
    const layers = Array.from(renderReef().querySelectorAll("[data-bay-layer]"));
    expect(layers.map((layer) => layer.getAttribute("data-bay-layer"))).toEqual(["rays", "far-bubbles", "near-bubbles", "sand"]);
    const depths = layers.map((layer) => Number(layer.getAttribute("data-depth")));
    expect(depths.every((depth) => depth > 0 && depth <= 1)).toBe(true);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(new Set(depths).size).toBe(depths.length);
    // The sand is the ground everything stands on: it never drifts.
    expect(depths.at(-1)).toBe(1);
  });

  it("draws in brand colours only, with the front dune in the sand the next section is printed on", () => {
    const svg = renderReef();
    const palette = new Set<string>([...Object.values(brandTokens.color), "#ffffff"].map((value) => value.toLowerCase()));
    const fills = Array.from(svg.querySelectorAll("[fill]"), (shape) => shape.getAttribute("fill")!.toLowerCase());
    expect(fills.length).toBeGreaterThan(10);
    for (const fill of fills) expect(palette.has(fill), fill).toBe(true);
    const dunes = svg.querySelectorAll("[data-bay-layer='sand'] [data-dune]");
    expect(dunes.length).toBeGreaterThan(0);
    expect(dunes[dunes.length - 1]!.getAttribute("fill")).toBe(brandTokens.color.sand);
  });

  it("covers its box from the bottom edge, so the sand always meets the section below", () => {
    const svg = renderReef("absolute inset-0");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMax slice");
    expect(svg.getAttribute("class")).toContain("absolute inset-0");
    expect(svg.getAttribute("class")).toContain("reef-backdrop");
  });

  it("renders every layer fully visible, with no transform for motion to undo", () => {
    for (const layer of renderReef().querySelectorAll("[data-bay-layer]")) {
      expect(layer.hasAttribute("transform")).toBe(false);
      expect(layer.getAttribute("opacity")).toBeNull();
      expect(layer.getAttribute("style")).toBeNull();
    }
  });
});
