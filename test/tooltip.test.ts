import { describe, expect, it } from "vitest";

import { placeTooltip } from "@/ui/tooltipPlace";

/**
 * The dock's tooltip is drawn, not the browser's, so where it lands is this arithmetic rather than
 * a CSS rule. The three things that matter are held here: it opens upward from a control at the
 * bottom of the window, it never runs past a window edge, and a control near the top flips it
 * below rather than letting it be clipped.
 */

const VIEWPORT = { width: 1280, height: 720 };
const TIP = { width: 200, height: 32 };
const CONTROL = { left: 600, top: 660, width: 30, height: 30 };

describe("placeTooltip", () => {
  it("opens upward, centred on the control", () => {
    expect(placeTooltip(CONTROL, TIP, VIEWPORT)).toEqual({ left: 515, top: 620 });
  });

  it("keeps a control at the left edge inside the window", () => {
    const at = placeTooltip({ ...CONTROL, left: 0 }, TIP, VIEWPORT);
    expect(at.left).toBe(8);
  });

  it("keeps a control at the right edge inside the window", () => {
    const at = placeTooltip({ ...CONTROL, left: 1250 }, TIP, VIEWPORT);
    expect(at.left).toBe(VIEWPORT.width - 8 - TIP.width);
  });

  it("clamps a bubble taller than the window to the top margin", () => {
    const at = placeTooltip(CONTROL, { width: 200, height: 900 }, VIEWPORT);
    expect(at.top).toBe(8);
  });

  it("opens below a control near the top of the window instead of off it", () => {
    const at = placeTooltip({ ...CONTROL, top: 20 }, TIP, VIEWPORT);
    expect(at.top).toBe(20 + CONTROL.height + 8);
  });
});
