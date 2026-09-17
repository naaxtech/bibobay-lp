import React, { useState, useEffect } from 'react';
import { BiboLogo } from './BiboLogo';
import { Menu, X, Sparkles, Download } from 'lucide-react';

interface NavbarProps {
  onOpenStarterKit: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenStarterKit }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'The Show', href: '#the-show' },
    { name: 'Meet the Friends', href: '#characters' },
    { name: 'Why It Works', href: '#philosophy' },
    { name: 'What Kids Learn', href: '#the-show' },
    { name: 'Coming Soon', href: '#coming-soon' },
    { name: 'Parent FAQ', href: '#faq' },
  ];

  return (
    <header
      id="main-navbar"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#FAF9F5]/95 backdrop-blur-md shadow-2xs border-b border-[#E2E8F0] py-2.5'
          : 'bg-transparent py-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Brand Logo */}
        <a href="#" className="flex items-center gap-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#0D9488] rounded-xl p-1">
          <BiboLogo size="md" />
        </a>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-3 text-sm font-semibold text-[#334155]">
          {navLinks.map((link, idx) => (
            <a
              key={idx}
              href={link.href}
              className="px-3 py-1.5 rounded-full hover:text-[#0D9488] hover:bg-[#F0FDFA] transition-colors"
            >
              {link.name}
            </a>
          ))}
        </nav>

        {/* Action Button */}
        <div className="hidden sm:flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenStarterKit}
            id="nav-starter-kit-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-xs sm:text-sm shadow-xs hover:shadow-md transition-all duration-200 active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-200 animate-pulse" />
            <span>Free 28-Page Activity Pack</span>
          </button>
        </div>

        {/* Mobile menu toggle */}
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={onOpenStarterKit}
            className="sm:hidden px-3 py-1.5 rounded-full bg-[#EA580C] text-white text-xs font-bold"
          >
            Free Pack
          </button>
          <button
            type="button"
            id="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-[#334155] hover:bg-[#E2E8F0]/50 transition-colors"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#FAF9F5] border-b border-[#E2E8F0] px-4 pt-3 pb-6 shadow-lg">
          <div className="flex flex-col gap-2">
            {navLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-xl text-base font-medium text-[#1E293B] hover:bg-[#F0FDFA] hover:text-[#0D9488]"
              >
                {link.name}
              </a>
            ))}
            <div className="pt-3 border-t border-[#E2E8F0] mt-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenStarterKit();
                }}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#EA580C] text-white font-bold text-sm shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Claim Free 28-Page Family Starter Pack</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
