import { parseChart, type ChartModel } from "./chart";
import type { Diagnostic, Graph } from "./ir";
import { hasDialect, parseDiagram } from "./parse";
import { parseSequence, type SequenceModel } from "./sequence";

/**
 * What a board says is wrong with it, asked in one place.
 *
 * The per-type dispatch below was written out twice — once in `DiagramItem`, to draw, and once in
 * the `/__board/diagnostics` route, to tell an agent what it got wrong — and a third copy was about
 * to land for the problems dock. Two copies of "which parser, with which arguments" is how the route
 * came to report warnings against a board the page drew without a word: it forgot `aspect` and
 * `layout`, which change what the parser *says* and not only what the layout does.
 *
 * Deliberately board-agnostic: it takes the handful of fields a parse reads, structurally, rather
 * than importing `BoardItem`. `src/board/` must not know diagrams, and this file is the other side
 * of that line. Plain relative imports only — the dev server's plugin loads it before Vite's `@/`
 * aliases exist.
 */

export type Model = Graph | SequenceModel | ChartModel;

/** The fields of an item a parse depends on — the same five the item's `hash` is made of. */
export interface Parseable {
  type: string;
  body: string;
  dir?: "LR" | "TB";
  aspect?: number;
  layout?: "fixed";
}

/**
 * Parse one item's body with its own dialect's parser.
 *
 * `null` for anything that is not a diagram — prose, an image, an `edges` fence — and for a diagram
 * type with no dialect, which a board written ahead of its renderer is allowed to contain.
 */
export function parseItem(it: Parseable): Model | null {
  if (it.type === "sequence") return parseSequence(it.body);
  if (it.type === "chart") return parseChart(it.body);
  return parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout);
}

interface ItemDiagnostics {
  id: string;
  type: string;
  /** Rebased onto the board file, because that is the file someone will open. */
  diagnostics: Diagnostic[];
}

export interface BoardDiagnostics {
  /** Problems with the file itself — its frontmatter, a fence line, an `edges` statement. */
  board: Diagnostic[];
  /** Only the items that have something to say. */
  items: ItemDiagnostics[];
  errors: number;
  warnings: number;
}

interface Diagnosable {
  errors: Diagnostic[];
  items: (Parseable & { id: string; line: number })[];
}

/**
 * Every diagnostic on the board: the file's own, then each diagram's, in file order.
 *
 * `diagnosticsOf` is the item's diagnostics *before* rebasing, and defaults to a fresh parse. The
 * page passes a cached one — it asks after every write, and re-parsing thirty unchanged diagrams to
 * find the one that changed is waste the server, asked once per request, does not care about.
 */
export function diagnoseBoard(
  board: Diagnosable,
  diagnosticsOf: (it: Parseable & { id: string }) => Diagnostic[] = (it) => parseItem(it)?.diagnostics ?? [],
): BoardDiagnostics {
  const items = board.items
    .filter((it) => hasDialect(it.type))
    .map((it) => ({
      id: it.id,
      type: it.type,
      diagnostics: diagnosticsOf(it).map((d) => ({ ...d, line: it.line + d.line })),
    }))
    .filter((x) => x.diagnostics.length > 0);

  const all = [...board.errors, ...items.flatMap((i) => i.diagnostics)];
  return {
    board: board.errors,
    items,
    errors: all.filter((d) => d.severity === "error").length,
    warnings: all.filter((d) => d.severity === "warn").length,
  };
}
