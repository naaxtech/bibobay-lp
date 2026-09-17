import React, { useState } from 'react';
import { Sparkles, Download, CheckCircle, Mail, User, Shield, ArrowRight, Heart } from 'lucide-react';
import confetti from 'canvas-confetti';
import { LeadFormData } from '../types';

export const EmailCaptureSection: React.FC = () => {
  const [formData, setFormData] = useState<LeadFormData>({
    email: '',
    parentName: '',
    childAge: '5-7',
    primaryInterest: 'kindness-emotions',
    newsletterOptIn: true,
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);

      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#0D9488', '#F59E0B', '#EA580C', '#7C3AED'],
        });
      } catch (err) {
        // Ignored
      }
    }, 850);
  };

  const ageOptions = [
    { label: 'Little Cubs (Ages 2–4)', value: '2-4' },
    { label: 'Curious Explorers (Ages 5–7)', value: '5-7' },
    { label: 'Junior Makers (Ages 8+)', value: '8+' },
  ];

  return (
    <section id="starter-kit" className="py-20 bg-[#FAF9F5] border-t border-[#E2E8F0] relative overflow-hidden">
      {/* Warm Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-5xl h-[450px] bg-gradient-to-r from-[#22C1C3]/10 via-[#F59E0B]/10 to-[#EA580C]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="max-w-4xl mx-auto rounded-3xl bg-white border border-[#E2E8F0] shadow-xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12">
            
            {/* Left Column: What Parents Receive */}
            <div className="lg:col-span-5 bg-[#0F172A] text-white p-8 sm:p-10 flex flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#22C1C3]/20 text-[#22C1C3] text-xs font-bold uppercase tracking-wider mb-4">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Free Welcome Gift for Parents</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-display font-bold mb-3 leading-tight">
                  Join the Founding Parents & Get the Free 28-Page Kit
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mb-6 leading-relaxed">
                  Join 14,000+ mindful parents testing a calmer way to do screen time. Instant access right to your inbox:
                </p>

                <div className="space-y-3.5 text-xs sm:text-sm">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle className="w-4 h-4 text-[#22C1C3] shrink-0 mt-0.5" />
                    <span><strong>Private Pilot Screening:</strong> Watch Episode 1 of BIBO Bay before the official premiere.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle className="w-4 h-4 text-[#FBBF24] shrink-0 mt-0.5" />
                    <span><strong>Printable Coloring Book:</strong> 12 pages featuring Ollie, Wally, Shelly, and the ocean friends.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle className="w-4 h-4 text-[#EA580C] shrink-0 mt-0.5" />
                    <span><strong>Big Feelings Fridge Chart:</strong> A gentle visual tool to help kids name emotions without shame.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle className="w-4 h-4 text-[#C084FC] shrink-0 mt-0.5" />
                    <span><strong>Sunday Night Spark:</strong> One 2-minute offline play prompt emailed every Sunday for easy family bonding.</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-800 mt-8 flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-4 h-4 text-[#22C1C3]" />
                <span>100% ad-free, zero spam, cancel anytime in 1 click.</span>
              </div>
            </div>

            {/* Right Column: Parent Form */}
            <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
              {isSuccess ? (
                <div className="text-center py-8 animate-in fade-in duration-300">
                  <div className="w-16 h-16 rounded-full bg-[#CCFBF1] text-[#0D9488] mx-auto flex items-center justify-center text-3xl mb-4">
                    🌊
                  </div>
                  <h4 className="text-2xl font-display font-bold text-[#0F172A] mb-2">
                    Welcome to the Bay, {formData.parentName || 'Friend'}!
                  </h4>
                  <p className="text-sm text-[#475569] max-w-md mx-auto mb-6">
                    We just sent your <strong>28-Page Family Discovery Pack & Pilot Access</strong> to <strong>{formData.email}</strong>.
                  </p>

                  <div className="p-4 rounded-2xl bg-[#F0FDFA] border border-[#CCFBF1] mb-6 text-left max-w-md mx-auto text-xs text-[#0F766E] space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <Download className="w-4 h-4" /> Your Pack Contains:
                    </div>
                    <div>• 12x Printable Character Coloring Sheets (PDF)</div>
                    <div>• Emotion Volcano & Calm Ocean Breathing Chart</div>
                    <div>• 5x Zero-Prep Kitchen Science Activity Cards</div>
                    <div>• Private VIP link to the BIBO Bay pilot episode</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSuccess(false);
                      setFormData({
                        email: '',
                        parentName: '',
                        childAge: '5-7',
                        primaryInterest: 'kindness-emotions',
                        newsletterOptIn: true,
                      });
                    }}
                    className="text-xs text-[#64748B] hover:text-[#0F172A] underline cursor-pointer"
                  >
                    Add another email or reset
                  </button>
                </div>
              ) : (
                <form onSubmit={handleFormSubmit} className="space-y-4" id="founding-parents-form">
                  <div>
                    <h4 className="text-xl font-display font-bold text-[#0F172A] mb-1">
                      Claim Your Free 28-Page Pack
                    </h4>
                    <p className="text-xs text-[#64748B]">
                      Tell us a little bit about your family so we can tailor your activity pack.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                      {errorMessage}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="parent-name" className="block text-xs font-semibold text-[#334155] mb-1">
                        Your First Name
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          id="parent-name"
                          value={formData.parentName}
                          onChange={(e) => setFormData({ ...formData, parentName: e.target.value })}
                          placeholder="e.g. Maria"
                          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#CBD5E1] text-sm focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] outline-hidden bg-[#FAF9F5]"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="parent-email" className="block text-xs font-semibold text-[#334155] mb-1">
                        Email Address <span className="text-[#EA580C]">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          id="parent-email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          placeholder="you@example.com"
                          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#CBD5E1] text-sm focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] outline-hidden bg-[#FAF9F5]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Child Age */}
                  <div>
                    <label className="block text-xs font-semibold text-[#334155] mb-1.5">
                      Your Child’s Age Group
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {ageOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormData({ ...formData, childAge: opt.value })}
                          className={`py-2 px-2 text-center rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                            formData.childAge === opt.value
                              ? 'bg-[#0F172A] text-white border-[#0F172A]'
                              : 'bg-[#FAF9F5] text-[#475569] border-[#E2E8F0] hover:bg-slate-100'
                          }`}
                        >
                          {opt.label.split('(')[0]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    id="submit-parent-starter-kit-btn"
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all active:scale-98 cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <span>Sending Your Family Pack...</span>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Send Me the Free 28-Page Family Pack</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <p className="text-[11px] text-center text-[#64748B]">
                    Strictly no spam. We hate junk email just as much as junk TV.
                  </p>
                </form>
              )}
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
