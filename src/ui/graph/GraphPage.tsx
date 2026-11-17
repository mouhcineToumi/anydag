import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { clusters, numbered } from "@/graph/clusters";
import { groupsOf, shown, type Graph, type Shown } from "@/graph/model";
import { colours } from "@/graph/palette";
import { GROUP_BY_LINKS, simForces, type GraphView } from "@/graph/view";
import { useTabActive, useTabKeep } from "@/ui/tabs/keep";
import { Button } from "@/ui/controls";
import { ZoomBar } from "@/ui/ZoomBar";
import type { Theme } from "@/theme/contract";

import { useGraphData } from "./data";
import { Find, type FindHandle } from "./Find";
import { NoWebGL } from "./gl";
import { lookOf } from "./look";
import { Panel } from "./Panel";
import { flushView, loadView, saveView } from "./saved";
import { GraphScene, HEAT, type Kept, type SceneGraph, type SceneGroups } from "./scene";

/**
 * The Graph page (#459) — `?graph=1`: the vault drawn as dots and lines, laid out by the simulation
 * in a worker and drawn with WebGL2, with a panel that colours, filters and groups it by any field
 * the server sends.
 *
 * **It costs nothing when it is not looked at.** The scene, its worker and its GL context exist only
 * while this page is mounted, and the page unmounts when its tab goes behind another; what is worth
 * keeping — each file's place and the camera — stays in memory with the tab (`useTabKeep`), so
 * coming back draws at once with no simulation. At rest it requests no frame and runs no timer.
 */

/** A shown file's name: its title, or the last part of its name. */
const nameOf = (graph: Graph, doc: number): string => {
  const t = graph.titles[doc];
  if (t) return t;
  const n = graph.names[doc]!;
  return n.slice(n.lastIndexOf("/") + 1);
};

/** Groups for the layout: by a field's value, or the clusters the shown links make. */
function groupsFor(graph: Graph, s: Shown, view: GraphView): SceneGroups | null {
  if (view.groupBy === null) return null;
  if (view.groupBy === GROUP_BY_LINKS) {
    const of = numbered(clusters({ start: s.start, near: s.near }));
    let top = -1;
    for (let i = 0; i < of.length; i++) if (of[i]! > top) top = of[i]!;
    const sizes = new Int32Array(top + 1);
    for (let i = 0; i < of.length; i++) if (of[i]! >= 0) sizes[of[i]!]!++;
    return { of, names: null, sizes };
  }
  const g = groupsOf(graph, s, view);
  return g ? { of: g.of, names: g.names, sizes: g.sizes } : null;
}

const typingIn = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const forcesKey = (v: GraphView) => JSON.stringify(v.forces);

export function GraphPage({ theme, onOpen }: { theme: Theme; onOpen(id: string): void }) {
  const data = useGraphData();
  const [view, setView] = useState<GraphView | null>(null);
  useEffect(() => {
    let live = true;
    void loadView().then((v) => live && setView(v));
    return () => {
      live = false;
      flushView();
    };
  }, []);

  const graph = data.graph;
  const rules = view?.rules;
  const orphans = view?.orphans;
  const sub = useMemo(
    () => (graph && rules !== undefined && orphans !== undefined ? shown(graph, { ...view!, rules, orphans }) : null),
    // The subgraph depends on the rules and orphans only: a colour or a slider moves no file in or out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, rules, orphans],
  );
  const colourBy = view?.colourBy;
  const col = useMemo(
    () => (graph && sub && colourBy !== undefined ? colours(graph, sub, { ...view!, colourBy }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, sub, colourBy],
  );
  const slots = useMemo(() => col?.slots ?? (sub ? new Uint8Array(sub.n).fill(1) : null), [col, sub]);
  const groupBy = view?.groupBy;
  const groups = useMemo(
    () => (graph && sub && groupBy !== undefined ? groupsFor(graph, sub, { ...view!, groupBy }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, sub, groupBy],
  );
  const names = useMemo(() => (graph && sub ? Array.from(sub.from, (d) => nameOf(graph, d)) : []), [graph, sub]);

  /* ---- the scene ---- */
  const stage = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const labelCanvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const find = useRef<FindHandle>(null);
  const scene = useRef<GraphScene | null>(null);
  const [made, setMade] = useState(0);
  const [failed, setFailed] = useState(false);
  const tab = useTabKeep("graph", () => ({ kept: null as Kept | null }));
  const latest = useRef({ graph, sub, onOpen });
  latest.current = { graph, sub, onOpen };
  const look = useMemo(() => lookOf(theme), [theme]);
  const lookRef = useRef(look);
  lookRef.current = look;

  useLayoutEffect(() => {
    if (!stage.current || !surface.current || !labelCanvas.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let s: GraphScene;
    try {
      s = new GraphScene(
        stage.current,
        surface.current,
        labelCanvas.current,
        lookRef.current,
        reduced,
        {
          open: (i) => {
            const { graph: g, sub: v, onOpen: go } = latest.current;
            if (g && v && i < v.n) go(g.ids[v.from[i]!]!);
          },
          zoom: (z) => document.dispatchEvent(new CustomEvent("dag:zoom", { detail: z })),
          inset: () => (panel.current ? panel.current.offsetWidth + 16 : 0),
        },
        tab?.kept ?? null,
      );
    } catch (e) {
      if (!(e instanceof NoWebGL)) throw e;
      setFailed(true);
      return;
    }
    scene.current = s;
    /* The bench and the e2e spec read the scene's own numbers here, never its insides. */
    const probe = window as unknown as { __dagGraph?: unknown };
    probe.__dagGraph = {
      get frames() {
        return s.frames;
      },
      get frameMs() {
        return s.frameMs;
      },
      get settleMs() {
        return s.settleMs;
      },
      get tickMs() {
        return s.tickMs;
      },
      get where() {
        return s.where;
      },
      /** The file *Find* lit, as an index `at` takes, or -1. */
      get found() {
        return s.found;
      },
      set finish(on: boolean) {
        s.finish = on;
      },
      at: (i: number) => s.screenOf(i),
      pick: (x: number, y: number) => s.pick(x, y),
    };
    setMade((n) => n + 1);
    return () => {
      if (tab) tab.kept = s.keep();
      s.end();
      scene.current = null;
      if (probe.__dagGraph) delete probe.__dagGraph;
    };
    // Made once per mount: a theme or a graph is handed to the scene, never a reason to make another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scene.current?.setLook(look);
  }, [look]);

  /* What the scene was last handed, to tell a new subgraph from a recolouring or a new layout. */
  const handed = useRef<{
    sub: Shown | null;
    slots: Uint8Array | null;
    groups: SceneGroups | null;
    forces: string;
    resets: number;
  } | null>(null);
  /* *Reset the layout* pressed, counted: pressed with the sliders already where it puts them, the
     view does not change, and the graph is still warmed to move. */
  const [resets, setResets] = useState(0);
  const fkey = view ? forcesKey(view) : "";
  useEffect(() => {
    const s = scene.current;
    if (!s || !graph || !sub || !slots || !view) return;
    const forces = simForces(view);
    const last = handed.current;
    if (!last || last.sub !== sub) {
      const sg: SceneGraph = {
        ids: graph.ids,
        n: sub.n,
        from: sub.from,
        src: sub.src,
        dst: sub.dst,
        degree: sub.degree,
        start: sub.start,
        near: sub.near,
        byDegree: sub.byDegree,
        name: (i) => names[i] ?? "",
      };
      s.show(sg, slots, groups, forces, "auto");
    } else {
      if (last.slots !== slots) s.colour(slots);
      if (last.groups !== groups) s.layout(forces, groups, last.resets !== resets ? HEAT.reset : HEAT.group);
      else if (last.resets !== resets) s.layout(forces, undefined, HEAT.reset);
      else if (last.forces !== fkey) s.layout(forces, undefined, HEAT.layout);
    }
    handed.current = { sub, slots, groups, forces: fkey, resets };
    // `view` is read for its forces, whose key is `fkey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made, graph, sub, slots, groups, fkey, names, resets]);

  const change = useCallback((next: GraphView) => {
    setView(next);
    saveView(next);
  }, []);
  const changeLayout = useCallback(
    (next: GraphView, reset?: boolean) => {
      if (reset) setResets((n) => n + 1);
      change(next);
    },
    [change],
  );

  /* ---- the keys: F fits, + and - zoom, 0 is 100%, / finds, Escape lets go ---- */
  const active = useTabActive();
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      const s = scene.current;
      if (!s) return;
      if (e.key === "f" || e.key === "F") s.refit();
      else if (e.key === "+" || e.key === "=") s.zoomBy(1.4);
      else if (e.key === "-" || e.key === "_") s.zoomBy(1 / 1.4);
      else if (e.key === "0") s.actual();
      else if (e.key === "/") find.current?.focus();
      else if (e.key === "Escape") {
        if (!s.letGo()) return;
        find.current?.clear();
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [active]);

  const open = useCallback((i: number) => {
    const { graph: g, sub: v, onOpen: go } = latest.current;
    if (g && v && i >= 0 && i < v.n) go(g.ids[v.from[i]!]!);
  }, []);
  const pick = useCallback((i: number) => {
    const s = scene.current;
    if (!s) return;
    if (i >= 0) s.find(i);
    else s.letGo();
  }, []);

  const n = sub?.n ?? 0;
  const m = sub?.m ?? 0;
  const label = `Graph of the vault: ${n.toLocaleString("en-GB")} files and ${m.toLocaleString("en-GB")} links shown`;
  const empty = graph && view ? (graph.n === 0 ? "vault" : n === 0 ? "filtered" : null) : null;

  return (
    <div className="dag-graph" data-dag-graph-page="">
      <div ref={stage} className="dag-graph__stage" data-dag-graph="settling">
        {/* The scene puts its own GL canvas in here, and takes it away when it ends. */}
        <div ref={surface} className="dag-graph__surface" role="img" aria-label={label} data-dag-graph-surface="" />
        <canvas ref={labelCanvas} className="dag-graph__labels" aria-hidden="true" />
        {failed ? (
          <div className="dag-graph__empty" role="status" data-dag-graph-problem="webgl">
            <p>The graph needs WebGL 2, which this browser or this machine cannot give it.</p>
          </div>
        ) : data.problem === "version" ? (
          <div className="dag-graph__empty" role="status" data-dag-graph-problem="version">
            <p>This page is older than the server. Reload it to draw the graph.</p>
          </div>
        ) : data.problem === "failed" && !graph ? (
          <div className="dag-graph__empty" role="status" data-dag-graph-problem="failed">
            <p>The vault's links did not come. Trying again in a moment.</p>
          </div>
        ) : empty === "vault" ? (
          <div className="dag-graph__empty" role="status">
            <p>Nothing to draw yet: this vault has no file.</p>
          </div>
        ) : empty === "filtered" && view ? (
          <div className="dag-graph__empty" role="status">
            <p>The filters leave no file to show.</p>
            <Button onClick={() => change({ ...view, rules: [], orphans: true })}>Show every file</Button>
          </div>
        ) : null}
        {graph && sub && !failed ? <Find ref={find} names={names} byDegree={sub.byDegree} onPick={pick} onOpen={open} /> : null}
        {graph && view && !failed ? (
          <Panel
            ref={panel}
            graph={graph}
            view={view}
            palette={col?.palette ?? null}
            shownFiles={n}
            shownLinks={m}
            groups={view.groupBy !== null ? (groups?.sizes.length ?? 0) : 0}
            onView={change}
            onLayout={changeLayout}
          />
        ) : null}
        {!failed ? (
          <>
            <p className="dag-graph__hint" aria-hidden="true">
              Wheel zooms · drag the paper to move · drag a dot · click opens · F fits
            </p>
            <ZoomBar
              onZoom={(dir) => scene.current?.zoomBy(dir > 0 ? 1.4 : 1 / 1.4)}
              onFit={() => scene.current?.refit()}
              onActual={() => scene.current?.actual()}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
