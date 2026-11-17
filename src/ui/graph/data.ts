/**
 * The Graph page's copy of `GET /__board/graph` (#459), kept current by the change feed the way
 * `useIndex` keeps the reference index: **at most one wait after the first change**, not after the
 * last, so an agent writing all afternoon does not starve it; one request out at a time; and **an
 * identical answer changes nothing**, so a drag on a board in another window — a write that moves
 * no link — re-renders nothing and does not warm the graph.
 *
 * Subscribed only while a Graph page is mounted: with the page closed it holds no listener and no
 * timer. The last answer is kept, so coming back draws at once and asks again behind it.
 */
import { useSyncExternalStore } from "react";

import { onBoard, onBoards, onFile, onNote, onQuiz, onTable, onTags } from "@/board/events";
import { refresher } from "@/board/refresher";
import { GraphVersion, read, type Graph } from "@/graph/model";
import type { GraphWire } from "@/graph/wire";

export interface GraphData {
  graph: Graph | null;
  /** The answer could not be read: a newer server (`version`), or none came. */
  problem: "version" | "failed" | null;
}

const EMPTY: GraphData = { graph: null, problem: null };
let current: GraphData = EMPTY;
let said = "";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let off: (() => void) | null = null;

/** After a change, how long to wait for more before asking again: `useIndex`'s. */
const SETTLE = 800;

async function fetchGraph(): Promise<boolean> {
  const r = await fetch("/__board/graph");
  if (!r.ok) {
    if (!current.graph) set({ graph: null, problem: "failed" });
    return false;
  }
  const body = await r.text();
  if (body === said && current.graph) return true;
  try {
    const graph = read(JSON.parse(body) as GraphWire);
    said = body;
    set({ graph, problem: null });
  } catch (e) {
    set({ graph: current.graph, problem: e instanceof GraphVersion ? "version" : "failed" });
  }
  return true;
}

function set(next: GraphData): void {
  current = next;
  for (const l of listeners) l();
}

const graphs = refresher(fetchGraph);

function soon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void graphs.ask();
  }, SETTLE);
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  if (!off) {
    void graphs.ask();
    const stops = [onBoard(soon), onNote(soon), onQuiz(soon), onTable(soon), onFile(soon), onBoards(soon), onTags(soon)];
    off = () => {
      for (const stop of stops) stop();
    };
  }
  return () => {
    listeners.delete(listen);
    if (listeners.size === 0 && off) {
      off();
      off = null;
      graphs.cancel();
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

export function useGraphData(): GraphData {
  return useSyncExternalStore(subscribe, () => current);
}
