"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { BayBackdrop } from "@/components/brand/BayBackdrop";
import { BiboLogo } from "@/components/brand/BiboLogo";
import { Dialog } from "@/components/ui/Dialog";
import type { Cta } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { UI_COPY } from "./ui-copy";

export interface NavbarProps {
  /** Story anchors (and the shop when commerce is on), already filtered to places that exist. */
  links: Cta[];
  /** The founding-family call to action, when its target is on the page. */
  primaryCta?: Cta;
}

/**
 * Sticky site header: the canonical logo, editorial anchor links and one founding-family call to
 * action. Below the large breakpoint the links move into a full-screen menu dialog.
 */
export function Navbar({ links, primaryCta }: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);
  // With every destination hidden in the CMS there is nothing to open: no empty landmark, no dead button.
  const hasMenu = links.length > 0 || primaryCta !== undefined;

  return (
    <header className="site-header" data-site-header>
      <div className="landing-container flex h-full items-center justify-between gap-6">
        <Link href="/" className="site-header__home">
          <BiboLogo priority className="w-[7.75rem] lg:w-[8.5rem]" />
        </Link>

        {links.length > 0 ? (
          <nav aria-label={UI_COPY.mainNavigation} className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {links.map((link) => (
                <li key={`${link.href}-${link.label}`}>
                  <CtaLink cta={link} className="nav-link" />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="flex items-center gap-3">
          {primaryCta ? <CtaLink cta={primaryCta} variant="primary" className="hidden lg:inline-flex" /> : null}
          {hasMenu ? (
            <button
              ref={menuButtonRef}
              type="button"
              className="menu-button lg:hidden"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <svg className="menu-button__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 7.5H20M4 12.5H16M4 17.5H18" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
              </svg>
              {UI_COPY.menu}
            </button>
          ) : null}
        </div>
      </div>

      <Dialog open={hasMenu && menuOpen} onClose={closeMenu} title={UI_COPY.menu} hideTitle returnFocusRef={menuButtonRef} className="mobile-menu">
        <div className="mobile-menu__bar landing-container">
          <BiboLogo decorative className="w-[7.75rem]" />
          <button type="button" className="menu-button" onClick={closeMenu}>
            <svg className="menu-button__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
            </svg>
            {UI_COPY.close}
          </button>
        </div>
        <div className="landing-container mobile-menu__body">
          <ul className="mobile-menu__links">
            {links.map((link) => (
              <li key={`${link.href}-${link.label}`}>
                <CtaLink cta={link} className="mobile-menu__link" onClick={closeMenu} />
              </li>
            ))}
          </ul>
          {primaryCta ? <CtaLink cta={primaryCta} variant="primary" className="mobile-menu__cta" onClick={closeMenu} /> : null}
        </div>
        <div className="mobile-menu__bay">
          <BayBackdrop className="absolute inset-0" />
        </div>
      </Dialog>
    </header>
  );
}
