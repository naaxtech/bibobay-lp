import { PREVIEW_COPY } from "@/components/legal/legal-copy";
import { PreviewExitLink } from "./PreviewExitLink";
import { VisualEditingLoader } from "./VisualEditingLoader";

/**
 * Ruling R33: in draft mode every page says it shows unpublished drafts and offers a way out (hidden
 * inside the Studio, R164). Inside the Studio's Presentation tool it also loads click-to-edit
 * overlays and the live refresh (R158, R161).
 */
export function PreviewNotice() {
  return (
    <>
      <div className="preview-notice" role="status">
        <p>{PREVIEW_COPY.notice}</p>
        <PreviewExitLink />
      </div>
      <VisualEditingLoader />
    </>
  );
}
