/**
 * What the preview does when the Studio says content changed (ruling R162). Visual Editing calls it
 * with `manual` (the editor pressed refresh) or `mutation` (an edit was saved). Draft-mode reads are
 * never cached, so a router refresh re-renders the page with the latest draft.
 *
 * A burst of keystrokes arrives as a burst of mutations: wait for 300 ms of quiet, refresh, and refresh
 * once more 1.5 s after the last edit, because Sanity's query index can trail the mutation event that
 * told the Studio about the edit. The returned promise keeps the Studio's refresh indicator on until
 * the last refresh has been asked for.
 */
export type PreviewRefreshPayload = { source: "manual" | "mutation" };

const FIRST_REFRESH_MS = 300;
const SECOND_REFRESH_MS = 1500;

export function createPreviewRefresher(refresh: () => void): (payload: PreviewRefreshPayload) => false | Promise<void> {
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let settle: Array<() => void> = [];
  const finish = () => {
    for (const resolve of settle) resolve();
    settle = [];
  };
  return (payload) => {
    if (payload.source === "manual") {
      refresh();
      return Promise.resolve();
    }
    if (payload.source !== "mutation") return false;
    for (const timer of timers) clearTimeout(timer);
    timers = [
      setTimeout(refresh, FIRST_REFRESH_MS),
      setTimeout(() => {
        refresh();
        finish();
      }, SECOND_REFRESH_MS),
    ];
    return new Promise<void>((resolve) => {
      settle.push(resolve);
    });
  };
}
