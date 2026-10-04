import { Fragment, type ReactNode } from "react";

import type { PortableContent } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";

type Block = PortableContent[number];
type Span = NonNullable<Block["children"]>[number];
type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

const DECORATORS: Record<string, "strong" | "em" | "code" | "u" | "s"> = {
  strong: "strong",
  em: "em",
  code: "code",
  underline: "u",
  "strike-through": "s",
};

const HEADING_TAGS: readonly HeadingTag[] = ["h2", "h3", "h4", "h5", "h6"];

function headingTag(level: number): HeadingTag {
  return HEADING_TAGS[Math.min(Math.max(level, 2), 6) - 2]!;
}

function renderSpan(span: Span, markDefs: Block["markDefs"]): ReactNode {
  let node: ReactNode = span.text;
  for (const mark of span.marks ?? []) {
    const link = markDefs?.find((definition) => definition._key === mark);
    if (link) {
      node = <CtaLink cta={{ label: span.text, href: link.href }}>{node}</CtaLink>;
      continue;
    }
    const Tag = DECORATORS[mark];
    if (Tag) node = <Tag>{node}</Tag>;
  }
  return node;
}

export interface PortableTextProps {
  value: PortableContent;
  /** Level for the CMS "Heading" style, so rich text never breaks the page outline. "Subheading" sits one below. */
  headingLevel?: number;
  className?: string;
}

/** Renders normalized Sanity rich text: paragraphs, two heading styles, decorators and vetted links. */
export function PortableText({ value, headingLevel = 3, className }: PortableTextProps) {
  if (value.length === 0) return null;
  return (
    <div className={className}>
      {value.map((block, index) => {
        const children = (block.children ?? []).map((span, spanIndex) => (
          <Fragment key={span._key ?? spanIndex}>{renderSpan(span, block.markDefs)}</Fragment>
        ));
        const key = block._key ?? index;
        if (block.style === "h2" || block.style === "h3") {
          const Tag = headingTag(block.style === "h2" ? headingLevel : headingLevel + 1);
          return (
            <Tag key={key} className="font-display text-h3 font-semibold">
              {children}
            </Tag>
          );
        }
        return <p key={key}>{children}</p>;
      })}
    </div>
  );
}
