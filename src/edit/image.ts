import type { Settings } from "@/settings/store";

/**
 * How wide an image lands, and how wide it is stored.
 *
 * Both halves are arithmetic with no DOM in them, which is the same split every other file in
 * `src/edit/` makes: `useEditor` has the clipboard and the `createImageBitmap`, and what a number
 * *means* is here, where `test/image.test.ts` can hold it.
 *
 * The defect this replaces: `onPaste` and `importFiles` both posted a literal `w: 520`, so a
 * 1002-pixel screenshot was drawn into a 520-pixel box — 52% of its pixels, resampled again by
 * whatever the board's zoom was. Nothing had ever compressed the bytes (the plugin writes what the
 * clipboard handed it, byte for byte), so the softness everybody could see had no setting behind it
 * and no diagnostic either. It was one hardcoded number.
 */

/** The size a decoded image really is. */
export type Natural = { w: number; h: number };

/**
 * The width the image is *placed* at, given the width it is *stored* at.
 *
 * - `screen` — as it looked on the screen it came from. A screenshot is captured in device pixels,
 *   so dividing by the ratio is what makes it land at the size it appeared: pixel for pixel on a
 *   DPR-1 monitor, and still crisp at zoom 1 on a laptop at 2×, because the box then holds exactly
 *   twice its own device pixels.
 * - `pixels` — its own pixels, whatever the screen was. For someone who wants a 2× capture to land
 *   at 2× and be sharp at 50% zoom.
 * - `width` — one fixed number, which is what the app did before there were settings.
 *
 * The floor is one grid step: a 1×1 tracking pixel or a decode that reported nothing must not
 * become an item too small to select, and a board where an item cannot be got hold of again is a
 * worse outcome than one where a dot is drawn eight pixels wide.
 */
export function placedWidth(stored: number, dpr: number, rule: Settings["paste"], grid: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const w = rule.size === "width" ? rule.width : rule.size === "pixels" ? stored : stored / ratio;
  return Math.max(grid, Math.round(Number.isFinite(w) && w > 0 ? w : rule.width));
}

/**
 * The width to *store* the image at, or `null` to write the bytes exactly as they arrived.
 *
 * This is the only thing in the app that can lose a pixel, and it is off unless somebody asks: a
 * cap is for the person whose 2560-pixel captures are 2MB each in a git repository, and the answer
 * to "how compressed are the images I paste" is otherwise "not at all". A resample stays a PNG —
 * what is pasted here is a screenshot with text in it, and lossy encoding of text is precisely the
 * defect being complained about.
 */
export function storedWidth(natural: Natural, rule: Settings["paste"]): number | null {
  const cap = rule.maxWidth;
  return cap !== null && natural.w > cap ? cap : null;
}
