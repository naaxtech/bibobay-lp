"use server";

import { refresh } from "next/cache";
import { cookies, draftMode } from "next/headers";

import { applyPerspectiveChange } from "./draft-mode";

/**
 * Presentation's perspective switch (ruling R162): Visual Editing calls this when an editor picks
 * drafts, published or a release in the Studio. Only a draft-mode request may change it, and only to
 * a valid perspective; then the frame re-renders with it.
 * src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md · next 16.3.8 · 2026-10-21
 */
export async function changePreviewPerspective(perspective: unknown): Promise<void> {
  await applyPerspectiveChange(perspective, {
    draftMode: (await draftMode()).isEnabled,
    cookies: await cookies(),
    secure: process.env.NODE_ENV === "production",
    refresh,
  });
}
