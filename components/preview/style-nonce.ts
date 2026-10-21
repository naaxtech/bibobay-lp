/**
 * Ruling R169: lets the Visual Editing overlay's styles through the site's CSP. The policy admits a
 * <style> element only with the request's nonce (R34, `style-src-elem 'self' 'nonce-…'`), and
 * styled-components, which draws the overlays, takes its nonce from <meta property="csp-nonce">
 * (src: node_modules/styled-components/dist/styled-components.browser.esm.js · styled-components 6.5.3 · 2026-10-21).
 * The nonce is copied from the scripts Next stamped with it, in the browser and only by the Studio's
 * chunk, so it never travels in the page payload. Any script on the page can already read it.
 */
export const STYLE_NONCE_META = 'meta[property="csp-nonce"]';

/** The nonce grammar Next accepts (lib/security/headers.ts NONCE). */
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

const nonceOf = (element: HTMLElement): string => element.nonce || element.getAttribute("nonce") || "";

/** The nonce Next stamped on the page's scripts, or null when there is none or it breaks the grammar. */
export function pageScriptNonce(doc: Document): string | null {
  const script = Array.from(doc.querySelectorAll<HTMLScriptElement>("script[nonce]")).find((element) => nonceOf(element));
  const nonce = script ? nonceOf(script) : "";
  return NONCE.test(nonce) ? nonce : null;
}

/** Adds the meta once; returns the nonce shared, or null when the page has none. */
export function shareStyleNonce(doc: Document): string | null {
  const existing = doc.head.querySelector<HTMLMetaElement>(STYLE_NONCE_META);
  if (existing) return nonceOf(existing) || null;
  const nonce = pageScriptNonce(doc);
  if (!nonce) return null;
  const meta = doc.createElement("meta");
  meta.setAttribute("property", "csp-nonce");
  meta.nonce = nonce;
  // jsdom and older engines have no `nonce` property: the attribute carries it there.
  if (meta.nonce !== nonce) meta.setAttribute("nonce", nonce);
  doc.head.append(meta);
  return nonce;
}
