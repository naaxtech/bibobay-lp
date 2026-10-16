import { ACTIVITY_PACK, activityPackPreviews, isRepositoryPack } from "@/lib/content/freebie";
import type { LeadMagnet } from "@/lib/content/types";
import { DownloadGlyph } from "./DownloadGlyph";
import { UI_COPY } from "./ui-copy";

/**
 * The section's free download (R140, which overrides R66's "no sign-up"). It is offered only when the
 * CMS marks a real file available. For the repository's own activity pack the card fans out real
 * renders of its pages and states its real size; any other file shows its CMS title and
 * description alone. The card never links the file: its button leads to the signup form, which
 * shows the download only once the server has stored the signup. The `fileUrl` only decides which
 * previews to show.
 */
export function FreebieCard({ magnet, anchor }: { magnet: LeadMagnet & { fileUrl: string }; anchor: string }) {
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
        <a href={anchor} className="btn btn-primary freebie-card__download" aria-label={`${UI_COPY.getFreebie}: ${magnet.title}`}>
          <DownloadGlyph />
          {UI_COPY.getFreebie}
        </a>
        <p className="freebie-card__gate">{UI_COPY.freebieGate}</p>
        {ours ? <p className="freebie-card__meta">{UI_COPY.freebieMeta(ACTIVITY_PACK.pages, ACTIVITY_PACK.bytes)}</p> : null}
      </div>
    </div>
  );
}
