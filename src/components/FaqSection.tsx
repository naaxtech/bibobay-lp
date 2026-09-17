import React, { useState } from 'react';
import { PARENT_FAQS } from '../data/biboContent';
import { ChevronDown, HelpCircle, Sparkles } from 'lucide-react';

export const FaqSection: React.FC = () => {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIdx(openIdx === idx ? null : idx);
  };

  return (
    <section id="faq" className="py-20 bg-white border-t border-[#E2E8F0] relative">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold uppercase tracking-wider mb-3">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Parent Questions, Answered Honestly</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-[#0F172A] tracking-tight mb-3">
            What Parents Ask Us Most
          </h2>
          <p className="text-sm sm:text-base text-[#64748B]">
            Honest, straightforward answers about our pacing, release timeline, and ad-free promise.
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3.5">
          {PARENT_FAQS.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className={`rounded-2xl border transition-all ${
                  isOpen
                    ? 'bg-[#FAF9F5] border-[#0D9488]/40 shadow-2xs'
                    : 'bg-white border-[#E2E8F0] hover:border-slate-300'
                }`}
              >
                <button
                  type="button"
                  id={`faq-accordion-toggle-${idx}`}
                  onClick={() => toggle(idx)}
                  className="w-full text-left p-5 sm:p-6 flex items-center justify-between gap-4 cursor-pointer"
                >
                  <span className="text-sm sm:text-base font-display font-bold text-[#0F172A]">
                    {item.question}
                  </span>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 bg-[#0D9488] text-white' : 'bg-[#FAF9F5] text-slate-500'
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 sm:px-6 pb-5 sm:pb-6 text-xs sm:text-sm text-[#475569] leading-relaxed border-t border-[#E2E8F0]/60 pt-3">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
