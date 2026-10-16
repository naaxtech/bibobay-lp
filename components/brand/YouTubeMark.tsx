/**
 * YouTube's play mark on links that lead to YouTube, where Bibo Bay is watched (owner directive
 * 2026-10-15). Decorative: the link's own words say where it goes. Drawn in YouTube's own colours,
 * a red rounded rectangle with a white play triangle, as YouTube's brand rules ask for the icon
 * (review M9: a recoloured mark in the link's text colour does not follow them).
 * src: https://brand.youtube (Core icon: "The triangle in the full-color red icon must always be white") · read 2026-10-16
 */
export function YouTubeMark({ className }: { className?: string }) {
  return (
    <svg className={["youtube-mark", className].filter(Boolean).join(" ")} viewBox="0 0 28 20" aria-hidden="true" focusable="false" data-youtube-mark>
      <path
        fill="#FF0000"
        d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z"
      />
      <path fill="#FFFFFF" d="M11.2 14.3V5.7L18.5 10l-7.3 4.3Z" />
    </svg>
  );
}

/** True for links to youtube.com or any of its subdomains (www., m.). */
export function isYouTubeHref(href: string): boolean {
  try {
    const { protocol, hostname } = new URL(href);
    return protocol === "https:" && (hostname === "youtube.com" || hostname.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}
