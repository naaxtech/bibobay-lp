import React from 'react';
import { UPCOMING_EXTENSIONS } from '../data/biboContent';
import { BookOpen, FlaskConical, Package, Sparkles, Clock, ShieldCheck } from 'lucide-react';

export const ComingSoonEcosystemSection: React.FC = () => {
  const getIcon = (name: string) => {
    switch (name) {
      case 'BookOpen': return <BookOpen className="w-6 h-6 text-[#D97706]" />;
      case 'FlaskConical': return <FlaskConical className="w-6 h-6 text-[#EA580C]" />;
      case 'Package': return <Package className="w-6 h-6 text-[#7C3AED]" />;
      default: return <Sparkles className="w-6 h-6 text-[#0D9488]" />;
    }
  };

  return (
    <section id="coming-soon" className="py-20 bg-white border-t border-[#E2E8F0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold uppercase tracking-wider mb-3">
            <Clock className="w-3.5 h-3.5 text-[#0D9488]" />
            <span>Looking Ahead</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-[#0F172A] tracking-tight mb-4">
            Growing Beyond the Screen. <br />
            <span className="text-[#0D9488]">One Thoughtful Step at a Time</span>.
          </h2>
          <p className="text-base sm:text-lg text-[#475569] leading-relaxed">
            Our first and absolute focus is making <strong>BIBO Bay the best children’s show on television</strong>. As our characters become part of your home routines, here is what our team is gently preparing next:
          </p>
        </div>

        {/* 3 Coming Soon Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-12">
          {UPCOMING_EXTENSIONS.map((item) => (
            <div
              key={item.id}
              className="rounded-3xl bg-[#FAF9F5] border border-[#E2E8F0] p-6 sm:p-8 flex flex-col justify-between hover:shadow-md transition-shadow relative"
            >
              <div className="absolute top-6 right-6">
                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px] uppercase tracking-wider">
                  {item.status}
                </span>
              </div>

              <div>
                <div className="w-12 h-12 rounded-2xl bg-white border border-[#E2E8F0] shadow-xs flex items-center justify-center mb-4">
                  {getIcon(item.icon)}
                </div>
                <h3 className="text-xl font-display font-bold text-[#0F172A] mb-1">
                  {item.title}
                </h3>
                <span className="text-xs font-semibold text-[#0D9488] block mb-3">
                  {item.tagline}
                </span>
                <p className="text-xs sm:text-sm text-[#475569] leading-relaxed mb-6">
                  {item.description}
                </p>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex items-center gap-2 text-xs text-[#64748B]">
                <ShieldCheck className="w-4 h-4 text-[#0D9488]" />
                <span>Founding families get early preview access</span>
              </div>
            </div>
          ))}
        </div>

        {/* Reassurance Banner */}
        <div className="rounded-2xl bg-[#F0FDFA] border border-[#CCFBF1] p-6 text-center max-w-2xl mx-auto">
          <p className="text-xs sm:text-sm text-[#0F766E] leading-relaxed font-medium">
            🌱 <strong>Our Promise to Families:</strong> We will never push cheap plastic merchandise or rush out half-baked products. If it doesn’t help your child grow into a kinder, more curious human, it doesn’t belong in BIBO.
          </p>
        </div>

      </div>
    </section>
  );
};
