import { declaredAt } from "@/dsl/declared";
import { hasGraph, parseDiagram } from "@/dsl/parse";
import { renameIds } from "@/dsl/rebind";
import { edgeSpan, statementSpan } from "@/dsl/restate";
import { tokenize } from "@/dsl/tokenizer";

/**
 * What a *pick* is, and the three questions about one that `restate.ts` does not answer.
 *
 * A pick is a thing inside a diagram — a card, a group, a lane, one segment of an edge — as opposed
 * to the diagram itself, which is an item and lives in `selected`. It is deliberately not part of
 * the selection: a card cannot be marquee'd, grouped, copied or moved as an item, and widening
 * `selected` to hold two kinds of thing would put a `typeof` in every place that reads it. That is
 * the argument `pickedLink` already made, one layer down.
 *
 * A node pick remembers the **id** and nothing else, because the id is what the author wrote and
 * the line is derived from it on demand — so a pick survives an edit above it, and the strip and
 * the writers agree about which line they mean without carrying a stale number around.
 *
 * An edge pick cannot do that: an edge has no author id (`e3` is the parser's, and it is renumbered
 * by anything that adds an edge before it), so it remembers the line as well. And it remembers
 * `seg`, because every edge of a chain `a --> b --> c` is written on one line — the line alone
 * cannot say which arrow is meant.
 */

/** A card, a group or a lane inside one item's diagram. */
export interface PickedNode {
  item: string;
  node: string;
}

/** One segment of one edge statement inside one item's diagram. */
export interface PickedEdge {
  item: string;
  /** The parser's id (`e3`), which is how the pointer said which edge it hit. */
  id: string;
  line: number;
  /** Which arrow along a chain, 0-based. */
  seg: number;
}

/**
 * Which segment of its statement the nth edge on a line came from.
 *
 * Exported because an `edges` fence has the same problem one layer out: `parseLinks` walks the
 * same grammar, so two links written `who --> stack --> db` are two segments of one line and the
 * panel's label field has to know which arrow it is offering to write.
 *
 * `parseEdge` walks the arrows left to right and, for each, emits one edge per (source, target)
 * pair — so a bus `a & b --> c` is two edges from *one* arrow and a chain `a --> b --> c` is two
 * edges from two. Counting the pairs each arrow produced is therefore the only way back from an
 * index in `graph.edges` to an index in the text, and `edgeSpan` already reads the ref lists that
 * say how many that was.
 */
export function segOf(line: string, nth: number): number {
  const e = edgeSpan(line);
  if (!e) return 0;
  let seen = 0;
  for (let k = 0; k < e.arrows.length; k++) {
    const made = (e.refs[k]?.tokens.length ?? 1) * (e.refs[k + 1]?.tokens.length ?? 1);
    if (nth < seen + made) return k;
    seen += made;
  }
  return Math.max(0, e.arrows.length - 1);
}

/** Where an edge of this diagram was written: its line, and which arrow on it. */
export function edgeAt(
  type: string,
  body: string,
  dir: "LR" | "TB" | undefined,
  id: string,
): { line: number; seg: number } | null {
  const graph = hasGraph(type) ? parseDiagram(type, body, dir) : null;
  const edge = graph?.edges.find((e) => e.id === id);
  if (!graph || !edge) return null;
  const onLine = graph.edges.filter((e) => e.line === edge.line);
  return { line: edge.line, seg: segOf(body.split("\n")[edge.line - 1] ?? "", onLine.indexOf(edge)) };
}

/**
 * What an edge of this diagram may run to or from: its cards, its groups, and the rows inside a card
 * — `api.content` — which are the three things the grammar lets an arrow name (`docs/dsl/common.md`
 * rules 4 and 9).
 *
 * Read off the parse, because only the parse knows which words are declared; a list kept beside the
 * text would be the second copy that drifts. Empty for a dialect that has no graph, and a `more`
 * row is left out: it is a "…and four more" line, not a field an arrow can leave from.
 */
export function edgeTargets(
  type: string,
  body: string,
  dir?: "LR" | "TB",
): { nodes: string[]; groups: string[]; rows: string[] } {
  const graph = hasGraph(type) ? parseDiagram(type, body, dir) : null;
  if (!graph) return { nodes: [], groups: [], rows: [] };
  return {
    nodes: graph.nodes.map((n) => n.id),
    groups: graph.groups.map((g) => g.id),
    rows: graph.nodes.flatMap((n) => n.rows.filter((r) => r.kind !== "more").map((r) => `${n.id}.${r.id}`)),
  };
}

/** The label written on one segment of an edge statement, as the author spelled it. */
export function edgeLabelOf(line: string, seg: number): string {
  return edgeSpan(line)?.tails[seg + 1]?.strings[0]?.value ?? "";
}

/**
 * A second copy of one statement, under a name nothing else in the body uses.
 *
 * The statement and the `{ }` block it opens are copied *as written* — `statementSpan` gives the
 * lines and they are spliced back in below themselves, so the spacing, the quoting and the author's
 * trailing comment come through exactly as they were. Only the ids are touched, and only the ones
 * this span **declares**: duplicating a group takes its children with it, and the edges between
 * them have to follow, which is what `renameIds` over the fragment alone does for free.
 *
 * The names avoided are every word in the body rather than every declared id, which is broader than
 * it needs to be and cheaper than being exactly right: `api2` is a fine name for a copy of `api`
 * unless the word `api2` appears anywhere at all, in which case it is a confusing one.
 *
 * `null` means the id is not declared here and there is nothing to copy.
 */
export function duplicateStatement(
  type: string,
  body: string,
  id: string,
  dir?: "LR" | "TB",
): { body: string; id: string } | null {
  const line = declaredAt(type, body, id, dir);
  if (line === null) return null;

  const span = statementSpan(body, line);
  const lines = body.split("\n");

  const taken = new Set<string>();
  for (const t of tokenize(body, [])) if (t.kind === "word") taken.add(t.value);

  /* What the span declares. The parse is the authority for the same reason `declaredAt` gives; a
     dialect that hands back no graph leaves the picked id itself, which is all a one-liner has. */
  const inside = new Set<string>([id]);
  const graph = hasGraph(type) ? parseDiagram(type, body, dir) : null;
  if (graph) {
    for (const d of [...graph.nodes, ...graph.groups, ...graph.lanes]) {
      if (d.line >= span.from && d.line <= span.to) inside.add(d.id);
    }
  }

  const map = new Map<string, string>();
  for (const from of inside) {
    for (let n = 2; ; n++) {
      const to = `${from.replace(/\d+$/, "")}${n}`;
      if (!taken.has(to)) {
        taken.add(to);
        map.set(from, to);
        break;
      }
    }
  }

  const fragment = renameIds(lines.slice(span.from - 1, span.to).join("\n"), map).split("\n");
  /* A block gets a blank line before it, the way a person writing two groups would; a one-liner
     goes straight under the line it copies, the way a person writing two cards would. */
  const gap = span.to > span.from ? [""] : [];
  const out = [...lines.slice(0, span.to), ...gap, ...fragment, ...lines.slice(span.to)];
  return { body: out.join("\n"), id: map.get(id) ?? id };
}
