/**
 * The two rules of a calendar item's menu that are not drawing: what opens it, and where it goes.
 *
 * A menu is placed at the pointer and asked for from the keyboard, so the arithmetic that keeps it
 * on screen and the keys that summon it are here, with no DOM in them — `model.ts`'s rule for the
 * calendar's other arithmetic, and the sidebar's row menu does the same sum inline.
 */

/** How far a menu keeps from the window's edge, as the sidebar's row menu does. */
export const MENU_MARGIN = 8;

export interface Spot {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Where a menu asked for at `at` goes: where it was asked for, nudged back inside the window.
 * A menu too large for the window starts at the margin, because an edge it cannot keep is still
 * better than one it hangs off; the caller draws it bigger than the window only when it must.
 */
export function menuWithin(at: Spot, size: Size, frame: Size): Spot {
  return {
    x: Math.max(MENU_MARGIN, Math.min(at.x, frame.width - size.width - MENU_MARGIN)),
    y: Math.max(MENU_MARGIN, Math.min(at.y, frame.height - size.height - MENU_MARGIN)),
  };
}

/**
 * Whether a key opens a focused item's menu: the context-menu key, or `shift+F10` — the two the
 * keyboard has for a right-click. `F10` alone is not one: it walks the browser's menu bar on
 * Windows, and a menu that opened there would take a key that was doing something else.
 */
export function menuKey(key: string, shiftKey: boolean): boolean {
  return key === "ContextMenu" || (shiftKey && key === "F10");
}
