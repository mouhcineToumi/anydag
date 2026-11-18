import { useEffect, useRef, useState } from "react";

/**
 * A menu that hangs from its button as a card — the top bar's `⋯` (`PageMore`) and the quiz form's
 * menus (#257): open or shut, the box that holds both, the button and the card.
 *
 * It shuts by a press outside the box or by Escape, and Escape hands the focus back to the button.
 * Escape is taken in the capture phase and stopped, so the innermost thing closes first: an open
 * field under the card is not closed by the same key. `capture` takes the outside press in the
 * capture phase too.
 */
export function useMenuCard(capture = false) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    };
    addEventListener("pointerdown", away, capture);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away, capture);
      removeEventListener("keydown", esc, true);
    };
  }, [open, capture]);

  return { open, setOpen, box, toggle, menu };
}

const WALK = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * The row a key moves the focus to, in the WAI menu pattern: the arrows walk the rows and wrap,
 * Home and End go to the ends. `null` for any other key, or with no row to go to.
 */
export function nextRow(rows: HTMLElement[], key: string): number | null {
  if (!WALK.has(key) || rows.length === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return rows.length - 1;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  return (at + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
}
