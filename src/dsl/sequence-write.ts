import { setEdgeLabel, setTitle } from "./restate";
import { parseSequence, seqParts, type FragmentKind, type SeqEvent, type SeqFragment } from "./sequence";
import { tokenize, type Token } from "./tokenizer";

/**
 * The writers behind a sequence diagram's controls — a message, a fragment, a note, a participant's
 * kind — and the statements the pointer adds.
 *
 * Their own file because the dialect has its own model: a sequence is moments in order, not nodes
 * and edges, so most of what `restate.ts` knows about a statement (a title slot after an id, a `{ }`
 * block, a chain of arrows) is the wrong shape here, and the things this dialect *does* have — an
 * `alt` with `else` branches closed by `end`, a `+` on the target of a message, `note over a, b` —
 * are nobody else's. Where a writer in `restate.ts` already fits it is reused rather than copied: a
 * message's label is an edge label, a fragment's condition is the first string after its keyword,
 * which is what `setTitle` writes.
 *
 * The same contract as every writer there: **total**, and one span in, one span out. A line it
 * cannot read comes back unchanged; a body it cannot honestly change comes back unchanged; the
 * author's spacing, quoting and comments survive everything it does not mean to touch.
 */

/** The tokens of one line, with `sep` and `eof` dropped. */
const lineTokens = (line: string): Token[] => tokenize(line, []).filter((t) => t.kind !== "sep" && t.kind !== "eof");

/** A token's half-open span in its line: `col` is 1-based, and a string wears two quotes. */
const span = (t: Token): [number, number] => [t.col - 1, t.col - 1 + t.value.length + (t.kind === "string" ? 2 : 0)];

const swap = (line: string, [from, to]: [number, number], text: string): string => line.slice(0, from) + text + line.slice(to);

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0]!;

/** One level deeper than a block's head, the way the grammar sheet and the library write it. */
const UNIT = "  ";

/* ------------------------------------------------------------------------------- a message */

/** What one message line says, with the span of each part — or `null` when it is not a message. */
interface MessageLine {
  from: Token;
  arrow: Token;
  /** The target's span *without* a `+`/`-` written onto its front. */
  to: { value: string; span: [number, number] };
  plus: boolean;
  minus: boolean;
  /**
   * Every marker on the line, so a writer can take them all off: a word of its own (`->>+ b`,
   * `b +`), or the first character of the target's word (`+b`).
   */
  marks: { span: [number, number]; prefix: boolean }[];
  colon?: Token;
  label?: Token;
}

function readMessage(line: string): MessageLine | null {
  const toks = lineTokens(line);
  const from = toks[0];
  const arrow = toks[1];
  if (from?.kind !== "word" || arrow?.kind !== "arrow") return null;
  let i = 2;
  const marks: MessageLine["marks"] = [];
  let plus = false;
  let minus = false;
  const mark = (t: Token | undefined): boolean => {
    if (t?.kind !== "word" || (t.value !== "+" && t.value !== "-")) return false;
    marks.push({ span: span(t), prefix: false });
    if (t.value === "+") plus = true;
    else minus = true;
    return true;
  };
  if (mark(toks[i])) i++;
  const target = toks[i];
  if (target?.kind !== "word") return null;
  let to: MessageLine["to"] = { value: target.value, span: span(target) };
  if (/^[+-]./.test(target.value)) {
    const [a, b] = span(target);
    marks.push({ span: [a, a + 1], prefix: true });
    if (target.value[0] === "+") plus = true;
    else minus = true;
    to = { value: target.value.slice(1), span: [a + 1, b] };
  }
  i++;
  while (mark(toks[i])) i++;
  const colon = toks[i]?.kind === "punct" && toks[i]!.value === ":" ? toks[i++] : undefined;
  const label = toks[i]?.kind === "string" ? toks[i] : undefined;
  return { from, arrow, to, plus, minus, marks, colon, label };
}

/** What the panel shows for a picked message. */
export interface MessageParts {
  from: string;
  to: string;
  arrow: string;
  text: string;
  /** `+`: the message starts the target's activation. */
  activates: boolean;
  /** `-`: the message ends the sender's. */
  deactivates: boolean;
}

export function messageParts(line: string): MessageParts | null {
  const m = readMessage(line);
  if (!m) return null;
  return {
    from: m.from.value,
    to: m.to.value,
    arrow: m.arrow.value,
    text: m.label?.value ?? "",
    activates: m.plus,
    deactivates: m.minus,
  };
}

/**
 * The four arrows of the sequence sheet, by what they mean.
 *
 * The menu speaks in the meaning — a call, a reply — because that is what a person choosing one is
 * deciding; the spelling is what gets written.
 */
export const MESSAGE_ARROWS = [
  { arrow: "->>", name: "call" },
  { arrow: "-->>", name: "reply" },
  { arrow: "-)", name: "async" },
  { arrow: "->", name: "plain" },
] as const;

/** A message spelled out — the one place this dialect's statement is written from nothing. */
export function messageStatement(from: string, to: string, text: string, arrow = "->>"): string {
  return `${from} ${arrow} ${to} : ${JSON.stringify(text)}`;
}

/** The label, `null` to take it off. The edge writer when there is one to replace, and the colon kept. */
export function setMessageText(line: string, text: string | null): string {
  const m = readMessage(line);
  if (!m) return line;
  if (text === null) {
    if (!m.label) return line;
    const from = m.colon ? span(m.colon)[0] : span(m.label)[0];
    return line.slice(0, from).replace(/[ \t]+$/, "") + line.slice(span(m.label)[1]);
  }
  if (m.label) return setEdgeLabel(line, text, 0);
  const at = m.colon ? span(m.colon)[1] : Math.max(m.to.span[1], ...m.marks.map((k) => k.span[1]));
  const tail = line.slice(at);
  return `${line.slice(0, at)}${m.colon ? " " : " : "}${JSON.stringify(text)}${tail}`;
}

/** Who sends it, or who receives it. An id with nothing in it is refused rather than written. */
export function setMessageEnd(line: string, end: "from" | "to", id: string): string {
  const m = readMessage(line);
  if (!m || !/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(id)) return line;
  return swap(line, end === "from" ? span(m.from) : m.to.span, id);
}

/** Which arrow. Only the four the sheet lists — anything else would not be a message. */
export function setMessageArrow(line: string, arrow: string): string {
  const m = readMessage(line);
  if (!m || !MESSAGE_ARROWS.some((a) => a.arrow === arrow) || m.arrow.value === arrow) return line;
  return swap(line, span(m.arrow), arrow);
}

/**
 * The `+` or the `-` on a message — the busy bar starting at the target, or ending at the sender.
 *
 * Written the way Mermaid writes it, onto the front of the target: `a ->> +b`. Both at once is a
 * hand-off the grammar can say, and the second one goes after the target as its own word, the form
 * the parser has always read: `a ->> +b - : "x"`. Every mark already on the line is taken off and
 * the wanted ones put back, so the line converges on one spelling whatever it started from.
 */
export function setMessageMark(line: string, which: "+" | "-", on: boolean): string {
  const m = readMessage(line);
  if (!m) return line;
  const plus = which === "+" ? on : m.plus;
  const minus = which === "-" ? on : m.minus;
  if (plus === m.plus && minus === m.minus) return line;

  /* Right to left, so the earlier spans stay where they were. A word mark takes the space before it;
     a prefix is one character of the target's word and takes nothing else. */
  let out = line;
  for (const {
    span: [a, b],
    prefix,
  } of [...m.marks].sort((x, y) => y.span[0] - x.span[0])) {
    const start = prefix ? a : out.slice(0, a).replace(/[ \t]+$/, "").length;
    out = out.slice(0, start) + out.slice(b);
  }
  const again = readMessage(out);
  if (!again) return line;
  const [a, b] = again.to.span;
  const head = plus ? "+" : minus ? "-" : "";
  const trail = plus && minus ? " -" : "";
  return `${out.slice(0, a)}${head}${again.to.value}${trail}${out.slice(b)}`;
}

/* ------------------------------------------------------------------- where a statement goes */

/**
 * Every line of the body that is drawn at a height, in the order the file says them — the same
 * list the layout publishes with a `y` on each (`SeqPlaced.rows`).
 *
 * `inside` marks a line that opens a block: a fragment's head and each `else` / `and`. A statement
 * placed after one of those goes *into* the block. An `activate` is not a row: it has no height of
 * its own, it is a mark on the one beside it.
 */
export interface SeqRow {
  line: number;
  inside: boolean;
}

export function seqRows(events: readonly SeqEvent[]): SeqRow[] {
  const out: SeqRow[] = [];
  const walk = (list: readonly SeqEvent[]) => {
    for (const e of list) {
      if (e.t === "msg" || e.t === "note") out.push({ line: e.line, inside: false });
      else if (e.t === "fragment") {
        e.branches.forEach((b) => {
          out.push({ line: b.line, inside: true });
          walk(b.events);
        });
        if (e.end !== undefined) out.push({ line: e.end, inside: false });
      }
    }
  };
  walk(events);
  return out;
}

/**
 * Where a new statement goes: after a row, or at the top of the conversation.
 *
 * `null` is "above every row" — before the first thing that happens, which in a body with no rows
 * at all is its end, after the participants.
 */
export type Slot = SeqRow | null;

/** The indent and the line index (0-based, to splice before) for a statement in this slot. */
function placeIn(lines: string[], rows: SeqRow[], slot: Slot): { at: number; indent: string } {
  if (slot === null) {
    const first = rows[0];
    if (first) return { at: first.line - 1, indent: indentOf(lines[first.line - 1] ?? "") };
    /* Nothing happens yet: after the last line that says anything, so a trailing blank stays last. */
    let at = lines.length;
    while (at > 0 && lines[at - 1]!.trim() === "") at--;
    return { at, indent: "" };
  }
  const own = lines[slot.line - 1] ?? "";
  if (!slot.inside) return { at: slot.line, indent: indentOf(own) };
  /* Into a block: as deep as what is already in it, or one level deeper than its head. */
  const next = lines[slot.line];
  const deeper = next !== undefined && next.trim() !== "" && indentOf(next).length > indentOf(own).length;
  return { at: slot.line, indent: deeper ? indentOf(next) : indentOf(own) + UNIT };
}

/** A statement put into a slot, and the line it landed on. */
export function insertStatement(body: string, slot: Slot, statement: string): { body: string; line: number } {
  const lines = body.split("\n");
  const rows = seqRows(parseSequence(body).events);
  const { at, indent } = placeIn(lines, rows, slot);
  lines.splice(at, 0, indent + statement.trim());
  return { body: lines.join("\n"), line: at + 1 };
}

/**
 * Move a message, a note — any one-line row — one row up or down the drawing.
 *
 * One row at a time through what is drawn, which is what makes it the inverse of nothing clever:
 * stepping up past an `alt`'s head takes a message out of the fragment, stepping down past an
 * `else` puts it into the next branch, and stepping past a whole fragment's `end` goes into its last
 * branch. A message sits in the slot after the row above it; moving it is putting it in the slot one
 * row further along. A fragment's own lines are not moved by this — `null` for those, and at either
 * end of the conversation.
 */
export function moveRow(body: string, line: number, dir: -1 | 1): { body: string; line: number } | null {
  const rows = seqRows(parseSequence(body).events);
  const i = rows.findIndex((r) => r.line === line);
  if (i === -1 || rows[i]!.inside) return null;
  const target = dir === -1 ? (i >= 2 ? rows[i - 2]! : i === 1 ? null : undefined) : rows[i + 1];
  if (target === undefined) return null;
  /* A fragment's `end` is a row but not a statement: it stays, and only a message or a note moves. */
  if (fragmentAt(body, line)) return null;
  const lines = body.split("\n");
  const text = lines[line - 1]!;
  lines.splice(line - 1, 1);
  const without = lines.join("\n");
  const shift = (r: SeqRow): SeqRow => (r.line > line ? { ...r, line: r.line - 1 } : r);
  return insertStatement(without, target === null ? null : shift(target), text);
}

/* ------------------------------------------------------------------------------- fragments */

/** The fragment whose head, `else`/`and` or `end` is on this line. */
function fragmentAt(body: string, line: number): SeqFragment | null {
  const { fragments } = seqParts(parseSequence(body).events);
  return fragments.find((f) => f.line === line || f.end === line || f.branches.some((b) => b.line === line)) ?? null;
}

/** What a fresh fragment is labelled — something to retype, in the words the sheet uses. */
const LABEL: Record<FragmentKind, string> = {
  alt: "condition",
  opt: "condition",
  loop: "repeat",
  par: "in parallel",
};

/**
 * The list a line's event is in: the body's top level, or one branch of one fragment.
 *
 * Two messages can be wrapped together only when they share one — a range that starts inside an
 * `else` and ends after the `end` would have to cut the fragment in half.
 */
function listOf(events: readonly SeqEvent[], line: number): readonly SeqEvent[] | null {
  for (const e of events) {
    if (e.line === line) return events;
    if (e.t === "fragment") {
      for (const b of e.branches) {
        const inner = listOf(b.events, line);
        if (inner) return inner;
      }
    }
  }
  return null;
}

/** The last line an event takes: its `end` for a fragment, its own line otherwise. */
const lastLine = (e: SeqEvent, body: string): number => (e.t === "fragment" ? (e.end ?? body.split("\n").length) : e.line);

/**
 * Whether the statements from one line to another can be wrapped in a fragment — the two are in
 * the same list, so everything between them is whole.
 */
export function canWrap(body: string, first: number, last: number): boolean {
  const events = parseSequence(body).events;
  const a = listOf(events, Math.min(first, last));
  return a !== null && a === listOf(events, Math.max(first, last));
}

/**
 * Wrap the statements from `first` to `last` in a new fragment: its head before them, `end` after,
 * and every line between one level deeper. The line the head landed on comes back with the body,
 * so the caller can pick the new fragment.
 *
 * `null` when the two are not in one list — see `canWrap`.
 */
export function wrapIn(body: string, first: number, last: number, kind: FragmentKind): { body: string; line: number } | null {
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  const events = parseSequence(body).events;
  const list = listOf(events, lo);
  if (!list || list !== listOf(events, hi)) return null;
  const end = lastLine(list.find((e) => e.line === hi)!, body);
  const lines = body.split("\n");
  const indent = indentOf(lines[lo - 1] ?? "");
  const inner = lines.slice(lo - 1, end).map((l) => (l.trim() === "" ? l : UNIT + l));
  const out = [
    ...lines.slice(0, lo - 1),
    `${indent}${kind} ${JSON.stringify(LABEL[kind])}`,
    ...inner,
    `${indent}end`,
    ...lines.slice(end),
  ];
  return { body: out.join("\n"), line: lo };
}

/**
 * Take a fragment's frame away and keep what was in it: the head, every `else` / `and` and the
 * `end` go, and the statements between come out one level.
 */
export function unwrap(body: string, line: number): string {
  const f = fragmentAt(body, line);
  if (!f || f.end === undefined) return body;
  const end = f.end;
  const lines = body.split("\n");
  const frame = new Set([f.line, end, ...f.branches.map((b) => b.line)]);
  const head = indentOf(lines[f.line - 1] ?? "").length;
  /* How far the contents sit in from the head: the shallowest of them, so a nested block keeps its shape. */
  let depth = Infinity;
  for (let n = f.line + 1; n < end; n++) {
    const l = lines[n - 1]!;
    if (!frame.has(n) && l.trim() !== "") depth = Math.min(depth, indentOf(l).length);
  }
  const cut = Number.isFinite(depth) ? Math.max(0, depth - head) : 0;
  const out: string[] = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    if (frame.has(n)) return;
    if (n > f.line && n < end && l.trim() !== "") out.push(l.slice(Math.min(cut, indentOf(l).length)));
    else out.push(l);
  });
  return out.join("\n");
}

/** A fragment and everything in it gone, which is what Delete on a picked one means. */
export function removeFragment(body: string, line: number): string {
  const f = fragmentAt(body, line);
  if (!f) return body;
  const lines = body.split("\n");
  const to = f.end ?? lines.length;
  return [...lines.slice(0, f.line - 1), ...lines.slice(to)].join("\n");
}

/**
 * Another branch: `else` on an `alt`, `and` on a `par`, written before the `end` at the head's
 * indent with a statement-less body for the person to fill. `null` for a fragment that has no second
 * branch to give — an `opt` or a `loop` — or that was never closed.
 */
export function addBranch(body: string, line: number): { body: string; line: number } | null {
  const f = fragmentAt(body, line);
  if (!f || f.end === undefined || (f.kind !== "alt" && f.kind !== "par")) return null;
  const lines = body.split("\n");
  const word = f.kind === "alt" ? `else ${JSON.stringify("otherwise")}` : `and ${JSON.stringify("also")}`;
  lines.splice(f.end - 1, 0, indentOf(lines[f.line - 1] ?? "") + word);
  return { body: lines.join("\n"), line: f.end };
}

/** One `else` / `and` branch taken out with what is in it. The first branch is the fragment itself. */
export function removeBranch(body: string, line: number): string {
  const f = fragmentAt(body, line);
  if (!f || f.end === undefined) return body;
  const at = f.branches.findIndex((b) => b.line === line);
  if (at < 1) return body;
  const next = f.branches[at + 1]?.line ?? f.end;
  const lines = body.split("\n");
  return [...lines.slice(0, line - 1), ...lines.slice(next - 1)].join("\n");
}

/**
 * A branch's condition — the head's for the first, an `else`'s or an `and`'s after. It is the first
 * string after the keyword, which is the slot `setTitle` writes on a line whose head word is bare.
 */
export function setBranchLabel(line: string, text: string | null): string {
  return setTitle(line, text);
}

/** The branches of the fragment on this line, each with its line and its condition. */
export function branchesOf(
  body: string,
  line: number,
): { kind: FragmentKind; branches: { line: number; label: string }[] } | null {
  const f = fragmentAt(body, line);
  return f ? { kind: f.kind, branches: f.branches.map((b) => ({ line: b.line, label: b.label })) } : null;
}

/* ----------------------------------------------------------------------------------- notes */

export function noteStatement(over: readonly string[], text: string): string {
  return `note over ${over.join(", ")} : ${JSON.stringify(text)}`;
}

/** The text of a `note over …` line, and who it is over. */
export function noteParts(line: string): { over: string[]; text: string } | null {
  const toks = lineTokens(line);
  if (toks[0]?.kind !== "word" || toks[0].value !== "note") return null;
  const over: string[] = [];
  let text = "";
  for (const t of toks.slice(1)) {
    if (t.kind === "word" && t.value !== "over") over.push(t.value);
    if (t.kind === "string") text = t.value;
  }
  return { over, text };
}

/** The note's words. A note always has some, so an empty one writes `""` rather than nothing. */
export function setNoteText(line: string, text: string): string {
  const toks = lineTokens(line);
  if (toks[0]?.value !== "note") return line;
  const s = toks.find((t) => t.kind === "string");
  if (s) return swap(line, span(s), JSON.stringify(text));
  const colon = toks.find((t) => t.kind === "punct" && t.value === ":");
  const end = line.replace(/\s+$/, "").length;
  return colon
    ? `${line.slice(0, end)} ${JSON.stringify(text)}${line.slice(end)}`
    : `${line.slice(0, end)} : ${JSON.stringify(text)}${line.slice(end)}`;
}

/** Who a note is over. At least one, or nothing is written: a note over nobody has no place to be drawn. */
export function setNoteOver(line: string, over: readonly string[]): string {
  const toks = lineTokens(line);
  if (toks[0]?.value !== "note" || over.length === 0) return line;
  const ids = toks.filter((t, i) => i > 0 && t.kind === "word" && t.value !== "over");
  if (ids.length === 0) {
    const after = toks[1]?.value === "over" ? toks[1] : toks[0]!;
    const at = span(after)[1];
    return `${line.slice(0, at)} ${over.join(", ")}${line.slice(at)}`;
  }
  return swap(line, [span(ids[0]!)[0], span(ids[ids.length - 1]!)[1]], over.join(", "));
}

/* ----------------------------------------------------------------------------- participants */

/** A participant spelled out, for the item view's Add. */
function participantStatement(id: string, title: string): string {
  return `participant ${id} ${JSON.stringify(title)}`;
}

/** After the last participant line, or at the top — where a column is declared. */
export function insertParticipant(body: string, id: string, title: string): string {
  const model = parseSequence(body);
  const last = Math.max(0, ...model.participants.map((p) => p.line ?? 0));
  const lines = body.split("\n");
  const statement = participantStatement(id, title);
  if (body.trim() === "") return statement;
  lines.splice(last, 0, (last ? indentOf(lines[last - 1] ?? "") : "") + statement);
  return lines.join("\n");
}
