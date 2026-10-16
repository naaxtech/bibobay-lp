import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BayBackdrop } from "@/components/brand/BayBackdrop";
import { brandTokens } from "@/lib/brand/tokens";

afterEach(() => {
  cleanup();
});

const renderBackdrop = (className?: string) => {
  const { container } = render(<BayBackdrop className={className} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("BayBackdrop did not render an svg");
  return svg;
};

describe("BayBackdrop", () => {
  it("is decorative and hidden from assistive technology", () => {
    const svg = renderBackdrop();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title, desc, text")).toBeNull();
    expect(svg.textContent?.trim()).toBe("");
  });

  it("stacks cut-paper layers from the far sun to the near shore", () => {
    const layers = Array.from(renderBackdrop().querySelectorAll("[data-bay-layer]"));
    expect(layers.map((layer) => layer.getAttribute("data-bay-layer"))).toEqual([
      "sun",
      "clouds",
      "far-sea",
      "mid-sea",
      "near-sea",
      "shore",
    ]);
    const depths = layers.map((layer) => Number(layer.getAttribute("data-depth")));
    expect(depths.every((depth) => depth > 0 && depth <= 1)).toBe(true);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(new Set(depths).size).toBe(depths.length);
  });

  it("paints only with brand palette colours", () => {
    const palette = new Set<string>(Object.values(brandTokens.color));
    const painted = Array.from(renderBackdrop().querySelectorAll("*")).flatMap((element) =>
      ["fill", "stroke"].map((name) => element.getAttribute(name)?.toLowerCase()).filter((value) => value && value !== "none"),
    );
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.filter((colour) => !palette.has(colour!))).toEqual([]);
  });

  it("starts fully visible so motion can never hide it", () => {
    for (const element of Array.from(renderBackdrop().querySelectorAll("*")) as SVGElement[]) {
      expect(element.getAttribute("opacity")).not.toBe("0");
      expect(element.style.opacity).not.toBe("0");
      expect(element.style.visibility).not.toBe("hidden");
      expect(element.style.display).not.toBe("none");
    }
  });

  it("covers its container from the bottom edge", () => {
    expect(renderBackdrop().getAttribute("preserveAspectRatio")).toBe("xMidYMax slice");
  });

  it("passes className to its root element", () => {
    expect(renderBackdrop("hero-bay").classList.contains("hero-bay")).toBe(true);
  });
});
