/**
 * BIBO Bay brand tokens: the typed source for colour, type, radius, shadow, spacing, motion and focus.
 *
 * app/globals.css declares `brandCssVariables` on :root (plus the reduced-motion override), and
 * tests/brand/tokens.test.ts fails if a name or value drifts between this file and the stylesheet.
 * The logo inks below are the exact colours painted by public/bibo-logo.svg.
 */

const color = {
  // Paper and ink
  cream: "#f8f3e9",
  paper: "#ffffff",
  sand: "#ede0c6",
  line: "#dccfb6",
  navy: "#13294b",
  navySoft: "#45536b",
  // Logo inks, sampled from references/bibo-logo.jpg and fixed as production values
  teal: "#29aba8",
  yellow: "#f9b224",
  amber: "#f6a31c",
  orange: "#f06323",
  purple: "#7c5fa8",
  // Text-safe deep tones of the logo inks: at least 4.5:1 on cream, paper and sand
  tealInk: "#0c6b68",
  orangeInk: "#a93b0c",
  purpleInk: "#5b4189",
  // Bay system colours
  ocean: "#3aa8d0",
  seagrass: "#5e9f6e",
} as const;

const font = {
  display: 'var(--font-fredoka, "Fredoka"), ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif',
  body: 'var(--font-plus-jakarta, "Plus Jakarta Sans"), system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/** Seven fluid steps, largest first. Body never drops below 1rem; small never below 0.875rem. */
const typeScale = {
  display: { size: "clamp(2.75rem, 1.85rem + 4.4vw, 5.5rem)", leading: "1.02" },
  h1: { size: "clamp(2.25rem, 1.65rem + 2.9vw, 4rem)", leading: "1.05" },
  h2: { size: "clamp(1.75rem, 1.4rem + 1.7vw, 2.75rem)", leading: "1.1" },
  h3: { size: "clamp(1.375rem, 1.2rem + 0.85vw, 1.875rem)", leading: "1.2" },
  lead: { size: "clamp(1.125rem, 1.05rem + 0.35vw, 1.375rem)", leading: "1.5" },
  body: { size: "clamp(1rem, 0.97rem + 0.15vw, 1.0625rem)", leading: "1.6" },
  small: { size: "0.875rem", leading: "1.45" },
} as const;

const radius = {
  soft: "0.75rem",
  paper: "1.25rem",
  sticker: "2rem",
  pill: "999px",
} as const;

/** Cut-paper light falls from the top left, so every cast layer drops down and to the right. */
const shadow = {
  paper: "0.125rem 0.1875rem 0 rgb(19 41 75 / 0.06), 0.25rem 0.5rem 1.25rem rgb(19 41 75 / 0.12)",
  felt: "inset 0 0.0625rem 0 rgb(255 255 255 / 0.65), 0.125rem 0.375rem 1.5rem rgb(19 41 75 / 0.1)",
  lifted: "0.1875rem 0.375rem 0 rgb(19 41 75 / 0.07), 0.5rem 1rem 2rem rgb(19 41 75 / 0.16)",
} as const;

const space = {
  tight: "clamp(0.5rem, 0.42rem + 0.4vw, 0.75rem)",
  block: "clamp(1rem, 0.8rem + 1vw, 1.5rem)",
  gutter: "clamp(1rem, 0.4rem + 3vw, 3rem)",
  section: "clamp(4rem, 2.6rem + 7vw, 8.5rem)",
} as const;

/**
 * Durations in milliseconds. Every one drops to 0ms under prefers-reduced-motion. Motion code should
 * read these numbers rather than parse the CSS variables: the CSS minifier may serve 320ms as .32s.
 */
const motion = {
  duration: {
    press: 120,
    quick: 180,
    base: 320,
    gentle: 560,
    drift: 18000,
  },
  easing: {
    paper: "cubic-bezier(0.22, 1, 0.36, 1)",
    press: "cubic-bezier(0.3, 0, 0.2, 1)",
    drift: "cubic-bezier(0.45, 0, 0.55, 1)",
  },
} as const;

/** Focus ring for light surfaces; `colorOnDark` applies inside `[data-surface="navy"]`. */
const focus = {
  color: color.navy,
  colorOnDark: color.yellow,
  width: "3px",
  offset: "3px",
} as const;

export const brandTokens = { color, font, typeScale, radius, shadow, space, motion, focus } as const;

export type BrandTokens = typeof brandTokens;
export type BrandColor = keyof typeof color;
export type BrandTypeStep = keyof typeof typeScale;
export type BrandDuration = keyof typeof motion.duration;
export type BrandCssVariable = `--bibo-${string}`;

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function prefixed(prefix: string, values: Readonly<Record<string, string | number>>, unit = "") {
  return Object.entries(values).map(([name, value]) => [`--bibo-${prefix}-${kebab(name)}`, `${value}${unit}`] as const);
}

/** Every token as the CSS custom property declared on :root in app/globals.css. */
export const brandCssVariables: Readonly<Record<BrandCssVariable, string>> = Object.freeze(
  Object.fromEntries([
    ...prefixed("color", color),
    ...prefixed("font", font),
    ...prefixed("text", Object.fromEntries(Object.entries(typeScale).map(([step, value]) => [step, value.size]))),
    ...prefixed("leading", Object.fromEntries(Object.entries(typeScale).map(([step, value]) => [step, value.leading]))),
    ...prefixed("radius", radius),
    ...prefixed("shadow", shadow),
    ...prefixed("space", space),
    ...prefixed("duration", motion.duration, "ms"),
    ...prefixed("ease", motion.easing),
    ...prefixed("focus", focus),
  ]),
);

/** The :root override applied under `@media (prefers-reduced-motion: reduce)`. */
export const brandReducedMotionCssVariables: Readonly<Record<BrandCssVariable, string>> = Object.freeze(
  Object.fromEntries(prefixed("duration", motion.duration).map(([name]) => [name, "0ms"])),
);
