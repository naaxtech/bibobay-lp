import React, { useState } from 'react';
import { Play, Sparkles, Compass, ArrowRight, RotateCw, CheckCircle2 } from 'lucide-react';

export const ScreenToLifeLoop: React.FC = () => {
  const [activeScenarioIdx, setActiveScenarioIdx] = useState<number>(0);

  const scenarios = [
    {
      title: 'Shelly’s Shoreline Clean-Up',
      screenStory: 'In BIBO Bay, Shelly the Turtle discovers a plastic wrapper caught in the seagrass and shows her friends how to safely pick it up.',
      screenTakeaway: 'Children learn that small hands can protect big oceans, and that littering hurts our animal friends.',
      offlineStep: 'Do a 2-minute “Tidy Tide” in your living room: race the timer to put 5 toys back in their safe homes!',
      tag: 'Earth Care & Responsibility',
      icon: '🐢',
      bgColor: 'from-emerald-500/10 to-teal-500/10',
      badgeColor: 'text-emerald-800 bg-emerald-100',
    },
    {
      title: 'Wally’s Calming Ocean Breaths',
      screenStory: 'Ollie the Otter’s pebble castle collapses and he feels a hot, angry storm inside his chest. Wally guides him through 3 slow, deep ocean breaths.',
      screenTakeaway: 'Recognizing that frustration is a natural feeling, and using physical belly breathing to calm our nervous system.',
      offlineStep: 'Place your favorite stuffed toy on your tummy. Breathe in to make it rise like a boat, breathe out to gently dock it!',
      tag: 'Emotions & Calming Down',
      icon: '🦈',
      bgColor: 'from-sky-500/10 to-blue-500/10',
      badgeColor: 'text-sky-800 bg-sky-100',
    },
    {
      title: 'Pip’s Alphabet Scavenger Hunt',
      screenStory: 'Pip the Little Squid sings the Bay ABC song and searches for things shaped like the letter B in the coral garden.',
      screenTakeaway: 'Phonics sounds, letter recognition, and connecting letters to real physical shapes around us.',
      offlineStep: 'Look around your home: can you and your parent find 3 things that start with the letter “B” (like a book, a bed, or a button)?',
      tag: 'Phonics & Alphabet',
      icon: '🦑',
      bgColor: 'from-purple-500/10 to-violet-500/10',
      badgeColor: 'text-purple-800 bg-purple-100',
    },
  ];

  const current = scenarios[activeScenarioIdx];

  return (
    <section id="loop" className="py-20 bg-white border-t border-[#E2E8F0] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold uppercase tracking-wider mb-3">
            <RotateCw className="w-3.5 h-3.5" />
            <span>Why Bedtimes & Dinners Stay Peaceful</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            The Screen Is the Beginning, <br className="hidden sm:inline" />
            <span className="text-[#0D9488]">Never the Trap</span>.
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            Most kids’ shows are designed like casinos: endless auto-plays and cliffhangers so your child screams if you turn it off. BIBO Bay does the opposite. Every episode winds down with a fun offline play spark.
          </p>
        </div>

        {/* Scenario Toggle Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {scenarios.map((sc, idx) => (
            <button
              key={idx}
              type="button"
              id={`scenario-pill-${idx}`}
              onClick={() => setActiveScenarioIdx(idx)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeScenarioIdx === idx
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <span>{sc.icon}</span>
              <span>{sc.title}</span>
            </button>
          ))}
        </div>

        {/* 4-Step Visual Flow Diagram */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
          
          {/* Step 1 */}
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E2E8F0] p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="w-7 h-7 rounded-full bg-[#0D9488] text-white flex items-center justify-center text-xs font-bold">1</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">Watch</span>
              </div>
              <h3 className="text-base font-bold text-[#0F172A] mb-2 font-display">1. Character Story</h3>
              <p className="text-xs text-[#475569] leading-relaxed mb-3">
                {current.screenStory}
              </p>
            </div>
            <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-[#64748B] flex items-center gap-1.5">
              <Play className="w-3 h-3 text-[#0D9488]" />
              <span>11–12 min gentle pacing</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E2E8F0] p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="w-7 h-7 rounded-full bg-[#EA580C] text-white flex items-center justify-center text-xs font-bold">2</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#EA580C]">Absorb</span>
              </div>
              <h3 className="text-base font-bold text-[#0F172A] mb-2 font-display">2. Heart & Mind Lesson</h3>
              <p className="text-xs text-[#475569] leading-relaxed mb-3">
                {current.screenTakeaway}
              </p>
            </div>
            <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-[#64748B] flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-[#EA580C]" />
              <span>Early skills + kindness</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E2E8F0] p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="w-7 h-7 rounded-full bg-[#7C3AED] text-white flex items-center justify-center text-xs font-bold">3</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#7C3AED]">Prompt</span>
              </div>
              <h3 className="text-base font-bold text-[#0F172A] mb-2 font-display">3. Screen-Off Invitation</h3>
              <p className="text-xs text-[#475569] leading-relaxed mb-3">
                The episode concludes with a soft acoustic song and the animal friend saying: <em>“Now it’s your turn in the real world!”</em>
              </p>
            </div>
            <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-[#64748B] flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-[#7C3AED]" />
              <span>No cliffhangers, no tantrum</span>
            </div>
          </div>

          {/* Step 4 */}
          <div className="rounded-2xl bg-[#F0FDFA] border-2 border-[#0D9488]/40 p-5 flex flex-col justify-between shadow-2xs">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="w-7 h-7 rounded-full bg-[#0D9488] text-white flex items-center justify-center text-xs font-bold">4</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">Play</span>
              </div>
              <h3 className="text-base font-bold text-[#0F172A] mb-2 font-display">4. Offline Activity</h3>
              <p className="text-xs text-[#0F766E] leading-relaxed mb-3 font-medium bg-white p-3 rounded-xl border border-[#CCFBF1]">
                {current.offlineStep}
              </p>
            </div>
            <div className="pt-3 border-t border-[#CCFBF1] text-[11px] text-[#0D9488] font-semibold flex items-center gap-1.5">
              <Compass className="w-3 h-3" />
              <span>Real hands, real world</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
