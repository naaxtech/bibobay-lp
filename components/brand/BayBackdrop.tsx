import { brandTokens } from "@/lib/brand/tokens";

export type BayLayerName = "sun" | "clouds" | "far-sea" | "mid-sea" | "near-sea" | "shore";

interface PaperShape {
  d: string;
  fill: string;
  /** A ripple is a light mark printed on the sea; it casts no paper shadow. */
  ripple?: boolean;
}

interface BayLayer {
  name: BayLayerName;
  /** Parallax hint for motion code: 0 stays still, 1 moves with the page. */
  depth: number;
  shapes: readonly PaperShape[];
}

const { color } = brandTokens;

/**
 * Back to front. Sea and shore bands overrun the canvas so their paper shadows never show a raw edge.
 * The sun sits centre-right so a narrow (phone) crop of the slice still shows it.
 */
const BAY_LAYERS: readonly BayLayer[] = [
  {
    name: "sun",
    depth: 0.15,
    shapes: [
      { d: "M870 200C917 200 955 239 955 287C955 334 916 371 869 371C822 371 785 333 785 285C785 238 823 200 870 200Z", fill: color.yellow },
    ],
  },
  {
    name: "clouds",
    depth: 0.3,
    shapes: [
      {
        d: "M150 212C146 192 162 176 184 178C190 152 216 138 246 142C262 112 306 102 338 120C358 104 398 110 410 138C440 136 466 154 464 182C462 200 452 212 434 214C350 220 236 218 150 212Z",
        fill: color.paper,
      },
      {
        d: "M912 290C908 274 920 262 938 264C944 242 968 230 992 236C1008 214 1046 210 1066 230C1090 222 1118 236 1120 260C1138 264 1144 282 1132 292C1062 298 978 296 912 290Z",
        fill: color.paper,
      },
    ],
  },
  {
    name: "far-sea",
    depth: 0.45,
    shapes: [
      { d: "M-40 354C110 338 230 342 350 350C480 359 600 340 740 344C880 348 990 334 1130 340C1260 346 1360 336 1480 330L1480 680L-40 680Z", fill: color.ocean },
      { d: "M560 394C600 382 642 382 682 394C642 388 600 388 560 394Z", fill: color.paper, ripple: true },
    ],
  },
  {
    name: "mid-sea",
    depth: 0.6,
    shapes: [
      { d: "M-40 432C150 410 300 428 470 422C640 416 780 400 950 412C1110 423 1270 404 1480 410L1480 680L-40 680Z", fill: color.teal },
      { d: "M880 462C930 450 980 450 1030 462C980 456 930 456 880 462Z", fill: color.paper, ripple: true },
    ],
  },
  {
    name: "near-sea",
    depth: 0.8,
    shapes: [
      { d: "M-40 508C170 488 330 506 510 500C690 494 850 480 1030 492C1190 503 1320 486 1480 492L1480 680L-40 680Z", fill: color.tealInk },
      { d: "M240 548C280 538 322 538 362 548C322 543 280 543 240 548Z", fill: color.paper, ripple: true },
    ],
  },
  {
    name: "shore",
    depth: 1,
    shapes: [
      { d: "M-40 562C120 536 260 540 400 562C520 581 680 592 860 590C1040 588 1240 596 1480 584L1480 680L-40 680Z", fill: color.sand },
      { d: "M100 568C88 546 82 524 86 500C96 522 106 544 114 566Z", fill: color.seagrass },
      { d: "M118 566C108 536 112 506 128 484C130 512 132 540 132 566Z", fill: color.seagrass },
      { d: "M136 566C138 530 150 500 172 478C164 508 154 538 150 566Z", fill: color.seagrass },
      { d: "M1288 590C1282 566 1286 544 1298 528C1300 550 1302 570 1300 590Z", fill: color.seagrass },
      { d: "M1304 590C1308 566 1318 548 1334 534C1326 556 1318 574 1316 590Z", fill: color.seagrass },
    ],
  },
];

/** Cut paper is lit from the top left, so each piece drops a soft navy shadow down and right. */
const PAPER_SHADOW_OFFSET = "translate(6 9)";

export interface BayBackdropProps {
  /** Position and size the backdrop; it covers its box from the bottom edge. */
  className?: string;
}

/**
 * Decorative cut-paper Bay horizon: sun, clouds, three sea layers and a seagrass shore.
 * Hidden from assistive technology. Every layer renders fully visible; motion code may move
 * `[data-bay-layer]` groups by their `data-depth`, but never needs to reveal them.
 */
export function BayBackdrop({ className }: BayBackdropProps) {
  return (
    <svg
      className={className ? `bay-backdrop ${className}` : "bay-backdrop"}
      viewBox="0 0 1440 640"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {BAY_LAYERS.map((layer) => (
        <g key={layer.name} data-bay-layer={layer.name} data-depth={layer.depth}>
          {layer.shapes.map((shape) =>
            shape.ripple ? (
              <path key={shape.d} d={shape.d} fill={shape.fill} fillOpacity={0.55} />
            ) : (
              <g key={shape.d}>
                <path d={shape.d} transform={PAPER_SHADOW_OFFSET} fill={color.navy} fillOpacity={0.1} />
                <path d={shape.d} fill={shape.fill} />
              </g>
            ),
          )}
        </g>
      ))}
    </svg>
  );
}
