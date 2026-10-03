// Public project metadata only; private credentials stay in server-only client.ts.
export interface SanityEnvironment { projectId: string; dataset: string; apiVersion: string }
export function getSanityEnvironment(env: NodeJS.ProcessEnv = process.env): SanityEnvironment | null {
  const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = env.NEXT_PUBLIC_SANITY_DATASET?.trim();
  const apiVersion = env.NEXT_PUBLIC_SANITY_API_VERSION?.trim() || "2026-03-01";
  if (!projectId || !dataset || !/^[a-z0-9-]+$/.test(projectId) || !/^[a-z0-9_\-]+$/.test(dataset) || !/^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) return null;
  return { projectId, dataset, apiVersion };
}
