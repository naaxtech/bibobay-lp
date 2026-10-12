import { PREVIEW_COPY } from "@/components/legal/legal-copy";
import { DRAFT_DISABLE_PATH } from "@/lib/sanity/draft-mode";

/**
 * Ruling R33: in draft mode every page says it shows unpublished drafts and offers a way out.
 * A plain link: the disable route is an API redirect, never something to prefetch.
 */
export function PreviewNotice() {
  return (
    <div className="preview-notice" role="status">
      <p>{PREVIEW_COPY.notice}</p>
      <a href={DRAFT_DISABLE_PATH} className="preview-notice__exit">
        {PREVIEW_COPY.exit}
      </a>
    </div>
  );
}
