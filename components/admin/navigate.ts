/**
 * Moves the browser to another staff page with a full page load. Signing in or out changes what
 * the staff frame (app/admin/layout.tsx) shows, and a layout is not rendered again by a client-side
 * navigation, so a fresh request is the only move that always shows the new session state. Tests
 * replace this module, because jsdom cannot navigate.
 */
export function goTo(path: string): void {
  window.location.assign(path);
}
