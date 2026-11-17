/**
 * The Graph page's scene (#459): one graph, one camera, the simulation's worker, the GL renderer and
 * the names, and **a frame only when something moved**.
 *
 * Kept out of React on purpose: a frame touches a camera, two textures and a canvas, and none of
 * that is state a component should re-render for. The page makes one scene when it mounts, hands it
 * the shown subgraph and the view's forces as they change, and ends it when it unmounts — which ends
 * the worker and gives back the GL context. What is worth keeping (each file's place and the
 * camera) is handed back as `Kept` and given to the next scene, so coming back to the tab costs no
 * simulation.
 *
 * **At rest nothing runs.** The worker stops itself and says so; the page asks for a frame only while
 * the graph moves, the camera eases or the hover fades, and once all three are still it draws its
 * last frame and marks the stage `data-dag-graph="rest"`. There is no drift and no timer.
 */
import type { HostOut } from "@/graph/host";
import { boundsOf, centreOn, dotZoom, ease, fitTo, zoomAbout, type Box, type Camera } from "@/graph/camera";
import type { SimForces } from "@/graph/view";

import { drawLabels, type LabelStyle } from "./labels";
import { NoWebGL, Renderer, TEX_W, texRows, type Paint, type Sizes } from "./gl";
import { startSim, type SimLink } from "./simLink";

/** What the scene draws: the shown subgraph, in the page's terms. */
export interface SceneGraph {
  /** The whole graph's document count and ids, for keeping places by document. */
  ids: readonly string[];
  n: number;
  /** The graph's document for each shown file. */
  from: Int32Array;
  src: Int32Array;
  dst: Int32Array;
  degree: Int32Array;
  start: Int32Array;
  near: Int32Array;
  byDegree: Int32Array;
  /** A shown file's name. */
  name(i: number): string;
}

/** Groups, as the simulation takes them, and their names for the labels (`null` names: draw none). */
export interface SceneGroups {
  of: Int32Array;
  names: readonly string[] | null;
  sizes: Int32Array;
}

/** What a scene leaves for the next one on the same tab: every file's place, by document, and the camera. */
export interface Kept {
  ids: readonly string[];
  /** Two floats per document of `ids`, `NaN` for one that was not shown. */
  pos: Float32Array;
  cam: Camera;
  auto: boolean;
  /** The heat it was left at: 0 at rest. */
  alpha: number;
}

/** The look, resolved from the theme by the page. */
export interface Look {
  paint: Paint;
  sizes: Sizes & { dot: number; dotGrow: number; dotMax: number; hit: number };
  labels: LabelStyle;
}

export interface SceneHooks {
  /** A file pressed and let go without a drag: the page opens it. */
  open(shown: number): void;
  /** The zoom changed, for the zoom bar. */
  zoom(z: number): void;
  /** The space the panel leaves on the right, in CSS px, for a fit. */
  inset(): number;
}

type State = "settling" | "rest";

/** How the radius of a group's disc grows with its size, as the simulation packs it (`sim.ts`). */
const groupRadius = (size: number): number => 10.5 * Math.sqrt(size) + 8;
/** The heat a change of layout warms the graph to, and a refresh, and a filter. */
export const HEAT = { layout: 0.5, group: 0.8, reset: 0.7, refresh: 0.3, filter: 0.35 } as const;
/** How far a pointer moves before a press is a drag. */
const DRAG = 4;
/** The hover's fade, and the camera's easing, in ms. */
const FADE_MS = 130;
const EASE_MS = 170;
const EASE_FOLLOW_MS = 420;
const FIT_PAD = 48;

export class GraphScene {
  private gl: Renderer;
  private readonly sim: SimLink;
  private graph: SceneGraph | null = null;
  private groups: SceneGroups | null = null;
  private gen = 0;
  private pos = new Float32Array(TEX_W * 2);
  private spare: Float32Array | null = new Float32Array(TEX_W * 2);
  private posDirty = false;
  private radius = new Float32Array(0);
  private widths = new Float32Array(0);
  private state: Uint8Array = new Uint8Array(TEX_W);
  private slots: Uint8Array = new Uint8Array(0);
  private asked = false;
  private live = false;
  private alpha = 0;
  private held = false;
  private readonly cam: Camera = { z: 1, x: 0, y: 0 };
  private readonly target: Camera = { z: 1, x: 0, y: 0 };
  private auto = true;
  private hover = -1;
  private locked = -1;
  private hoverAmount = 0;
  private hoverTarget = 0;
  private raf = 0;
  private lastT = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private shownZoom = -1;
  private press: { px: number; py: number; cx: number; cy: number; node: number; dragged: boolean; id: number } | null = null;
  private ended = false;
  private kept: Kept | null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly off: (() => void)[] = [];
  /** Frames drawn, for the e2e spec's "nothing at rest" and the bench. */
  frames = 0;
  /** The last frame's cost in ms (GPU included only when `finish` is on). */
  frameMs = 0;
  /** The bench waits for the GPU each frame, to time it. */
  finish = false;
  private readonly glCanvas: HTMLCanvasElement;
  /** When the graph was last asked to settle, and how long it took. */
  private settleFrom = 0;
  settleMs = 0;
  tickMs = 0;

  constructor(
    private readonly stage: HTMLElement,
    surface: HTMLElement,
    private readonly labelCanvas: HTMLCanvasElement,
    private look: Look,
    private readonly reduced: boolean,
    private readonly hooks: SceneHooks,
    kept: Kept | null,
  ) {
    /* The scene's own canvas, made here and taken away in `end`: a context once lost stays lost on
       its canvas, so a page mounted again on the same element (React's strict mode does exactly
       that) would get the dead one back and never draw. */
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "dag-graph__gl";
    glCanvas.dataset.dagGraphCanvas = "";
    glCanvas.setAttribute("aria-hidden", "true");
    surface.append(glCanvas);
    this.glCanvas = glCanvas;
    try {
      this.gl = new Renderer(glCanvas);
    } catch (e) {
      glCanvas.remove();
      throw e;
    }
    const ctx = labelCanvas.getContext("2d");
    if (!ctx) {
      this.gl.dispose();
      glCanvas.remove();
      throw new NoWebGL("no 2D canvas");
    }
    this.ctx = ctx;
    this.kept = kept;
    if (kept) {
      Object.assign(this.cam, kept.cam);
      Object.assign(this.target, kept.cam);
      this.auto = kept.auto;
    }
    this.sim = startSim((msg) => this.heard(msg));
    this.listen();
    this.resize();
    this.mark("settling");
  }

  get where(): "worker" | "page" {
    return this.sim.where;
  }

  /* ---------------------------------------------------------------------------- the graph */

  /**
   * A new shown subgraph. Every file that was drawn before, here or in the scene this tab kept, keeps
   * its place; a new one starts beside its neighbours. `heat` is how warm it starts: 1 for a graph
   * never seen, 0 for one that comes back as it was.
   */
  show(g: SceneGraph, slots: Uint8Array, groups: SceneGroups | null, forces: SimForces, heat: number | "auto"): void {
    const old = this.graph;
    const oldPos = this.pos;
    const n = g.n;
    const rows = texRows(n);
    const next = new Float32Array(TEX_W * rows * 2);
    /* Where each document was: in the graph drawn now, or in what the tab kept. */
    const oldIndex = old ? indexOf(old, g.ids) : null;
    const kept = this.kept;
    const keptAt = kept ? keptIndex(kept, g.ids) : null;
    const known = new Uint8Array(n);
    let fresh = 0;
    for (let i = 0; i < n; i++) {
      const doc = g.from[i]!;
      const was = oldIndex ? (oldIndex.get(doc) ?? -1) : -1;
      if (was >= 0) {
        next[2 * i] = oldPos[2 * was]!;
        next[2 * i + 1] = oldPos[2 * was + 1]!;
        known[i] = 1;
        continue;
      }
      const k = keptAt ? keptAt[doc]! : -1;
      if (k >= 0 && kept && Number.isFinite(kept.pos[2 * k]!)) {
        next[2 * i] = kept.pos[2 * k]!;
        next[2 * i + 1] = kept.pos[2 * k + 1]!;
        known[i] = 1;
        continue;
      }
      fresh++;
    }
    const anyKnown = fresh < n;
    /* A new file beside the files it links to, a little apart; one with none known on the spiral. */
    for (let i = 0; i < n; i++) {
      if (known[i]) continue;
      let sx = 0;
      let sy = 0;
      let c = 0;
      for (let k = g.start[i]!; k < g.start[i + 1]!; k++) {
        const j = g.near[k]!;
        if (!known[j]) continue;
        sx += next[2 * j]!;
        sy += next[2 * j + 1]!;
        c++;
      }
      const a = i * 2.399963229728653;
      if (c) {
        next[2 * i] = sx / c + 12 * Math.cos(a);
        next[2 * i + 1] = sy / c + 12 * Math.sin(a);
      } else {
        const r = 9 * Math.sqrt(i + 0.5) + (anyKnown ? 40 : 0);
        next[2 * i] = r * Math.cos(a);
        next[2 * i + 1] = r * Math.sin(a);
      }
    }
    const alpha =
      heat !== "auto" ? heat : !anyKnown ? 1 : fresh > 0 ? HEAT.refresh : this.kept && !old ? this.kept.alpha : HEAT.filter;
    const first = !anyKnown && !old && !this.kept;
    if (first) this.auto = true;
    this.kept = null;

    this.graph = g;
    this.groups = groups;
    this.pos = next;
    this.spare = new Float32Array(next.length);
    this.state = new Uint8Array(TEX_W * rows);
    this.widths = new Float32Array(n);
    this.radius = new Float32Array(n);
    const m = this.look.sizes;
    for (let i = 0; i < n; i++) this.radius[i] = Math.min(m.dotMax, m.dot + m.dotGrow * Math.sqrt(g.degree[i]!));
    this.slots = slots;
    this.hover = -1;
    this.locked = -1;
    this.hoverTarget = 0;
    this.hoverAmount = 0;
    this.press = null;
    this.gen++;
    this.asked = false;
    this.live = alpha > 0;
    this.alpha = alpha;
    this.posDirty = true;
    this.upload();
    this.settleFrom = performance.now();
    this.settleMs = 0;
    this.sim.post({
      t: "init",
      gen: this.gen,
      n,
      src: g.src,
      dst: g.dst,
      pos: next.slice(0, 2 * n),
      alpha,
      forces,
      group: groups?.of ?? null,
    });
    if (first || (this.auto && !this.live)) this.fit(false);
    this.invalidate();
  }

  /** The dots' slots: one small buffer, nothing else changes when the colouring does. */
  colour(slots: Uint8Array): void {
    this.slots = slots;
    if (this.graph) this.gl.dots(this.radius, slots);
    this.invalidate();
  }

  /** Forces or groups changed: the same files in the same places, warmed enough to move to the new layout. */
  layout(forces: SimForces, groups: SceneGroups | null | undefined, heat: number): void {
    if (!this.graph) return;
    if (groups !== undefined) this.groups = groups;
    this.sim.post({ t: "set", forces, heat, ...(groups !== undefined ? { group: groups?.of ?? null } : {}) });
    this.live = true;
    this.auto = true;
    this.settleFrom = performance.now();
    this.settleMs = 0;
    this.invalidate();
  }

  setLook(look: Look): void {
    this.look = look;
    if (this.graph) {
      const m = look.sizes;
      for (let i = 0; i < this.graph.n; i++)
        this.radius[i] = Math.min(m.dotMax, m.dot + m.dotGrow * Math.sqrt(this.graph.degree[i]!));
      this.widths.fill(0);
      this.gl.dots(this.radius, this.slots);
    }
    this.invalidate();
  }

  private upload(): void {
    const g = this.graph;
    if (!g) return;
    this.gl.graph(g.n, g.src, g.dst);
    this.gl.dots(this.radius, this.slots);
    this.gl.positions(this.pos);
    this.posDirty = false;
    this.gl.lit(this.state);
  }

  /* ---------------------------------------------------------------------- the simulation */

  private heard(msg: HostOut): void {
    if (this.ended) return;
    if (msg.t === "rest") {
      /* Stopped because the window is hidden: it goes on where it was when the window comes back. */
      if (msg.gen !== this.gen || document.hidden) return;
      this.live = false;
      this.held = false;
      this.alpha = 0;
      /* Asked nothing while it settled (reduced motion): one frame now, of where it came to rest. */
      if (!this.asked && this.spare) this.ask();
      this.invalidate();
      return;
    }
    this.asked = false;
    if (msg.gen !== this.gen || !msg.filled) {
      const size = this.pos.length;
      this.spare = msg.buf.byteLength === size * 4 ? new Float32Array(msg.buf) : new Float32Array(size);
      if (msg.gen === this.gen) this.invalidate();
      return;
    }
    this.spare = this.pos;
    this.pos = new Float32Array(msg.buf);
    this.posDirty = true;
    this.alpha = msg.alpha;
    this.live = msg.live;
    this.held = msg.held;
    this.tickMs = msg.tickMs;
    if (!this.live && !this.settleMs) {
      this.settleMs = performance.now() - this.settleFrom;
      if (this.auto) this.fit(!this.reduced);
    }
    this.invalidate();
  }

  private ask(): void {
    if (!this.spare) return;
    const buf = this.spare.buffer as ArrayBuffer;
    this.spare = null;
    this.asked = true;
    this.sim.post({ t: "frame", gen: this.gen, buf }, [buf]);
  }

  /* --------------------------------------------------------------------------- the camera */

  private room(): Box {
    const inset = this.w > 720 ? this.hooks.inset() : 0;
    return { x0: 0, y0: 0, x1: Math.max(1, this.w - inset), y1: this.h };
  }

  /** The whole graph in the room the panel leaves. */
  fit(eased = true): void {
    const g = this.graph;
    const to = fitTo(boundsOf(this.pos, g?.n ?? 0), this.room(), FIT_PAD);
    Object.assign(this.target, to);
    if (!eased || this.reduced) Object.assign(this.cam, to);
    this.invalidate();
  }

  /** Back to fitting the graph, and staying fitted while it settles: the F key and the zoom bar. */
  refit(): void {
    this.auto = true;
    this.fit(true);
  }

  zoomBy(by: number, px = this.w / 2, py = this.h / 2): void {
    this.auto = false;
    Object.assign(this.target, zoomAbout(this.target, px, py, by));
    if (this.reduced) Object.assign(this.cam, this.target);
    this.invalidate();
  }

  /** Zoom 1, about the middle. */
  actual(): void {
    this.zoomBy(1 / this.target.z);
  }

  /* --------------------------------------------------------------------------- the frame */

  private invalidate(): void {
    if (this.ended || this.raf) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.mark("settling");
  }

  private frame(t: number): void {
    this.raf = 0;
    if (this.ended) return;
    const dt = Math.min(50, t - (this.lastT || t));
    this.lastT = t;
    const t0 = performance.now();
    let more = false;
    /* Positions as often as frames are drawn, while it moves — but under reduced motion only while a
       file is held: the graph is laid out without being shown moving. */
    if (this.live && !this.asked && this.spare && (!this.reduced || this.held)) this.ask();
    if (this.live && this.auto && !this.reduced) this.fit(true);
    const k = this.reduced ? 1 : 1 - 0.001 ** (dt / (this.live && this.auto ? EASE_FOLLOW_MS : EASE_MS));
    if (ease(this.cam, this.target, k)) more = true;
    if (this.hoverAmount !== this.hoverTarget) {
      const by = this.reduced ? 1 : dt / FADE_MS;
      this.hoverAmount =
        this.hoverTarget > this.hoverAmount
          ? Math.min(this.hoverTarget, this.hoverAmount + by)
          : Math.max(this.hoverTarget, this.hoverAmount - by);
      if (this.hoverAmount !== this.hoverTarget) more = true;
    }
    if (this.gl.lost) return;
    if (this.posDirty) {
      this.gl.positions(this.pos);
      this.posDirty = false;
    }
    const look = this.look;
    const dot = dotZoom(this.cam.z);
    const quiet = Math.min(1, 0.5 + 0.6 * this.cam.z) * ((this.graph?.src.length ?? 0) > 40_000 ? 0.6 : 1);
    this.gl.draw(
      { w: this.w, h: this.h, dpr: this.dpr, z: this.cam.z, x: this.cam.x, y: this.cam.y, dot, hover: this.hoverAmount },
      { ...look.paint, edgeAlpha: look.paint.edgeAlpha * quiet },
      look.sizes,
    );
    this.labels(dot);
    if (this.finish) this.gl.finish();
    const ms = performance.now() - t0;
    this.frameMs = this.frameMs ? this.frameMs * 0.9 + ms * 0.1 : ms;
    this.frames++;
    const z = Math.round(this.cam.z * 100);
    if (z !== this.shownZoom) {
      this.shownZoom = z;
      this.hooks.zoom(this.cam.z);
    }
    /* Waiting on the worker is not a frame: its answer asks for the next one. */
    if (more) this.invalidate();
    else if (!this.live && !this.asked) this.mark("rest");
  }

  private labels(dot: number): void {
    const g = this.graph;
    const focus = this.hoverAmount > 0 ? (this.locked >= 0 ? this.locked : this.hover) : -1;
    drawLabels(
      {
        ctx: this.ctx,
        w: this.w,
        h: this.h,
        dpr: this.dpr,
        z: this.cam.z,
        x: this.cam.x,
        y: this.cam.y,
        dot,
        dotMin: this.look.sizes.dotMin,
        hover: this.hoverAmount,
        focus,
        n: g?.n ?? 0,
        pos: this.pos,
        radius: this.radius,
        byDegree: g?.byDegree ?? new Int32Array(0),
        start: g?.start ?? new Int32Array(1),
        near: g?.near ?? new Int32Array(0),
        name: (i) => g!.name(i),
        widths: this.widths,
        group: this.groups?.names ? this.groups.of : null,
        groupNames: this.groups?.names ?? null,
        groupSizes: this.groups?.sizes ?? null,
        groupRadius,
      },
      this.look.labels,
    );
  }

  private mark(state: State): void {
    if (this.stage.dataset.dagGraph !== state) this.stage.dataset.dagGraph = state;
  }

  /* --------------------------------------------------------------------------- the pointer */

  /** The shown file under a screen point, or -1. */
  pick(px: number, py: number): number {
    const g = this.graph;
    if (!g) return -1;
    const wx = (px - this.cam.x) / this.cam.z;
    const wy = (py - this.cam.y) / this.cam.z;
    const dot = dotZoom(this.cam.z);
    const { dotMin, hit } = this.look.sizes;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < g.n; i++) {
      const dx = this.pos[2 * i]! - wx;
      const dy = this.pos[2 * i + 1]! - wy;
      const d = dx * dx + dy * dy;
      const r = (Math.max(this.radius[i]! * dot, dotMin) + hit) / this.cam.z;
      if (d < r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Where a shown file is drawn now, in CSS px from the stage's corner: the e2e spec presses there. */
  screenOf(i: number): { x: number; y: number } | null {
    if (!this.graph || i < 0 || i >= this.graph.n) return null;
    return { x: this.pos[2 * i]! * this.target.z + this.target.x, y: this.pos[2 * i + 1]! * this.target.z + this.target.y };
  }

  private light(i: number): void {
    const g = this.graph;
    if (!g) return;
    this.state.fill(0);
    if (i >= 0) {
      this.state[i] = 2;
      for (let k = g.start[i]!; k < g.start[i + 1]!; k++) this.state[g.near[k]!] = 1;
    }
    this.gl.lit(this.state);
  }

  private setHover(i: number): void {
    if (this.locked >= 0 || i === this.hover) return;
    this.hover = i;
    this.glCanvas.classList.toggle("is-node", i >= 0);
    if (i >= 0) {
      this.light(i);
      this.hoverTarget = 1;
    } else this.hoverTarget = 0;
    this.invalidate();
  }

  /** Centre on a shown file and light it, until let go: the find field. */
  find(i: number): void {
    if (!this.graph || i < 0 || i >= this.graph.n) return;
    this.locked = i;
    this.hover = i;
    this.light(i);
    this.hoverTarget = 1;
    this.auto = false;
    const z = Math.max(this.target.z, 1.5);
    const room = this.room();
    Object.assign(
      this.target,
      centreOn(this.pos[2 * i]!, this.pos[2 * i + 1]!, (room.x0 + room.x1) / 2, (room.y0 + room.y1) / 2, z),
    );
    if (this.reduced) Object.assign(this.cam, this.target);
    this.invalidate();
  }

  /** The found file let go: Escape. Returns whether one was held. */
  letGo(): boolean {
    if (this.locked < 0) return false;
    this.locked = -1;
    this.hover = -1;
    this.hoverTarget = 0;
    this.invalidate();
    return true;
  }

  get found(): number {
    return this.locked;
  }

  private point(e: PointerEvent | WheelEvent): { px: number; py: number } {
    const r = this.glCanvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  private listen(): void {
    const c = this.glCanvas;
    type Events = HTMLElementEventMap & { visibilitychange: Event; webglcontextlost: Event; webglcontextrestored: Event };
    const on = <K extends keyof Events>(
      target: HTMLElement | Document,
      type: K,
      fn: (e: Events[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(c, "pointermove", (e) => {
      const { px, py } = this.point(e);
      const p = this.press;
      if (!p || p.id !== e.pointerId) {
        if (e.pointerType !== "touch") this.setHover(this.pick(px, py));
        return;
      }
      if (Math.hypot(px - p.px, py - p.py) > DRAG) p.dragged = true;
      if (!p.dragged) return;
      if (p.node >= 0) {
        this.sim.post({ t: "pin", i: p.node, x: (px - this.cam.x) / this.cam.z, y: (py - this.cam.y) / this.cam.z });
        this.live = true;
        this.held = true;
        this.auto = false;
        this.invalidate();
        return;
      }
      this.auto = false;
      this.cam.x = this.target.x = p.cx + px - p.px;
      this.cam.y = this.target.y = p.cy + py - p.py;
      this.invalidate();
    });
    on(c, "pointerdown", (e) => {
      if (e.button !== 0 || this.press) return;
      const { px, py } = this.point(e);
      this.press = { px, py, cx: this.cam.x, cy: this.cam.y, node: this.pick(px, py), dragged: false, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      if (this.press.node < 0) c.classList.add("is-pan");
    });
    const up = (e: PointerEvent, cancelled: boolean) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      this.press = null;
      c.classList.remove("is-pan");
      if (p.node >= 0 && p.dragged) {
        this.sim.post({ t: "drop" });
        this.live = true;
        this.invalidate();
      } else if (p.node >= 0 && !cancelled) this.hooks.open(p.node);
      else if (!p.dragged && !cancelled) this.letGo();
    };
    on(c, "pointerup", (e) => up(e, false));
    on(c, "pointercancel", (e) => up(e, true));
    on(c, "pointerleave", () => {
      if (!this.press) this.setHover(-1);
    });
    on(
      c,
      "wheel",
      (e) => {
        e.preventDefault();
        const { px, py } = this.point(e);
        /* A pinch arrives as a wheel with ctrl held, in small steps: it moves faster. */
        const by = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : e.deltaMode === 1 ? 0.05 : 0.0016));
        this.zoomBy(by, px, py);
      },
      { passive: false },
    );
    on(document, "visibilitychange", () => {
      this.sim.post({ t: document.hidden ? "pause" : "resume" });
      if (!document.hidden) this.invalidate();
    });
    on(c, "webglcontextlost", (e) => e.preventDefault());
    on(c, "webglcontextrestored", () => {
      if (this.ended) return;
      try {
        this.gl = new Renderer(c);
        this.upload();
        this.invalidate();
      } catch {
        /* Nothing to draw with: the page stays as it was until it is opened again. */
      }
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.stage);
    this.off.push(() => ro.disconnect());
  }

  resize(): void {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (this.auto) {
      this.cam.x += (w - this.w) / 2;
      this.cam.y += (h - this.h) / 2;
      Object.assign(this.target, this.cam);
    }
    this.w = w;
    this.h = h;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.glCanvas, this.labelCanvas]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    if (this.auto && this.graph && !this.live) this.fit(false);
    this.invalidate();
  }

  /* ------------------------------------------------------------------------------ the end */

  /** What the next scene on this tab starts from. */
  keep(): Kept | null {
    const g = this.graph;
    if (!g) return this.kept;
    const docs = g.ids.length;
    const pos = new Float32Array(2 * docs).fill(Number.NaN);
    for (let i = 0; i < g.n; i++) {
      const d = g.from[i]!;
      pos[2 * d] = this.pos[2 * i]!;
      pos[2 * d + 1] = this.pos[2 * i + 1]!;
    }
    return { ids: g.ids, pos, cam: { ...this.target }, auto: this.auto, alpha: this.live ? Math.max(this.alpha, 0.05) : 0 };
  }

  /** The worker ended, the GL context given back, every listener and frame gone. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const f of this.off) f();
    this.sim.end();
    this.gl.dispose();
    this.glCanvas.remove();
  }
}

/**
 * Where each document of `ids` is in the shown graph `g`: by index when `g` reads the same answer,
 * by id when the vault moved under it (a file added shifts every index after it).
 */
function indexOf(g: SceneGraph, ids: readonly string[]): Map<number, number> {
  const m = new Map<number, number>();
  if (g.ids === ids) {
    for (let i = 0; i < g.n; i++) m.set(g.from[i]!, i);
    return m;
  }
  const at = new Map<string, number>();
  for (let i = 0; i < g.n; i++) at.set(g.ids[g.from[i]!]!, i);
  for (let d = 0; d < ids.length; d++) {
    const i = at.get(ids[d]!);
    if (i !== undefined) m.set(d, i);
  }
  return m;
}

/** For each document of `ids`, its index in what was kept, or -1: the same array is the same order. */
function keptIndex(kept: Kept, ids: readonly string[]): Int32Array {
  const out = new Int32Array(ids.length).fill(-1);
  if (kept.ids === ids || (kept.ids.length === ids.length && kept.ids.every((id, i) => id === ids[i]))) {
    for (let i = 0; i < ids.length; i++) out[i] = i;
    return out;
  }
  const at = new Map(kept.ids.map((id, i) => [id, i]));
  for (let i = 0; i < ids.length; i++) out[i] = at.get(ids[i]!) ?? -1;
  return out;
}
