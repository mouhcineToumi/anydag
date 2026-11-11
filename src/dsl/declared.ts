import { parseChart } from "./chart";
import { hasGraph, parseDiagram } from "./parse";
import { seqIdOn, seqLineOf } from "./sequence";
import { tokenize } from "./tokenizer";

/**
 * Which line of a diagram's source declares a given node — 1-based, within the body.
 *
 * A person who clicks a card is pointing at a *thing*; the panel can only show them *text*. Without
 * this, "edit the Firestore card" meant opening forty lines of `arch` with the caret at character
 * zero and reading until you found it. The card knows its id (`data-dag-node`), the parser knows
 * which line said it, and nothing joined the two.
 *
 * The parse is the authority, because the parser is what decided the id in the first place — an
 * anonymous or renamed one included. A `chart` is a parse too: a `Series` carries its line, so it
 * answers exactly. The token scan under both is for the case the models cannot answer — a
 * `sequence`, whose `Participant` carries no line (its model is moments, not a graph) — and for any
 * id declared by a dialect that hands back nothing. All of them are the same shape on the page —
 * `<kind> <id> …`, or the id alone at the head of its line — which is enough to find.
 *
 * An **edge id** answers too, after everything the author named: they are the parser's (`e3`), and
 * they are how a picked edge says which line it came from without carrying the line around.
 *
 * `null` means "nothing here claims that id", and the caller should leave the caret alone rather
 * than send it somewhere arbitrary.
 */
/** Everything a chart body declares — its series and its slices — as one list in file order. */
const chartDeclarations = (body: string): { id: string; line: number }[] => {
  const model = parseChart(body);
  return [...model.series, ...model.slices].map((s) => ({ id: s.id, line: s.line }));
};

export function declaredAt(type: string, body: string, id: string, dir?: "LR" | "TB"): number | null {
  /* A sequence's message, fragment and note are counted rather than named (`msg:3`) — see
     `seqParts`. The colon keeps them apart from any participant, which the scan below finds. */
  if (type === "sequence") {
    const at = seqLineOf(body, id);
    if (at !== null) return at;
  }
  if (type === "chart") {
    const found = chartDeclarations(body).find((d) => d.id === id);
    if (found) return found.line;
  }

  const graph = hasGraph(type) ? parseDiagram(type, body, dir) : null;
  if (graph) {
    /* Nodes first: a group and a node may share an id in different scopes, and the card under the
       pointer is the more specific answer. */
    const node = graph.nodes.find((n) => n.id === id);
    if (node) return node.line;
    const group = graph.groups.find((g) => g.id === id);
    if (group) return group.line;
    const lane = graph.lanes.find((l) => l.id === id);
    if (lane) return lane.line;
    /* Last, because an edge id is the parser's (`e3`) rather than the author's: a node that
       happens to be called `e3` is the one the author wrote down, and it wins. */
    const edge = graph.edges.find((e) => e.id === id);
    if (edge) return edge.line;
  }

  /*
   * The fallback: the first line whose id token is this one, in a declaring position.
   *
   * Tokenized rather than matched, because a bare word is an identifier and a quoted string is free
   * text — `"talks to the api"` must not answer for `api`. Position matters for the same reason a
   * declaration is `<kind> <id>`: the id at the head of an edge (`api --> store`) is a *use*, and
   * sending the caret there would be pointing at the wrong line with total confidence.
   */
  const tokens = tokenize(body);
  const byLine = new Map<number, typeof tokens>();
  for (const t of tokens) {
    if (t.kind === "eof" || t.kind === "sep") continue;
    const list = byLine.get(t.line);
    if (list) list.push(t);
    else byLine.set(t.line, [t]);
  }
  for (const [line, list] of [...byLine].sort((a, b) => a[0] - b[0])) {
    const [first, second, third] = list;
    if (!first || first.kind !== "word") continue;
    /* `<kind> <id> "title"` — a declaration. */
    if (second?.kind === "word" && second.value === id && third?.kind !== "arrow") return line;
    /* `<id> "title"` — the participant shorthand, and a mindmap's own shape. */
    if (first.value === id && second?.kind !== "arrow") return line;
  }
  return null;
}

/**
 * The inverse: which node, group or lane a given line of the source declares.
 *
 * This is what lets the panel show controls for the thing the caret is sitting in. Deriving the
 * "current card" from the caret rather than from the last card clicked means one source of truth
 * for it — arrowing down the source moves the strip, clicking in the text moves it, and the
 * double-click that opened the panel moved the caret in the first place.
 *
 * An **edge** answers last and answers with the parser's own id (`e3`), because a declaration on
 * that line is the more specific thing and because a chain writes several edges onto one line —
 * the first is the one that line is *about*. A caller that only has controls for a node has to say
 * so: `what` is the whole of the difference and it is in the answer.
 */
export function declaredOn(
  type: string,
  body: string,
  line: number,
  dir?: "LR" | "TB",
): { id: string; what: "node" | "group" | "lane" | "edge" } | null {
  /* A message answers as an edge, a fragment or a note as a group — the frame they are drawn in. */
  if (type === "sequence") return seqIdOn(body, line);
  if (type === "chart") {
    const found = chartDeclarations(body).find((d) => d.line === line);
    /* A series and a slice are both `node` to whatever asks: a thing inside the item that a pick
       can hold, a rename can retitle and a link can end on. There is no second kind here. */
    return found ? { id: found.id, what: "node" } : null;
  }
  const graph = hasGraph(type) ? parseDiagram(type, body, dir) : null;
  if (!graph) return null;
  const node = graph.nodes.find((n) => n.line === line);
  if (node) return { id: node.id, what: "node" };
  const group = graph.groups.find((g) => g.line === line);
  if (group) return { id: group.id, what: "group" };
  const lane = graph.lanes.find((l) => l.line === line);
  if (lane) return { id: lane.id, what: "lane" };
  const edge = graph.edges.find((e) => e.line === line);
  if (edge) return { id: edge.id, what: "edge" };
  return null;
}
