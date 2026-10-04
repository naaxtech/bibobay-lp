import { useId, useState, type KeyboardEvent } from "react";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * WAI-ARIA tabs with automatic activation and a roving tabindex: one tab stop for the whole
 * list, arrow keys (either axis, since the list reflows between a grid and a column) move focus
 * and selection with wrap-around, Home and End jump to the ends.
 * src: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ · WAI-ARIA APG (living document) · 2026-10-05
 */
export function useRovingTabs(count: number) {
  const baseId = useId();
  const [selected, setSelected] = useState(0);
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = (index: number) => `${baseId}-panel-${index}`;

  const select = (index: number, moveFocus: boolean) => {
    setSelected(index);
    if (moveFocus) document.getElementById(tabId(index))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : STEP[event.key] === undefined ? null : index + STEP[event.key]!;
    if (target === null) return;
    event.preventDefault();
    select((target + count) % count, true);
  };

  return {
    selected,
    tabProps: (index: number) => ({
      id: tabId(index),
      role: "tab" as const,
      type: "button" as const,
      "aria-selected": index === selected,
      "aria-controls": panelId(index),
      tabIndex: index === selected ? 0 : -1,
      onClick: () => select(index, false),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index),
    }),
    panelProps: (index: number) => ({
      id: panelId(index),
      role: "tabpanel" as const,
      "aria-labelledby": tabId(index),
      hidden: index !== selected,
      // A panel of plain text must still be reachable from the keyboard.
      tabIndex: 0,
    }),
  };
}
