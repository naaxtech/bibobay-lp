/**
 * Whether this page is being edited from the Studio (rulings R161, R164): inside Presentation's
 * iframe, or in a window Presentation opened (its "Open preview" button). A frame whose top the page
 * may not even read is a cross-origin frame, so it counts as framed.
 */
export function inPresentationContext(win: Pick<Window, "self" | "top" | "opener">): boolean {
  try {
    if (win.self !== win.top) return true;
  } catch {
    return true;
  }
  return Boolean(win.opener);
}

/** For useSyncExternalStore: the answer never changes while the page lives. */
export const subscribeNever = () => () => {};
export const inPresentationNow = () => inPresentationContext(window);
/** The server and the first client render know nothing yet: render as a normal tab. */
export const notInPresentationOnServer = () => false;
