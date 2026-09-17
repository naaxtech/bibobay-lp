import React, { useState } from 'react';
import { X, Sparkles, Download, Mail, User, Shield } from 'lucide-react';
import confetti from 'canvas-confetti';

interface StarterKitModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StarterKitModal: React.FC<StarterKitModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [childAge, setChildAge] = useState('5-7');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    setError('');
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.5 },
          colors: ['#0D9488', '#F59E0B', '#EA580C', '#7C3AED'],
        });
      } catch (e) {
        // Ignored
      }
    }, 750);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-[#E2E8F0] overflow-hidden p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        {isSuccess ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-[#CCFBF1] text-[#0D9488] mx-auto flex items-center justify-center text-2xl mb-3">
              🌊
            </div>
            <h3 className="text-2xl font-display font-bold text-[#0F172A] mb-2">
              Pack On Its Way!
            </h3>
            <p className="text-xs sm:text-sm text-[#475569] mb-6">
              We just sent the <strong>28-Page Family Starter Pack & Pilot Screening</strong> to <strong>{email}</strong>.
            </p>
            <div className="p-3 bg-[#FAF9F5] rounded-xl border border-[#E2E8F0] text-xs text-[#0F766E] mb-6 font-medium">
              Check your inbox for 12 character coloring sheets, the fridge emotion chart, and the pilot video stream!
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-full bg-[#0F172A] text-white font-bold text-sm"
            >
              Back to BIBO Bay
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center mb-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#CCFBF1] text-[#0F766E] text-xs font-bold mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Free Founding Parents Pack</span>
              </div>
              <h3 className="text-2xl font-display font-bold text-[#0F172A]">
                The 28-Page Activity Bundle
              </h3>
              <p className="text-xs text-[#64748B] mt-1">
                Printable coloring book, kitchen science cards, and private pilot screening.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Your First Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  placeholder="e.g. Rachel"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#CBD5E1] text-sm focus:border-[#0D9488] outline-hidden bg-[#FAF9F5]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Your Email Address *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#CBD5E1] text-sm focus:border-[#0D9488] outline-hidden bg-[#FAF9F5]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Child’s Age Group
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['2-4', '5-7', '8+'].map((age) => (
                  <button
                    key={age}
                    type="button"
                    onClick={() => setChildAge(age)}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      childAge === age
                        ? 'bg-[#0F172A] text-white border-[#0F172A]'
                        : 'bg-[#FAF9F5] text-[#475569] border-[#E2E8F0]'
                    }`}
                  >
                    Ages {age}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-sm shadow-md transition-all active:scale-98 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {isSubmitting ? (
                <span>Preparing your pack...</span>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Send Free 28-Page Family Pack</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-2 text-[11px] text-[#64748B] pt-2">
              <Shield className="w-3.5 h-3.5 text-[#0D9488]" />
              <span>100% Free • No Spam • Safe for Little Eyes</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
