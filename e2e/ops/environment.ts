/*
 * Which kind of server a browser run is pointed at (final review O-I3).
 *
 * The default is the KEYLESS production server of docs/qa-checklist.md section 2: no Supabase, no
 * Sanity project, no email. Staff routes answer "not configured" (503), readiness answers 503, and the
 * staff pages show the unconfigured notice.
 *
 * `E2E_CONFIGURED=1` says the server under test has Supabase (and the lead storage secrets) configured,
 * as a Vercel preview does after Task 11: the same routes then answer from the live checks (401 for a
 * signed-out staff request, 400 for a bad sign-in body, a redirect to sign-in for the staff pages,
 * readiness 200). The specs that assume keyless answers branch on this one flag and cite the route code
 * for each configured expectation. Email may or may not be configured; nothing here depends on it.
 */
export const CONFIGURED = process.env.E2E_CONFIGURED === "1";
