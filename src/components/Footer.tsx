import React from 'react';
import { BiboLogo } from './BiboLogo';
import { Sparkles, ArrowUp, Waves, Heart } from 'lucide-react';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#0F172A] text-white pt-16 pb-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 pb-12 border-b border-slate-800">
          
          {/* Brand Column */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white/10 p-2.5 rounded-2xl inline-block">
              <BiboLogo size="md" />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
              BIBO is the family brand dedicated to raising bright, kind, curious, and responsible little humans. Starting with our flagship animated show, <strong>BIBO Bay</strong>.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#22C1C3] font-semibold">
              <Sparkles className="w-4 h-4 text-[#FBBF24]" />
              <span>Entertain first. Enrich always.</span>
            </div>
          </div>

          {/* BIBO Bay The Show */}
          <div className="lg:col-span-3 space-y-3">
            <h4 className="text-sm font-display font-bold text-white uppercase tracking-wider">
              BIBO Bay (The Show)
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-slate-400">
              <li>
                <a href="#the-show" className="hover:text-white transition-colors">
                  Episode Guide & Lessons
                </a>
              </li>
              <li>
                <a href="#characters" className="hover:text-white transition-colors">
                  Meet Ollie, Wally & Friends
                </a>
              </li>
              <li>
                <a href="#loop" className="hover:text-white transition-colors">
                  The Screen-Off Promise
                </a>
              </li>
              <li>
                <a href="#philosophy" className="hover:text-white transition-colors">
                  Why Gentle Pacing Works
                </a>
              </li>
              <li>
                <a href="#starter-kit" className="hover:text-white transition-colors">
                  Free 28-Page Family Pack
                </a>
              </li>
            </ul>
          </div>

          {/* Coming Soon Extensions */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="text-sm font-display font-bold text-white uppercase tracking-wider">
              Coming Soon
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-slate-400">
              <li>
                <a href="#coming-soon" className="hover:text-white transition-colors">
                  BIBO Academy
                </a>
              </li>
              <li>
                <a href="#coming-soon" className="hover:text-white transition-colors">
                  BIBO Lab (Kitchen STEM)
                </a>
              </li>
              <li>
                <a href="#coming-soon" className="hover:text-white transition-colors">
                  Plastic-Free Plush & Toys
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white transition-colors">
                  Parent FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* The Parent Promise Card */}
          <div className="lg:col-span-3 space-y-3">
            <h4 className="text-sm font-display font-bold text-white uppercase tracking-wider">
              Our Parent Promise
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              You shouldn’t have to choose between content your child loves and content you feel peaceful about.
            </p>
            <div className="p-3.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs text-slate-300">
              “Yes. They can watch this.”
            </div>
            <button
              type="button"
              onClick={scrollToTop}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mt-2 cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
              <span>Back to Top</span>
            </button>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            © {new Date().getFullYear()} BIBO Brand. Bright minds. Kind hearts. Better humans.
          </div>
          <div className="flex items-center gap-4">
            <a href="#philosophy" className="hover:text-slate-300 transition-colors">Parent Peace of Mind</a>
            <span>•</span>
            <a href="#characters" className="hover:text-slate-300 transition-colors">Meet the Characters</a>
            <span>•</span>
            <a href="#starter-kit" className="hover:text-slate-300 transition-colors">Founding Parents Pack</a>
          </div>
        </div>

      </div>
    </footer>
  );
};
