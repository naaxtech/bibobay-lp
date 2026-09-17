import React from 'react';
import { Heart, Check, X, ShieldAlert, Sparkles } from 'lucide-react';

export const PhilosophySection: React.FC = () => {
  return (
    <section id="philosophy" className="py-20 bg-white border-t border-[#E2E8F0] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EA580C]/10 text-[#EA580C] text-xs font-bold uppercase tracking-wider mb-3">
            <Heart className="w-3.5 h-3.5 fill-current" />
            <span>Parent to Parent</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            We Know What 5:30 PM <br className="hidden sm:inline" />
            <span className="text-[#0D9488]">Feels Like in Your Living Room</span>.
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            You just need 20 minutes to make dinner, unpack a backpack, or take a quiet breath. But you shouldn’t have to trade your child’s emotional calm for a few moments of peace.
          </p>
        </div>

        {/* The 2-Way Comparison for Parents */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-16">
          
          {/* Left: The Frantic Screen Candy */}
          <div className="lg:col-span-6 rounded-3xl bg-[#FFF5F5] border border-rose-200 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100 text-rose-800 text-xs font-bold mb-4">
                <X className="w-3.5 h-3.5" />
                <span>What Most Shows Do</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-bold text-[#0F172A] mb-3">
                The Hyperactive Sugar Rush
              </h3>
              <ul className="space-y-3.5 text-xs sm:text-sm text-[#475569]">
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span><strong>Lightning-fast cuts:</strong> Scenes jump every 2 seconds to hook attention, flooding immature nervous systems with dopamine.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span><strong>Screaming earworms:</strong> Synthetic, screeching voice acting and high-pitched noise designed to drown out your home.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span><strong>The brutal power-off meltdown:</strong> Because the brain was in sensory overdrive, turning the TV off triggers tears and anger.</span>
                </li>
              </ul>
            </div>
            <div className="mt-8 pt-4 border-t border-rose-200 text-xs text-rose-800 font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
              <span>Result: You get 20 minutes of silence, followed by an hour of irritability.</span>
            </div>
          </div>

          {/* Right: The BIBO Bay Difference */}
          <div className="lg:col-span-6 rounded-3xl bg-[#F0FDFA] border-2 border-[#0D9488]/40 p-6 sm:p-8 flex flex-col justify-between shadow-xs">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold mb-4">
                <Check className="w-3.5 h-3.5" />
                <span>The BIBO Bay Way</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-bold text-[#0F172A] mb-3">
                Intentional, Gentle & Joyful
              </h3>
              <ul className="space-y-3.5 text-xs sm:text-sm text-[#334155]">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
                  <span><strong>Breathable visual pacing:</strong> The camera holds still so children can take in the scene, recognize letters, and think.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
                  <span><strong>Soft acoustic melodies:</strong> Calming guitars, warm voices, and songs that celebrate kindness, ocean tides, and counting.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
                  <span><strong>Happy transition off the screen:</strong> Episodes naturally wind down with a simple idea: <em>“Go find three smooth pebbles!”</em></span>
                </li>
              </ul>
            </div>
            <div className="mt-8 pt-4 border-t border-[#CCFBF1] text-xs text-[#0F766E] font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0D9488] shrink-0" />
              <span>Result: Your child finishes the episode calm, smiling, and ready to play.</span>
            </div>
          </div>

        </div>

        {/* The North Star Banner */}
        <div className="rounded-3xl bg-[#0F172A] text-white p-8 sm:p-10 text-center relative overflow-hidden">
          <div className="max-w-2xl mx-auto space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-[#22C1C3]">
              The BIBO Promise to Parents
            </span>
            <blockquote className="text-2xl sm:text-3xl font-display font-bold leading-tight text-white">
              “If they’re watching, make it worthwhile.”
            </blockquote>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl mx-auto">
              Every episode gives your little human something truly positive—whether it's learning the letter B, counting with Wally, or learning that crying when you're frustrated is completely okay.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
};
