import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { TOOLTIP_DELAY_MS, placeTooltip, type TooltipPlacement } from "@/ui/tooltipPlace";

/**
 * A drawn tooltip for the chrome, where the native `title` is not dependable.
 *
 * The dock is icon-only by design, so its `title` was the only place a control's name and chord
 * were written down — and in the desktop app on macOS the native tooltip does not appear within
 * the time a person waits. The labels cannot come back without taking board width, so the tooltip
 * is drawn instead: a small portal at the body, opened by hover or keyboard focus after
 * `TOOLTIP_DELAY_MS`, dismissed on leave, blur, Escape and press, and placed by `placeTooltip` so
 * it opens upward from the dock and stays inside the window.
 *
 * **The bubble is a sibling of nothing it lives in.** It is `position: fixed` in a portal, because
 * `.dag-body` and the dock both clip or sit above their own stacking contexts, and a `title`
 * replacement that can slide under the page tabs is not a replacement. The wrapper only measures
 * the control and carries the handlers; it adds no drawing of its own.
 *
 * A control keeps its `aria-label`: this is a visual name for a pointer and keyboard user, not an
 * accessible name. The `title` is removed wherever this is used, so only one tooltip can appear.
 *
 * **One bubble at a time.** A pointer hovering one control while another still holds keyboard
 * focus would otherwise leave two standing, so the newest opener closes the one before it.
 */
let closeShown: (() => void) | null = null;

export function Tooltip({ name, shortcut, children }: { name: string; shortcut?: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const hide = () => {
    stop();
    setOpen(false);
  };
  const show = () => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      closeShown?.();
      closeShown = () => setOpen(false);
      setOpen(true);
    }, TOOLTIP_DELAY_MS);
  };

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return (
    <span
      className="dag-tip"
      ref={anchor}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onClick={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {children}
      {open ? <Bubble anchor={anchor} name={name} shortcut={shortcut} /> : null}
    </span>
  );
}

function Bubble({ anchor, name, shortcut }: { anchor: RefObject<HTMLSpanElement | null>; name: string; shortcut?: string }) {
  const bubble = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<TooltipPlacement | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const b = bubble.current;
      if (!a || !b) return;
      const control = a.getBoundingClientRect();
      const size = b.getBoundingClientRect();
      setAt(
        placeTooltip(
          { left: control.left, top: control.top, width: control.width, height: control.height },
          { width: size.width, height: size.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  return createPortal(
    <span
      className="dag-tip__bubble"
      data-dag-tip=""
      role="tooltip"
      ref={bubble}
      /* Hidden until measured, so the first frame at 0,0 is never painted. */
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {name}
      {shortcut ? <span className="dag-tip__key"> ({shortcut})</span> : null}
    </span>,
    document.body,
  );
}
