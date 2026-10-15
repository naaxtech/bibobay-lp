import { brandTokens } from "@/lib/brand/tokens";

export type ReefLayerName = "rays" | "far-bubbles" | "near-bubbles" | "sand";

interface ReefShape {
  d: string;
  fill: string;
  fillOpacity?: number;
  /** A dune is part of the sea floor; the front dune matches the section printed below the reef. */
  dune?: boolean;
}

interface Bubble {
  cx: number;
  cy: number;
  r: number;
}

interface ReefLayer {
  name: ReefLayerName;
  /** Parallax hint for motion code: 0 stays still, 1 moves with the page. */
  depth: number;
  shapes?: readonly ReefShape[];
  bubbles?: readonly Bubble[];
}

const { color } = brandTokens;
const WHITE = "#ffffff";

/** Sunbeams fanning down from the surface: wide and faint, so text over them keeps its contrast. */
const RAYS: readonly ReefShape[] = [
  { d: "M150 -20H300L560 720H330Z", fill: WHITE, fillOpacity: 0.16 },
  { d: "M470 -20H560L760 720H620Z", fill: WHITE, fillOpacity: 0.12 },
  { d: "M760 -20H900L960 720H780Z", fill: WHITE, fillOpacity: 0.14 },
  { d: "M1060 -20H1150L1020 720H900Z", fill: WHITE, fillOpacity: 0.1 },
  { d: "M1250 -20H1400L1180 720H1010Z", fill: WHITE, fillOpacity: 0.13 },
];

/** Bubbles rising from the reef; the narrow centre of the canvas (a phone's crop) keeps a few of each. */
const FAR_BUBBLES: readonly Bubble[] = [
  { cx: 96, cy: 300, r: 5 }, { cx: 212, cy: 168, r: 4 }, { cx: 318, cy: 410, r: 6 }, { cx: 452, cy: 120, r: 4 },
  { cx: 604, cy: 236, r: 5 }, { cx: 668, cy: 92, r: 3 }, { cx: 742, cy: 330, r: 4 }, { cx: 812, cy: 186, r: 6 },
  { cx: 948, cy: 128, r: 4 }, { cx: 1034, cy: 352, r: 5 }, { cx: 1172, cy: 214, r: 4 }, { cx: 1296, cy: 96, r: 6 },
  { cx: 1384, cy: 300, r: 4 },
];

const NEAR_BUBBLES: readonly Bubble[] = [
  { cx: 54, cy: 470, r: 14 }, { cx: 238, cy: 300, r: 10 }, { cx: 560, cy: 420, r: 12 }, { cx: 702, cy: 214, r: 9 },
  { cx: 860, cy: 388, r: 15 }, { cx: 1102, cy: 470, r: 11 }, { cx: 1238, cy: 330, r: 17 }, { cx: 1404, cy: 182, r: 10 },
];

/** Finger coral: rounded fingers rising from one base line, as `[centre x, top y, radius]`. */
function coral(base: number, fingers: ReadonlyArray<readonly [number, number, number]>): string {
  return fingers.map(([x, top, r]) => `M${x - r} ${base}V${top + r}A${r} ${r} 0 0 1 ${x + r} ${top + r}V${base}Z`).join("");
}

/**
 * The sea floor, kept low (nothing rises above y 590 of 720) so the copy above it stays clear: a warm
 * back dune, seagrass and finger coral towards the edges, then the front dune in the sand below.
 */
const SAND: readonly ReefShape[] = [
  { d: "M-20 650C160 618 340 612 540 628C720 642 880 622 1060 610C1220 600 1350 612 1460 628V740H-20Z", fill: color.sandWarm, dune: true },
  // Seagrass at both edges.
  { d: "M228 648C214 618 218 598 236 588C234 610 240 630 248 648Z", fill: color.kelp },
  { d: "M246 648C250 616 266 600 284 594C272 616 268 632 268 648Z", fill: color.seagrass },
  { d: "M1188 640C1180 614 1186 596 1202 588C1200 608 1204 626 1210 640Z", fill: color.kelp },
  { d: "M1208 640C1214 616 1228 602 1244 596C1234 616 1230 630 1230 640Z", fill: color.seagrass },
  // Finger coral in the reef's pink, lilac and orange.
  { d: coral(654, [[300, 606, 9], [318, 596, 9], [336, 610, 8], [352, 620, 7]]), fill: color.coral, fillOpacity: 0.9 },
  { d: coral(644, [[1104, 600, 9], [1122, 590, 10], [1141, 604, 8]]), fill: color.lilac },
  { d: coral(642, [[1262, 612, 7], [1276, 604, 7], [1290, 616, 6]]), fill: color.orange, fillOpacity: 0.9 },
  { d: "M-20 700C180 672 380 672 600 684C820 696 1000 680 1200 670C1320 664 1400 668 1460 674V740H-20Z", fill: color.sand, dune: true },
];

/** Back to front. Only the sand stays with the page; light and bubbles lag behind as it scrolls. */
const REEF_LAYERS: readonly ReefLayer[] = [
  { name: "rays", depth: 0.15, shapes: RAYS },
  { name: "far-bubbles", depth: 0.4, bubbles: FAR_BUBBLES },
  { name: "near-bubbles", depth: 0.7, bubbles: NEAR_BUBBLES },
  { name: "sand", depth: 1, shapes: SAND },
];

function BubbleShape({ cx, cy, r, near }: Bubble & { near: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={WHITE} fillOpacity={near ? 0.18 : 0.4} stroke={WHITE} strokeOpacity={near ? 0.75 : 0} strokeWidth={2} />
      {near ? <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.28} fill={WHITE} fillOpacity={0.8} /> : null}
    </g>
  );
}

export interface ReefBackdropProps {
  /** Position and size the reef; it covers its box from the bottom edge. */
  className?: string;
}

/**
 * Decorative sunlit reef in Bibo Bay's colours: sunbeams, far and near bubbles, and a sandy floor
 * with coral and seagrass. It is drawn over the section's water (the CMS ground), hidden from
 * assistive technology, and every layer renders fully visible. Motion code may move the
 * `[data-bay-layer]` groups by their `data-depth` (the same contract as the paper bay), but never
 * needs to reveal them.
 */
export function ReefBackdrop({ className }: ReefBackdropProps) {
  return (
    <svg
      className={className ? `reef-backdrop ${className}` : "reef-backdrop"}
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {REEF_LAYERS.map((layer) => (
        <g key={layer.name} data-bay-layer={layer.name} data-depth={layer.depth}>
          {layer.shapes?.map((shape) => (
            <path key={shape.d} d={shape.d} fill={shape.fill} fillOpacity={shape.fillOpacity} data-dune={shape.dune ? "" : undefined} />
          ))}
          {layer.bubbles?.map((bubble) => (
            <BubbleShape key={`${bubble.cx}-${bubble.cy}`} {...bubble} near={layer.name === "near-bubbles"} />
          ))}
        </g>
      ))}
    </svg>
  );
}
