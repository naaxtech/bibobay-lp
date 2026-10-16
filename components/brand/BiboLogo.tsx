import Image from "next/image";

export type BiboLogoVariant = "full" | "mark" | "monochrome";

interface BiboLogoAsset {
  src: string;
  width: number;
  height: number;
}

/**
 * Published logo files. public/bibo-logo.svg is the canonical drawing; the mark and monochrome
 * files are generated from it (scripts/generate-brand-assets.ts). Sizes are each file's own
 * canvas, so the browser reserves the right space before the image arrives.
 */
export const BIBO_LOGO_ASSETS = {
  full: { src: "/bibo-logo.svg", width: 796, height: 496 },
  mark: { src: "/brand/bibo-mark.svg", width: 892, height: 892 },
  monochrome: { src: "/brand/bibo-logo-monochrome.svg", width: 796, height: 496 },
} as const satisfies Record<BiboLogoVariant, BiboLogoAsset>;

export const BIBO_LOGO_ALT = "BIBO";
export const BIBO_TAGLINE = "Bright minds. Kind hearts. Better humans.";

export interface BiboLogoProps {
  /** `full` sticker logo (default), square `mark`, or single-ink `monochrome`. */
  variant?: BiboLogoVariant;
  /** Adds the brand tagline as real text under the logo. */
  showTagline?: boolean;
  /** For an above-the-fold logo: preloads the file instead of lazy-loading it. */
  priority?: boolean;
  /** Set when visible text beside the logo already names the brand, so it is not announced twice. */
  decorative?: boolean;
  /** Sizes the logo; the image fills this element's width. */
  className?: string;
}

export function BiboLogo({
  variant = "full",
  showTagline = false,
  priority = false,
  decorative = false,
  className,
}: BiboLogoProps) {
  const asset = BIBO_LOGO_ASSETS[variant];
  return (
    <span className={className ? `bibo-logo ${className}` : "bibo-logo"} data-bibo-logo={variant}>
      <Image
        className="bibo-logo__image"
        src={asset.src}
        width={asset.width}
        height={asset.height}
        alt={decorative ? "" : BIBO_LOGO_ALT}
        // src: https://nextjs.org/docs/app/api-reference/components/image#preload · next 16.3.8 · 2026-10-04
        // Next 16 deprecates `priority`; its `preload` only injects a <link>. The logo is already in the
        // server HTML, so eager loading at high fetch priority is the documented, lighter choice.
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        // SVG is served as-is; it never needs the raster optimizer.
        unoptimized
      />
      {showTagline ? <span className="bibo-logo__tagline">{BIBO_TAGLINE}</span> : null}
    </span>
  );
}
