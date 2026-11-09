/**
 * Where a drawn tooltip goes, kept free of React and the DOM so it can be tested as arithmetic.
 *
 * The chrome's tooltip is a portal at the body rather than an absolutely-positioned child of the
 * control: the dock floats at the bottom of the window inside `.dag-body`, and a tooltip pinned to
 * a control near its edge would be clipped by whatever the ancestors do with overflow. `fixed`
 * escapes all of that, and this function answers the one question that then remains — above the
 * control, centred on it, and inside the window. The dock is at the bottom, so upward is the
 * natural answer; a control near the top flips it below, because a tooltip is useful only if it is
 * on screen.
 */

/** Long enough that a pointer passing over the dock does not flash a tooltip at every control. */
export const TOOLTIP_DELAY_MS = 400;

export interface TooltipAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Centre the bubble over the anchor, above it where it fits, and keep the whole of it inside the
 * viewport. `margin` is the least distance from a window edge; `gap` is the distance from the
 * control, so the bubble never sits on the button that summoned it.
 */
export function placeTooltip(
  anchor: TooltipAnchor,
  tip: TooltipSize,
  viewport: TooltipViewport,
  margin = 8,
  gap = 8,
): TooltipPlacement {
  const left = clamp(anchor.left + anchor.width / 2 - tip.width / 2, margin, viewport.width - margin - tip.width);

  const above = anchor.top - tip.height - gap;
  const below = anchor.top + anchor.height + gap;
  const top =
    above >= margin || below + tip.height > viewport.height - margin
      ? clamp(above, margin, viewport.height - margin - tip.height)
      : below;

  return { left, top };
}
