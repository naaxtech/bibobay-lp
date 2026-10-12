"use client";

import { useId } from "react";

import type { EpisodePreview, LandingPageContent, SectionConfig } from "@/lib/content/types";
import { ArtImage, CmsArt } from "./CmsArt";
import { PaperMood, moodAccent } from "./PaperMood";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";
import { UI_COPY } from "./ui-copy";
import { useRovingTabs } from "./useRovingTabs";

type PanelProps = ReturnType<ReturnType<typeof useRovingTabs>["panelProps"]>;

/** Covers start further round the palette than the friends, so the two sections never look alike. */
const COVER_OFFSET = 3;

function Storybook({ story, index, art, conceptLabel, panelProps, describedBy }: {
  story: EpisodePreview;
  index: number;
  art?: StageArt;
  conceptLabel: string;
  panelProps: PanelProps;
  /** id of the line saying which concept of how many this is, while it is the open one. */
  describedBy?: string;
}) {
  const isConcept = story.status === "concept";
  return (
    <div {...panelProps} aria-describedby={describedBy} className="storybook">
      <div className="storybook__cover">
        {art ? (
          <ArtImage art={art} sizes="(min-width: 80rem) 38rem, (min-width: 48rem) 50vw, 100vw" />
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
  /** The section's own CMS image: a paper print beside the heading. */
  introArt?: StageArt;
}

type StopState = "past" | "current" | "upcoming";
const stopState = (index: number, selected: number): StopState => (index < selected ? "past" : index === selected ? "current" : "upcoming");

/**
 * Where the open story concept sits among them (spec §7 "timeline-style progress", ruling R22): a
 * row of paper bookmark ticks, one per concept, with the open one long and inked. It follows the
 * tabs and nothing else: no playback, no running time, no advancing on its own. The ticks are a
 * picture for sighted readers; assistive technology hears "k of N" with the open story instead.
 */
function StoryProgress({ count, selected, countId }: { count: number; selected: number; countId: string }) {
  return (
    <div className="story-progress" data-story-progress>
      <ol className="story-progress__stops" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="story-progress__stop" data-state={stopState(index, selected)} />
        ))}
      </ol>
      <p id={countId} className="sr-only">
        {UI_COPY.storyPosition(selected + 1, count)}
      </p>
    </div>
  );
}

/**
 * Story concepts as an open storybook: titles as bookmarks above, the chosen concept on the
 * spread, a quiet marker of which concept is open between them. Every unfinished story says it
 * is a concept; there is no play control or running time.
 */
export function Episodes({ section, intro, episodes, art, introArt }: EpisodesProps) {
  const tabs = useRovingTabs(episodes.length);
  const countId = useId();
  const showProgress = episodes.length > 1;
  return (
    <SectionShell section={section} headingId="episodes-heading" className="py-section">
      <div className="landing-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="episodes-heading" className="mt-4 max-w-[14ch] font-display text-h2 font-semibold">
              {intro.heading}
            </h2>
            {intro.description ? <p className="mt-4 max-w-[46ch] text-(--ink-soft)">{intro.description}</p> : null}
          </div>
          {introArt ? (
            <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 20rem, 90vw" className="max-w-[20rem] lg:col-span-4 lg:col-start-9" />
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
        {showProgress ? <StoryProgress count={episodes.length} selected={tabs.selected} countId={countId} /> : null}
        {/* Every storybook shares one spread, so the section keeps its height whichever is open. */}
        <div className="storybooks">
          {episodes.map((story, index) => (
            <Storybook
              key={story.id}
              story={story}
              index={index}
              art={art[story.id]}
              conceptLabel={intro.conceptLabel}
              panelProps={tabs.panelProps(index)}
              describedBy={showProgress && index === tabs.selected ? countId : undefined}
            />
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
