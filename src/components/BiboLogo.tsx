import React from 'react';

interface BiboLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  showTagline?: boolean;
}

export const BiboLogo: React.FC<BiboLogoProps> = ({
  className = '',
  size = 'md',
  showTagline = false,
}) => {
  const sizeMap = {
    sm: 'h-8',
    md: 'h-11',
    lg: 'h-16',
    xl: 'h-24',
    custom: '',
  };

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <svg
        viewBox="0 0 360 170"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${sizeMap[size]} w-auto drop-shadow-sm transition-transform duration-300 hover:scale-[1.02]`}
        aria-label="BIBO Logo"
      >
        <defs>
          {/* Soft sticker drop shadow */}
          <filter id="bibo-shadow" x="-8%" y="-8%" width="120%" height="125%" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#0F172A" floodOpacity="0.08" />
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0F172A" floodOpacity="0.06" />
          </filter>

          {/* Color Gradients for authentic tactile feel */}
          <linearGradient id="bibo-teal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22C1C3" />
            <stop offset="100%" stopColor="#0B9A9C" />
          </linearGradient>

          <linearGradient id="bibo-yellow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>

          <linearGradient id="bibo-orange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FB713B" />
            <stop offset="100%" stopColor="#EA580C" />
          </linearGradient>

          <linearGradient id="bibo-purple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8766C2" />
            <stop offset="100%" stopColor="#6C47A8" />
          </linearGradient>
        </defs>

        {/* Thick White Sticker Background Silhouette */}
        <g filter="url(#bibo-shadow)">
          <path
            d="M 28 85 
               C 22 45, 52 35, 80 36 
               C 100 37, 114 42, 126 50 
               C 134 26, 146 16, 162 16 
               C 178 16, 190 26, 198 48 
               C 214 36, 240 34, 266 40 
               C 290 45, 308 50, 324 70 
               C 344 95, 344 125, 320 144 
               C 298 160, 272 154, 246 148 
               C 224 165, 175 168, 126 160 
               C 92 162, 54 160, 36 142 
               C 20 126, 20 102, 28 85 Z"
            fill="#FFFFFF"
            stroke="#F1F5F9"
            strokeWidth="1.5"
          />
        </g>

        {/* LETTER 1: 'B' in Teal / Turquoise */}
        <g id="letter-B1">
          {/* Main B body */}
          <path
            d="M 44 48
               C 44 45, 47 42, 51 42
               L 82 42
               C 98 42, 110 50, 110 63
               C 110 71, 105 77, 97 81
               C 108 85, 115 93, 115 106
               C 115 121, 102 130, 84 130
               L 51 130
               C 47 130, 44 127, 44 124
               Z"
            fill="url(#bibo-teal)"
          />
          {/* Top hole */}
          <rect x="63" y="55" width="22" height="20" rx="9" fill="#FFFFFF" />
          {/* Bottom hole */}
          <rect x="63" y="91" width="26" height="23" rx="10" fill="#FFFFFF" />
        </g>

        {/* LETTER 2: 'i' in Sunshine Golden Yellow with 3 Sunburst Rays */}
        <g id="letter-i">
          {/* Left ray (Coral/Orange) */}
          <path
            d="M 124 40 L 118 31 C 117 29, 119 27, 122 28 L 129 36 C 131 38, 126 42, 124 40 Z"
            fill="#F97316"
          />
          {/* Center ray (Bright Orange/Amber) */}
          <path
            d="M 143 32 L 143 20 C 143 18, 146 18, 146 20 L 146 32 C 146 34, 143 34, 143 32 Z"
            fill="#F59E0B"
            stroke="#EA580C"
            strokeWidth="0.5"
          />
          {/* Right ray (Teal/Cyan) */}
          <path
            d="M 160 36 L 168 28 C 170 26, 172 28, 170 31 L 164 40 C 162 42, 158 38, 160 36 Z"
            fill="#0D9488"
          />

          {/* Dot of the i (Bright Sun) */}
          <circle cx="144.5" cy="51" r="14" fill="url(#bibo-yellow)" />

          {/* Stem of the i (rounded pillar) */}
          <rect x="133" y="73" width="23" height="57" rx="11.5" fill="url(#bibo-yellow)" />
        </g>

        {/* LETTER 3: 'B' in Warm Orange */}
        <g id="letter-B2">
          {/* Main B body */}
          <path
            d="M 172 48
               C 172 45, 175 42, 179 42
               L 211 42
               C 227 42, 239 50, 239 63
               C 239 71, 234 77, 226 81
               C 237 85, 244 93, 244 106
               C 244 121, 231 130, 213 130
               L 179 130
               C 175 130, 172 127, 172 124
               Z"
            fill="url(#bibo-orange)"
          />
          {/* Top hole */}
          <rect x="191" y="55" width="22" height="20" rx="9" fill="#FFFFFF" />
          {/* Bottom hole */}
          <rect x="191" y="91" width="26" height="23" rx="10" fill="#FFFFFF" />
        </g>

        {/* LETTER 4: 'O' in Playful Purple */}
        <g id="letter-O">
          <path
            d="M 284 42
               C 308 42, 326 61, 326 86
               C 326 111, 308 130, 284 130
               C 260 130, 242 111, 242 86
               C 242 61, 260 42, 284 42 Z"
            fill="url(#bibo-purple)"
          />
          {/* Inner cutout */}
          <ellipse cx="284" cy="86" rx="14" ry="24" fill="#FFFFFF" />
        </g>

        {/* THE CURVED SMILE ARC UNDERNEATH in Deep Navy */}
        <g id="bibo-smile">
          <path
            d="M 128 143
               C 165 159, 212 157, 246 142"
            stroke="#16284F"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>
      </svg>

      {showTagline && (
        <span className="font-display text-xs md:text-sm tracking-wide text-[#1E293B]/80 font-semibold mt-1">
          Bright minds. Kind hearts. Better humans.
        </span>
      )}
    </div>
  );
};
