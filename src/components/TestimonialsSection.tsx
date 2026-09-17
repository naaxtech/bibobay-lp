import React from 'react';
import { TESTIMONIALS } from '../data/biboContent';
import { Star, Quote, ShieldCheck } from 'lucide-react';

export const TestimonialsSection: React.FC = () => {
  return (
    <section className="py-20 bg-white border-t border-[#E2E8F0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold uppercase tracking-wider mb-3">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Trusted By Parents & Child Experts</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            “Finally, Screen Time I <br className="hidden sm:inline" />
            <span className="text-[#0D9488]">Feel Truly Good About</span>.”
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            Read how pediatric neuropsychologists, educators, and everyday families experience the transition to BIBO’s intentional pacing.
          </p>
        </div>

        {/* 3 Testimonial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.id}
              className="rounded-3xl bg-[#FAF9F5] border border-[#E2E8F0] p-6 sm:p-8 flex flex-col justify-between shadow-2xs hover:shadow-xs transition-shadow"
            >
              <div>
                <div className="flex items-center gap-1 text-amber-400 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-current" />
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-[#334155] leading-relaxed mb-6 italic">
                  “{t.quote}”
                </p>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex items-center gap-3">
                <img
                  src={t.avatar}
                  alt={t.author}
                  className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-xs"
                />
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-[#0F172A]">{t.author}</h3>
                  <p className="text-[11px] text-[#64748B]">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
