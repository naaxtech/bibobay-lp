import { createClient } from "@sanity/client";
import { buildSeedDocuments } from "./seed-data";

const dryRun = process.argv.includes("--dry-run");
const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
const dataset = process.env.SANITY_STUDIO_DATASET;
const token = process.env.SANITY_WRITE_TOKEN;
const documents = buildSeedDocuments();

if (dryRun) {
  console.info(`Dry run: ${documents.length} claim-safe documents; ${documents.map((doc) => doc._id).join(", ")}`);
} else {
  if (!projectId || !dataset || !token) {
    throw new Error("Seeding requires verified SANITY_STUDIO_PROJECT_ID, SANITY_STUDIO_DATASET and server-only SANITY_WRITE_TOKEN.");
  }
  const client = createClient({ projectId, dataset, token, apiVersion: "2025-02-19", useCdn: false });
  // Collections before references: createIfNotExists is retry-safe and preserves editor edits.
  for (const doc of documents) {
    await client.createIfNotExists(doc);
    console.info(`Ensured ${doc._type}: ${doc._id}`);
  }
}
