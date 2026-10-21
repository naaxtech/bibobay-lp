import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID,
    dataset: process.env.SANITY_STUDIO_DATASET,
  },
  deployment: {
    // The hosted Studio at https://bibobay.sanity.studio, created by the first `sanity deploy` (2026-10-21).
    // Without it every deploy asks which Studio to replace.
    appId: "dvwgghfenbicfhglkgd2uji4",
    // Sanity's recommended setting for a standalone Studio: the hosted Studio loads the latest `sanity` 6.x
    // at runtime, so it gets fixes without a redeploy. The pinned version in package.json still builds it.
    autoUpdates: true,
  },
});
