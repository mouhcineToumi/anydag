import { describe, expect, it } from "vitest";

import { drawn, OVERSCAN, offsetsOf, rowAt, scrollFor, windowFor } from "@/ui/virtual";

/* 100 rows of 30px, and one of 56 (an open empty folder with its *Empty* line) at row 10. */
const heights = Array.from({ length: 100 }, (_, i) => (i === 10 ? 56 : 30));
const offsets = offsetsOf(heights);

describe("offsetsOf", () => {
  it("sums the heights, with the total last", () => {
    expect([...offsetsOf([30, 56, 30])]).toEqual([0, 30, 86, 116]);
    expect([...offsetsOf([])]).toEqual([0]);
    expect(offsets[100]).toBe(99 * 30 + 56);
  });
});

describe("rowAt", () => {
  it("finds the row a point is in, a boundary belonging to the row that starts there", () => {
    expect(rowAt(offsets, 0)).toBe(0);
    expect(rowAt(offsets, 29.9)).toBe(0);
    expect(rowAt(offsets, 30)).toBe(1);
    expect(rowAt(offsets, 300)).toBe(10);
    expect(rowAt(offsets, 355)).toBe(10);
    expect(rowAt(offsets, 356)).toBe(11);
  });
  it("answers the first row above the list and the last below it", () => {
    expect(rowAt(offsets, -50)).toBe(0);
    expect(rowAt(offsets, 1e9)).toBe(99);
    expect(rowAt(offsetsOf([]), 10)).toBe(0);
  });
});

describe("windowFor", () => {
  it("is the rows in view and the overscan either side", () => {
    expect(windowFor(offsets, 0, 300)).toEqual({ start: 0, end: 10 + 1 + OVERSCAN });
    const w = windowFor(offsets, 1000, 300);
    expect(w.start).toBe(rowAt(offsets, 1000) - OVERSCAN);
    expect(w.end).toBe(rowAt(offsets, 1300) + 1 + OVERSCAN);
  });
  it("stops at the ends of the list", () => {
    expect(windowFor(offsets, 1e9, 300).end).toBe(100);
    expect(windowFor(offsetsOf([30, 30]), 0, 900)).toEqual({ start: 0, end: 2 });
    expect(windowFor(offsetsOf([]), 0, 900)).toEqual({ start: 0, end: 0 });
  });
  it("draws a window as tall as the folder is long for a short folder, not more", () => {
    const w = windowFor(offsetsOf(new Array(5_000).fill(30)), 0, 600);
    expect(w.end - w.start).toBeLessThan(60);
  });
  it("keeps the window it had while the view is well inside it", () => {
    const prev = windowFor(offsets, 1000, 300);
    expect(windowFor(offsets, 1030, 300, prev)).toBe(prev);
    expect(windowFor(offsets, 970, 300, prev)).toBe(prev);
  });
  it("moves it when the view gets near an edge, or when it has grown far past what is needed", () => {
    const prev = windowFor(offsets, 1000, 300);
    expect(windowFor(offsets, 1000 + 30 * (OVERSCAN - 1), 300, prev)).not.toBe(prev);
    expect(windowFor(offsets, 1000 - 30 * (OVERSCAN - 1), 300, prev)).not.toBe(prev);
    const tall = { start: 0, end: 100 };
    expect(windowFor(offsets, 0, 300, tall)).not.toBe(tall);
  });
  it("does not trust a window that is longer than the list now is", () => {
    const stale = { start: 40, end: 80 };
    const w = windowFor(offsetsOf(new Array(20).fill(30)), 0, 300, stale);
    expect(w).toEqual({ start: 0, end: 20 });
  });
});

describe("scrollFor", () => {
  it("leaves the list where it is when the row shows", () => {
    expect(scrollFor(offsets, 3, 0, 300, "nearest")).toBe(0);
    expect(scrollFor(offsets, 3, 0, 300, "center")).toBe(0);
  });
  it("shows a row below by its bottom edge, and one above by its top, for nearest", () => {
    expect(scrollFor(offsets, 30, 0, 300, "nearest")).toBe(offsets[31]! - 300);
    expect(scrollFor(offsets, 3, 600, 300, "nearest")).toBe(90);
  });
  it("centres a row that is out of view, and one cut by an edge", () => {
    expect(scrollFor(offsets, 50, 0, 300, "center")).toBe(offsets[50]! + 15 - 150);
    expect(scrollFor(offsets, 10, 340, 300, "center")).toBe(offsets[10]! + 28 - 150);
  });
  it("does not scroll past either end", () => {
    expect(scrollFor(offsets, 1, 600, 300, "center")).toBe(0);
    expect(scrollFor(offsets, 99, 0, 300, "center")).toBe(offsets[100]! - 300);
  });
});

describe("drawn", () => {
  it("is the window, then the pinned rows, once each and in order", () => {
    expect(drawn({ start: 2, end: 5 }, 100, [])).toEqual([2, 3, 4]);
    expect(drawn({ start: 2, end: 5 }, 100, [90, 3, 0])).toEqual([0, 2, 3, 4, 90]);
  });
  it("leaves out a pin the list no longer has, and a window past its end", () => {
    expect(drawn({ start: 8, end: 20 }, 10, [-1, 12, 7])).toEqual([7, 8, 9]);
  });
});
