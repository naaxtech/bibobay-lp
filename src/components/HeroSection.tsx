import React from 'react';
import { Sparkles, ArrowRight, CheckCircle, Waves } from 'lucide-react';
import { BiboLogo } from './BiboLogo';

interface HeroSectionProps {
  onOpenStarterKit: () => void;
  onExploreCharacters: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenStarterKit, onExploreCharacters }) => {
  return (
    <section id="hero-section" className="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden">
      {/* Warm Ambient Lagoon Glows */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[550px] pointer-events-none -z-10 opacity-70">
        <div className="absolute top-8 left-10 w-96 h-96 bg-[#22C1C3]/15 rounded-full blur-3xl" />
        <div className="absolute top-20 right-10 w-96 h-96 bg-[#FBBF24]/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-10 left-1/3 w-[450px] h-[350px] bg-[#EA580C]/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          
          {/* Reassuring Parent Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-[#E2E8F0] shadow-2xs text-xs sm:text-sm font-semibold text-[#0F766E] mb-6">
            <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
            <span>Introducing BIBO Bay • The Flagship Animated Children’s Show</span>
          </div>

          {/* Primary Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-extrabold tracking-tight text-[#0F172A] leading-[1.08] mb-6">
            Bright minds. <br className="hidden sm:inline" />
            <span className="text-[#EA580C]">Kind hearts.</span>{' '}
            <span className="text-[#0D9488]">Better humans.</span>
          </h1>

          {/* Warm, Parent-to-Parent Body Copy */}
          <p className="text-lg sm:text-xl text-[#334155] leading-relaxed mb-8 max-w-2xl mx-auto font-normal">
            Screen time you can actually exhale to. Join Ollie the Otter, Wally the Whale Shark, and four lovable ocean friends on gentle adventures teaching the <strong>alphabet, counting, big feelings, and caring for our planet</strong>.
          </p>

          {/* Dual CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10">
            <button
              type="button"
              id="hero-starter-kit-btn"
              onClick={onOpenStarterKit}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-base shadow-md hover:shadow-lg transition-all duration-200 active:scale-98 cursor-pointer group"
            >
              <Sparkles className="w-5 h-5 text-amber-200 group-hover:rotate-12 transition-transform" />
              <span>Get Free 28-Page Activity Pack & Pilot Links</span>
              <ArrowRight className="w-4 h-4 ml-0.5 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              type="button"
              id="hero-meet-characters-btn"
              onClick={onExploreCharacters}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-white hover:bg-[#F8FAFC] text-[#1E293B] font-semibold text-base border border-[#CBD5E1] shadow-2xs hover:border-[#94A3B8] transition-all duration-200 cursor-pointer"
            >
              <Waves className="w-5 h-5 text-[#0D9488]" />
              <span>Meet the Ocean Friends</span>
            </button>
          </div>

          {/* Trust Guarantees Strip */}
          <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-6 text-xs sm:text-sm font-medium text-[#475569]">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-[#0D9488]" />
              <span>Gentle pacing (no tantrums)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-[#EA580C]" />
              <span>100% ad-free & commercial-free</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-[#7C3AED]" />
              <span>Ends with screen-off play prompts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-[#0284C7]" />
              <span>Created with pediatric educators</span>
            </div>
          </div>
        </div>

        {/* Hero Character Lineup Showcase */}
        <div className="mt-12 md:mt-16 max-w-5xl mx-auto">
          <div className="relative rounded-3xl bg-gradient-to-b from-[#E0F2FE]/80 via-white to-[#CCFBF1]/40 border-2 border-white shadow-xl overflow-hidden p-6 sm:p-8 lg:p-10">
            
            {/* Top Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-sky-100 mb-8">
              <div className="flex items-center gap-3">
                <BiboLogo size="sm" />
                <div className="text-left">
                  <h2 className="text-base font-bold text-[#0F172A]">BIBO Bay: The Animated Series</h2>
                  <p className="text-xs text-[#64748B]">Meet the six characters teaching kindness, ABCs & ocean care</p>
                </div>
              </div>
              <span className="px-3.5 py-1 rounded-full bg-[#0D9488] text-white text-xs font-bold shadow-2xs">
                Season 1 Pilot In Production
              </span>
            </div>

            {/* Visual Lineup of the 6 Character Avatars */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center mb-8">
              <div className="p-3.5 rounded-2xl bg-white/90 border border-amber-100 shadow-2xs">
                <div className="text-4xl mb-2">🦦</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Ollie</h3>
                <span className="text-[10px] text-[#92400E] font-medium">Sea Otter</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/90 border border-sky-100 shadow-2xs">
                <div className="text-4xl mb-2">🦈</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Wally</h3>
                <span className="text-[10px] text-[#0284C7] font-medium">Whale Shark</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/90 border border-emerald-100 shadow-2xs">
                <div className="text-4xl mb-2">🐢</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Shelly</h3>
                <span className="text-[10px] text-[#15803D] font-medium">Sea Turtle</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/90 border border-purple-100 shadow-2xs">
                <div className="text-4xl mb-2">🦑</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Pip</h3>
                <span className="text-[10px] text-[#7C3AED] font-medium">Little Squid</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/90 border border-orange-100 shadow-2xs">
                <div className="text-4xl mb-2">🐠</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Finny</h3>
                <span className="text-[10px] text-[#EA580C] font-medium">Clownfish</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/90 border border-teal-100 shadow-2xs">
                <div className="text-4xl mb-2">🦪</div>
                <h3 className="text-xs font-bold text-[#0F172A]">Pearl</h3>
                <span className="text-[10px] text-[#0F766E] font-medium">In the Shell</span>
              </div>
            </div>

            {/* The Parent Promise Quote */}
            <div className="rounded-2xl bg-white p-5 sm:p-6 border border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#EA580C] block mb-1">
                  Our Parent Promise
                </span>
                <p className="text-sm font-semibold text-[#0F172A]">
                  “You shouldn’t have to choose between content your child loves and content you feel peaceful about.”
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenStarterKit}
                className="whitespace-nowrap px-5 py-2.5 rounded-full bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold transition-colors shadow-2xs cursor-pointer"
              >
                Claim Free Starter Kit
              </button>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
