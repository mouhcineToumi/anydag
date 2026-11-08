import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

import {
  centeredBox,
  clampPan,
  clampZoom,
  DRAG_SLOP,
  fitTo,
  PAN_STEP,
  stepZoom,
  wheelPixels,
  WHEEL_ZOOM,
  type Point,
  type Rect,
} from "./geometry";

/** A form control owns its own space bar; so does anything a person is typing into. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));

/**
 * The infinite canvas.
 *
 * The load-bearing idea is the split between **what is painted** and **what React knows**. A drag
 * or a wheel writes `layer.style.transform` directly and records it in `applied`; React hears about
 * it once, at the end. Without that, every wheel tick reconciles the whole board — which at forty
 * items and a few hundred nodes is the difference between a tool that feels instant and one that
 * does not.
 *
 * Everything that needs "where is the canvas right now" reads `applied.current`, never the `off`
 * state, which is one frame stale by construction.
 */

export interface ViewportHandle {
  fit(content?: Rect): void;
  /**
   * Bring one box into the middle of the view — what opening a board at an item does.
   *
   * A fit with two differences. It **never magnifies past 100%**: a note of three lines fitted to
   * the glass is drawn at four times its size, which is not "here it is" but "here is a letter of
   * it". And it **counts as the person having moved the view**, so the next change of content does
   * not refit the whole board over it — a `fit` hands the view back to that refit, which is right
   * for the fit button and wrong for a view somebody was sent to.
   */
  show(box: Rect): void;
  zoomBy(dir: 1 | -1): void;
  reset(): void;
  /* Back to 100%, keeping the corner where it is — what the `0` key does, and what the zoom
     readout means when it is pressed. `reset` is a *fit* despite the name, so it cannot serve:
     "100%" that silently framed the content would be a control lying about its own label. */
  actual(): void;
  /** Board coordinates of a client point — where a paste should land. */
  toBoard(clientX: number, clientY: number): Point;
  /** The zoom on the glass right now — what turns a screen measure into board units. */
  zoom(): number;
  /** Board coordinates of the middle of the view — where a new item lands when there is no pointer. */
  center(): Point;
  /**
   * The top-left that puts a box of `w` × `h` in the middle of the view — what an item made from
   * the chrome lands on. A view too small for the box keeps it against its top-left edge.
   */
  centerItem(w: number, h: number): Point;
  /** Take keyboard focus, so a shortcut typed after a toolbar click reaches the board. */
  focus(): void;
}

/**
 * What a left drag on the paper does.
 *
 * `select` draws a marquee, the way draw.io and Excalidraw do it, and the paper is moved with the
 * wheel, a middle drag, or space or ctrl held. `hand` is the old behaviour — a left drag pans —
 * for whoever wants a board they only read. `pen` draws: a press is the start of a stroke, and the
 * stroke is handed to `onInk` when the pointer lifts.
 */
export type Tool = "select" | "hand" | "pen";

interface Props {
  content: Rect;
  tool?: Tool;
  onZoom?(zoom: number): void;
  /** A marquee was drawn, in board coordinates. `additive` when shift was held. */
  onMarquee?(rect: Rect, additive: boolean): void;
  /**
   * A stroke was drawn, in board coordinates — the raw samples, in the order the pointer gave
   * them. Reducing and placing them is the editor's (`src/edit/ink.ts`); this reports a gesture,
   * exactly as `onMarquee` reports its rect.
   */
  onInk?(points: Point[]): void;
  /** A press on the paper that never became a drag — the click that deselects. */
  onPaperClick?(): void;
  /** Two presses on the paper — where a new note goes. */
  onPaperDoubleClick?(at: Point): void;
  handleRef?: Ref<ViewportHandle>;
  /**
   * Let a plain wheel scroll whatever the viewport sits in, and keep only ctrl/cmd-wheel and the
   * pinch for zooming. A board embedded in a note is a box in a page that scrolls, and one that
   * swallowed every wheel would stop the note scrolling the moment the pointer crossed it.
   */
  scrollThrough?: boolean;
  children: ReactNode;
}

export function Viewport({
  content,
  tool = "select",
  onZoom,
  onMarquee,
  onInk,
  onPaperClick,
  onPaperDoubleClick,
  handleRef,
  scrollThrough = false,
  children,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  /* Neither value is read during render — the transform and `data-zoom` are both painted. They are
     state so that a commit still schedules a render, which is what lets children that care about a
     settled view (rather than a live gesture) see one. */
  const [, setZoom] = useState(1);
  const [, setOff] = useState<Point>({ x: 0, y: 0 });

  /** The truth on the glass. `paint` is its only writer. */
  const applied = useRef({ zoom: 1, off: { x: 0, y: 0 } as Point });
  /** Set once the user has moved the canvas; a resize must not yank a deliberate view back. */
  const touched = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  const onInkRef = useRef(onInk);
  onInkRef.current = onInk;

  const paint = useCallback((z: number, o: Point) => {
    applied.current = { zoom: z, off: o };
    const layer = layerRef.current;
    if (layer) layer.style.transform = `translate(${o.x}px, ${o.y}px) scale(${z})`;
    /* `data-zoom` is painted, not rendered.
     *
     * Anything measuring a box on the canvas has to divide the scale back out, and it reads the
     * factor from here. Publishing it as a React attribute made it a frame stale by construction —
     * the same frame in which `paint` has already scaled the layer — so a measurement taken during
     * the initial fit divided a scaled rect by 1 and disagreed with the layout by exactly the zoom.
     * That is what made the dev size assertion fire at random on a loaded machine. The transform
     * and the number describing it are now written in the same statement.
     *
     * `dag:view` goes out at the end for the chrome that has to follow the view — the selection bar,
     * which measures where its selection now is — as an event rather than a prop, the way
     * `dag:zoom` and `dag:links-preview` already do. */
    const box = boxRef.current;
    if (box) box.dataset.zoom = String(z);
    document.dispatchEvent(new CustomEvent("dag:view"));
  }, []);

  const commit = useCallback(
    (z: number, o: Point) => {
      paint(z, o);
      setZoom(z);
      setOff(o);
      onZoomRef.current?.(z);
    },
    [paint],
  );

  const viewSize = useCallback(() => ({ w: boxRef.current?.clientWidth ?? 1, h: boxRef.current?.clientHeight ?? 1 }), []);

  const fit = useCallback(
    (target?: Rect) => {
      const { zoom: z, off: o } = fitTo(target ?? contentRef.current, viewSize());
      commit(z, o);
      touched.current = false;
    },
    [commit, viewSize],
  );

  const show = useCallback(
    (box: Rect) => {
      const view = viewSize();
      const z = Math.min(fitTo(box, view).zoom, 1);
      commit(z, { x: (view.w - box.w * z) / 2 - box.x * z, y: (view.h - box.h * z) / 2 - box.y * z });
      touched.current = true;
    },
    [commit, viewSize],
  );

  /* Zoom from a button or a key anchors on the middle of the window, not the pointer: there is no
     pointer, and anchoring on the origin would walk the board off-screen. */
  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const view = viewSize();
      const { zoom: from, off } = applied.current;
      const next = stepZoom(from, dir);
      if (next === from) return;
      const k = next / from;
      const ax = view.w / 2;
      const ay = view.h / 2;
      commit(next, { x: ax - (ax - off.x) * k, y: ay - (ay - off.y) * k });
      touched.current = true;
    },
    [commit, viewSize],
  );

  const toBoard = useCallback((clientX: number, clientY: number): Point => {
    const box = boxRef.current?.getBoundingClientRect();
    const { zoom: z, off } = applied.current;
    return {
      x: (clientX - (box?.left ?? 0) - off.x) / z,
      y: (clientY - (box?.top ?? 0) - off.y) / z,
    };
  }, []);

  useImperativeHandle(
    handleRef,
    (): ViewportHandle => ({
      fit,
      show,
      zoomBy,
      reset: () => fit(),
      actual: () => {
        commit(1, applied.current.off);
        touched.current = true;
      },
      toBoard,
      zoom: () => applied.current.zoom,
      center: () => {
        const box = boxRef.current?.getBoundingClientRect();
        return toBoard((box?.left ?? 0) + (box?.width ?? 0) / 2, (box?.top ?? 0) + (box?.height ?? 0) / 2);
      },
      centerItem: (w, h) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return { x: -w / 2, y: -h / 2 };
        const a = toBoard(box.left, box.top);
        const b = toBoard(box.right, box.bottom);
        return centeredBox({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { w, h }, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
      },
      focus: () => boxRef.current?.focus({ preventScroll: true }),
    }),
    [commit, fit, show, zoomBy, toBoard],
  );

  /* React registers `onWheel` passively at the root, so `preventDefault` inside a synthetic handler
     is ignored and the page scrolls behind the canvas. It has to be a native listener. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    /*
     * **Scroll moves the paper; ctrl/cmd-scroll zooms.** That is draw.io, Excalidraw, Figma and
     * every map, and the earlier version had it the other way round — reasonable for a canvas
     * that is one graph sized to fit and never pans far, wrong here, where a board is a plane you
     * travel across.
     *
     * The assignment also happens to be the only one that serves both input devices, because a
     * trackpad pinch arrives as a wheel with `ctrlKey` set whether or not a ctrl key is down. One
     * branch therefore covers both the modifier and the gesture.
     */
    const onWheel = (e: WheelEvent) => {
      if (scrollThrough && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoom: from, off } = applied.current;
      const dx = wheelPixels(e.deltaX, e.deltaMode);
      const dy = wheelPixels(e.deltaY, e.deltaMode);

      if (e.ctrlKey || e.metaKey) {
        const rect = box.getBoundingClientRect();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        const next = clampZoom(from * Math.exp(-dy * WHEEL_ZOOM));
        if (next === from) return;
        const k = next / from;
        const to = { x: ax - (ax - off.x) * k, y: ay - (ay - off.y) * k };
        paint(next, to);
        setZoom(next);
        setOff(to);
        onZoomRef.current?.(next);
        touched.current = true;
        return;
      }

      /* A mouse wheel has one axis, and shift borrows it for the other — the convention in every
         scrolling surface there is. A trackpad already sends both and must not be second-guessed:
         a diagonal two-finger swipe reports a real `deltaX`, so the borrow is conditional on there
         being no horizontal component to begin with. */
      const [px, py] = e.shiftKey && dx === 0 ? [dy, 0] : [dx, dy];
      const to = clampPan({ x: off.x - px, y: off.y - py }, contentRef.current, from, {
        w: box.clientWidth,
        h: box.clientHeight,
      });
      paint(from, to);
      setOff(to);
      touched.current = true;
    };

    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [paint, scrollThrough]);

  /*
   * Hold space — or ctrl/cmd — to pan.
   *
   * A press on an item moves the item, so on a full board — which is most boards — there is no
   * paper left to grab and the view can only be moved with the wheel. Holding either makes the
   * whole surface paper again, items included. Space is what every canvas tool binds this to; ctrl
   * is here because ctrl already means "I am navigating, not editing" on the wheel, and a hand that
   * has just ctrl-zoomed reaches straight for a ctrl-drag.
   *
   * The flag is *painted* onto the box, and `Item` reads it back off the nearest `.dag-viewport`
   * exactly as it reads `data-zoom`. As React state it would re-render every item on the board
   * twice per gesture, which is the thing the paint/render split exists to avoid; and `Item` is
   * memoised, so it would have to become a prop threaded through `App` to be seen at all.
   *
   * This is the cursor's copy of the answer, not the authority: a modifier held down *before* the
   * window took focus produces no keydown at all, so `Item` also reads the modifier off the press
   * itself. Both have to agree, and the press is the one that decides.
   *
   * Listeners go on the window, not the viewport: the viewport has to be focused for a key to reach
   * it, and the gesture has to work right after clicking a toolbar select.
   *
   * **Space is also the editor's leader key**, and this arming depends on that handler letting the
   * press through. `useEditor`'s key handler runs in the capture phase and could stop it dead; it
   * calls `preventDefault` on the leader and never `stopPropagation`, for exactly this. The other
   * half is that a pointer going down while Space is held takes the chord back over there, so a
   * pan is a pan and never also a command. See `docs/architecture/editing.md` → *The leader key*.
   */
  useEffect(() => {
    let on = false;
    let space = false;
    const set = (next: boolean) => {
      if (next === on) return;
      on = next;
      const box = boxRef.current;
      if (!box) return;
      if (next) box.dataset.pan = "";
      else delete box.dataset.pan;
    };
    /* Read from the event rather than tracked, because a keyup for `Control` reports `ctrlKey`
       false and a keyup for anything else while ctrl is down reports it true — which is exactly the
       question being asked. */
    const sync = (e: KeyboardEvent) => set(space || e.ctrlKey || e.metaKey);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typing(e.target)) {
        /* Otherwise space scrolls the page under the app and activates whatever button has focus.
           Ctrl is never swallowed: every shortcut in the browser is built on it. */
        e.preventDefault();
        space = true;
      }
      sync(e);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
      sync(e);
    };
    /* A window that loses focus never delivers the keyup — alt-tab away mid-pan and the modifier
       would stay down for the rest of the session. */
    const clear = () => {
      space = false;
      set(false);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", clear);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", clear);
      clear();
    };
  }, []);

  /*
   * Drag to pan, or drag to select, or drag to draw.
   *
   * The slop matters because items underneath are interactive: capturing the pointer on press
   * would swallow their clicks, so capture waits until the gesture is unambiguously a drag, and the
   * click that ends a drag is eaten in the capture phase.
   *
   * Which of the three a left press becomes is decided on the press: a pan when the hand tool is on
   * or a pan modifier is held (the flag or the key itself, for the reason `Item` reads both), ink
   * when the pen is on, a marquee otherwise. A press on an item never arrives here — `Item` stops
   * it — so "the paper" really is the paper; with the pen up, chrome.css makes it paper again,
   * because a stroke is drawn wherever the pointer is, over whatever is there. The marquee is
   * painted, like the transform: a rectangle that re-rendered the board on every pointer move
   * would be the one thing on this canvas that did.
   *
   * The pen skips the slop and captures on the press instead. The slop exists to protect an item's
   * click from a drag that was never meant — and under the pen an item's click is not a thing that
   * exists — while the first few pixels of a stroke are the start of it: swallowing them bends
   * every short stroke and loses the start of the shortest ones.
   */
  const drag = useRef<{
    id: number;
    button: number;
    kind: "pan" | "marquee" | "ink";
    sx: number;
    sy: number;
    from: Point;
    moved: boolean;
    /** Board-coordinate samples, in the order the pointer gave them — the ink gesture's own. */
    pts: Point[];
  } | null>(null);
  const swallow = useRef(false);
  const marqueeRef = useRef<HTMLDivElement>(null);
  /** The stroke as it is being drawn, painted into `.dag-guides` and cleared on release. */
  const inkRef = useRef<SVGPolylineElement | null>(null);
  const onMarqueeRef = useRef(onMarquee);
  onMarqueeRef.current = onMarquee;
  const onPaperClickRef = useRef(onPaperClick);
  onPaperClickRef.current = onPaperClick;

  /*
   * Fingers: one on the paper pans — on a phone there is no space bar to hold, and a
   * marquee under a thumb is a selection nobody meant — and two pinch, zooming about the point
   * between them while it moves with them. The finger that lands first on an item goes to the
   * editor, which pans for it unless that item is selected (`useEditor`'s `press`); so fingers are
   * counted in the capture phase, before anything under them can keep the press to itself.
   */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: Point; zoom: number; off: Point } | null>(null);

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size !== 2) return;
    const box = boxRef.current;
    const rect = box?.getBoundingClientRect();
    const [a, b] = [...fingers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
    pinch.current = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2 - (rect?.left ?? 0), y: (a.y + b.y) / 2 - (rect?.top ?? 0) },
      zoom: applied.current.zoom,
      off: applied.current.off,
    };
    /* Whatever one finger had started is over: a pinch is not a pan that grew a second finger, and
       a stroke or a marquee half-drawn goes. The item a finger was moving is told to let go. */
    if (drag.current?.kind === "ink") {
      inkRef.current?.remove();
      inkRef.current = null;
    }
    if (marqueeRef.current) marqueeRef.current.hidden = true;
    drag.current = null;
    box?.removeAttribute("data-panning");
    document.dispatchEvent(new CustomEvent("dag:pinch"));
    for (const id of fingers.current.keys()) {
      try {
        box?.setPointerCapture(id);
      } catch {
        /* A finger already lifted cannot be captured, and needs not be. */
      }
    }
    e.stopPropagation();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (pinch.current) return;
    if (e.button !== 0 && e.button !== 1) return;
    /* Middle-drag is the other pan every canvas tool has, and unlike a left drag it reaches the
       viewport over an item without a modifier — `Item` ignores every button but the first. The
       default it has to beat is the browser's autoscroll widget. */
    if (e.button === 1) e.preventDefault();
    const pan =
      e.button === 1 ||
      tool === "hand" ||
      boxRef.current?.dataset.pan !== undefined ||
      e.ctrlKey ||
      e.metaKey ||
      (e.pointerType === "touch" && tool !== "pen");
    const kind = pan ? "pan" : tool === "pen" ? "ink" : "marquee";
    drag.current = {
      id: e.pointerId,
      button: e.button,
      kind,
      sx: e.clientX,
      sy: e.clientY,
      from: applied.current.off,
      moved: kind === "ink",
      pts: [],
    };
    if (kind !== "ink") return;
    /* Capture on the press, not at the slop: there is no slop. The click a pen press would
       otherwise deliver to whatever is under it is eaten on release instead — nothing under it is
       pressable, and a stroke that started on a link must not end by selecting that link. */
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current.pts.push(toBoard(e.clientX, e.clientY));
    const svg = layerRef.current?.querySelector<SVGSVGElement>(".dag-guides");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("class", "dag-ink-preview");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg?.appendChild(line);
    inkRef.current = line;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && fingers.current.has(e.pointerId))
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && fingers.current.size >= 2) {
      const rect = boxRef.current?.getBoundingClientRect();
      const [a, b] = [...fingers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mid = { x: (a.x + b.x) / 2 - (rect?.left ?? 0), y: (a.y + b.y) / 2 - (rect?.top ?? 0) };
      const z = clampZoom(p.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist));
      const k = z / p.zoom;
      /* The point of the board that was between the fingers stays between them. */
      paint(z, { x: mid.x - (p.mid.x - p.off.x) * k, y: mid.y - (p.mid.y - p.off.y) * k });
      onZoomRef.current?.(z);
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      /* Painted, not set on `document.body`: the viewport's own `cursor` rule outranks an inherited
         one, so the body-level grabbing cursor this replaces was never visible. */
      if (d.kind === "pan") boxRef.current?.setAttribute("data-panning", "");
    }
    if (d.kind === "ink") {
      /* Painted, not rendered — the same split the marquee uses, for the same reason: `Item` is
         memoised, and a board re-rendered sixty times a second is the one thing this canvas does
         not do. The points are board coordinates and the svg is inside the layer, so the transform
         carries them; `non-scaling-stroke` keeps the line one width at any zoom. */
      d.pts.push(toBoard(e.clientX, e.clientY));
      inkRef.current?.setAttribute("points", d.pts.map((p) => `${p.x},${p.y}`).join(" "));
      return;
    }
    if (d.kind === "marquee") {
      const box = boxRef.current?.getBoundingClientRect();
      const m = marqueeRef.current;
      if (!m || !box) return;
      const x = Math.min(d.sx, e.clientX) - box.left;
      const y = Math.min(d.sy, e.clientY) - box.top;
      m.hidden = false;
      m.style.transform = `translate(${x}px, ${y}px)`;
      m.style.width = `${Math.abs(dx)}px`;
      m.style.height = `${Math.abs(dy)}px`;
      return;
    }
    const box = boxRef.current;
    const to = clampPan({ x: d.from.x + dx, y: d.from.y + dy }, contentRef.current, applied.current.zoom, {
      w: box?.clientWidth ?? 1,
      h: box?.clientHeight ?? 1,
    });
    paint(applied.current.zoom, to);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      fingers.current.delete(e.pointerId);
      if (pinch.current) {
        /* The pinch ends when fewer than two are left, and the finger still down starts nothing. */
        if (fingers.current.size < 2) {
          pinch.current = null;
          touched.current = true;
          swallow.current = true;
          commit(applied.current.zoom, applied.current.off);
        }
        return;
      }
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    boxRef.current?.removeAttribute("data-panning");
    if (d.kind === "ink") {
      inkRef.current?.remove();
      inkRef.current = null;
      /* The click the release would deliver is eaten even when the stroke is refused: a pen tap is
         not a click on whatever sits under it, and the stroke that is refused here is a stroke
         nobody drew. */
      swallow.current = d.button === 0;
      /* A pointer the browser took away did not say anything — the same rule the marquee's paper
         click already follows. */
      if (e.type !== "pointerup") return;
      onInkRef.current?.(d.pts);
      return;
    }
    if (d.kind === "marquee") {
      const m = marqueeRef.current;
      if (m) m.hidden = true;
      if (!d.moved) {
        /* A click on the paper, with nothing in the way: the selection goes. Not on a cancel —
           a pointer the browser took away did not say anything. */
        if (e.type === "pointerup") onPaperClickRef.current?.();
        return;
      }
      swallow.current = true;
      const a = toBoard(Math.min(d.sx, e.clientX), Math.min(d.sy, e.clientY));
      const b = toBoard(Math.max(d.sx, e.clientX), Math.max(d.sy, e.clientY));
      onMarqueeRef.current?.({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, e.shiftKey);
      return;
    }
    if (!d.moved) {
      /* A tap on the paper, with a finger: the selection goes, as a click does. On an
         item it is that item's — `useEditor` selects it on the same release. */
      if (e.pointerType === "touch" && e.type === "pointerup" && !(e.target as Element | null)?.closest?.("[data-dag-item]"))
        onPaperClickRef.current?.();
      return;
    }
    /* Only a left drag has a `click` coming to eat. A middle one fires `auxclick` instead, and
       arming the swallow for it would leave it armed until the next real click, which it would then
       swallow instead. */
    swallow.current = d.button === 0;
    touched.current = true;
    setOff(applied.current.off);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    /* Two strokes in quick succession arrive here as a double-click — the pointer was captured to
       the box for both — and they are two strokes, not a request for a note. */
    if (tool === "pen") return;
    /* Only the paper itself: a double-click inside an item is that item's to handle. */
    if (e.target !== boxRef.current && e.target !== layerRef.current) return;
    onPaperDoubleClick?.(toBoard(e.clientX, e.clientY));
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = PAN_STEP * (e.shiftKey ? 3 : 1);
    const { zoom: z, off } = applied.current;
    const pan = (dx: number, dy: number) => {
      e.preventDefault();
      commit(z, { x: off.x + dx, y: off.y + dy });
      touched.current = true;
    };
    switch (e.key) {
      case "ArrowLeft":
        return pan(step, 0);
      case "ArrowRight":
        return pan(-step, 0);
      case "ArrowUp":
        return pan(0, step);
      case "ArrowDown":
        return pan(0, -step);
      case "Home":
      case "f":
      case "F":
        e.preventDefault();
        return fit();
      case "0":
        e.preventDefault();
        return commit(1, applied.current.off);
      case "+":
      case "=":
        e.preventDefault();
        return zoomBy(1);
      case "-":
      case "_":
        e.preventDefault();
        return zoomBy(-1);
    }
  };

  /* Fit on the first real content, and again whenever the content changes shape — unless the user
     has taken over, in which case leave their view exactly where they put it. */
  const fitted = useRef("");
  useEffect(() => {
    const key = `${content.x},${content.y},${content.w},${content.h}`;
    if (key === fitted.current || content.w <= 1) return;
    fitted.current = key;
    if (!touched.current) fit(content);
  }, [content, fit]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    /* Where the canvas's left edge is on the glass, as of the last resize. See below. */
    let left = box.getBoundingClientRect().left;
    const ro = new ResizeObserver(() => {
      const now = box.getBoundingClientRect().left;
      const moved = left - now;
      left = now;
      /* The same `w <= 1` guard as above. `contentBounds`
         answers `1 × 1` when nothing is placed, and fitting a 1px box means the maximum zoom — so
         the window's first resize left an empty plane reading **400%**. That was reachable before
         only on a board with no items; now it is the first screen anybody sees, and a zoom figure
         about nothing is worse than no figure at all. */
      if (!touched.current && contentRef.current.w > 1) return fit();
      /*
       * **The drawing does not move when the chrome beside it does.**
       *
       * The layer's transform is anchored to the canvas's own left edge, and a docked sidebar that
       * opens, closes or is dragged wider moves that edge. Left alone, everything on the board
       * would jump sideways by the column's width — which reads as the view changing when only the
       * chrome did. So a view somebody has placed is offset by exactly how far the edge went, and
       * stays put on the glass. A view nobody has touched still refits above, as it always has.
       */
      if (moved !== 0) {
        const { zoom: z, off } = applied.current;
        commit(z, { x: off.x + moved, y: off.y });
      }
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [fit, commit]);

  return (
    <div
      ref={boxRef}
      className="dag-viewport"
      tabIndex={0}
      role="application"
      aria-label="AnyDag. Scroll or use the arrow keys to move, ctrl and scroll to zoom, hold space or ctrl to drag the view, F to fit. Click an item to select it, drag the paper to select several."
      data-tool={tool}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div ref={layerRef} className="dag-layer">
        {children}
        {/* Smart guides, painted by the editor during a drag. In the layer so they share its
            transform; `overflow: visible` lets lines land anywhere on the board. */}
        <svg className="dag-guides" aria-hidden="true" />
      </div>
      <div ref={marqueeRef} className="dag-marquee" hidden aria-hidden="true" />
    </div>
  );
}
