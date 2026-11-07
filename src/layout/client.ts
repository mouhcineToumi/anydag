import type { ChartModel } from "@/dsl/chart";
import type { Graph } from "@/dsl/ir";
import type { SequenceModel } from "@/dsl/sequence";
import type { Theme } from "@/theme/contract";
import { metricsHash } from "@/theme/applyTheme";

import { layoutChart } from "./chart";
import { layoutGraph } from "./elk";
import { getMeasurer } from "./measure";
import { layoutSequence } from "./sequence";
import { sizeGraph, sizeLabels } from "./size";
import type { Layout } from "./types";

/**
 * The layout service: a cache and one in-flight request per key.
 *
 * The cache is the reason a board with twenty diagrams stays usable while Claude writes to it. A
 * save re-parses everything, but only the item whose DSL actually changed misses — the other
 * nineteen return the same `Placed` object by reference, and `React.memo` sees no change at all.
 */

const cache = new Map<string, Layout>();
const inflight = new Map<string, Promise<Layout>>();

/**
 * What a layout is cached under.
 *
 * `hash` is the item's body and its fence attributes, which for the twelve `Graph` dialects and for
 * `sequence` is everything that decides the answer. **A chart is the exception**: its box is the
 * author's — `resizeOf("chart")` is `box` — and `w=`/`h=` are not in the body hash, so a chart
 * dragged wider would otherwise be handed the layout it had at the old width. `box` is passed only
 * where it changes the answer, so a graph item's cache is untouched by any of this.
 */
export function layoutKey(hash: string, theme: Theme, box?: { w: number; h: number }): string {
  const at = box ? `|${box.w}x${box.h}` : "";
  return `${hash}|${metricsHash(theme)}|${getMeasurer().generation}${at}`;
}

export function cached(key: string): Layout | undefined {
  return cache.get(key);
}

export async function layout(
  model: Graph | SequenceModel | ChartModel,
  theme: Theme,
  key: string,
  /** The content rectangle a chart draws in — the item's box less the frame's own parts. */
  box?: { w: number; h: number },
): Promise<Layout> {
  const hit = cache.get(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;

  /* Sequence never reaches ELK: its layout is a single pass down the event list, so it resolves
     immediately rather than crossing to a worker and back. */
  if (model.kind === "sequence") {
    const placed = layoutSequence(model, theme);
    cache.set(key, placed);
    return placed;
  }
  /*
   * Neither does a chart, and for the same reason: a scale, a run of rectangles and an arc are one
   * synchronous pass. Unlike every other model it is handed a *box*, because a chart's size is the
   * author's rather than the layout's answer — see `layoutKey`.
   */
  if (model.kind === "chart") {
    const placed = layoutChart(model, box ?? { w: theme.metric.chart.w, h: theme.metric.chart.h }, theme, getMeasurer());
    cache.set(key, placed);
    return placed;
  }
  const graph = model;

  /* Sizing stays on the main thread: it needs `measureText` with the real webfonts, and a worker
     would have to load and match them itself. The worker gets numbers. */
  const sizes = sizeGraph(graph, theme);
  const labels = sizeLabels(graph, theme);

  const promise = layoutGraph(graph, sizes, labels, theme.metric)
    .then((placed) => {
      cache.set(key, placed);
      inflight.delete(key);
      /* A board is edited for minutes, not hours; a few hundred layouts is far more than any board
         has and still nothing in memory. */
      if (cache.size > 400) cache.delete(cache.keys().next().value!);
      return placed;
    })
    .catch((e: Error) => {
      inflight.delete(key);
      throw e;
    });

  inflight.set(key, promise);
  return promise;
}
