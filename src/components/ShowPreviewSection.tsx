import React, { useState } from 'react';
import { SHOW_EPISODES, ShowEpisode } from '../data/biboContent';
import { Play, Sparkles, Clock, BookOpen, Heart, Leaf, RotateCw, CheckCircle2 } from 'lucide-react';

interface ShowPreviewSectionProps {
  onOpenStarterKit: () => void;
}

export const ShowPreviewSection: React.FC<ShowPreviewSectionProps> = ({ onOpenStarterKit }) => {
  const [activeEpisodeId, setActiveEpisodeId] = useState<string>(SHOW_EPISODES[0].id);

  const activeEpisode = SHOW_EPISODES.find((e) => e.id === activeEpisodeId) || SHOW_EPISODES[0];

  return (
    <section id="the-show" className="py-20 bg-[#FAF9F5] border-t border-[#E2E8F0] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EA580C]/10 text-[#EA580C] text-xs font-bold uppercase tracking-wider mb-3">
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Our Flagship Show</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            Welcome to <span className="text-[#0D9488]">BIBO Bay</span>. <br />
            <span className="text-[#EA580C]">The Show That Cares How Kids Feel</span>.
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            Every 11-minute animated episode combines gentle storytelling with the foundational skills your preschooler needs: the alphabet, counting, kindness, and taking care of our planet.
          </p>
        </div>

        {/* 4 Pillars of Learning In The Show */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-14">
          <div className="p-5 rounded-3xl bg-white border border-[#E2E8F0] shadow-xs">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 text-[#0D9488] flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-base font-display font-bold text-[#0F172A] mb-1">Alphabet & Counting</h3>
            <p className="text-xs text-[#475569] leading-relaxed">
              Phonics, letter shapes, and counting 1–20 through memorable ocean songs—never rote flashcards.
            </p>
          </div>

          <div className="p-5 rounded-3xl bg-white border border-[#E2E8F0] shadow-xs">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mb-3">
              <Heart className="w-5 h-5" />
            </div>
            <h3 className="text-base font-display font-bold text-[#0F172A] mb-1">Empathy & Friendship</h3>
            <p className="text-xs text-[#475569] leading-relaxed">
              Navigating jealousy, taking turns, apologizing honestly, and welcoming shy friends.
            </p>
          </div>

          <div className="p-5 rounded-3xl bg-white border border-[#E2E8F0] shadow-xs">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-3">
              <Leaf className="w-5 h-5" />
            </div>
            <h3 className="text-base font-display font-bold text-[#0F172A] mb-1">Loving Our Earth</h3>
            <p className="text-xs text-[#475569] leading-relaxed">
              Cleaning the beach, protecting sea creatures, reducing waste, and loving nature without fear.
            </p>
          </div>

          <div className="p-5 rounded-3xl bg-white border border-[#E2E8F0] shadow-xs">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center mb-3">
              <RotateCw className="w-5 h-5" />
            </div>
            <h3 className="text-base font-display font-bold text-[#0F172A] mb-1">Screen-Off Prompts</h3>
            <p className="text-xs text-[#475569] leading-relaxed">
              Every episode ends with an offline activity invitation, making "TV time is over" peaceful.
            </p>
          </div>
        </div>

        {/* Interactive Episode Explorer */}
        <div className="rounded-3xl bg-white border border-[#E2E8F0] p-6 sm:p-8 lg:p-10 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#F1F5F9] mb-8">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#0D9488]">Season 1 Pilot Episodes</span>
              <h3 className="text-2xl font-display font-bold text-[#0F172A]">Take a Peek at What Your Child Will Watch</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-semibold">
                11–12 Minutes Each
              </span>
            </div>
          </div>

          {/* Episode Switcher Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
            {SHOW_EPISODES.map((ep) => {
              const isSelected = ep.id === activeEpisodeId;
              return (
                <button
                  key={ep.id}
                  type="button"
                  id={`episode-tab-${ep.id}`}
                  onClick={() => setActiveEpisodeId(ep.id)}
                  className={`p-4 rounded-2xl text-left transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-md'
                      : 'bg-[#FAF9F5] text-[#475569] border-[#E2E8F0] hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-[#22C1C3]' : 'text-slate-400'}`}>
                      Episode 0{ep.episodeNumber}
                    </span>
                    <span className="text-[11px] opacity-80">{ep.duration}</span>
                  </div>
                  <h4 className="text-sm font-bold font-display leading-snug mb-1">
                    {ep.title}
                  </h4>
                  <span className={`text-xs block truncate ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                    Featuring {ep.characterFocus}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Episode Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#FAF9F5] p-6 sm:p-8 rounded-3xl border border-[#E2E8F0]">
            
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-3 py-0.5 rounded-full bg-white text-xs font-bold text-[#0D9488] shadow-2xs">
                  Episode 0{activeEpisode.episodeNumber} Spotlight
                </span>
                <span className="text-xs text-[#64748B]">Featuring {activeEpisode.characterFocus}</span>
              </div>

              <h4 className="text-2xl font-display font-bold text-[#0F172A]">
                “{activeEpisode.title}”
              </h4>

              <p className="text-sm text-[#334155] leading-relaxed">
                {activeEpisode.summary}
              </p>

              <div className="pt-3 border-t border-[#E2E8F0] space-y-2 text-xs">
                <div className="flex items-start gap-2 text-[#0F172A]">
                  <strong className="text-[#0D9488] shrink-0">Early Skills:</strong>
                  <span>{activeEpisode.learningFocus.earlySkills}</span>
                </div>
                <div className="flex items-start gap-2 text-[#0F172A]">
                  <strong className="text-[#EA580C] shrink-0">Values & Feelings:</strong>
                  <span>{activeEpisode.learningFocus.values}</span>
                </div>
                <div className="flex items-start gap-2 text-[#0F172A]">
                  <strong className="text-emerald-700 shrink-0">Earth Care:</strong>
                  <span>{activeEpisode.learningFocus.earthCare}</span>
                </div>
              </div>
            </div>

            {/* Offline Screen-Off Spark Card */}
            <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#EA580C] mb-2">
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>The Screen-Off Activity</span>
                </div>
                <h5 className="text-sm font-bold text-[#0F172A] mb-2">
                  What Happens When the Show Finishes
                </h5>
                <p className="text-xs text-[#475569] leading-relaxed mb-4 bg-[#FAF9F5] p-3 rounded-xl border border-[#E2E8F0]">
                  “{activeEpisode.screenOffSpark}”
                </p>
              </div>

              <button
                type="button"
                onClick={onOpenStarterKit}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Get Free Pilot Episode Coloring Pack</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
