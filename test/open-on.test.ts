/** Where a board opens: fitted, unless a phone would show it too small to read (`openOn`). */
import { describe, expect, it } from "vitest";

import { firstPlacement } from "../src/board/flow";
import { fitTo, NARROW, openOn, READABLE } from "../src/canvas/geometry";

const phone = { w: 393, h: 760 };
const desk = { w: 1280, h: 800 };

describe("openOn", () => {
  const wide = { x: 0, y: 0, w: 2400, h: 900 };
  const first = { x: 0, y: 0, w: 2400, h: 900 };

  it("fits the whole board on a desktop, however small that makes it", () => {
    expect(openOn(wide, first, desk)).toEqual(fitTo(wide, desk));
    expect(desk.w).toBeGreaterThanOrEqual(NARROW);
  });

  it("fits the whole board on a phone when it can be read whole", () => {
    const small = { x: 40, y: 40, w: 300, h: 200 };
    expect(openOn(small, small, phone)).toEqual(fitTo(small, phone));
  });

  it("opens a phone on the first item, never under the readable zoom, its corner at the margin", () => {
    const got = openOn(wide, first, phone);
    expect(fitTo(wide, phone).zoom).toBeLessThan(READABLE);
    expect(got.zoom).toBe(READABLE);
    expect(got.off).toEqual({ x: 16, y: 16 });
  });

  it("fits a first item narrower than the phone across it, centred, at most at 100%", () => {
    const note = { x: 100, y: 50, w: 200, h: 120 };
    const got = openOn(wide, note, phone);
    expect(got.zoom).toBe(1);
    expect(got.off.x + note.x * got.zoom).toBeCloseTo((phone.w - note.w) / 2);
    expect(got.off.y + note.y * got.zoom).toBe(16);
  });

  it("fits whole when there is no first item", () => {
    expect(openOn(wide, null, phone)).toEqual(fitTo(wide, phone));
  });
});

describe("firstPlacement", () => {
  const at = (x: number, y: number) => ({ x, y, w: 100, h: 100, pinned: true });

  it("is the top row's leftmost, a few pixels out of line still one row", () => {
    const places = new Map([
      ["b", at(400, 10)],
      ["a", at(0, 40)],
      ["c", at(0, 600)],
    ]);
    expect(firstPlacement(places)).toBe(places.get("a"));
  });

  it("is nothing on an empty page", () => {
    expect(firstPlacement(new Map())).toBeNull();
  });
});
