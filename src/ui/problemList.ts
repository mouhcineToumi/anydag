import type { Board, BoardItem } from "@/board/types";
import type { Code } from "@/dsl/codes";
import { diagnoseBoard, parseItem, type Parseable } from "@/dsl/diagnose";
import type { Diagnostic } from "@/dsl/ir";

/**
 * Everything wrong with a board, as the problems dock and the editor panel list it.
 *
 * The meaning, with no DOM in it: which problems there are, which item each belongs to, and which
 * of them are *new* — the one question the notification asks before it interrupts anybody.
 * `Problems.tsx` is the chrome that shows the answer.
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
  const push = (d: Diagnostic, it: BoardItem | undefined) =>
    out.push({
      key: `${d.code}|${it?.id ?? ""}|${d.message}`,
      severity: d.severity,
      code: d.code,
      message: d.message,
      line: d.line,
      item: it?.id,
      type: it?.type,
      page: it?.page,
    });
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
