import { describe, expect, it } from "vitest";

import { CHROME_GAP, placeBottomBars } from "@/ui/bottomBars";

/**
 * The two bars at the canvas's foot are positioned by rules that cannot see each other — the dock
 * centred on the drawing, the zoom cluster pinned to its right edge — so at a narrow canvas the
 * cluster was drawn over the dock's last controls (#395). This is the arithmetic that decides when
 * the cluster has to move, held here because the browser gate that would otherwise be the only
 * witness is one window size wide.
 *
 * The boxes are the ones measured at 800×700 with the library open: the dock centred on a 528px
 * canvas is `101..428`, and the cluster pinned 12px off its right edge is `360..516` — 68px of the
 * dock covered, and `elementFromPoint` answering with the cluster at the centre of the last two of
 * its nine controls. QA's own run, with the board list docked too, left a 295px canvas and no dock
 * control reachable at all.
 */

const DOCK = { left: 101, right: 428, height: 38 };
const CLUSTER = { left: 360, right: 516, height: 38 };

describe("placeBottomBars", () => {
  it("lifts the cluster above the dock when their boxes intersect", () => {
    expect(placeBottomBars(DOCK, CLUSTER)).toEqual({ lifted: true, lift: DOCK.height + CHROME_GAP });
  });

  it("keeps the cluster beside the dock while a clear gap separates them", () => {
    /* 428 + 12 is where the cluster's left edge has to be; one pixel past it is still clear. */
    expect(placeBottomBars(DOCK, { ...CLUSTER, left: 440, right: 596 })).toEqual({ lifted: false, lift: 0 });
    expect(placeBottomBars(DOCK, { ...CLUSTER, left: 1160, right: 1316 })).toEqual({ lifted: false, lift: 0 });
  });

  it("lifts the cluster as soon as the gap is gone", () => {
    expect(placeBottomBars(DOCK, { ...CLUSTER, left: 439, right: 595 }).lifted).toBe(true);
  });

  it("still clears a dock wider than the canvas", () => {
    /* The list and the library both open on a small window: the dock overflows the drawing on both
       sides, and the cluster sits over its right end rather than past it. */
    const wide = { left: -16, right: 311, height: 38 };
    expect(placeBottomBars(wide, { left: 143, right: 299, height: 38 }).lifted).toBe(true);
  });

  it("takes its own gap when the chrome's is not the right one", () => {
    expect(placeBottomBars(DOCK, { ...CLUSTER, left: 448, right: 604 }, 24)).toEqual({
      lifted: true,
      lift: DOCK.height + 24,
    });
  });
});
