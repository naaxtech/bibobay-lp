/**
 * The words the order pad says to a screen reader through its one polite status line (spec §13):
 * a removal, a quantity held down to the most one order can hold, and a quantity that was refused.
 * Kept beside the pad (the shared landing copy is not edited for this).
 */
export const ORDER_PAD_ANNOUNCE = {
  removed: (name: string) => `${name} removed`,
  capped: (name: string, most: number) => `${name}: the most one order can hold is ${most}, so the quantity is ${most}.`,
  refused: (name: string, kept: number, most: number) => `${name}: the quantity must be a whole number from 1 to ${most}, so it stays at ${kept}.`,
} as const;
