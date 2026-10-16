"use client";

import type { CSSProperties } from "react";

import type { Character, SectionConfig, SectionIntro } from "@/lib/content/types";
import { ArtImage, CmsArt } from "./CmsArt";
import { PaperMood, moodAccent } from "./PaperMood";
import { PaperEdge, SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";
import { UI_COPY } from "./ui-copy";
import { useEverChosen, useRovingTabs } from "./useRovingTabs";

type PanelProps = ReturnType<ReturnType<typeof useRovingTabs>["panelProps"]>;

const accentStyle = (accent: string) => ({ "--friend-accent": accent }) as CSSProperties;

function FriendStage({ friend, index, art, panelProps }: { friend: Character; index: number; art?: StageArt; panelProps: PanelProps }) {
  const accent = moodAccent(friend.accentColor, index);
  const status = friend.status === "concept" ? UI_COPY.characterStatus.concept : null;
  const showArt = useEverChosen(!panelProps.inert);
  const kind = [friend.species, friend.role].filter(Boolean).join(" · ");
  const personality = friend.personality && friend.personality !== friend.description ? friend.personality : null;
  return (
    <div {...panelProps} className="friend-stage" style={accentStyle(accent)}>
      <div className="friend-stage__art">
        {art && showArt ? (
          <ArtImage art={art} sizes="(min-width: 64rem) 30rem, (min-width: 48rem) 45vw, 100vw" />
        ) : (
          <PaperMood variant={index} accent={accent} />
        )}
      </div>
      <div className="friend-stage__text">
        {status ? <p className="paper-stamp friend-stage__stamp">{status}</p> : null}
        <h3 className="font-display text-h2 font-semibold">{friend.name}</h3>
        {kind ? <p className="friend-stage__kind">{kind}</p> : null}
        {friend.description ? <p className="text-lead">{friend.description}</p> : null}
        {personality ? <p className="text-(--ink-soft)">{personality}</p> : null}
        {friend.catchphrase ? (
          <p className="friend-stage__catchphrase">
            <q>{friend.catchphrase}</q>
          </p>
        ) : null}
        {friend.favoriteActivity ? (
          <p>
            <span className="detail-label">{UI_COPY.favoriteActivity}</span> {friend.favoriteActivity}
          </p>
        ) : null}
        {friend.teaches.length > 0 ? (
          <div>
            <p className="detail-label">{UI_COPY.explores}</p>
            <ul className="chip-list mt-2">
              {friend.teaches.map((value, valueIndex) => (
                <li key={valueIndex}>{value}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface CharactersProps {
  section: SectionConfig;
  intro: SectionIntro;
  characters: Character[];
  /** Approved Sanity artwork by character id; a friend without it keeps an abstract placeholder. */
  art: Readonly<Record<string, StageArt>>;
  /** The section's own CMS image: a paper print beside the heading. */
  introArt?: StageArt;
}

/**
 * Meet the Bay friends: one friend at a time on a large stage, chosen from named tabs that carry
 * each friend's face. A concept friend is labelled so; a friend without art keeps an abstract
 * placeholder, never pretend character art. The heading and its line of context read as one
 * stacked block; the right of the header is the section's own art when the CMS has some.
 */
export function Characters({ section, intro, characters, art, introArt }: CharactersProps) {
  const tabs = useRovingTabs(characters.length);
  return (
    <SectionShell section={section} headingId="characters-heading" className="relative pb-section pt-16 sm:pt-24">
      <PaperEdge />
      <div className="landing-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="characters-heading" className="mt-4 max-w-[16ch] font-display text-h1 font-semibold">
              {intro.heading}
            </h2>
            {intro.description ? <p className="mt-5 max-w-[46ch] text-lead text-(--ink-soft)">{intro.description}</p> : null}
          </div>
          {introArt ? (
            <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 22rem, 90vw" className="max-w-[22rem] lg:col-span-4 lg:col-start-9" />
          ) : null}
        </div>
        <div className="mt-10 grid gap-6 lg:mt-14 lg:grid-cols-12 lg:gap-8">
          <div
            role="tablist"
            aria-labelledby="characters-heading"
            className="friend-tabs lg:col-span-4 lg:col-start-9 lg:row-start-1"
          >
            {characters.map((friend, index) => {
              const status = friend.status === "concept" ? UI_COPY.characterStatus.concept : null;
              const portrait = art[friend.id];
              return (
                <button
                  key={friend.id}
                  {...tabs.tabProps(index)}
                  className="friend-tab"
                  data-avatar={portrait ? "" : undefined}
                  style={accentStyle(moodAccent(friend.accentColor, index))}
                >
                  {/* The friend's face beside their name: a picture of the words, so announced as nothing. */}
                  {portrait ? (
                    <span className="friend-tab__avatar">
                      <ArtImage art={{ ...portrait, alt: "" }} sizes="3.5rem" />
                    </span>
                  ) : null}
                  <span className="friend-tab__name">{friend.name}</span>{" "}
                  {friend.role ? <span className="friend-tab__role">{friend.role}</span> : null}{" "}
                  {status ? <span className="friend-tab__status">{status}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="friend-stages lg:col-span-8 lg:col-start-1 lg:row-start-1">
            {characters.map((friend, index) => (
              <FriendStage key={friend.id} friend={friend} index={index} art={art[friend.id]} panelProps={tabs.panelProps(index)} />
            ))}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
