# BIBO Bay Studio

Standalone Sanity Studio 6.17.0; the website remains a separate Next.js application. Install and run from this directory with `npm install` and `npm run dev`.

1. Supply **verified** `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` in a local `.env` or deployment environment. Do not put a token in a `SANITY_STUDIO_*` variable; those values are exposed in the browser.
2. Configure Sanity CORS for the actual Studio and preview origins. Set `SANITY_STUDIO_PREVIEW_URL` to an HTTPS website origin (or local `http://localhost:3000`) to enable Presentation. Draft-mode routes and the site's visual-editing integration must be wired separately before draft preview will work end to end.
3. Run `npm run typecheck && npm run build`. The build does not create a Sanity project or publish the Studio.
4. Review `npm run seed -- --dry-run` first. To create missing editorial documents, set server-only `SANITY_WRITE_TOKEN` and run `npm run seed`. It uses `createIfNotExists`; it does **not** overwrite editor changes. The fixed singleton IDs are `siteSettings`, `landingPage`, and `legalSettings`.

Seed content is concept-only: six characters, three story concepts, six values and eight envisioned ecosystem extensions. Commerce, tracking, and testimonials default off. No social URLs, legal notice, media, files, products, testimonials or contact details are invented. Privacy and terms are intentionally empty pending legal review; do not index or present them as final notices.

The public catalogue holds **no prices**. Staff-controlled quotes and payment links belong in the protected operational system, not Sanity. The web application must enforce commerce gating server-side even if an editor enables its display flag.
