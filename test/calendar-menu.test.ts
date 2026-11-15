import { describe, expect, it } from "vitest";

import { MENU_MARGIN, menuKey, menuWithin } from "@/calendar/menu";

/** The menu a calendar item opens: which keys ask for it, and where it lands on the glass. */

describe("a calendar item's menu", () => {
  it("opens on the context-menu key and on shift+F10, and not on F10 alone", () => {
    expect(menuKey("ContextMenu", false)).toBe(true);
    expect(menuKey("ContextMenu", true)).toBe(true);
    expect(menuKey("F10", true)).toBe(true);
    /* `F10` is the browser's menu bar, and Enter on a link is opening it. */
    expect(menuKey("F10", false)).toBe(false);
    expect(menuKey("Enter", true)).toBe(false);
  });

  it("lands at the pointer, and comes back inside the window at either edge", () => {
    const size = { width: 180, height: 120 };
    const frame = { width: 800, height: 600 };
    expect(menuWithin({ x: 100, y: 100 }, size, frame)).toEqual({ x: 100, y: 100 });
    /* As far right and down as it goes while keeping the margin: 800 - 180 - 8, 600 - 120 - 8. */
    expect(menuWithin({ x: 780, y: 580 }, size, frame)).toEqual({ x: 612, y: 472 });
    expect(menuWithin({ x: -20, y: -10 }, size, frame)).toEqual({ x: MENU_MARGIN, y: MENU_MARGIN });
    /* A menu bigger than the window has nowhere to fit: the top-left margin is the only answer
       that keeps its first rows on the glass. */
    expect(menuWithin({ x: 700, y: 500 }, { width: 900, height: 700 }, frame)).toEqual({
      x: MENU_MARGIN,
      y: MENU_MARGIN,
    });
  });
});
