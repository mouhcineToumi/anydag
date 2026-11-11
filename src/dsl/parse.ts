import { parseWith, type Dialect } from "./common";
import { arch } from "./graph/arch";
import { c4 } from "./graph/c4";
import { erd } from "./graph/erd";
import { activity, flow } from "./graph/flow";
import { klass } from "./graph/klass";
import { parseGitgraph } from "./graph/gitgraph";
import { parseMindmap } from "./graph/mindmap";
import { sketch } from "./graph/sketch";
import { parseTimeline } from "./graph/timeline";
import { state } from "./graph/state";
import { usecase } from "./graph/usecase";
import { OWN_MODEL_TYPES, type DiagramType, type Graph } from "./ir";

/**
 * Dispatch by fence type.
 *
 * Dialects land one milestone at a time; a type with no dialect yet returns `null` so the board
 * shows the source rather than an error — a board written ahead of its renderer is still readable.
 */
const DIALECTS: Partial<Record<DiagramType, Dialect>> = {
  arch,
  erd,
  state,
  flow,
  activity,
  class: klass,
  usecase,
  c4,
  sketch,
};

/**
 * `layout` rides beside `dir` and `aspect` because it changes what the *parser* does, not only what
 * the layout does: `x=` on a statement is geometry inside a fixed fence and a `W_UNKNOWN_ATTR`
 * outside one, and that is decided while the tokens are still going past.
 */
export function parseDiagram(type: string, src: string, dir?: "LR" | "TB", aspect?: number, layout?: "fixed"): Graph | null {
  /* Mindmap owns its parser: indentation *is* the grammar, and quoting every label would drown the
     one form whose appeal is that it is fast to type. */
  const own = (g: Graph | null) => {
    if (g && aspect !== undefined) g.aspect = aspect;
    if (g && layout !== undefined) g.layout = layout;
    return g;
  };
  if (type === "mindmap") return own(parseMindmap(src));
  if (type === "timeline") return own(parseTimeline(src));
  if (type === "gitgraph") return own(parseGitgraph(src));

  const dialect = DIALECTS[type as DiagramType];
  if (!dialect) return null;
  const graph = parseWith(dialect, src, layout);
  if (dir) graph.dir = dir;
  return own(graph);
}

/**
 * The kind words this dialect accepts, in the order it declares them.
 *
 * The same list `E_UNKNOWN_KIND` suggests from (`common.ts` reads `Object.keys(dialect.kinds)`),
 * so the menu a person picks a kind from and the error they get for typing one that is not there
 * can never disagree. Empty for the four dialects with their own parser: a `mindmap` topic, a
 * `timeline` entry, a `gitgraph` commit and a `sequence` participant have no kind word to choose.
 */
export function kindsOf(type: string): string[] {
  const dialect = DIALECTS[type as DiagramType];
  return dialect ? Object.keys(dialect.kinds) : [];
}

/**
 * Which string of a statement the card draws as its description, or `null` when it draws none.
 *
 * Only `C4Box` draws a third string, and it is reached two ways: any C4 `container`/`db`, and a
 * `person` or `extsystem` in any dialect that has one. They differ in *where* the sentence is
 * written, which is why this is a function and not a list of kinds. A C4 `person` and `extsystem`
 * are documented with two strings — name, description — and `c4.finish` moves the second one into
 * `desc`; a third string, if there is one, wins. So the slot is 1 until a third is written. Every
 * other one is the third string, slot 2.
 *
 * `word` is the word the statement is declared with (or its `kind=`): the vocabulary is the
 * dialect's, and the kind it maps to is what decides. `strings` is how many the line has now.
 */
export function descriptionSlot(type: string, word: string, strings: number): 1 | 2 | null {
  const kind = DIALECTS[type as DiagramType]?.kinds[word];
  if (kind === "person" || kind === "extsystem") return type === "c4" && strings < 3 ? 1 : 2;
  if (type === "c4" && (kind === "container" || kind === "db")) return 2;
  return null;
}

/**
 * Whether a node in this dialect can carry rows — the `{ … }` block under a declaration.
 *
 * `Dialect.row` is the row grammar, and its absence is what "this dialect has no rows" means; a
 * use case has none, an entity's are its columns and a class's are its members. Asked so the
 * properties panel can leave the whole rows editor out rather than offer an "add a row" that
 * writes a line the parser will reject.
 */
export const hasRows = (type: string): boolean => Boolean(DIALECTS[type as DiagramType]?.row);

/**
 * Whether `parseDiagram` is the right question to ask about this type — i.e. whether its model is a
 * `Graph` at all.
 *
 * The one predicate that replaced fifteen `type === "sequence"` guards. Each of those meant "this
 * dialect has a model of its own, so do not parse it as a graph"; each was a literal; and a second
 * literal beside every one of them is how the sixteenth site quietly keeps the old behaviour when a
 * second such dialect lands. `OWN_MODEL_TYPES` in `ir.ts` is the list, and the caller that then
 * needs the model dispatches on the type once, in the one place that has a parser to call.
 *
 * `false` does **not** mean "unknown": `hasDialect` answers that, and a type can be both known and
 * not a graph.
 */
export const hasGraph = (type: string): boolean => !(OWN_MODEL_TYPES as readonly string[]).includes(type);

export const hasDialect = (type: string): boolean =>
  type === "mindmap" || type === "timeline" || type === "gitgraph" || !hasGraph(type) || type in DIALECTS;
