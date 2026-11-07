import { describe, expect, it } from "vitest";

import { placedWidth, storedWidth } from "@/edit/image";
import { DEFAULTS, normalise } from "@/settings/store";

const rule = (patch: Partial<typeof DEFAULTS.paste> = {}) => normalise({ paste: { ...DEFAULTS.paste, ...patch } }).paste;

const GRID = 8;

describe("placedWidth", () => {
  it("places a screenshot at the size it was on the screen it came from", () => {
    /* The board's own defect, in numbers: this is the 1002-pixel paste that arrived at 520. */
    expect(placedWidth(1002, 1, rule(), GRID)).toBe(1002);
    expect(placedWidth(1002, 2, rule(), GRID)).toBe(501);
  });

  it("places by raw pixels when asked, whatever the screen was", () => {
    const r = rule({ size: "pixels" });
    expect(placedWidth(1002, 1, r, GRID)).toBe(1002);
    expect(placedWidth(1002, 2, r, GRID)).toBe(1002);
  });

  it("honours one fixed width, which is what the app did before", () => {
    const r = rule({ size: "width", width: 520 });
    expect(placedWidth(1002, 1, r, GRID)).toBe(520);
    expect(placedWidth(64, 2, r, GRID)).toBe(520);
  });

  it("never lands smaller than a grid step, so a tiny image stays selectable", () => {
    expect(placedWidth(1, 2, rule(), GRID)).toBe(GRID);
    expect(placedWidth(3, 1, rule(), GRID)).toBe(GRID);
  });

  it("falls back to the fixed width when the decode reported no size", () => {
    /* `stageImage` catches an undecodable blob and calls this with 0 rather than refusing a paste. */
    expect(placedWidth(0, 1, rule(), GRID)).toBe(DEFAULTS.paste.width);
    expect(placedWidth(0, 1, rule({ width: 640 }), GRID)).toBe(640);
  });

  it("survives a device pixel ratio a browser could not answer for", () => {
    for (const dpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(placedWidth(1002, dpr, rule(), GRID)).toBe(1002);
    }
  });

  it("returns whole pixels", () => {
    expect(Number.isInteger(placedWidth(1003, 3, rule(), GRID))).toBe(true);
  });
});

describe("storedWidth", () => {
  it("is nothing at all unless a cap was asked for", () => {
    expect(storedWidth({ w: 2560, h: 1440 }, rule())).toBeNull();
  });

  it("caps only what is over it", () => {
    const r = rule({ maxWidth: 1600 });
    expect(storedWidth({ w: 2560, h: 1440 }, r)).toBe(1600);
    expect(storedWidth({ w: 1600, h: 900 }, r)).toBeNull();
    expect(storedWidth({ w: 1002, h: 734 }, r)).toBeNull();
  });

  it("and a capped image is then placed at the pixels it actually has", () => {
    /* `stageImage` passes the resampled width on, so the two agree by construction. */
    const r = rule({ maxWidth: 1600 });
    const stored = storedWidth({ w: 2560, h: 1440 }, r) ?? 2560;
    expect(placedWidth(stored, 1, r, GRID)).toBe(1600);
  });
});
