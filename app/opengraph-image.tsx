import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { BIBO_LOGO_ASSETS } from "@/components/brand/BiboLogo";
import { brandTokens } from "@/lib/brand/tokens";
import { getLandingPage } from "@/lib/sanity/fetch";

/*
 * The share image (ruling R36): the canonical logo on the cream paper ground with the CMS page title.
 * src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md · next 16.3.8 · 2026-10-13
 * Static by default: drawn at build time and again when the landing page's tag is revalidated. The
 * logo is read from public/bibo-logo.svg and the text uses the font bundled with next/og, so drawing
 * it makes no network request.
 */

export const alt = "The BIBO Bay logo on cream paper, with the page title";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A literal path, read once when the module loads (as in the docs example), so output file tracing
// ships public/bibo-logo.svg with the function that redraws the image after a revalidation.
const logoFile = readFile(join(process.cwd(), "public/bibo-logo.svg"));

/**
 * Keeps the title to characters the bundled font draws. A missing glyph makes next/og try to fetch
 * a font from Google, which would put a network call into the build.
 */
function drawableTitle(title: string): string {
  const cleaned = title.replace(/[^\u0020-\u024f\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 89).trimEnd()}\u2026` : cleaned;
}

export default async function OpenGraphImage() {
  const [content, logo] = await Promise.all([getLandingPage(), logoFile]);
  const logoWidth = 520;
  const logoHeight = Math.round((logoWidth * BIBO_LOGO_ASSETS.full.height) / BIBO_LOGO_ASSETS.full.width);
  const { color } = brandTokens;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          padding: "48px 80px",
          backgroundColor: color.cream,
          color: color.navy,
        }}
      >
        <img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} width={logoWidth} height={logoHeight} alt="" />
        <div style={{ display: "flex", fontSize: 46, lineHeight: 1.2, textAlign: "center", maxWidth: 1000 }}>{drawableTitle(content.seo.title)}</div>
      </div>
    ),
    { ...size },
  );
}
