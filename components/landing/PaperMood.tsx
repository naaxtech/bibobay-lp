import { useId } from "react";

import { brandTokens } from "@/lib/brand/tokens";

const { color } = brandTokens;

/**
 * Honest placeholder art: a collage of patterned paper cut-outs (a shape, a sun, the tide) that
 * sets a mood without pretending to illustrate a character or a scene. It stands in until
 * approved artwork exists in Sanity, and it is hidden from assistive technology.
 *
 * The composition lives in a 400×400 box anchored to the bottom of its frame; sky and tide run
 * past the box so any frame shape is filled without cropping the cut-outs.
 */

/** Cut-out silhouettes, each drawn in a 240×240 box. */
const SHAPES = {
  pebble: "M128 14C176 18 222 54 226 108C230 160 200 210 146 222C96 234 36 214 20 160C4 108 30 50 78 26C94 18 110 13 128 14Z",
  swell: "M24 140C20 96 52 58 100 50C130 45 150 62 172 58C204 52 230 82 228 122C226 168 188 198 136 200C84 202 28 186 24 140Z",
  billow:
    "M60 82C64 50 96 32 126 42C146 22 186 28 196 58C226 66 238 100 224 126C232 158 206 184 174 180C156 204 116 206 98 186C66 196 34 176 34 146C14 128 20 98 46 92C50 88 54 85 60 82Z",
  drop: "M120 16C160 58 214 104 210 154C206 200 170 228 122 226C74 224 34 196 32 150C30 104 78 60 120 16Z",
  crescent: "M150 20C96 30 56 78 58 132C60 188 106 228 162 226C116 214 88 172 90 126C92 80 116 42 150 20Z",
} as const;

type ShapeName = keyof typeof SHAPES;
type PatternName = "dots" | "waves" | "rings" | "stripes" | "checks" | "scallops";
type Circle = readonly [cx: number, cy: number, r: number];

interface Mood {
  shape: ShapeName;
  /** SVG transform placing the 240×240 cut-out in the 400×400 composition. */
  at: string;
  pattern: PatternName;
  partner: { shape: ShapeName; at: string; fill: string };
  sun?: Circle;
  bubbles?: readonly Circle[];
  /** Translate for a seagrass tuft standing in the tide. */
  seagrass?: string;
  /** Height of the tide line. */
  tide: number;
}

const MOODS: readonly Mood[] = [
  {
    shape: "pebble", at: "translate(92 70)", pattern: "dots",
    partner: { shape: "drop", at: "translate(30 182) scale(0.46) rotate(-26 120 120)", fill: color.orange },
    sun: [306, 92, 42], bubbles: [[66, 118, 8], [86, 94, 5], [54, 146, 4]], tide: 300,
  },
  {
    shape: "swell", at: "translate(30 108) scale(1.3 1)", pattern: "waves",
    partner: { shape: "pebble", at: "translate(262 40) scale(0.36)", fill: color.purple },
    sun: [98, 92, 36], bubbles: [[336, 186, 7], [356, 210, 4]], tide: 306,
  },
  {
    shape: "billow", at: "translate(84 62) scale(1.04)", pattern: "rings",
    partner: { shape: "crescent", at: "translate(10 22) scale(0.5)", fill: color.yellow },
    seagrass: "translate(318 304)", tide: 298,
  },
  {
    shape: "drop", at: "translate(108 46) rotate(14 120 120)", pattern: "stripes",
    partner: { shape: "pebble", at: "translate(34 206) scale(0.4)", fill: color.sand },
    sun: [92, 98, 34], bubbles: [[326, 120, 7], [344, 98, 4]], tide: 302,
  },
  {
    shape: "pebble", at: "translate(64 80) scale(1.04 0.92) rotate(-14 120 120)", pattern: "checks",
    partner: { shape: "drop", at: "translate(262 140) scale(0.44) rotate(30 120 120)", fill: color.teal },
    sun: [304, 76, 30], seagrass: "translate(46 300)", tide: 300,
  },
  {
    shape: "crescent", at: "translate(66 60) scale(1.12) rotate(-10 120 120)", pattern: "scallops",
    partner: { shape: "pebble", at: "translate(214 176) scale(0.42)", fill: color.purple },
    sun: [290, 96, 38], bubbles: [[338, 196, 6], [354, 220, 4]], tide: 304,
  },
];

const SEAGRASS = [
  "M0 0C-12 -22 -18 -44 -14 -68C-4 -46 6 -24 14 -2Z",
  "M18 -2C8 -32 12 -62 28 -84C30 -56 32 -28 32 -2Z",
  "M36 -2C38 -38 50 -68 72 -90C64 -60 54 -30 50 -2Z",
] as const;

/** Light marks printed on the cut-out paper; each pattern tile is in composition units. */
function PatternTile({ name }: { name: PatternName }) {
  const ink = { fill: color.paper, fillOpacity: 0.38 } as const;
  const line = { fill: "none", stroke: color.paper, strokeOpacity: 0.45, strokeLinecap: "round" } as const;
  switch (name) {
    case "dots":
      return <circle cx={11} cy={11} r={4} {...ink} />;
    case "waves":
      return <path d="M0 11C6 4 14 4 20 11S34 18 40 11" strokeWidth={4} {...line} />;
    case "rings":
      return <circle cx={22} cy={22} r={12} strokeWidth={4} {...line} />;
    case "stripes":
      return <rect width={8} height={22} {...ink} />;
    case "checks":
      return (
        <g {...ink}>
          <rect width={12} height={12} />
          <rect x={12} y={12} width={12} height={12} />
        </g>
      );
    case "scallops":
      return <path d="M0 16A8 8 0 0 1 16 16A8 8 0 0 1 32 16" strokeWidth={3} {...line} />;
  }
}

const TILE_SIZE: Record<PatternName, readonly [number, number]> = {
  dots: [22, 22],
  waves: [40, 22],
  rings: [44, 44],
  stripes: [22, 22],
  checks: [24, 24],
  scallops: [32, 16],
};

/** Accents a friend may be drawn in when the CMS gives none; order keeps neighbours distinct. */
const MOOD_ACCENTS = [color.teal, color.ocean, color.seagrass, color.purple, color.orange, color.yellow] as const;
const NAMED_ACCENTS: Record<string, string> = {
  teal: color.teal,
  yellow: color.yellow,
  amber: color.amber,
  orange: color.orange,
  purple: color.purple,
  ocean: color.ocean,
  seagrass: color.seagrass,
};

/** A CMS accent when it is a plain hex colour or a brand ink name; otherwise a palette colour by position. */
export function moodAccent(requested: string | undefined, index: number): string {
  const value = requested?.trim().toLowerCase() ?? "";
  if (/^#(?:[0-9a-f]{3}){1,2}$/.test(value)) return value;
  return NAMED_ACCENTS[value] ?? MOOD_ACCENTS[index % MOOD_ACCENTS.length]!;
}

/** Cut paper is lit from the top left, so each piece drops a soft navy shadow down and right. */
const SHADOW = { transform: "translate(5 7)", fill: color.navy, fillOpacity: 0.1 } as const;

function PaperPath({ d, fill }: { d: string; fill: string }) {
  return (
    <g>
      <path d={d} {...SHADOW} />
      <path d={d} fill={fill} />
    </g>
  );
}

function PaperCircle({ circle: [cx, cy, r], fill }: { circle: Circle; fill: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} {...SHADOW} />
      <circle cx={cx} cy={cy} r={r} fill={fill} />
    </g>
  );
}

export interface PaperMoodProps {
  /** Picks one of six compositions; neighbouring friends and stories get different ones. */
  variant: number;
  /** The colour of the main cut-out, as a hex value. */
  accent: string;
  className?: string;
}

export function PaperMood({ variant, accent, className }: PaperMoodProps) {
  const patternId = `${useId()}-paper`;
  const mood = MOODS[((variant % MOODS.length) + MOODS.length) % MOODS.length]!;
  const sun = accent === color.yellow || accent === color.amber ? color.orange : color.yellow;
  const [tileWidth, tileHeight] = TILE_SIZE[mood.pattern];
  const far = `M-420 ${mood.tide}C-200 ${mood.tide - 18} 20 ${mood.tide + 6} 200 ${mood.tide - 4}C380 ${mood.tide - 14} 600 ${mood.tide + 10} 820 ${mood.tide - 8}V760H-420Z`;
  const near = `M-420 ${mood.tide + 40}C-180 ${mood.tide + 26} 40 ${mood.tide + 50} 210 ${mood.tide + 38}C400 ${mood.tide + 26} 610 ${mood.tide + 48} 820 ${mood.tide + 34}V760H-420Z`;
  return (
    <svg
      className={className ? `paper-mood ${className}` : "paper-mood"}
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={patternId}
          width={tileWidth}
          height={tileHeight}
          patternUnits="userSpaceOnUse"
          patternTransform={mood.pattern === "stripes" ? "rotate(35)" : undefined}
        >
          <PatternTile name={mood.pattern} />
        </pattern>
      </defs>
      <rect x={-420} y={-400} width={1240} height={1160} style={{ fill: `color-mix(in srgb, ${accent} 14%, ${color.paper})` }} />
      {mood.sun ? <PaperCircle circle={mood.sun} fill={sun} /> : null}
      <g transform={mood.partner.at}>
        <PaperPath d={SHAPES[mood.partner.shape]} fill={mood.partner.fill} />
      </g>
      <g transform={mood.at}>
        <PaperPath d={SHAPES[mood.shape]} fill={accent} />
        <path d={SHAPES[mood.shape]} fill={`url(#${patternId})`} />
      </g>
      <PaperPath d={far} fill={color.ocean} />
      <PaperPath d={near} fill={color.teal} />
      {mood.seagrass ? (
        <g transform={mood.seagrass}>
          {SEAGRASS.map((leaf) => (
            <path key={leaf} d={leaf} fill={color.seagrass} />
          ))}
        </g>
      ) : null}
      {mood.bubbles?.map((bubble) => <circle key={bubble.join(",")} cx={bubble[0]} cy={bubble[1]} r={bubble[2]} fill={color.paper} />)}
    </svg>
  );
}
