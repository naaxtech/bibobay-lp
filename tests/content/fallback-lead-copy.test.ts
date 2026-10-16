import { describe, expect, it } from "vitest";

import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

// R140: the free pack is gated behind the email signup, so the fallback copy may not say otherwise.
describe("fallback lead copy", () => {
  it("no longer promises a download without a sign-up", () => {
    const { lead } = SAFE_FALLBACK_CONTENT;
    expect(lead.description).not.toMatch(/no sign-up/i);
    expect(lead.description).toBe("Sign up with your email and the free activity pack is yours to download straight away. You'll also hear first about new adventures in the Bay.");
    expect(lead.description).not.toMatch(/email you|inbox/i);
    expect(lead.buttonLabel).toBe("Get the free pack");
  });

  it("answers the signup FAQ with the download button, not a denial", () => {
    const answer = SAFE_FALLBACK_CONTENT.faqs.find((item) => item.id === "signup")!.answer;
    expect(answer).toMatch(/download button/);
    expect(answer).not.toMatch(/does not guarantee an email or download/);
  });
});
