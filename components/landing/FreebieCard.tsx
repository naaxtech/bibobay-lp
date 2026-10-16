import { ACTIVITY_PACK, activityPackPreviews, isRepositoryPack } from "@/lib/content/freebie";
import type { LeadMagnet } from "@/lib/content/types";
import { UI_COPY } from "./ui-copy";

/** A down arrow into a tray. Decorative: the button's words say what it does. */
function DownloadGlyph() {
  return (
    <svg className="freebie-card__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5v11M7 10l5 5 5-5M4.5 16.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The section's free download (R66). It is offered only when the CMS marks a real file available.
 * For the repository's own activity pack the card fans out real renders of its pages and states
 * its real size; any other file shows its CMS title and description alone. No sign-up: the link
 * is the file.
 */
export function FreebieCard({ magnet }: { magnet: LeadMagnet & { fileUrl: string } }) {
  const ours = isRepositoryPack(magnet.fileUrl);
  const previews = ours ? activityPackPreviews().slice(0, 3) : [];
  return (
    <div className={`freebie-card${previews.length > 0 ? " freebie-card--pages" : ""}`} data-freebie>
      {previews.length > 0 ? (
        <div className="freebie-card__pages">
          {previews.map((preview, index) => {
            const [small] = preview.variants;
            return (
              // Pre-sized renders through a plain srcset (R65), like the repository art.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.page}
                className={`freebie-card__page freebie-card__page--${index}`}
                src={small!.src}
                srcSet={preview.variants.map((variant) => `${variant.src} ${variant.width}w`).join(", ")}
                sizes="(min-width: 64rem) 10rem, 34vw"
                width={small!.width}
                height={small!.height}
                alt={index === 0 ? preview.alt : ""}
                loading="lazy"
                decoding="async"
              />
            );
          })}
        </div>
      ) : null}
      <div className="freebie-card__body">
        <h3 className="freebie-card__title">{magnet.title}</h3>
        {magnet.description ? <p className="freebie-card__description">{magnet.description}</p> : null}
        {/* One label, starting with the visible words: a hidden span would be block-level, and Chromium then names it "… : <title>". */}
        <a
          href={magnet.fileUrl}
          className="btn btn-primary freebie-card__download"
          aria-label={`${UI_COPY.downloadFreebie}: ${magnet.title}`}
          {...(ours ? { download: "" } : {})}
        >
          <DownloadGlyph />
          {UI_COPY.downloadFreebie}
        </a>
        {ours ? <p className="freebie-card__meta">{UI_COPY.freebieMeta(ACTIVITY_PACK.pages, ACTIVITY_PACK.bytes)}</p> : null}
      </div>
    </div>
  );
}
