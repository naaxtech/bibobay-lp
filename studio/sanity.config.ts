import { defineConfig, defineSingleton } from "sanity";
import { structureTool } from "sanity/structure";
import { presentationTool } from "sanity/presentation";
import { schemaTypes } from "./schemaTypes";
import { SINGLETON_IDS, structure } from "./structure";
import { locations, mainDocuments } from "./presentation/resolve";

const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
const dataset = process.env.SANITY_STUDIO_DATASET;
if (!projectId || !dataset) throw new Error("Set verified SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET before running Studio.");

// The public website origin Presentation previews. Optional: without it the Presentation tool is not added.
const previewUrl = process.env.SANITY_STUDIO_PREVIEW_URL;
if (previewUrl && (!/^https:\/\//.test(previewUrl) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(previewUrl))) {
  throw new Error("SANITY_STUDIO_PREVIEW_URL must be HTTPS or local development.");
}

/** The website's route that turns draft mode on for Presentation (app/api/draft-mode/enable/route.ts). */
const DRAFT_MODE_ENABLE_PATH = "/api/draft-mode/enable";

export default defineConfig({
  name: "bibobay",
  title: "BIBO Bay Studio",
  projectId,
  dataset,
  document: {
    singletons: SINGLETON_IDS.map((id) => defineSingleton({ documentId: id, schemaType: id })),
  },
  schema: { types: schemaTypes },
  plugins: [
    structureTool({ structure }),
    // `previewMode.enable` is the site's draft-mode route (app/api/draft-mode/enable, ruling R33): Presentation opens it
    // with a one-time secret, and the site then serves drafts. Without it the preview would show published content.
    // src: sanity/presentation PreviewUrlOption · sanity 6.17.0 · 2026-10-16
    ...(previewUrl ? [presentationTool({ previewUrl: { origin: previewUrl, previewMode: { enable: DRAFT_MODE_ENABLE_PATH } }, resolve: { mainDocuments, locations } })] : []),
  ],
});
