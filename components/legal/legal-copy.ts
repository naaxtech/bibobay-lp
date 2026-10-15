/**
 * Interface copy for the legal, thank-you and preview chrome (Task 9 rulings R30, R31, R33). Like
 * components/landing/ui-copy.ts, this holds page titles, labels and status lines only; legal text
 * itself comes from Sanity `legalSettings`, or from lib/content/legal-fallback.ts until it exists.
 */
export const LEGAL_PAGE_COPY = {
  privacy: {
    title: "Privacy",
    description: "How BIBO Bay handles the details you share through this website.",
  },
  terms: {
    title: "Terms",
    description: "The terms for using the BIBO Bay website while it is being built.",
  },
  /** Shown above repository fallback text, so nobody mistakes it for reviewed legal wording. */
  fallbackNote:
    "This page describes what this website currently does. It has not yet been reviewed by a lawyer, and it will be replaced by reviewed text.",
  /** Shown with Sanity text that carries a version number. */
  version: (version: string) => `Version ${version}`,
  /** Lead-in for the configured contact address on the privacy page. */
  contactLead: "You can also write to",
} as const;

/**
 * Ruling R31: the lead form reports its own result inline and never sends anyone here, so a visit
 * proves nothing. This page explains the list and points to the form; it never says the visitor joined.
 */
export const THANK_YOU_COPY = {
  title: "About the founding-family list",
  description: "What joining the BIBO Bay founding-family list means.",
  paragraphs: [
    "The founding-family list is how BIBO Bay shares news with adults while the story world is being developed.",
    "The form on the home page tells you straight away whether your details were saved. If it showed a confirmation, there is nothing more to do.",
    "If you are not sure it worked, or you have not signed up yet, you can use the form again. Signing up twice with the same email address changes nothing.",
    "You can ask to be removed at any time by replying to any BIBO Bay email.",
  ],
  backToForm: "Go to the founding-family form",
  backHome: "Back to the home page",
} as const;

/** Ruling R33: editors previewing unpublished drafts always see that they are, and can leave. */
/** The page for an address the site does not have (app/not-found.tsx, review I2). */
export const NOT_FOUND_COPY = {
  title: "This page is not here",
  paragraphs: [
    "The link may be mistyped, or the page may have moved. Tula, Bob and Lumi are waiting on the home page, and every adventure is free to watch on YouTube.",
  ],
  backHome: "Back to the home page",
  watch: "Watch on YouTube",
} as const;

export const PREVIEW_COPY = {
  notice: "Preview: you are seeing unpublished drafts.",
  exit: "Exit preview",
} as const;
