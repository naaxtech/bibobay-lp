import { defineConfig, defineSingleton } from "sanity";
import { structureTool } from "sanity/structure";
import { presentationTool } from "sanity/presentation";
import { schemaTypes } from "./schemaTypes";
import { SINGLETON_IDS, structure } from "./structure";
import { locations, mainDocuments } from "./presentation/resolve";

const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
const dataset = process.env.SANITY_STUDIO_DATASET;
if (!projectId || !dataset) throw new Error("Set verified SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET before running Studio.");

// The public preview origin is optional until the Next preview integration is wired.
const previewUrl = process.env.SANITY_STUDIO_PREVIEW_URL;
if (previewUrl && (!/^https:\/\//.test(previewUrl) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(previewUrl))) {
  throw new Error("SANITY_STUDIO_PREVIEW_URL must be HTTPS or local development.");
}

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
    ...(previewUrl ? [presentationTool({ previewUrl, resolve: { mainDocuments, locations } })] : []),
  ],
});
