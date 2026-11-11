import type { Board, BoardItem } from "@/board/types";
import { CODES, type Code } from "@/dsl/codes";
import { diagnoseBoard, parseItem, type Parseable } from "@/dsl/diagnose";
import type { Diagnostic, DiagnosticTarget } from "@/dsl/ir";
import { detectMermaid } from "@/dsl/mermaid";

/**
 * What is wrong with a board that a person can do something about, as the problems dock, the
 * editor panel and the marker on a diagram's frame show it.
 *
 * The meaning, with no DOM in it: which problems there are, which item and which thing in it each
 * concerns, the words a person reads, and which of them are *new* — the one question the
 * notification asks before it interrupts anybody. `Problems.tsx` is the chrome that shows the answer.
 *
 * **Only what a person can act on is here** (#145). A board's text is the app's own format and a
 * person never sees it, so a missing quote or a word the grammar does not know is not something
 * they could find, let alone fix: that statement is skipped and the rest is drawn. What stays is a
 * problem with a control that answers it — a card's icon or colour, a link that ends on nothing, a
 * Mermaid paste to convert, a board setting the dock can repair. Every diagnostic is still there for
 * an agent (`board_diagnose`, `/__board/diagnostics`, `anydag snapshot`), which reads the text.
 */

export interface Problem {
  /**
   * What makes two readings "the same problem", for the notification's purposes.
   *
   * The line is left out on purpose. Typing a line above a broken statement moves it down one, and
   * a notification that popped up again for a problem the person has already dismissed — because it
   * is now on line 7 rather than 6 — would be exactly the nagging this dock exists to stop. Two
   * identical messages in one item collapse to one key, which costs nothing: the list still shows
   * both, and one notification says it.
   */
  key: string;
  severity: "error" | "warn";
  code: Code;
  message: string;
  /** 1-based line in the board file. */
  line: number;
  /** The item the line is inside, when it is inside one — the thing "Show" opens. */
  item?: string;
  type?: string;
  page?: string;
  /** The card, group, lane or edge inside the item that "Show" picks, when the problem is about one. */
  target?: DiagnosticTarget;
  /** What a person reads: what is wrong and what to do, in words, with no grammar in them. */
  words: string;
  /** A fix the row can carry out itself, beside the control the pick leads to. */
  fix?: "delete-edge";
}

/**
 * The problems a person can act on, and what they read about each.
 *
 * `pick` is a problem about one thing in a diagram: the row picks it, and the panel then shows the
 * control that fixes it. `item` is about the diagram as a whole, and the panel's own controls are
 * the answer. A code in neither list is not shown to a person at all.
 */
const ON_A_PICK: Partial<Record<Code, { words: string; fix?: Problem["fix"] }>> = {
  [CODES.W_UNKNOWN_ICON]: { words: "A card's icon is not one AnyDag has, so it shows the default. Choose another." },
  [CODES.W_UNKNOWN_HUE]: { words: "A colour here is not one of the theme's, so none is drawn. Choose one." },
  [CODES.W_RETIRED_FLAG]: { words: "A card wears a mark that no longer draws anything. Update it from its panel." },
  [CODES.E_UNKNOWN_ID]: {
    words: "A link ends on a card that is not there. Point it at another card, or delete it.",
    fix: "delete-edge",
  },
  [CODES.W_MISSING_ROW]: { words: "A link ends on a row the card does not have. Point it at another end." },
  /* A board link with one end that names nothing hangs from a loose end (#173), and the diagnostic
     carries the link — so these are a pick like the rest. With both ends missing nothing is drawn,
     there is no target, and nothing is shown. */
  [CODES.EB_LINK_UNKNOWN_ITEM]: {
    words: "A link ends on something that is not on this page. Drag its loose end onto a card, or delete it.",
    fix: "delete-edge",
  },
  [CODES.EB_LINK_UNKNOWN_NODE]: {
    words: "A link ends on a card that is not there. Drag its loose end onto a card, or delete it.",
    fix: "delete-edge",
  },
  [CODES.W_CHART_LENGTH]: { words: "A series has a different number of values than the chart has categories." },
};

/** A board setting `planRepair` can put right; the words the dock says over its repair. */
const ON_THE_BOARD: Partial<Record<Code, string>> = {
  [CODES.EB_FRONTMATTER]: "The board's settings could not all be read.",
  [CODES.EB_UNKNOWN_TYPE]: "A block on this board is of a kind AnyDag does not draw.",
  [CODES.EB_BAD_LAYOUT]: "A diagram has a layout setting AnyDag does not know.",
  [CODES.EB_BAD_ASPECT]: "A diagram has a wrapping setting AnyDag cannot read.",
};

/**
 * What a person reads about one diagnostic, or `null` when it is not theirs to see.
 *
 * `body` is the item's, for the one item-wide case: a Mermaid header means the whole block is
 * another language, and the panel's Convert is the answer. A Mermaid habit on one line of an
 * otherwise good body is a statement that could not be read, and is skipped like any other.
 */
function shown(d: Diagnostic, body?: string): Pick<Problem, "words" | "fix" | "target"> | null {
  if (d.code === CODES.E_MERMAID_SYNTAX)
    return body !== undefined && detectMermaid(body).fatal
      ? { words: "This diagram is written in Mermaid. Convert it from its panel to draw it." }
      : null;
  if (d.code === CODES.W_CHART_EMPTY) return { words: "This chart has no data yet. Add a series from its panel." };
  const board = ON_THE_BOARD[d.code];
  if (board) return { words: board };
  const pick = ON_A_PICK[d.code];
  /* About a thing that was not drawn — a link from a card that could not be read — there is nothing
     to pick, and so nothing a person could do from here. */
  if (!pick || !d.target) return null;
  return { words: pick.words, fix: pick.fix, target: d.target };
}

/**
 * Parses keyed on the item's `hash`, which is made of exactly what a parse reads (type, body, dir,
 * aspect, layout). The dock asks after every write, and a board of thirty diagrams where one line
 * changed should parse one diagram, not thirty. Bounded by being dropped whole: there is no LRU
 * worth writing for a map that only ever holds the boards one person has had open.
 */
const parsed = new Map<string, Diagnostic[]>();
const LIMIT = 2000;

function diagnosticsOf(it: Parseable & { id: string; hash?: string }): Diagnostic[] {
  const key = it.hash;
  if (key) {
    const hit = parsed.get(key);
    if (hit) return hit;
  }
  const found = parseItem(it)?.diagnostics ?? [];
  if (key) {
    if (parsed.size >= LIMIT) parsed.clear();
    parsed.set(key, found);
  }
  return found;
}

/** The last line of an item's fence — its closing ``` — or its only line when it has no body. */
const lastLine = (it: BoardItem) => it.line + it.body.split("\n").length + 1;

/**
 * The item whose fence holds this board line, if any.
 *
 * A board-level diagnostic names a line and nothing else — `EB_LINK_SYNTAX` is a statement in an
 * `edges` fence, `EB_BAD_DIR` is on some fence's opening line — and "show me" has to open
 * *something*. Frontmatter holds no item, and neither does a blank line between two fences.
 */
export function itemAt(items: readonly BoardItem[], line: number): BoardItem | undefined {
  return items.find((it) => it.line <= line && line <= lastLine(it));
}

export function listProblems(board: Board): Problem[] {
  const found = diagnoseBoard(board, diagnosticsOf);
  const byId = new Map(board.items.map((it) => [it.id, it]));
  const out: Problem[] = [];
  const push = (d: Diagnostic, it: BoardItem | undefined) => {
    const said = shown(d, it?.body);
    if (!said) return;
    /* One Mermaid header is reported on every line it found; the person has one thing to do. */
    if (d.code === CODES.E_MERMAID_SYNTAX && out.some((p) => p.code === d.code && p.item === it?.id)) return;
    out.push({
      key: `${d.code}|${it?.id ?? ""}|${said.target?.id ?? ""}|${d.message}`,
      severity: d.severity,
      code: d.code,
      message: d.message,
      line: d.line,
      item: it?.id,
      type: it?.type,
      page: it?.page,
      ...said,
    });
  };
  for (const d of found.board) push(d, itemAt(board.items, d.line));
  for (const x of found.items) for (const d of x.diagnostics) push(d, byId.get(x.id));
  return out.sort((a, b) => a.line - b.line);
}

/**
 * The errors worth interrupting somebody for: not seen at the last reading, and not in the item
 * they are editing — that one's problems are in the panel they are typing into, and a notification
 * about the line under their caret is the dock shouting about something already on screen.
 * Warnings never interrupt; they are counted and listed, and that is all.
 */
export function freshErrors(now: readonly Problem[], seen: ReadonlySet<string>, editing: string | null): Problem[] {
  return now.filter((p) => p.severity === "error" && !seen.has(p.key) && p.item !== editing);
}

export const count = (ps: readonly Problem[]) => ({
  errors: ps.filter((p) => p.severity === "error").length,
  warnings: ps.filter((p) => p.severity === "warn").length,
});
