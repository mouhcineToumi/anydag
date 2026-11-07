import { memo, useEffect, useMemo, useRef, useState } from "react";

import { framed as isFramed, type BoardItem } from "@/board/types";
import { parseItem, type Model } from "@/dsl/diagnose";
import type { Graph } from "@/dsl/ir";
import type { SequenceModel } from "@/dsl/sequence";
import { cached, layout, layoutKey } from "@/layout/client";
import { figureHull, figureParts } from "@/layout/figure";
import { isShape } from "@/layout/shapes";
import { sizeLabels } from "@/layout/size";
import type { InnerBox, Layout } from "@/layout/types";
import { scoreGraph } from "@/quality/score";
import { isSnapshot } from "@/settings/store";
import type { Theme } from "@/theme/contract";

import { Axis } from "./Axis";
import { ChartView } from "./ChartView";
import { Edges } from "./Edges";
import { CODES } from "@/dsl/codes";

import { BrokenItem, type Shown } from "./ErrorItem";
import { Frame } from "./Frame";
import { Group } from "./Group";
import { Lane } from "./Lane";
import { Legend } from "./Legend";
import { PendingItem } from "./PendingItem";
import { SequenceView } from "./SequenceView";
import { useArtReady, type ArtCut } from "./art";
import { artOf, iconFor } from "./Icon";
import { NodeView } from "./nodes";

/**
 * The art files a model draws from, which are loaded on demand (`./art.ts`) — every node's and
 * participant's glyph, its `icon=` or its kind's default, through the resolver the cards use. A
 * chart draws none. A node whose card has no tile asks too, which costs a fetch and draws nothing
 * wrong.
 */
function cutsOf(model: Model | null, theme: Theme): ArtCut[] {
  if (!model || model.kind === "chart") return [];
  const refs =
    model.kind === "sequence"
      ? model.participants.map((p) => iconFor(p.kind, theme, p.icon))
      : model.nodes.map((n) => iconFor(n.kind, theme, n.icon));
  return [...new Set(refs.map(artOf))];
}

/**
 * A diagram: parse, lay out, draw.
 *
 * Layout is async because the graph types cross to a worker, so the first paint of a new diagram
 * has no boxes yet. Rather than flash, the item keeps its previous layout until the new one
 * arrives — editing one line of a forty-node diagram should not make it disappear and come back.
 *
 * **A body that does not parse keeps the last drawing that did.** Typing through a half-written
 * line in the panel used to swap the whole diagram for a red card on every keystroke, and a board
 * Claude had just broken sat behind one until somebody fixed it. What is wrong is the problems
 * dock's to say (`src/ui/Problems.tsx`), and the panel's while the item is open in it; the canvas
 * shows the drawing, with a dot in its corner saying it is not the file's current text. Only when
 * there has never been a good drawing — the page was opened on a broken board — is there nothing to
 * keep, and then a small grey placeholder stands where the diagram goes.
 */

export interface DiagramProps {
  item: BoardItem;
  theme: Theme;
  /**
   * The item's own box, and where each of its nodes sits inside it.
   *
   * The node boxes are what lets a *board-level* link end on a node rather than on the whole
   * diagram (`item.node` in an `edges` fence). They are in the item's coordinates, not the
   * layout's: the frame's padding and header sit between the two, and only this component knows
   * how much — `frame.pad`, `frame.headerH` and the rule's margins are read here and in `nodes.css`.
   */
  onSize(size: { w: number; h: number }, nodes: Record<string, InnerBox>): void;
  /**
   * Pick one of this diagram's own edges, by the id the parser gave it.
   *
   * Absent under `?snapshot=1`, where the page is being photographed rather than used — and that
   * absence is what stops the hit strokes being drawn at all, so a snapshot is unchanged by any of
   * this. The ring on the picked edge does *not* come back down as a prop: it is painted onto the
   * element, because `Item` is memoised and this would be a per-node prop on it.
   */
  onPickEdge?(id: string): void;
}

/**
 * The rectangle a chart draws in.
 *
 * `metric.chart.w`/`h` are the *item's* default box, so the content box is that less what the frame
 * draws around it — the padding twice, and the header and its rule when there is one. Derived from
 * the same parts the size effect below adds back up, rather than from a key of its own: a metric
 * nothing draws from is a claim, and `frame.bodyTop` is what that claim cost the last time.
 *
 * Every other item type reads its size *out* of the layout. This is the one that reads it in.
 */
function chartBox(item: BoardItem, theme: Theme): { w: number; h: number } {
  const m = theme.metric.frame;
  const bare = !isFramed(item);
  const pad = bare ? m.barePad : m.pad;
  const top = bare ? pad : pad + (m.headerH - m.pad) + m.ruleGapTop + theme.metric.line.hair + m.ruleGapBottom;
  return {
    w: (item.w ?? theme.metric.chart.w) - pad * 2,
    h: (item.h ?? theme.metric.chart.h) - top - pad,
  };
}

/**
 * A diagram, from its body to its drawing.
 *
 * Memoised on its props, which `Item` keeps stable: `Item` re-renders for its own reasons —
 * selected, moved, a card picked in it — and each used to redraw every card, edge and group in
 * here and report its size again, which re-rendered the page. A new parse is a new `item`, so a
 * change to the diagram still redraws it.
 */
export const DiagramItem = memo(function DiagramItem({ item, theme, onSize, onPickEdge }: DiagramProps) {
  /* The latest parse, errors and all — what the dot and the placeholder report. */
  const [model, setModel] = useState<Model | null>(null);
  /* The latest parse with no errors: the one that is drawn. It trails `model` while the body is
     broken, and `placed` is always its layout, because a broken parse is never laid out. */
  const [drawn, setDrawn] = useState<Model | null>(null);
  const [placed, setPlaced] = useState<Layout | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    /* One dispatch, shared with the diagnostics route and the problems dock (`dsl/diagnose.ts`), so
       the three cannot disagree about which parser a fence gets or what it is handed. */
    const parsed = parseItem(item);
    setModel(parsed);
    if (!parsed) return;
    /* Laying out a broken parse is what used to put a half-drawn diagram behind the error card.
       The last good drawing and its layout stay exactly as they were instead. */
    if (parsed.diagnostics.some((d) => d.severity === "error")) return;
    setDrawn(parsed);

    /* A chart is the one type whose *box* changes its layout — `resizeOf("chart")` is `box`, so
       `w=`/`h=` are the author's and neither is in the body hash. Everything else is keyed on the
       hash alone, exactly as before. */
    const box = item.type === "chart" ? chartBox(item, theme) : undefined;
    const key = layoutKey(item.hash, theme, box);
    const hit = cached(key);
    if (hit) {
      setPlaced(hit);
      setFailed(null);
      return;
    }

    let live = true;
    void layout(parsed, theme, key, box)
      .then((p) => {
        if (!live) return;
        setPlaced(p);
        setFailed(null);
      })
      .catch((e: Error) => live && setFailed(e.message));
    return () => {
      live = false;
    };
  }, [item.type, item.body, item.dir, item.aspect, item.layout, item.hash, item.w, item.h, theme]);

  const m = theme.metric.frame;
  const legend = drawn?.legend ?? [];

  /*
   * Does this diagram wear a header?
   *
   * A header is something the author asked for: `frame=full` always draws one, `frame=none` never
   * does, and absent either, a `title=` or a `subtitle=` is what does it — somebody saying "this drawing
   * is about something". There is no fallback to counting nodes: a component dropped from the
   * library keeps its frame off until an author names it, whatever grows inside it, and a diagram
   * with nothing to say for itself stays frameless with eleven cards in it just as it does with one.
   *
   * Computed here, above the early returns, and not after them: the size effect below runs on every
   * render — `PendingItem`'s included — and an item that reports a framed box and then draws a
   * frameless one is the dev size assertion firing on a clean board. Unlike the old rule, this one
   * needs no parsed model, so it is already final before the layout — even before the parse — lands.
   *
   * `framed()` lives in `@/board/types` beside `resizeOf`, the item's other self-description, so
   * this component and its tests read the same rule rather than a copy of it.
   */
  const bare = !isFramed(item);

  /* A diagram is not finished until its art is here: `onSize` is what `data-dag-ready` waits on,
     and a snapshot taken over blank tiles is a picture of a board that does not exist. A diagram
     that draws no glyph asks for nothing. */
  const cuts = useMemo(() => cutsOf(drawn, theme), [drawn, theme]);
  const art = useArtReady(cuts);

  useEffect(() => {
    if (!placed || !art) return;
    const pad = bare ? m.barePad : m.pad;
    /* Where the body starts inside the frame. Bare it is the padding on both axes; framed, the
       header and the rule sit above it. */
    /* Derived from the parts the frame actually draws — the head's height, the rule's two margins
       and the hairline — rather than read from a `bodyTop` the theme used to carry. That key said
       152 from the artboards, the CSS had drawn the body at 129, and the 23px between them
       put every board link into a framed card, and then every pick handle, 23px low. One set of
       numbers now, and `nodes.css` is the other reader of the same keys. */
    const top = bare ? pad : pad + (m.headerH - m.pad) + m.ruleGapTop + theme.metric.line.hair + m.ruleGapBottom;
    const nodes: Record<string, InnerBox> = {};
    const put = (id: string, b: InnerBox, group?: boolean) =>
      (nodes[id] = { x: pad + b.x, y: top + b.y, w: b.w, h: b.h, ...(group ? { group: true } : null) });
    if (placed.kind === "sequence") for (const [id, b] of Object.entries(placed.participants)) put(id, b);
    /* A chart's `nodes` are the bounding box of each series' marks and of each wedge — the same
       contract every other model keeps, so a board link into `chart.web` lands on the thing it
       names rather than on the frame around it. */ else if (placed.kind === "chart")
      for (const [id, b] of Object.entries(placed.nodes)) put(id, b);
    else {
      /* Groups as well as nodes, because a link may end on one: `resolveLinks` accepts a group id
         as an endpoint. They are marked, because a boundary is scenery to the router and a card is
         an obstacle — the same rule that holds inside the diagram. */
      for (const g of placed.groups) put(g.id, g, true);
      for (const [id, b] of Object.entries(placed.nodes)) put(id, b);
      /* A geometric shape says so, so a board link into it ends on its outline as an edge inside
         the diagram does — `routeLinks` hands it to the same `onOutline`. */
      if (drawn && drawn.kind === "graph")
        for (const n of drawn.nodes) {
          const b = nodes[n.id];
          if (!b) continue;
          if (isShape(n.kind)) b.shape = n.kind;
          /* And a figure is met on its picture and caption — the same arithmetic the
             renderer placed them by, so a link cannot stop short of what is drawn. */ else if (n.kind === "figure")
            b.hull = figureHull(figureParts(n, b, theme), b);
        }
    }

    onSize(
      {
        w: item.w ?? placed.size.w + pad * 2,
        /* The frame draws `h=` as a minimum, so the report is whichever is taller. Framed, `top`
           already holds the top padding and the header; bare, there is only the padding twice. */
        h: Math.max(item.h ?? 0, top + placed.size.h + (legend.length ? m.legendH : 0) + pad),
      },
      nodes,
    );
  }, [placed, drawn, bare, legend.length, item.w, item.h, m, onSize, art]);

  if (!model) return <PendingItem item={item} />;

  /* Rebased onto the board file, because that is the file someone will open. Warnings are not
     here: they never stop a drawing, and the dock is where they are read. */
  const problems: Shown[] = model.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => ({ line: item.line + d.line, code: d.code, message: d.message }));
  if (failed) problems.push({ line: item.line, code: CODES.E_UNEXPECTED, message: failed });

  /* Nothing good to fall back on: the page was opened on a body that has never parsed. */
  if (problems.length > 0 && (!drawn || !placed)) {
    return (
      <Failed onSize={onSize}>
        <BrokenItem what={item.type} messages={problems} />
      </Failed>
    );
  }

  /* `drawn` is `model` whenever the body parses, so this is the current drawing or the last good one. */
  const view = drawn ?? model;
  const width = item.w ?? (placed ? placed.size.w + (bare ? m.barePad : m.pad) * 2 : 520);

  return (
    <>
      <Frame item={item} width={width} theme={theme} bare={bare}>
        {!placed ? (
          <div className="dag-diagram dag-diagram--pending" />
        ) : placed.kind === "sequence" ? (
          <SequenceView placed={placed} participants={(view as SequenceModel).participants} theme={theme} />
        ) : placed.kind === "chart" ? (
          <ChartBody placed={placed} theme={theme} id={item.id} />
        ) : (
          <GraphBody graph={view as Graph} placed={placed} theme={theme} onPickEdge={onPickEdge} />
        )}

        {legend.length > 0 ? <Legend entries={legend} theme={theme} /> : null}
      </Frame>
      {problems.length > 0 ? <Stale messages={problems} /> : null}
    </>
  );
});

/**
 * The dot on a diagram that is showing its last good drawing rather than the file's current text.
 *
 * Placed against the item and *inside* its box — `.dag-item` is `content-visibility: auto`, which
 * clips anything drawn outside it — and outside the frame, so the frame's size is what it was. It
 * carries `data-dag-diagnostics`, the attribute every error surface here has always published, so a
 * tool reading the DOM still finds what went wrong; the words are in its tooltip and in the dock.
 */
function Stale({ messages }: { messages: Shown[] }) {
  const first = messages[0]!;
  const more = messages.length > 1 ? ` (and ${messages.length - 1} more)` : "";
  return (
    <span
      className="dag-stale"
      data-dag-stale=""
      data-dag-diagnostics={JSON.stringify(messages)}
      title={`Showing the last version that worked. Line ${first.line}: ${first.message}${more}`}
    />
  );
}

/**
 * An item that could not be drawn still has to report a size.
 *
 * `data-dag-ready` waits for every item to measure itself, so before this a board whose only item
 * failed to parse never became ready at all — the page sat there and the skill's screenshot script
 * timed out after twenty seconds with a generic "never became ready", which is the least useful
 * possible way to be told about a syntax error.
 */
function Failed({ onSize, children }: { onSize: DiagramProps["onSize"]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    /* No nodes: there is no layout, which is why there is a placeholder here instead of one. */
    if (el) onSize({ w: el.offsetWidth, h: el.offsetHeight }, {});
  }, [onSize]);
  /* Inline-block, so it reports what the placeholder needs. As a block it measured the item's own
     wrapper, which is sized from this report — so it could never be anything but the 520px guess. */
  return (
    <div ref={ref} style={{ display: "inline-block" }}>
      {children}
    </div>
  );
}

/*
 * Warnings used to be a strip under the diagram, and they are in the problems dock now
 * (`src/ui/Problems.tsx`) with everything else that is wrong. The strip was part of the item, so a
 * warning changed a diagram's size and put prose on the one surface that is meant to be a drawing;
 * a warning never stops anything from being drawn, which is exactly why it is not the canvas's to
 * say.
 */

/**
 * In development, check that what rendered is the size the layout said it would be.
 *
 * Sizing is arithmetic done before anything exists in the DOM, so a CSS change that adds two pixels
 * of padding does not fail anything — it just makes every box slightly wrong, and diagrams start
 * touching for no visible reason. The assertion: measure the real box, divide out
 * the canvas zoom, and shout when it disagrees. The Playwright run fails on a dirty console, so it
 * is a real gate rather than a note.
 */
function useSizeAssertion(
  ref: React.RefObject<HTMLDivElement | null>,
  placed: Extract<Layout, { kind: "graph" }>,
  id: string,
): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const root = ref.current;
    if (!root) return;

    /*
     * Not while the browser is skipping it. `.dag-item` is `content-visibility: auto`, and a brand-new
     * item's contents are skipped until the browser first decides whether it is on screen — a
     * skipped subtree measures 0×0 whatever the CSS says. `fonts.ready` has almost always resolved,
     * so its `check` runs a microtask after mount, and a diagram small enough to be laid out that
     * fast (a prompt card's answer, three cards) was measured before that first decision and
     * reported every card as 0×0. The check waits for the state to change instead of guessing.
     */
    const item = root.closest<HTMLElement>(".dag-item");
    const skipped = () =>
      !root.isConnected || (root.checkVisibility ? !root.checkVisibility({ contentVisibilityAuto: true }) : false);

    const check = () => {
      if (skipped()) return;
      const zoom = Number(root.closest<HTMLElement>(".dag-viewport")?.dataset.zoom ?? 1) || 1;
      for (const el of root.querySelectorAll<HTMLElement>("[data-dag-node]")) {
        const want = placed.nodes[el.dataset.dagNode ?? ""];
        if (!want) continue;
        const rect = el.getBoundingClientRect();
        const dw = Math.abs(rect.width / zoom - want.w);
        const dh = Math.abs(rect.height / zoom - want.h);
        if (dw > 1 || dh > 1) {
          console.error(
            `[anydag] ${id}: node \`${el.dataset.dagNode}\` rendered ` +
              `${Math.round(rect.width / zoom)}×${Math.round(rect.height / zoom)} but was laid out ` +
              `${want.w}×${want.h}. Sizing in layout/size.ts and the CSS disagree.`,
          );
        }
      }
    };

    /* After paint, and after fonts land — a card measured mid-swap is a false alarm. */
    const raf = requestAnimationFrame(check);
    void document.fonts?.ready.then(check);
    const onState = (e: Event) => {
      if (!(e as Event & { skipped?: boolean }).skipped) check();
    };
    item?.addEventListener("contentvisibilityautostatechange", onState);
    return () => {
      cancelAnimationFrame(raf);
      item?.removeEventListener("contentvisibilityautostatechange", onState);
    };
  }, [ref, placed, id]);
}

/**
 * Publish what is wrong with the drawing, as `data-dag-quality` on the diagram.
 *
 * The diagnostics a board already reports are what is wrong with its *text*, found by parsing —
 * an unknown id, an unterminated string, a line and a column. They say nothing about the picture,
 * and the picture is what the reader gets: two edges crossing, a route straight through a card it
 * has nothing to do with, a label sitting on a border. `src/quality/` measures those, and until
 * now the only thing that ran it was a test over the eleven reference boards. This is the same
 * scorer, on the board actually on screen — which is the one board nobody has written an
 * expectation for, and the only one an author can still fix.
 *
 * Written onto the node rather than rendered as a prop, for the reason `data-zoom` is: as React
 * state it would re-render a memoised item on every layout, to carry a value nothing on the page
 * draws. And computed in an effect rather than during render, because the crossing pass is
 * quadratic in edges and belongs after paint, not in front of it.
 *
 * `data-dag-ready` therefore implies it: effects run child-first, so this has already written the
 * attribute by the time `onSize` reports upward and the board can call itself finished.
 *
 * **Only under `?snapshot=1`**, because every reader opens the page that way — `snapshot.mjs`,
 * the CLI's `snapshot`, `quality.spec.ts` — and nothing on an editing page reads it
 *. In the editor it was the crossing pass, run for nobody, after every layout: once per
 * diagram as a board opened and again on each write while somebody typed into one.
 */
function useQualityReport(
  ref: React.RefObject<HTMLDivElement | null>,
  graph: Graph,
  placed: Extract<Layout, { kind: "graph" }>,
  theme: Theme,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !isSnapshot()) return;
    root.dataset.dagQuality = JSON.stringify(scoreGraph(graph, placed, sizeLabels(graph, theme), theme));
  }, [ref, graph, placed, theme]);
}

/**
 * Where the layout put every box, as `data-dag-layout` on the diagram.
 *
 * The one thing Detach needs and cannot get any other way. Turning a fence over to `layout=fixed`
 * without writing the coordinates first hands it to `layoutSketch`, which finds nothing placed and
 * grids the cards in reading order — a different diagram, and the opposite of what somebody who
 * wants to nudge one card asked for. The answer only exists here: ELK runs in a worker reached
 * through a specifier only Vite can resolve, so there is no server route for it and `useEditor`
 * cannot ask for one.
 *
 * Written onto the node rather than handed back as a prop, for the reason `data-dag-quality` and
 * `data-zoom` are: as React state it would re-render a memoised `Item` on every layout to carry a
 * value nothing on the page draws. `App.tsx`'s `nodeBoxes` is deliberately not reused — those are
 * in the *item's* coordinates, with the frame's padding and the header already folded in, and a
 * conversion has to write the layout's own numbers or the drawing shifts as it lands.
 */
function usePublishedLayout(
  ref: React.RefObject<HTMLDivElement | null>,
  placed: Extract<Layout, { kind: "graph" | "chart" }>,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const groups: Record<string, InnerBox> = {};
    /* A chart has no groups and no date scale, and publishes the empty pair rather than a differently
       shaped object: one reader, one shape. Its `nodes` are the bounding box of each series' marks
       and of each wedge, which is the same claim every other model makes about its own. */
    if (placed.kind === "graph") for (const g of placed.groups) groups[g.id] = { x: g.x, y: g.y, w: g.w, h: g.h };
    /* The date scale rides along for the same reason the boxes do, and only the three numbers that
       invert it: the ticks are a drawing, and a `data-` attribute is not where a drawing goes. */
    root.dataset.dagLayout = JSON.stringify({
      nodes: placed.nodes,
      groups,
      scale: placed.kind === "graph" ? placed.axis?.scale : undefined,
      /* A fixed layout's translation, so a writer can turn a box back into the file's numbers. */
      origin: placed.kind === "graph" ? placed.origin : undefined,
      /* And how big it drew, which is more than the boxes when a line reaches past them:
         a writer that scales the drawing needs the padding round the boxes, not round the lines. */
      size: placed.size,
    });
  }, [ref, placed]);
}

/**
 * A chart, and the two things a diagram owes the page around it.
 *
 * `GraphBody`'s three hooks split here rather than being reused whole: `scoreGraph` is `Graph`-only
 * and a chart has no routes to score, and the per-node size assertion would be measuring a `<g>`
 * against a box the layout deliberately drew *approximately* — a line series' box carries a full
 * marker ring the stroke only half draws, and a wedge's box is the sector's true extent while the
 * path is inset by the slice gap. What is exact is the `<svg>` itself, which the layout sized, so
 * that is what is checked.
 */
function ChartBody({ placed, theme, id }: { placed: Extract<Layout, { kind: "chart" }>; theme: Theme; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePublishedLayout(ref, placed);
  useChartSizeAssertion(ref, placed, id);
  return (
    <div ref={ref} className="dag-diagram" style={{ width: placed.size.w, height: placed.size.h }}>
      <ChartView placed={placed} theme={theme} id={id} />
    </div>
  );
}

/** The same check `useSizeAssertion` makes, on the one box a chart's layout decided: its own. */
function useChartSizeAssertion(
  ref: React.RefObject<HTMLDivElement | null>,
  placed: Extract<Layout, { kind: "chart" }>,
  id: string,
): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const root = ref.current;
    if (!root) return;

    const check = () => {
      const svg = root.querySelector<SVGSVGElement>("svg.dag-chart");
      if (!svg) return;
      const zoom = Number(root.closest<HTMLElement>(".dag-viewport")?.dataset.zoom ?? 1) || 1;
      const rect = svg.getBoundingClientRect();
      const dw = Math.abs(rect.width / zoom - placed.size.w);
      const dh = Math.abs(rect.height / zoom - placed.size.h);
      if (dw > 1 || dh > 1) {
        console.error(
          `[anydag] chart \`${id}\` rendered ${Math.round(rect.width / zoom)}\u00d7${Math.round(rect.height / zoom)} ` +
            `but was laid out ${placed.size.w}\u00d7${placed.size.h}. layout/chart.ts and the CSS disagree.`,
        );
      }
    };

    const raf = requestAnimationFrame(check);
    void document.fonts?.ready.then(check);
    return () => cancelAnimationFrame(raf);
  }, [ref, placed, id]);
}

/** Bands and groups are the ground, then edges under the cards. */
function GraphBody({
  graph,
  placed,
  theme,
  onPickEdge,
}: {
  graph: Graph;
  placed: Extract<Layout, { kind: "graph" }>;
  theme: Theme;
  onPickEdge?(id: string): void;
}) {
  /* A strip is placed above the origin (a timeline section bar). The body has to reserve that room
     or it is clipped by the frame's rule. */
  const overhang = Math.max(0, ...placed.groups.filter((g) => g.strip).map((g) => -g.y));
  const ref = useRef<HTMLDivElement>(null);
  useSizeAssertion(ref, placed, graph.type);
  useQualityReport(ref, graph, placed, theme);
  usePublishedLayout(ref, placed);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const groupsById = new Map(graph.groups.map((g) => [g.id, g]));
  const lanesById = new Map(graph.lanes.map((l) => [l.id, l]));

  /* Padding would not move absolutely-positioned children — they lay out from the padding edge — so
     the overhang is an offset layer rather than a gap. */
  return (
    <div ref={ref} className="dag-diagram" style={{ width: placed.size.w, height: placed.size.h + overhang }}>
      <div className="dag-diagram__layer" style={{ top: overhang }}>
        {placed.lanes.map((band) => (
          <Lane key={band.id} lane={lanesById.get(band.id)} box={band} theme={theme} />
        ))}
        {placed.groups.map((g) => {
          const def = groupsById.get(g.id);
          return def ? <Group key={g.id} group={def} box={g} theme={theme} type={graph.type} /> : null;
        })}

        {placed.axis ? <Axis axis={placed.axis} width={placed.size.w} theme={theme} /> : null}

        <Edges edges={placed.edges} width={placed.size.w} height={placed.size.h} theme={theme} onPick={onPickEdge} />

        {Object.entries(placed.nodes).map(([id, box]) => {
          const node = byId.get(id);
          return node ? <NodeView key={id} node={node} box={box} theme={theme} type={graph.type} /> : null;
        })}
      </div>
    </div>
  );
}
