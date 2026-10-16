import type { StructureResolver } from "sanity/structure";

export const SINGLETON_IDS = ["siteSettings", "landingPage", "legalSettings"] as const;
const singletonNames = new Set<string>(SINGLETON_IDS);

export const structure: StructureResolver = (S) => S.list().title("BIBO Bay content").items([
  ...SINGLETON_IDS.map((id) => S.listItem().singleton(id)),
  S.divider(),
  ...S.documentTypeListItems().filter((item) => !singletonNames.has(item.getId() ?? "")),
]);
