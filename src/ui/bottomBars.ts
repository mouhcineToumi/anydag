import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * The dock and the zoom cluster, and the one thing each cannot know about the other.
 *
 * Both float at the foot of the canvas inside `.dag-body`: the dock is centred on the drawing
 * (`--canvas-mid`) and the cluster is pinned to its right edge (`--canvas-right`). Neither rule
 * looks at the other bar, so their boxes are free to intersect — and they do as soon as the canvas
 * is narrower than the two of them together, which is a 800×700 window with the library open, and a
 * 295px drawing with the board list docked too (#395). The cluster comes later in the DOM on the
 * same layer, so where they intersect it takes every press meant for the dock's last controls: the
 * QA pass found `elementFromPoint` answering with the cluster at the centre of all nine of them.
 *
 * A media query cannot answer this, because the canvas is the window minus whatever panels are
 * open, not the window. So the cluster is measured against the dock's own box and lifted clear
 * above it when the two would share pixels; the arithmetic is {@link placeBottomBars}, free of the
 * DOM so it can be tested as arithmetic the way `tooltipPlace` is. Which bar moves is not arbitrary:
 * zoom is navigation, one small cluster in the corner, while the dock is the board's tools at its
 * middle, and lifting the smaller thing costs the fewer pixels of the drawing.
 */

/** The clear space the two bars keep between them, in px — the gap a floating bar keeps from a neighbour it is not part of. */
export const CHROME_GAP = 12;

/** The attribute the stylesheet reads to draw the cluster above the dock. */
const LIFTED = "data-dag-zoombar-lifted";

/** The custom property that carries how far up it goes, in px (`--zoom-lift` in `chrome.css`). */
const LIFT = "--zoom-lift";

/** The two numbers each bar contributes: where it is horizontally, and how tall it is. */
export interface BarBox {
  left: number;
  right: number;
  height: number;
}

export interface BarsPlacement {
  /** Whether the zoom cluster has to sit above the dock rather than beside it. */
  lifted: boolean;
  /** How far above its usual `bottom` the cluster sits, in px. Zero when it sits beside the dock. */
  lift: number;
}

/**
 * Where the zoom cluster goes, given the two boxes it shares the canvas's foot with.
 *
 * Beside the dock while its left edge stays a clear {@link CHROME_GAP} to the right of the dock's;
 * otherwise above it, by the dock's own height, so the same gap separates them vertically. A dock
 * wider than the canvas — the list and the library both open on a small window — is still cleared,
 * because the test is the dock's *right* edge rather than the canvas's middle.
 */
export function placeBottomBars(dock: BarBox, zoom: BarBox, gap = CHROME_GAP): BarsPlacement {
  const lifted = zoom.left < dock.right + gap;
  return { lifted, lift: lifted ? Math.round(dock.height + gap) : 0 };
}

/** The three elements whose size can change the answer: the drawing, and the two bars. */
interface Watched {
  canvas: Element | null;
  dock: Element | null;
  zoom: Element | null;
}

/**
 * Keeps that answer true for as long as the page is up.
 *
 * The canvas is what is observed rather than the body, because opening a panel resizes the drawing
 * and not `.dag-body` — which is exactly the gesture that found this, so it is the one that has to
 * move the cluster. Painted onto the two elements rather than held in state, for the reason
 * `--canvas-x` and `data-zoom` are: this is geometry the browser just computed, and React state
 * would re-render every child of `App` on every drag of a panel's edge.
 *
 * A bar that appears or leaves is not a resize, so the set is read after every render and the
 * observation moved when it changes — after every render rather than on a list of dependencies that
 * would have to name every reason the dock's contents change.
 */
export function useBottomBars(body: RefObject<HTMLElement | null>): void {
  const seen = useRef<Watched>({ canvas: null, dock: null, zoom: null });
  const watch = useRef<ResizeObserver | null>(null);

  const read = useCallback((): Watched => {
    const el = body.current;
    return {
      canvas: el?.querySelector(".dag-viewport") ?? null,
      dock: el?.querySelector("[data-dag-dock]") ?? null,
      zoom: el?.querySelector("[data-dag-zoombar]") ?? null,
    };
  }, [body]);

  const place = useCallback(() => {
    const el = body.current;
    const { dock, zoom } = seen.current;
    if (!el) return;
    if (!dock || !zoom) {
      zoom?.removeAttribute(LIFTED);
      return;
    }
    const at = placeBottomBars(dock.getBoundingClientRect(), zoom.getBoundingClientRect());
    zoom.toggleAttribute(LIFTED, at.lifted);
    el.style.setProperty(LIFT, `${at.lift}px`);
  }, [body]);

  const observe = useCallback(
    (ro: ResizeObserver, next: Watched) => {
      ro.disconnect();
      const el = body.current;
      if (el) ro.observe(el);
      for (const node of [next.canvas, next.dock, next.zoom]) if (node) ro.observe(node);
    },
    [body],
  );

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    watch.current = ro;
    seen.current = read();
    observe(ro, seen.current);
    /* Once here as well as on a change: both bars may already be mounted when the hook first runs
       (a board switched to from another tab), and this measurement is the one that decides where
       they are drawn until something changes size. */
    place();
    return () => {
      ro.disconnect();
      watch.current = null;
    };
  }, [place, read, observe]);

  useEffect(() => {
    const next = read();
    const was = seen.current;
    const ro = watch.current;
    if (next.canvas === was.canvas && next.dock === was.dock && next.zoom === was.zoom) return;
    seen.current = next;
    if (ro) observe(ro, next);
    place();
  });
}
