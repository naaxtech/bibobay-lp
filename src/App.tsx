import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { ShowPreviewSection } from './components/ShowPreviewSection';
import { MeetCharactersSection } from './components/MeetCharactersSection';
import { PhilosophySection } from './components/PhilosophySection';
import { ScreenToLifeLoop } from './components/ScreenToLifeLoop';
import { ComingSoonEcosystemSection } from './components/ComingSoonEcosystemSection';
import { TestimonialsSection } from './components/TestimonialsSection';
import { EmailCaptureSection } from './components/EmailCaptureSection';
import { FaqSection } from './components/FaqSection';
import { Footer } from './components/Footer';
import { StarterKitModal } from './components/StarterKitModal';

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const handleOpenStarterKit = () => {
    setIsModalOpen(true);
  };

  const handleCloseStarterKit = () => {
    setIsModalOpen(false);
  };

  const handleExploreCharacters = () => {
    const el = document.getElementById('characters');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-[#1E293B] font-body flex flex-col selection:bg-[#0D9488]/20 selection:text-[#0D9488]">
      {/* Sticky Navigation Bar */}
      <Navbar onOpenStarterKit={handleOpenStarterKit} />

      {/* Main Content Sections */}
      <main className="flex-1">
        {/* 1. Hero: Spotlighting BIBO Bay the Show */}
        <HeroSection
          onOpenStarterKit={handleOpenStarterKit}
          onExploreCharacters={handleExploreCharacters}
        />

        {/* 2. The Show: BIBO Bay Episodes & Early Learning Focus */}
        <ShowPreviewSection onOpenStarterKit={handleOpenStarterKit} />

        {/* 3. Meet the 6 Ocean Friends (Plush Felt Characters) */}
        <MeetCharactersSection />

        {/* 4. Why It Works for Parents: The 5:30 PM Reality & Gentle Pacing */}
        <PhilosophySection />

        {/* 5. From Screen to Real Life: How Episodes End Without Meltdowns */}
        <ScreenToLifeLoop />

        {/* 6. What's Next: BIBO Academy, Lab & Toys (Coming Soon) */}
        <ComingSoonEcosystemSection />

        {/* 7. Parent & Educator Reviews */}
        <TestimonialsSection />

        {/* 8. Founding Parents Lead Capture Hub (Free 28-Page Pack & Pilot Access) */}
        <EmailCaptureSection />

        {/* 9. Mindful Parent FAQs */}
        <FaqSection />
      </main>

      {/* Brand Footer */}
      <Footer />

      {/* Global Starter Kit Modal */}
      <StarterKitModal isOpen={isModalOpen} onClose={handleCloseStarterKit} />
    </div>
  );
}
