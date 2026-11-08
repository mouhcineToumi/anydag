import { describe, expect, it } from "vitest";

import { firstFit, fitTo, type Rect } from "@/canvas/geometry";

/**
 * The two fits a board has.
 *
 * `fitTo` frames the content, magnifying it when that is what filling the glass takes — the Fit
 * action's job. `firstFit` is the view a board opens with, and it may shrink a large board but
 * never magnifies a small one: a board holding one prompt card opened at 215%, which the person
 * read as too much zoom rather than as a fitted board. The explicit action has to keep the old
 * behaviour, so the two are tested against each other.
 */

const VIEW = { w: 1600, h: 1200 };

/** One small card — the prompt card a new board arrives with, roughly. */
const SMALL: Rect = { x: -120, y: -80, w: 240, h: 160 };
/** A board wider and taller than the window, with a coordinate origin well off the corner. */
const LARGE: Rect = { x: -400, y: -300, w: 4000, h: 3000 };

describe("the fit a board opens with", () => {
  it("leaves a board smaller than the view at 100%", () => {
    expect(firstFit(SMALL, VIEW).zoom).toBe(1);
  });

  it("centres what it does not magnify", () => {
    const { zoom, off } = firstFit(SMALL, VIEW);
    expect(off.x).toBeCloseTo((VIEW.w - SMALL.w * zoom) / 2 - SMALL.x * zoom, 6);
    expect(off.y).toBeCloseTo((VIEW.h - SMALL.h * zoom) / 2 - SMALL.y * zoom, 6);
  });

  it("still shrinks a board larger than the view, exactly as an ordinary fit does", () => {
    const open = firstFit(LARGE, VIEW);
    expect(open.zoom).toBeLessThan(1);
    expect(open).toEqual(fitTo(LARGE, VIEW));
  });

  it("never exceeds 100% however small the content", () => {
    expect(firstFit({ x: 0, y: 0, w: 2, h: 2 }, VIEW).zoom).toBe(1);
  });
});

describe("the explicit fit", () => {
  it("still magnifies a small board to fill the glass", () => {
    expect(fitTo(SMALL, VIEW).zoom).toBeGreaterThan(1);
  });

  it("keeps the existing 400% ceiling", () => {
    expect(fitTo({ x: 0, y: 0, w: 2, h: 2 }, VIEW).zoom).toBe(4);
  });
});
