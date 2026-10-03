import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";
import Home from "@/app/page";
import { verifyEnvironment } from "@/scripts/verify-env";

afterEach(() => {
  cleanup();
});

describe("root page", () => {
  it("renders a single meaningful BIBO level-one heading", () => {
    render(<Home />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toMatch(/BIBO/);
  });

  it("states the brand idea without unsupported claims", () => {
    const { container } = render(<Home />);
    const text = container.textContent ?? "";
    expect(text).toContain("Bright minds. Kind hearts. Better humans.");
    // No fabricated social proof, counts, experts, testimonials or dates.
    expect(text).not.toMatch(/\d[\d,.]*\s*\+?\s*(families|parents|users|kids|children|downloads)/i);
    expect(text).not.toMatch(/testimonial|expert|trusted by|award|coming (in|on) \d/i);
  });

  it("renders inside a main landmark", () => {
    render(<Home />);
    expect(screen.getByRole("main")).toBeTruthy();
  });
});

describe("root metadata", () => {
  it("uses the BIBO title", () => {
    const title = typeof metadata.title === "string" ? metadata.title : JSON.stringify(metadata.title);
    expect(title).toMatch(/BIBO/);
  });

  it("does not carry unsupported skeleton metadata", () => {
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toMatch(/trusted children/i);
    expect(serialized).not.toMatch(/AI Studio|Gemini/i);
    expect(serialized).not.toMatch(/react-example/i);
    // Large-image twitter card without a real image is unsupported until assets exist.
    expect(serialized).not.toMatch(/summary_large_image/);
  });
});

describe("verifyEnvironment", () => {
  it("passes an empty environment in development", () => {
    const report = verifyEnvironment({}, "development");
    expect(report.ok).toBe(true);
    expect(report.phase).toBe("development");
    expect(report.errors).toEqual([]);
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SANITY_REVALIDATE_SECRET",
    "NEXT_PUBLIC_SANITY_API_READ_TOKEN",
    "NEXT_PUBLIC_SANITY_WRITE_TOKEN",
    "NEXT_PUBLIC_RESEND_API_KEY",
    "NEXT_PUBLIC_PRIVATE_KEY",
    "NEXT_PUBLIC_CRON_SECRET",
  ])("rejects server secret name %s under NEXT_PUBLIC_", (name) => {
    const report = verifyEnvironment({ [name]: "super-sensitive-value-123" }, "production");
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain(name);
    expect(report.errors.join("\n")).toContain(name);
  });

  it("rejects a Supabase secret key value exposed under a public name", () => {
    const report = verifyEnvironment(
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abcdef0123456789" },
      "production",
    );
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("rejects a server credential copied into an allowed public field", () => {
    const report = verifyEnvironment(
      {
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "copied-private-value",
        SUPABASE_SERVICE_ROLE_KEY: "copied-private-value",
      },
      "production",
    );
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(JSON.stringify(report)).not.toContain("copied-private-value");
  });

  it("allows legitimate public configuration", () => {
    const report = verifyEnvironment(
      {
        NEXT_PUBLIC_SANITY_PROJECT_ID: "abc123",
        NEXT_PUBLIC_SANITY_DATASET: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
        SUPABASE_SERVICE_ROLE_KEY: "server-only-value",
      },
      "production",
    );
    expect(report.ok).toBe(true);
    expect(report.forbiddenPublic).toEqual([]);
  });

  it("never includes secret values in the report", () => {
    const secret = ["fixture", "private", "value"].join("-");
    const report = verifyEnvironment(
      { NEXT_PUBLIC_RESEND_API_KEY: secret, RESEND_API_KEY: secret },
      "production",
    );
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("rejects an unknown phase", () => {
    expect(() => verifyEnvironment({}, "staging" as never)).toThrow(/phase/i);
  });
});
