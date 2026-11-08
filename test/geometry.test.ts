import { describe, expect, it } from "vitest";

import { centeredBox } from "@/canvas/geometry";

/**
 * Where an item made from the chrome lands.
 *
 * The viewport itself is a browser fact the e2e suite checks end to end; this is the arithmetic
 * that decides the top-left, including the case a window is too small for the thing being put
 * down.
 */

const view = { x: 100, y: 100, w: 800, h: 600 };

describe("centeredBox", () => {
  it("puts the box's centre on the point", () => {
    expect(centeredBox({ x: 500, y: 400 }, { w: 420, h: 174 }, view)).toEqual({ x: 290, y: 313 });
  });

  it("keeps a box that would hang off the far edge inside the view", () => {
    expect(centeredBox({ x: 2000, y: 2000 }, { w: 420, h: 174 }, view)).toEqual({ x: 480, y: 526 });
  });

  it("anchors a box wider than the view at its left and top rather than half outside", () => {
    const narrow = { x: 100, y: 100, w: 200, h: 100 };
    expect(centeredBox({ x: 500, y: 400 }, { w: 420, h: 174 }, narrow)).toEqual({ x: 100, y: 100 });
  });
});
