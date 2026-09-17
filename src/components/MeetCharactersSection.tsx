import React, { useState } from 'react';
import { CHARACTERS } from '../data/biboContent';
import { Sparkles, Heart, CheckCircle2, Music } from 'lucide-react';

export const MeetCharactersSection: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>(CHARACTERS[0].id);

  const selectedChar = CHARACTERS.find((c) => c.id === selectedId) || CHARACTERS[0];

  return (
    <section id="characters" className="py-20 bg-white border-t border-[#E2E8F0] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>The Six Friends</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            Meet the Animal Friends <br className="hidden sm:inline" />
            <span className="text-[#0D9488]">of BIBO Bay</span>
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            Crafted like plush felt toys with warm, comforting personalities. Each friend has real feelings, gentle flaws, and a special lesson they share with your child.
          </p>
        </div>

        {/* Character Selector Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-10">
          {CHARACTERS.map((char) => {
            const isSelected = char.id === selectedId;
            return (
              <button
                key={char.id}
                type="button"
                id={`character-btn-${char.id}`}
                onClick={() => setSelectedId(char.id)}
                className={`p-4 rounded-3xl text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-between border ${
                  isSelected
                    ? 'bg-white border-[#0D9488] shadow-md scale-105 ring-2 ring-[#0D9488]/20'
                    : 'bg-[#FAF9F5] border-[#E2E8F0] hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-4xl sm:text-5xl mb-3">
                  {char.avatarEmoji}
                </div>
                <div>
                  <h3 className="text-sm font-display font-bold text-[#0F172A] leading-tight mb-0.5">
                    {char.name.split(' the ')[0]}
                  </h3>
                  <span className="text-[11px] text-[#64748B] block truncate">
                    {char.species}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Character Deep Dive Card */}
        <div className="rounded-3xl bg-[#FAF9F5] border border-[#E2E8F0] p-6 sm:p-8 lg:p-10 shadow-sm relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            {/* Left Character Portrait & Identity */}
            <div className="lg:col-span-5 flex flex-col items-center text-center p-6 rounded-3xl bg-white border border-[#E2E8F0] shadow-2xs">
              <div className="text-7xl sm:text-8xl mb-4 animate-float-slow">
                {selectedChar.avatarEmoji}
              </div>
              <span
                className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2"
                style={{ backgroundColor: selectedChar.accentColor, color: selectedChar.color }}
              >
                {selectedChar.role}
              </span>
              <h3 className="text-2xl font-display font-extrabold text-[#0F172A] mb-1">
                {selectedChar.name}
              </h3>
              <p className="text-xs text-[#64748B] italic mb-4 max-w-xs leading-relaxed">
                {selectedChar.catchphrase}
              </p>
              
              <div className="w-full pt-4 border-t border-[#F1F5F9] text-xs text-[#334155] flex items-center justify-center gap-1.5 font-medium">
                <Heart className="w-3.5 h-3.5 text-rose-500 fill-current" />
                <span>Favorite game: {selectedChar.favoriteActivity}</span>
              </div>
            </div>

            {/* Right Educational & Emotional Details */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#0D9488] mb-2">
                  <Sparkles className="w-4 h-4 text-[#0D9488]" />
                  <span>Why Children Love {selectedChar.name.split(' the ')[0]}</span>
                </div>
                <p className="text-sm sm:text-base text-[#334155] leading-relaxed mb-6 font-normal">
                  {selectedChar.personality}
                </p>

                {/* What they teach */}
                <div className="mb-6">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64748B] mb-3">
                    Everyday Lessons Woven into the Show:
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {selectedChar.teaches.map((lesson, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-2xl bg-white border border-[#E2E8F0] flex items-center gap-2 text-xs font-semibold text-[#0F172A] shadow-2xs"
                      >
                        <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0" />
                        <span>{lesson}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Activity bridge */}
              <div className="p-4 rounded-2xl bg-[#CCFBF1]/50 border border-[#99F6E4] text-xs text-[#0F766E] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-[#0D9488] shrink-0" />
                  <span>Free printable coloring & story sheet of {selectedChar.name.split(' the ')[0]} included in the Starter Kit!</span>
                </div>
                <a
                  href="#starter-kit"
                  className="font-bold text-[#0D9488] hover:underline whitespace-nowrap"
                >
                  Download Free Kit &rarr;
                </a>
              </div>

            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
