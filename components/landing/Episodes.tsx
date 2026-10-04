"use client";

import Image from "next/image";

import type { EpisodePreview, LandingPageContent, SectionConfig } from "@/lib/content/types";
import { PaperMood, moodAccent } from "./PaperMood";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";
import { UI_COPY } from "./ui-copy";
import { useRovingTabs } from "./useRovingTabs";

type PanelProps = ReturnType<ReturnType<typeof useRovingTabs>["panelProps"]>;

/** Covers start further round the palette than the friends, so the two sections never look alike. */
const COVER_OFFSET = 3;

function Storybook({ story, index, art, conceptLabel, panelProps }: {
  story: EpisodePreview;
  index: number;
  art?: StageArt;
  conceptLabel: string;
  panelProps: PanelProps;
}) {
  const isConcept = story.status === "concept";
  return (
    <div {...panelProps} className="storybook">
      <div className="storybook__cover">
        {art ? (
          <Image src={art.src} alt={art.alt} fill sizes="(min-width: 64rem) 34rem, 100vw" unoptimized className="object-cover" />
        ) : (
          <PaperMood variant={index + COVER_OFFSET} accent={moodAccent(undefined, index + COVER_OFFSET)} />
        )}
        {isConcept ? <p className="paper-stamp storybook__stamp">{conceptLabel}</p> : null}
      </div>
      <div className="storybook__page">
        <h3 className="font-display text-h2 font-semibold">{story.title}</h3>
        {story.summary ? <p className="mt-4 text-lead">{story.summary}</p> : null}
        <dl className="storybook__facts">
          {story.characterFocus ? (
            <div>
              <dt className="detail-label">{UI_COPY.featuring}</dt>
              <dd>{story.characterFocus}</dd>
            </div>
          ) : null}
          {story.learningFocus.length > 0 ? (
            <div>
              <dt className="detail-label">{UI_COPY.themes}</dt>
              <dd>
                <ul className="chip-list mt-1">
                  {story.learningFocus.map((theme, themeIndex) => (
                    <li key={themeIndex}>{theme}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
        {story.offlinePrompt ? (
          <div className="storybook__note">
            <p className="detail-label">{UI_COPY.tryTogether}</p>
            <p className="mt-1">{story.offlinePrompt}</p>
          </div>
        ) : null}
        {!isConcept && story.mediaUrl ? (
          <p className="mt-6">
            <a href={story.mediaUrl} className="text-link" target="_blank" rel="noopener noreferrer">
              {UI_COPY.watchStory}
              <span className="sr-only"> {UI_COPY.opensInNewTab}</span>
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface EpisodesProps {
  section: SectionConfig;
  intro: LandingPageContent["episodesIntro"];
  episodes: EpisodePreview[];
  /** Approved Sanity artwork by story id; a story without it keeps an abstract cover. */
  art: Readonly<Record<string, StageArt>>;
}

/**
 * Story concepts as an open storybook: titles as bookmarks above, the chosen concept on the
 * spread. Every unfinished story says it is a concept; there is no play control or running time.
 */
export function Episodes({ section, intro, episodes, art }: EpisodesProps) {
  const tabs = useRovingTabs(episodes.length);
  return (
    <SectionShell section={section} headingId="episodes-heading" className="py-section">
      <div className="landing-container">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-6">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="episodes-heading" className="mt-4 max-w-[14ch] font-display text-h2 font-semibold">
              {intro.heading}
            </h2>
          </div>
          {intro.description ? (
            <p className="max-w-[44ch] text-(--ink-soft) lg:col-span-5 lg:col-start-8">{intro.description}</p>
          ) : null}
        </div>
        <div role="tablist" aria-labelledby="episodes-heading" className="story-tabs mt-10 lg:mt-14">
          {episodes.map((story, index) => (
            <button key={story.id} {...tabs.tabProps(index)} className="story-tab">
              <span className="story-tab__title">{story.title}</span>{" "}
              {story.status === "concept" ? <span className="story-tab__status">{intro.conceptLabel}</span> : null}
            </button>
          ))}
        </div>
        {episodes.map((story, index) => (
          <Storybook
            key={story.id}
            story={story}
            index={index}
            art={art[story.id]}
            conceptLabel={intro.conceptLabel}
            panelProps={tabs.panelProps(index)}
          />
        ))}
      </div>
    </SectionShell>
  );
}
