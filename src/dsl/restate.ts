import { FORMS, parseChart, type ChartForm } from "./chart";
import { declaredAt } from "./declared";
import { setLabel } from "./graph/timeline";
import { STATUSES, type Status } from "./ir";
import { renameIds } from "./rebind";
import { tokenize, type Token } from "./tokenizer";

/**
 * Rewriting one statement — everything a card, an edge or a row is wearing and saying.
 *
 * A hue, a status and an icon were the three things about a node that are a *choice* rather than a
 * fact, and the only way to change any of them was to type into the middle of a line of DSL. This
 * file was that: give it the line, the key and the new value, and get the line back. It is now the
 * whole statement — the title, the meta, the kind, the flags, the rows, the arrow, the label, and
 * the deletes and moves that span several lines — because a pointer that can only recolour a card
 * is not a pointer that can build a diagram.
 *
 * It works on a single statement rather than on the graph, and that is the point. Reserialising the
 * IR would be a second writer for the whole grammar — it would reformat every line it touched,
 * drop the comments, and have to be kept in step with eight dialects for ever. One span in, one
 * span out: everything else in the file is untouched by construction.
 *
 * The tokenizer is what makes it safe. `stop` inside `"we stop here"` is a `string`, not a `word`,
 * so it cannot be mistaken for the flag; `hue=teal` is three tokens with known columns, so removing
 * it is a slice rather than a regular expression that also matches `--> hue=teal` on the next line.
 *
 * **Every writer here is total.** Handed a line it cannot read — a title on an edge, a row on a
 * statement whose block is one line, an arrow spelling the tokenizer does not know — it hands the
 * body back unchanged rather than throwing or writing something that will not parse. A control
 * that quietly does nothing is a bug the caller can see; a board file that no longer parses is one
 * nobody can open.
 */

/**
 * The trailing modifier that carries a value. `w=` is deliberately absent: it is not a choice.
 *
 * `col=` is on the list because it *is* one — the layer a card is kept in, offered by the panel
 * after a drag moved a card past its own. `x=`/`y=` are not, for the reason the doc on
 * `writeModifier` gives: a coordinate is written by a conversion, never picked from a menu. `kind=`
 * is a sequence participant's: there the head word is `participant` or `actor` and the card it
 * draws is a value, which the Kind menu chooses.
 */
export type ModifierKey = "hue" | "icon" | "col" | "kind";

/** A bare word in modifier position that is not a status. `quiet` is an edge's; the rest are a node's. */
export type Flag = "async" | "external" | "quiet" | "bold" | "italic";

const STATUS_WORDS = new Set<string>(STATUSES);

/** The tokens of one line, with `sep` and `eof` dropped — they only carry the line ending. */
function lineTokens(line: string): Token[] {
  return tokenize(line, []).filter((t) => t.kind !== "sep" && t.kind !== "eof");
}

/** A token's half-open span in the line: `col` is 1-based, and a string wears two quotes. */
function span(t: Token): [number, number] {
  const start = t.col - 1;
  if (t.kind === "string") return [start, start + t.value.length + 2];
  return [start, start + t.value.length];
}

/** Where the author's trailing comment starts, or −1. The tokenizer drops them, so this is a scan. */
function commentAt(line: string): number {
  const m = /\s(?:%%|\/\/)/.exec(line);
  return m ? m.index : -1;
}

/**
 * Where a new modifier goes: before the `{` that opens a row block, else at the end.
 *
 * A trailing comment is left alone for the same reason — it is the author's, and pushing a modifier
 * past it would comment the modifier out.
 */
function insertAt(line: string, tokens: Token[]): number {
  const brace = tokens.find((t) => t.kind === "punct" && t.value === "{");
  if (brace) return span(brace)[0];
  const comment = commentAt(line);
  if (comment !== -1) return comment;
  return line.replace(/\s+$/, "").length;
}

/**
 * Put `text` in at `at`, as its own word.
 *
 * A space on each side unless there is already one, or nothing on that side to separate it from.
 * Without the trailing half, inserting before a row block gave `hue=teal{`.
 */
function splice(line: string, at: number, text: string): string {
  const head = line.slice(0, at).replace(/\s+$/, "");
  const tail = line.slice(at);
  const gap = tail === "" || /^\s/.test(tail) ? "" : " ";
  return `${head}${head === "" ? "" : " "}${text}${gap}${tail}`;
}

/** Cut a span out of the line, taking the one space that separated it from what came before. */
function cut(line: string, [from, to]: [number, number]): string {
  let start = from;
  while (start > 0 && (line[start - 1] === " " || line[start - 1] === "\t")) start--;
  /* Unless it was the first thing on the line, where the indent is the block's, not the token's. */
  if (start === 0 || line.slice(0, start).trim() === "") start = from;
  return line.slice(0, start) + line.slice(to);
}

/** Swap one span for other text, leaving both sides of it exactly as they were. */
function replaceSpan(line: string, [from, to]: [number, number], text: string): string {
  return line.slice(0, from) + text + line.slice(to);
}

/** The `key = value` triple for `key`, as one span, or `null` when the line does not carry it. */
function modifierSpan(tokens: Token[], key: string): [number, number] | null {
  for (let i = 0; i < tokens.length - 2; i++) {
    const k = tokens[i]!;
    const eq = tokens[i + 1]!;
    if (k.kind !== "word" || k.value !== key) continue;
    if (eq.kind !== "punct" || eq.value !== "=") continue;
    /* `icon=aws:lambda` is five tokens — the namespace join happens in the parser, not the
       tokenizer — so the span runs to the last one that is still part of the value. */
    let end = i + 2;
    while (
      end + 2 < tokens.length &&
      tokens[end + 1]!.kind === "punct" &&
      tokens[end + 1]!.value === ":" &&
      tokens[end + 2]!.kind === "word"
    )
      end += 2;
    return [span(k)[0], span(tokens[end]!)[1]];
  }
  return null;
}

/**
 * Where the id sits: index 1 of `<kind> <id>`, index 0 of the `<id> "title"` shorthand, −1 for a
 * line that declares nothing.
 */
function idIndex(tokens: Token[]): number {
  if (tokens[0]?.kind !== "word") return -1;
  return tokens[1]?.kind === "word" ? 1 : 0;
}

/**
 * A bare word used as a flag on this statement, if it is there.
 *
 * Four things can look like a flag without being one, and the first is the one that bit. **The
 * token straight after a kind word is the id, whatever it is called** — `state done "Done"` is the
 * natural way to write a terminal state, and `state done` with no title is the same statement with
 * one fewer string. The old rule ("not a flag if a string follows it") got the first spelling right
 * and would have overwritten the id in the second. So the scan starts past the id, and the id is a
 * position rather than a word.
 *
 * The other three: a word right after an arrow or an `&` is a reference (`a --> quiet` names a
 * node); a word before an `=` is a key; and `stop` inside `"we stop here"` is a `string`, which is
 * the whole reason this reads tokens rather than the line.
 */
function flagSpan(tokens: Token[], words: Set<string>): [number, number] | null {
  const start = tokens[0]?.kind === "word" && tokens[1]?.kind === "word" ? 2 : 1;
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "word" || !words.has(t.value)) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev?.kind === "arrow") continue;
    if (prev?.kind === "punct" && (prev.value === "&" || prev.value === "=" || prev.value === ":")) continue;
    if (next?.kind === "string") continue;
    if (next?.kind === "punct" && next.value === "=") continue;
    return span(t);
  }
  return null;
}

/**
 * Set any `key=value` modifier on one statement, or take it off with `null`.
 *
 * Private, and `key` is a bare `string` here on purpose: `setModifier` below is the *control's*
 * door and its vocabulary is what a person may choose, while a coordinate is written by a
 * conversion rather than picked from a menu. One mechanism, two contracts.
 */
function writeModifier(line: string, key: string, value: string | null, quote = false): string {
  const had = modifierSpan(lineTokens(line), key);
  const base = had ? cut(line, had) : line;
  if (value === null || value === "") return base;
  /* A value with a space in it is free text and has to be quoted; nothing else needs to be —
     except where the value carries punctuation the tokenizer would read as the end of it, which
     `quote` is for and `via=` is the one caller of. Asked for rather than sniffed, so that the
     bytes every existing key writes are exactly the bytes it wrote before. */
  const v = quote || /[\s"]/.test(value) ? JSON.stringify(value) : value;
  return splice(base, insertAt(base, lineTokens(base)), `${key}=${v}`);
}

/** Set a `key=value` modifier on one statement, or take it off with `null`. */
export function setModifier(line: string, key: ModifierKey, value: string | null): string {
  return writeModifier(line, key, value);
}

/**
 * What `key=` says on this statement, as the author wrote it, or `null` when it is not there.
 *
 * The inverse of `setModifier` and read the same way — off the tokens, so `w=` inside a quoted
 * title is a word in a title — which is why a control that shows a number reads it here and not
 * with a regular expression over the line.
 */
export function readModifier(line: string, key: string): string | null {
  const at = modifierSpan(lineTokens(line), key);
  if (!at) return null;
  const text = line.slice(at[0], at[1]);
  const value = text.slice(text.indexOf("=") + 1).trim();
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value;
}

/**
 * A card's, a shape's, a group's or a frame's own width or height: `w=` / `h=`, or `null` to take
 * it off and let the layout decide again.
 *
 * Whole pixels, because the file is a document a person reads. A size that is not a positive
 * number is refused by handing the line back — a `w=0` card is not a size, and a control that
 * quietly wrote one would be the board that draws nothing. A line that is not a declaration (an
 * edge, a bare word) is refused for the reason `setKind` refuses it.
 */
export function setExtent(line: string, key: "w" | "h", value: number | null): string {
  const tokens = lineTokens(line);
  if (idIndex(tokens) === -1 || tokens.some((t) => t.kind === "arrow")) return line;
  if (value === null) return writeModifier(line, key, null);
  if (!Number.isFinite(value) || Math.round(value) < 1) return line;
  return writeModifier(line, key, String(Math.round(value)));
}

/** The direction a group's own members run in: `dir=LR` or `dir=TB`, or `null` to follow the diagram. */
export function setGroupDir(line: string, dir: "LR" | "TB" | null): string {
  const tokens = lineTokens(line);
  if (idIndex(tokens) !== 1 || tokens.some((t) => t.kind === "arrow")) return line;
  return writeModifier(line, "dir", dir);
}

/** Which of a statement's geometry keys a conversion is writing. Absent means "leave it alone". */
export interface Geometry {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * Write geometry onto one statement — what Detach does to every card in a diagram at once.
 *
 * Rounded, because the file is a document a person reads and `x=241.60000000000002` is not
 * something anybody meant to write; `layoutSketch` snaps to the grid on the way back in anyway,
 * so the rounding cannot move a card the reader would notice.
 */
export function setGeometry(line: string, at: Geometry): string {
  let out = line;
  for (const key of ["x", "y", "w", "h"] as const) {
    const v = at[key];
    if (v !== undefined) out = writeModifier(out, key, String(Math.round(v)));
  }
  return out;
}

/**
 * Every `x=` and `y=` in a body, gone — the inverse of Detach.
 *
 * A **declared whole-body conversion**, in the sense `fromMermaid` established: it touches every
 * line rather than one span, and it is offered as a button that says what it will do rather than
 * happening as a side effect of something else. `w=` and `h=` stay: a card the author sized is
 * still that size once ELK is placing it again, and only the position was the fixed layout's.
 */
export function stripCoords(body: string): string {
  return splitLines(body)
    .map((line) => writeModifier(writeModifier(line, "x", null), "y", null))
    .join("\n");
}

/** Set the status flag on one statement, or take it off with `null`. */
export function setStatus(line: string, status: Status | null): string {
  const had = flagSpan(lineTokens(line), STATUS_WORDS);
  const base = had ? cut(line, had) : line;
  if (status === null) return base;
  return splice(base, insertAt(base, lineTokens(base)), status);
}

/**
 * Turn one of the bare-word flags on or off.
 *
 * Separate from `setStatus` because these are not a set of one: a node can be `async` *and*
 * `external`, and at most one status. Idempotent in both directions — setting a flag that is
 * already there hands the line straight back rather than writing a second copy of it.
 */
export function setFlag(line: string, flag: Flag, on: boolean): string {
  const had = flagSpan(lineTokens(line), new Set([flag]));
  if (!on) return had ? cut(line, had) : line;
  if (had) return line;
  return splice(line, insertAt(line, lineTokens(line)), flag);
}

/** Replace one 1-based line of a body, leaving every other byte alone. */
export function replaceLine(body: string, line: number, next: string): string {
  const lines = body.split("\n");
  if (line < 1 || line > lines.length) return body;
  lines[line - 1] = next;
  return lines.join("\n");
}

/* -------------------------------------------------------------------- what a statement says */

/**
 * The statement's own strings — its title, meta and desc — and where a first one would go.
 *
 * They are the *consecutive* run right after the id, because that is what `strings()` in
 * `common.ts` reads: a string written after a flag or a modifier is not a title, it is a syntax
 * error two tokens later. So a title inserted onto `service api done` has to land before the flag,
 * which is what `at` is for.
 *
 * `null` for anything carrying an arrow: an edge's strings are its labels, they belong to a segment
 * rather than to the statement, and `setEdgeLabel` is their writer.
 */
function textSlots(tokens: Token[]): { strings: Token[]; at: number } | null {
  const id = idIndex(tokens);
  if (id === -1) return null;
  if (tokens.some((t) => t.kind === "arrow")) return null;
  const strings: Token[] = [];
  for (let i = id + 1; i < tokens.length && tokens[i]!.kind === "string"; i++) strings.push(tokens[i]!);
  return { strings, at: span(tokens[id]!)[1] };
}

/**
 * Write the nth string of a statement, `null` to clear it.
 *
 * The slots are positional — title, meta, desc — so clearing one that has a later string standing
 * behind it leaves `""` in its place. Promoting the meta into the title's position because the
 * title was cleared would be a different diagram, silently.
 */
function setString(line: string, index: number, text: string | null): string {
  const slots = textSlots(lineTokens(line));
  if (!slots) return line;
  const { strings, at } = slots;
  const have = strings[index];

  if (text === null) {
    if (!have) return line;
    if (index < strings.length - 1) return replaceSpan(line, span(have), '""');
    return cut(line, span(have));
  }
  if (have) return replaceSpan(line, span(have), JSON.stringify(text));

  const pad = Array.from({ length: index - strings.length }, () => '""');
  const end = strings.length ? span(strings[strings.length - 1]!)[1] : at;
  return splice(line, end, [...pad, JSON.stringify(text)].join(" "));
}

/**
 * A mindmap line *is* its title: indentation is the grammar, the label is bare text to end of line,
 * and there is no id to put a string after. `root` stays where it is — it says which topic the tree
 * hangs from, not what that topic is called.
 *
 * This is why `setTitle` takes the diagram type at all. The alternative was to guess from the
 * shape, and `Content Management` tokenizes as exactly the two words a declaration does.
 */
function setTopic(line: string, text: string): string {
  const m = /^([ \t]*)(root\s+)?/.exec(line)!;
  return `${m[1] ?? ""}${m[2] ?? ""}${text}`;
}

/**
 * The node's name. `type` matters for `mindmap`, whose line carries nothing else, and `timeline`,
 * whose label sits after a date the tokenizer does not read (`..` is an arrow to it) and cannot be
 * taken off — see `setLabel`.
 */
export function setTitle(line: string, text: string | null, type?: string): string {
  if (type === "mindmap") return setTopic(line, text ?? "");
  if (type === "timeline") return setLabel(line, text ?? "") ?? line;
  return setString(line, 0, text);
}

/** The second string: a technology, a subtitle — whatever the dialect draws under the title. */
export function setMeta(line: string, text: string | null): string {
  return setString(line, 1, text);
}

/** The third string. Only C4 draws one, and only on a container. */
export function setDesc(line: string, text: string | null): string {
  return setString(line, 2, text);
}

/**
 * Retype a node: `service` becomes `store`.
 *
 * The caller passes a word out of `dialect.kinds` and this does not check — the vocabulary is the
 * dialect's, and it is already in front of whoever is choosing. What it does check is that the line
 * is a declaration at all, because token 0 of an edge is an id and rewriting that would be a
 * different statement about different things.
 *
 * A `kind=` on the line is taken off in the same write. The parser reads it *after* the word, so a
 * line that kept one would go on drawing the old kind however the word was changed — a menu that
 * answers and then changes nothing.
 */
export function setKind(line: string, word: string): string {
  const tokens = lineTokens(line);
  if (tokens[0]?.kind !== "word" || tokens[1]?.kind !== "word") return line;
  if (tokens.some((t) => t.kind === "arrow")) return line;
  const out = replaceSpan(line, span(tokens[0]!), word);
  const over = modifierSpan(lineTokens(out), "kind");
  return over ? cut(out, over) : out;
}

/**
 * The kind a sequence participant is drawn as, from the word it was declared with and its `kind=`.
 *
 * A participant has no kind word to choose — `participant` and `actor` are two spellings of one
 * statement — so its kind is the `kind=` modifier, and the default is what the word says: `actor`
 * is a person, `participant` is a service. `null` for a line that is not one.
 */
export function participantKind(line: string, kinds: readonly string[]): string | null {
  const tokens = lineTokens(line);
  const first = tokens[0];
  if (first?.kind !== "word" || (first.value !== "participant" && first.value !== "actor")) return null;
  const written = readModifier(line, "kind");
  return written !== null && kinds.includes(written) ? written : first.value === "actor" ? "person" : "service";
}

/** Retype a sequence participant: `kind=` written, or taken off when it says what the word already did. */
export function setParticipantKind(line: string, word: string): string {
  const tokens = lineTokens(line);
  const first = tokens[0];
  if (first?.kind !== "word" || (first.value !== "participant" && first.value !== "actor")) return line;
  if (tokens[1]?.kind !== "word") return line;
  return writeModifier(line, "kind", word === (first.value === "actor" ? "person" : "service") ? null : word);
}

/** The two words that open a container with a brace in the dialects that have both. */
export type ContainerWord = "group" | "system";

/**
 * Turn a `group` into a `system`, or back.
 *
 * Two spellings of one statement — `usecase` and `c4` take `system` for the boundary of the thing
 * under discussion, and the rest of the line (id, strings, hue, box) is read the same either way —
 * so this is the kind swap `setKind` makes, for the only declarations whose first word is not in
 * `dialect.kinds`. A line that opens with anything else is handed back: `frame` in a sketch is the
 * same statement as `group` and is not offered, and a node's kind is `setKind`'s to change.
 */
export function setContainer(line: string, word: ContainerWord): string {
  const tokens = lineTokens(line);
  const first = tokens[0];
  if (first?.kind !== "word" || (first.value !== "group" && first.value !== "system")) return line;
  if (tokens[1]?.kind !== "word") return line;
  return replaceSpan(line, span(first), word);
}

/** What `wrapStatement` writes round a statement. */
export interface WrapOpts {
  /** `group`, `system` or `lane` — the dialect's word for the container; the caller knows which. */
  word: string;
  id: string;
  label: string;
  /**
   * The container's own box, for a fence whose coordinates are the author's. Everywhere else the
   * layout places a container round what is in it and writing one would pin it.
   */
  box?: Geometry;
  /** Where the wrapped statement sits *inside* the new container, for the same fences. */
  at?: { x: number; y: number };
}

/**
 * Put one statement — with the `{ }` block it opens — inside a new container.
 *
 * The lines keep every byte they had and gain two spaces of indent, so a card that was at the top
 * level comes out one level in, and a group that is wrapped carries its children with it at the
 * same relative depth. Edges are untouched on purpose: they name ids, ids did not change, and an
 * edge to a card inside a container is exactly as legal as one to a card outside it.
 *
 * The container's line is written the way `+` writes a card — `<word> <id> "<label>"` and nothing
 * the author did not choose — with the brace after any geometry, which is where every dialect's
 * parser expects it.
 *
 * Total, like everything here: a line number that is outside the body, or a line that is blank or
 * a closing brace, hands the body back, because there is nothing there to wrap.
 */
export function wrapStatement(body: string, line: number, opts: WrapOpts): string {
  const lines = splitLines(body);
  const first = lines[line - 1];
  if (first === undefined || first.trim() === "" || /^\s*}/.test(first)) return body;
  const s = statementSpan(body, line);
  const pad = indentOf(first);

  const head = `${pad}${opts.word} ${opts.id} ${JSON.stringify(opts.label)}`;
  const open = `${opts.box ? setGeometry(head, opts.box) : head} {`;
  const inner = lines.slice(s.from - 1, s.to).map((l) => (l.trim() === "" ? l : `  ${l}`));
  if (opts.at) inner[0] = setGeometry(inner[0]!, opts.at);

  return [...lines.slice(0, s.from - 1), open, ...inner, `${pad}}`, ...lines.slice(s.to)].join("\n");
}

/* ---------------------------------------------------------------------------- across a body */

const splitLines = (body: string): string[] => body.split("\n");
const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0]!;
const isBlank = (line: string | undefined): boolean => line !== undefined && line.trim() === "";
const hasBrace = (line: string): boolean =>
  lineTokens(line).some((t) => t.kind === "punct" && (t.value === "{" || t.value === "}"));

/** Every token of a body, by 1-based line. */
function tokensByLine(body: string): Map<number, Token[]> {
  const out = new Map<number, Token[]>();
  for (const t of tokenize(body, [])) {
    if (t.kind === "sep" || t.kind === "eof") continue;
    const list = out.get(t.line);
    if (list) list.push(t);
    else out.set(t.line, [t]);
  }
  return out;
}

/**
 * The 1-based lines one statement occupies: itself, and the `{ }` block it opens.
 *
 * Brace depth over the *tokens*, so a `{` inside a label counts for nothing. Everything in this
 * grammar is line-oriented — a statement starts and ends on its line unless it opens a block — so
 * this is the whole of "where does this thing end".
 */
export function statementSpan(body: string, line: number): { from: number; to: number } {
  const by = tokensByLine(body);
  const last = splitLines(body).length;
  let depth = 0;
  for (let n = line; n <= last; n++) {
    for (const t of by.get(n) ?? []) {
      if (t.kind !== "punct") continue;
      if (t.value === "{") depth++;
      else if (t.value === "}") depth--;
    }
    if (depth <= 0) return { from: line, to: n };
  }
  return { from: line, to: last };
}

/** The block a statement opens, if it opens one. `oneLine` is `{ id uuid pk; slug text }`. */
function blockOf(body: string, line: number): { open: number; close: number; oneLine: boolean } | null {
  const text = splitLines(body)[line - 1];
  if (text === undefined) return null;
  if (!lineTokens(text).some((t) => t.kind === "punct" && t.value === "{")) return null;
  const s = statementSpan(body, line);
  return { open: line, close: s.to, oneLine: s.to === line };
}

/**
 * Take out 0-based lines `from`..`to`, and the blank line the cut would have doubled.
 *
 * Deleting a statement that had a blank line on each side leaves two, and deleting the first or the
 * last one leaves the body starting or ending on one. Neither is wrong and both look like the tool
 * lost track. The hygiene is local to the join by construction: nothing anywhere else in the body
 * is looked at, so an author's deliberate double space three statements down survives.
 */
function dropRange(lines: string[], from: number, to: number): string[] {
  const out = [...lines.slice(0, from), ...lines.slice(to + 1)];
  if (isBlank(out[from - 1]) && isBlank(out[from])) out.splice(from, 1);
  else if (from === 0 && isBlank(out[0])) out.splice(0, 1);
  else if (from >= out.length && isBlank(out[out.length - 1])) out.splice(out.length - 1, 1);
  return out;
}

/* ---------------------------------------------------------------------------------- the rows */

/**
 * Add a row to the node declared on `nodeLine`, making the block if it has none.
 *
 * A new block is always written over three lines with the row indented two past the statement,
 * because that is the only shape in which a row has a line of its own — and a row with no line of
 * its own cannot be addressed by `setRow` or `removeRow`. An author's existing one-liner is
 * appended to in place rather than exploded: adding a column should not reformat the card.
 */
export function addRow(body: string, nodeLine: number, rowText: string): string {
  const lines = splitLines(body);
  const stmt = lines[nodeLine - 1];
  if (stmt === undefined) return body;
  const pad = indentOf(stmt);
  const block = blockOf(body, nodeLine);

  if (!block) {
    lines[nodeLine - 1] = splice(stmt, insertAt(stmt, lineTokens(stmt)), "{");
    lines.splice(nodeLine, 0, `${pad}  ${rowText}`, `${pad}}`);
    return lines.join("\n");
  }

  if (block.oneLine) {
    const tokens = lineTokens(stmt);
    const open = tokens.find((t) => t.kind === "punct" && t.value === "{")!;
    const close = [...tokens].reverse().find((t) => t.kind === "punct" && t.value === "}");
    if (!close) return body;
    const inner = stmt.slice(span(open)[1], span(close)[0]).trim();
    lines[nodeLine - 1] =
      stmt.slice(0, span(open)[1]) + (inner === "" ? ` ${rowText} ` : ` ${inner}; ${rowText} `) + stmt.slice(span(close)[0]);
    return lines.join("\n");
  }

  /* At the rows' own indent, which is the first row's — an author who indents four keeps four. */
  const first = lines.slice(block.open, block.close - 1).find((l) => l.trim() !== "");
  lines.splice(block.close - 1, 0, `${first === undefined ? `${pad}  ` : indentOf(first)}${rowText}`);
  return lines.join("\n");
}

/**
 * The rows of a one-line block, each with its own character span in the line.
 *
 * `{ id uuid pk; slug text }` is two rows on one line, and a line number cannot say which — so a row
 * there is addressed by its **position among the line's rows**, `nth`, and this is what turns that
 * into bytes. The boundary is a `;` outside a quoted string, found by walking the characters between
 * the braces rather than by asking the tokenizer for its separators: the tokenizer collapses a run
 * of them into one, which is right for a parser and wrong for counting. An empty segment (`a;; b`)
 * is not a row and is not counted.
 */
function inlineRows(line: string): { from: number; to: number; text: string }[] {
  const tokens = lineTokens(line);
  const open = tokens.find((t) => t.kind === "punct" && t.value === "{");
  const close = [...tokens].reverse().find((t) => t.kind === "punct" && t.value === "}");
  if (!open || !close) return [];
  const [start, end] = [span(open)[1], span(close)[0]];
  const out: { from: number; to: number; text: string }[] = [];
  let from = start;
  let quoted = false;
  const flush = (to: number) => {
    const raw = line.slice(from, to);
    const text = raw.trim();
    if (text === "") return;
    const at = from + (raw.length - raw.trimStart().length);
    out.push({ from: at, to: at + text.length, text });
  };
  for (let i = start; i < end; i++) {
    const c = line[i];
    if (c === "\\" && quoted) i++;
    else if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) {
      flush(i);
      from = i + 1;
    }
  }
  flush(end);
  return out;
}

/**
 * Replace the text of the row on `line`, keeping its indent and its trailing comment.
 *
 * A row on a line of its own is addressed by the line. A row sharing its line with the statement's
 * braces — `{ id uuid pk; slug text }` — is addressed by `nth`, its position on that line, and
 * rewritten in place so the others and the author's spacing stay as they were. Text that would end
 * the row or the block (`;`, `{`, `}`) is refused there, because it would make two rows or break
 * the statement.
 */
export function setRow(body: string, line: number, text: string, nth?: number): string {
  const lines = splitLines(body);
  const cur = lines[line - 1];
  if (cur === undefined) return body;
  if (nth !== undefined) {
    const row = inlineRows(cur)[nth];
    if (!row || /[;{}]/.test(text)) return body;
    lines[line - 1] = replaceSpan(cur, [row.from, row.to], text);
    return lines.join("\n");
  }
  if (hasBrace(cur)) return body;
  const at = commentAt(cur);
  lines[line - 1] = `${indentOf(cur)}${text}${at === -1 ? "" : cur.slice(at)}`;
  return lines.join("\n");
}

/**
 * The rows of the node declared on `nodeLine`, as lines: what `setRow` and `removeRow` address.
 *
 * The inverse of `addRow`, and it reads the *text* rather than the IR on purpose. A `Row` is what
 * the dialect's row grammar made of a line — a name, a detail, some tags, an `fk=` — and rebuilding
 * a line from one would be the reserialisation this whole file exists to avoid. What a person
 * edits in the panel is the line they would have typed, which is also the only form in which every
 * dialect's rows are the same shape.
 *
 * The rows of a one-line block — `{ id uuid pk; slug text }` — share a line, so each carries `nth`,
 * its position on it, and `setRow` and `removeRow` take that as a third argument. A row on a line of
 * its own has no `nth`: the line says which. A row sharing its line with a *multi-line* block's
 * brace (`  slug text }`) is still left out; `addRow` never writes one.
 */
export function rowLines(body: string, nodeLine: number): { line: number; text: string; nth?: number }[] {
  const block = blockOf(body, nodeLine);
  if (!block) return [];
  const lines = splitLines(body);
  if (block.oneLine) return inlineRows(lines[nodeLine - 1] ?? "").map((row, nth) => ({ line: nodeLine, text: row.text, nth }));
  const out: { line: number; text: string }[] = [];
  for (let n = block.open + 1; n < block.close; n++) {
    const text = lines[n - 1];
    if (text === undefined || text.trim() === "" || hasBrace(text)) continue;
    const at = commentAt(text);
    out.push({ line: n, text: (at === -1 ? text : text.slice(0, at)).trim() });
  }
  return out;
}

/**
 * Take the row on `line` out; `nth` says which when the line holds several, as `setRow` does.
 *
 * Taking out the last row of a one-line block leaves `{ }` rather than removing the braces: the
 * statement is still a card that has rows, and `addRow` writes into exactly that shape.
 */
export function removeRow(body: string, line: number, nth?: number): string {
  const lines = splitLines(body);
  const cur = lines[line - 1];
  if (cur === undefined) return body;
  if (nth !== undefined) {
    const rows = inlineRows(cur);
    const row = rows[nth];
    if (!row) return body;
    const tokens = lineTokens(cur);
    const open = tokens.find((t) => t.kind === "punct" && t.value === "{")!;
    const close = [...tokens].reverse().find((t) => t.kind === "punct" && t.value === "}")!;
    const rest = rows.filter((_, i) => i !== nth).map((r) => r.text);
    lines[line - 1] = cur.slice(0, span(open)[1]) + (rest.length ? ` ${rest.join("; ")} ` : " ") + cur.slice(span(close)[0]);
    return lines.join("\n");
  }
  if (hasBrace(cur)) return body;
  return dropRange(lines, line - 1, line - 1).join("\n");
}

/* --------------------------------------------------------------------------------- the edges */

/** One side of an arrow: `a & b`, with the char span it covers. */
interface RefList {
  tokens: Token[];
  from: number;
  to: number;
}

/**
 * An edge statement taken apart: the ref lists, the arrows between them, and what trails each one.
 *
 * `refs` is always one longer than `arrows` — `a --> b --> c` is three lists and two arrows — and
 * `tails[k]` is what was written after `refs[k]` and before the next arrow: the optional Mermaid
 * `:`, the labels, and the modifiers. `tails[0]` is empty by construction; an arrow follows the
 * first list immediately or this is not an edge statement.
 */
export interface EdgeSpan {
  refs: RefList[];
  arrows: Token[];
  tails: { strings: Token[]; at: number }[];
}

/** Read one line as an edge statement, or `null` when it is not one. */
export function edgeSpan(line: string): EdgeSpan | null {
  const tokens = lineTokens(line);
  if (!tokens.some((t) => t.kind === "arrow")) return null;

  const refs: RefList[] = [];
  const arrows: Token[] = [];
  const tails: EdgeSpan["tails"] = [];
  let i = 0;

  while (i < tokens.length) {
    const list: Token[] = [];
    for (;;) {
      const t = tokens[i];
      if (t?.kind !== "word") break;
      list.push(t);
      i++;
      if (tokens[i]?.kind === "punct" && tokens[i]!.value === "&" && tokens[i + 1]?.kind === "word") {
        i++;
        continue;
      }
      break;
    }
    if (list.length === 0) return null;
    refs.push({ tokens: list, from: span(list[0]!)[0], to: span(list[list.length - 1]!)[1] });

    /* The tail. A label goes after the colon if the author wrote one, else straight after the ref,
       and always before the modifiers — which is the order `parseEdge` reads them in. */
    let at = refs[refs.length - 1]!.to;
    const colon = tokens[i];
    if (colon?.kind === "punct" && colon.value === ":") {
      at = span(colon)[1];
      i++;
    }
    const strings: Token[] = [];
    while (tokens[i]?.kind === "string") {
      strings.push(tokens[i]!);
      i++;
    }
    tails.push({ strings, at });

    while (i < tokens.length && tokens[i]!.kind !== "arrow") i++;
    if (tokens[i]?.kind === "arrow") {
      arrows.push(tokens[i]!);
      i++;
    }
  }
  return arrows.length === 0 ? null : { refs, arrows, tails };
}

/**
 * One of an arrow's two strings, on one segment: `0` is the label, `1` is the second one — C4's
 * technology chip, `a --> b : "Uses" "HTTPS"`.
 *
 * `seg` picks which arrow on a chain — every edge of `a --> b --> c` is on the same line, so the
 * line alone cannot say which one is meant.
 *
 * The strings are positional, as a node's title, meta and desc are: clearing the label while the
 * second one stands behind it leaves `""` in its place, because promoting the technology into the
 * label's position would be a different diagram. Clearing the second one takes off the `""` that
 * only held its place, so a line does not keep a pair of empty quotes nobody can see.
 */
function setEdgeString(line: string, index: 0 | 1, text: string | null, seg: number): string {
  const e = edgeSpan(line);
  const tail = e?.tails[seg + 1];
  if (!tail) return line;
  const have = tail.strings[index];
  if (text === null) {
    if (!have) return line;
    if (index < tail.strings.length - 1) return replaceSpan(line, span(have), '""');
    const before = tail.strings[index - 1];
    /* Both go in one slice: cutting them one at a time would reread the line between the two. */
    if (before?.value === "") return cut(line, [span(before)[0], span(have)[1]]);
    return cut(line, span(have));
  }
  if (have) return replaceSpan(line, span(have), JSON.stringify(text));
  if (index === 1 && tail.strings.length === 0) return splice(line, tail.at, `"" ${JSON.stringify(text)}`);
  const last = tail.strings[tail.strings.length - 1];
  return splice(line, last ? span(last)[1] : tail.at, JSON.stringify(text));
}

/** The label on one segment. See `setEdgeString`. */
export function setEdgeLabel(line: string, text: string | null, seg = 0): string {
  return setEdgeString(line, 0, text, seg);
}

/**
 * The second string on one segment — C4's technology chip, drawn under the label. Positional, so
 * writing one on an edge with no label first writes the empty label that holds its place.
 */
export function setEdgeLabel2(line: string, text: string | null, seg = 0): string {
  return setEdgeString(line, 1, text, seg);
}

/**
 * Whether the tokenizer reads `text` as exactly one arrow.
 *
 * The vocabulary is the tokenizer's table and this asks it rather than keeping a second copy —
 * including the ER cardinalities, which are matched structurally there and would be sixty entries
 * and sixty chances to disagree here.
 */
export function isArrow(text: string): boolean {
  const t = lineTokens(text);
  return t.length === 1 && t[0]!.kind === "arrow" && t[0]!.value === text;
}

/** Swap one segment's arrow for another spelling. An arrow the tokenizer does not know is refused. */
export function setEdgeArrow(line: string, arrow: string, seg = 0): string {
  const e = edgeSpan(line);
  const tok = e?.arrows[seg];
  if (!tok || !isArrow(arrow)) return line;
  return replaceSpan(line, span(tok), arrow);
}

/**
 * Which end of a segment, for the writers below that reach into one: the list of ids the arrow
 * leaves (`from`) or arrives at (`to`).
 *
 * On a chain the two halves share: `a --> b & c --> d` has `b & c` as the first segment's `to` *and*
 * the second one's `from`, because that is one list in the text. Writing either writes the list.
 */
export type EdgeSide = "from" | "to";

const listOf = (e: EdgeSpan, seg: number, side: EdgeSide): RefList | undefined => e.refs[side === "from" ? seg : seg + 1];

/** The ids one end of a segment names, in the order they are written. */
export function edgeEnds(line: string, seg: number, side: EdgeSide): string[] {
  const e = edgeSpan(line);
  const list = e && listOf(e, seg, side);
  return list ? list.tokens.map((t) => t.value) : [];
}

/**
 * Swap one id on one end of a segment for another — the node, group or row (`api.content`) the
 * arrow runs to. A word the tokenizer would not read as one id is refused, because a control
 * that writes `a b` into a list is a control that breaks the file.
 */
export function setEdgeEnd(line: string, seg: number, side: EdgeSide, index: number, ref: string): string {
  const e = edgeSpan(line);
  const tok = e && listOf(e, seg, side)?.tokens[index];
  if (!tok || !isRef(ref)) return line;
  return replaceSpan(line, span(tok), ref);
}

/**
 * Add an id to one end of a segment: `a --> c` becomes `a & b --> c`, which is a bus, and
 * `f --> a` becomes `f --> a & b`, which is a fan. The statement stays one statement, so the
 * router can see one family and draw one trunk with one label — what one line per pair cannot say.
 *
 * An id already in the list is not added twice, and a segment whose list is missing is left alone.
 */
export function addEdgeEnd(line: string, seg: number, side: EdgeSide, ref: string): string {
  const e = edgeSpan(line);
  const list = e && listOf(e, seg, side);
  if (!list || !isRef(ref) || list.tokens.some((t) => t.value === ref)) return line;
  return line.slice(0, list.to) + ` & ${ref}` + line.slice(list.to);
}

/**
 * Take one id off one end of a segment. The last id on an end stays: an arrow with nothing at one
 * end is not a statement, and deleting the edge is `removeEdge`'s job, which is the one that says so.
 */
export function removeEdgeEnd(line: string, seg: number, side: EdgeSide, index: number): string {
  const e = edgeSpan(line);
  const toks = e && listOf(e, seg, side)?.tokens;
  if (!toks || toks.length < 2 || !toks[index]) return line;
  /* The `&` goes with the id it joined: the one in front of it, or for the first id the one behind. */
  if (index === 0) return line.slice(0, span(toks[0]!)[0]) + line.slice(span(toks[1]!)[0]);
  return line.slice(0, span(toks[index - 1]!)[1]) + line.slice(span(toks[index]!)[1]);
}

/**
 * Carry a chain one hop further: `a --> b` becomes `a --> b --> c`.
 *
 * At the end of the statement, after everything the last hop wrote, because a label and the
 * modifiers belong to the hop *before* the arrow that follows them — appending cannot move one onto
 * the wrong segment. The new hop wears the arrow the chain's last one does, which is the spelling
 * the author has been using, and carries nothing else.
 */
export function appendHop(line: string, ref: string, arrow?: string): string {
  const e = edgeSpan(line);
  if (!e || !isRef(ref)) return line;
  const last = e.arrows[e.arrows.length - 1]!.value;
  return splice(line, insertAt(line, lineTokens(line)), `${arrow && isArrow(arrow) ? arrow : last} ${ref}`);
}

/**
 * Take the last hop off a chain: `a --> b --> c` becomes `a --> b`. A statement with one arrow has
 * no hop to take off — that is the whole edge, and `removeEdge` deletes those.
 */
export function dropHop(line: string): string {
  const e = edgeSpan(line);
  if (!e || e.arrows.length < 2) return line;
  const from = span(e.arrows[e.arrows.length - 1]!)[0];
  const comment = commentAt(line);
  const end = comment === -1 ? line.length : comment;
  return cut(line, [from, end]);
}

/**
 * Turn a statement round: `a --> b "label"` becomes `b --> a "label"`.
 *
 * The two ref lists trade places and everything else stays where it is. The label is written after
 * the second list and belongs to the segment, not to either end, so it keeps its place. The arrow
 * keeps its spelling, so a `--|>` still points from the new first end to the new second.
 *
 * Only a statement with one arrow. Reversing one hop of a chain would mean splitting the chain, and
 * reversing a whole chain is a different statement from the one picked. Either way the line is
 * returned unchanged, which is what the panel reads as "not offered".
 */
export function reverseEdge(line: string): string {
  const e = edgeSpan(line);
  if (!e || e.arrows.length !== 1) return line;
  const [a, z] = [e.refs[0]!, e.refs[1]!];
  const left = line.slice(a.from, a.to);
  const right = line.slice(z.from, z.to);
  return line.slice(0, a.from) + right + line.slice(a.to, z.from) + left + line.slice(z.to);
}

/**
 * Every place an edge statement names `from`, named `to` instead — only in its ref lists, never in a
 * label or a modifier. What a loose stub dropped on a card writes (#145): `api --> ghost` becomes
 * `api --> db`, and a chain through `ghost` is mended at every hop that named it.
 */
export function retargetRef(line: string, from: string, to: string): string {
  const e = edgeSpan(line);
  if (!e || !isRef(to)) return line;
  const hits = e.refs.flatMap((r) => r.tokens).filter((t) => t.value === from);
  /* Right to left, so each splice leaves the spans still to come where they were. */
  let out = line;
  for (const t of hits.reverse()) out = replaceSpan(out, span(t), to);
  return out;
}

/** Whether `text` is one id or `id.row`, the way the tokenizer reads a word. */
function isRef(text: string): boolean {
  const t = lineTokens(text);
  return t.length === 1 && t[0]!.kind === "word" && t[0]!.value === text;
}

/**
 * An edge's hue.
 *
 * It was written before anything read it: an edge's hue is derived in `finalize()` from its
 * source's, and a `hue=` on an edge statement landed in `modifiers().extra` and was dropped. F3
 * promoted it in `parseEdge` — three lines, and the derivation still stands where the author
 * wrote nothing, because `finalize()` only fills a hue that is absent. So the swatch beside a
 * picked edge now recolours the line instead of claiming to.
 */
export function setEdgeHue(line: string, hue: string | null): string {
  return setModifier(line, "hue", hue);
}

/** An edge's one flag. A node's writer, because it is the same bare word in the same position. */
export function setEdgeFlag(line: string, flag: "quiet", on: boolean): string {
  return setFlag(line, flag, on);
}

/**
 * The point a board link is bent through, or `null` to straighten it.
 *
 * Quoted, always, and that is not a style choice: `,` is punctuation to the tokenizer, so
 * `via=320,180` would come back as three tokens and the value would end at the comma.
 * `writeModifier` only reaches for quotes when it sees a space, which is the right default for
 * every other key and exactly wrong for this one, so the quoting is done here. `ink`'s `pts=`
 * settled the same question the same way.
 *
 * Rounded, for `setGeometry`'s reason: the file is a document somebody reads, and nobody meant to
 * write `via="241.60000000000002,88"`.
 *
 * Only a statement in an `edges` fence takes one. A diagram's own edges are routed between cards
 * ELK placed, so a point fixed between two of them is a claim the next relayout would make false —
 * the refusal this codebase already makes about a coordinate inside an automatic layout.
 */
export function setLinkVia(line: string, at: { x: number; y: number } | null): string {
  return writeModifier(line, "via", at === null ? null : `${Math.round(at.x)},${Math.round(at.y)}`, true);
}

/**
 * Delete a whole edge statement.
 *
 * A chain and a bus go as one, for the reason `removeLinkLine` in `src/edit/connect.ts` already
 * gives: `a --> b --> c` is one line and two edges, and half a chain is not something the grammar
 * can say. Every edge the pointer draws is a line of its own, so the two only diverge on text
 * somebody wrote by hand — where watching the whole statement go is the honest outcome.
 */
export function removeEdge(body: string, line: number): string {
  const lines = splitLines(body);
  if (line < 1 || line > lines.length) return body;
  const s = statementSpan(body, line);
  return dropRange(lines, s.from - 1, s.to - 1).join("\n");
}

/* -------------------------------------------------------------------------- deleting a node */

/** The head of a reference: `api.content` is declared as `api`. The rule `resolveRefs` uses. */
const headOf = (word: string): string => {
  const dot = word.lastIndexOf(".");
  return dot === -1 ? word : word.slice(0, dot);
};

/**
 * This edge statement with every reference to a dead id taken out of it — or `null` when it names
 * none of them and is not to be touched at all.
 *
 * Two shapes, and the difference between them is what the grammar can still say afterwards:
 *
 * - A **bus** loses one source: `a & b --> c` becomes `b --> c`, and the `&` goes with it. The line
 *   keeps its shape, its labels and its comment.
 * - A **chain** is split first. `a --> b --> c` is two edges written as one line, so removing `b`
 *   removes both of them; removing `c` from `a --> b --> c --> d` leaves `a --> b`, because the two
 *   segments naming `c` both go. What it never becomes is `a --> d`. That edge would be a claim
 *   about the system nobody made — deleting a thing does not connect what it stood between.
 *
 * The surviving segments are *slices of the original line*, not text rebuilt from tokens: a segment
 * is its left ref list, then its own arrow up to the next one — the right ref list, and the label
 * and modifiers after it, which belong to that hop in both grammars. Spacing, quoting and backticks
 * come through exactly as written, and so does a `hue=` or a `via=`; what trails the left list is
 * the hop before's and stays with it. The trailing comment goes on the first line out; it belonged
 * to the statement, and the statement is now several.
 *
 * `dead` says whether one reference, as written, names something that is going.
 */
function stripRefs(line: string, dead: (word: string) => boolean): string[] | null {
  const e = edgeSpan(line);
  if (!e) return null;

  const doomed = e.refs.map((r) => r.tokens.map((t) => dead(t.value)));
  if (!doomed.some((d) => d.some(Boolean))) return null;

  const cuts: [number, number][] = [];
  e.refs.forEach((list, k) => {
    const d = doomed[k]!;
    if (d.every(Boolean)) return;
    list.tokens.forEach((t, j) => {
      if (!d[j]) return;
      /* Take the separator on the side that has something left on it, so two adjacent removals cut
         two adjacent spans rather than one overlapping pair. */
      if (d.slice(0, j).some((x) => !x)) cuts.push([span(list.tokens[j - 1]!)[1], span(t)[1]]);
      else cuts.push([span(t)[0], span(list.tokens[j + 1]!)[0]]);
    });
  });

  const empty = doomed.map((d) => d.every(Boolean));
  const alive = e.arrows.map((_, k) => !empty[k] && !empty[k + 1]);

  const apply = (text: string, offset: number): string => {
    let out = text;
    for (const [from, to] of [...cuts].sort((a, b) => b[0] - a[0])) {
      if (from < offset || to > offset + text.length) continue;
      out = out.slice(0, from - offset) + out.slice(to - offset);
    }
    return out;
  };

  if (alive.every(Boolean)) return [apply(line, 0)];
  if (!alive.some(Boolean)) return [];

  const pad = indentOf(line);
  const at = commentAt(line);
  const out: string[] = [];
  e.arrows.forEach((arrow, k) => {
    if (!alive[k]) return;
    /* Two slices, because what trails a ref list in the middle of a chain is the *previous* hop's
       label and modifiers: its left ends, then its own arrow up to the next one, with the space the
       author put in front of that arrow. */
    const left = e.refs[k]!;
    let gap = span(arrow)[0];
    while (gap > left.to && /[ \t]/.test(line[gap - 1]!)) gap--;
    const next = e.arrows[k + 1];
    const to = next ? span(next)[0] : at === -1 ? line.length : at;
    out.push(pad + apply(line.slice(left.from, left.to), left.from) + apply(line.slice(gap, to), gap).trimEnd());
  });
  if (at !== -1) out[0] += line.slice(at);
  return out;
}

/** How `removeNode` finds the declaration. `type` lets it ask the parser; without one it scans tokens. */
export interface RemoveNodeOpts {
  type?: string;
  dir?: "LR" | "TB";
}

/**
 * Take a node out, and everything that named it with it.
 *
 * The statement, the `{ }` block it opened, and every edge that referenced it — including through a
 * row (`order.db --> pg` names `order`) and including one of several sources on a bus. Without the
 * last part a delete hands the author `E_UNKNOWN_ID` on lines they never touched, which is the
 * worst kind of error there is: the fix is on a line the message does not mention.
 *
 * **A group takes its children with it.** Deleting the block is deleting what is in it, so the ids
 * declared inside are dead too and the edges naming *those* go as well. Anything less leaves a
 * board that does not parse, which is the one outcome a writer here may not produce.
 *
 * The declaration is found through `declaredAt`, which with no `type` falls through to its own
 * token scan — one implementation of "which line says this id", not two.
 */
export function removeNode(body: string, id: string, opts: RemoveNodeOpts = {}): string {
  const lines = splitLines(body);
  const declLine = declaredAt(opts.type ?? "", body, id, opts.dir);
  const dead = new Set([id]);

  let block: { from: number; to: number } | null = null;
  if (declLine !== null) {
    block = statementSpan(body, declLine);
    for (let n = block.from + 1; n <= block.to; n++) {
      const t = lineTokens(lines[n - 1] ?? "");
      if (idIndex(t) === 1 && !t.some((x) => x.kind === "arrow")) dead.add(t[1]!.value);
    }
  }

  const edits: { from: number; to: number; replace: string[] | null }[] = [];
  if (block) edits.push({ ...block, replace: null });
  lines.forEach((text, i) => {
    const n = i + 1;
    if (block && n >= block.from && n <= block.to) return;
    const next = stripRefs(text, (word) => dead.has(headOf(word)));
    if (next !== null) edits.push({ from: n, to: n, replace: next });
  });
  return applyEdits(lines, edits);
}

/**
 * Every edge statement in `body` with the references `dead` answers for taken out, by
 * `removeNode`'s rules — a bus loses a source, a chain is split and never collapsed, and a statement
 * with nothing left on one side goes with the blank line its going would double.
 *
 * `removeNode`'s edge half, for a caller whose declaration is somewhere else: an `edges` fence names
 * items, and an item is removed from the board rather than from this body. `src/board/patch.ts`
 * is that caller, and it says what `dead` means, because only the board knows whether
 * `arch1.db` is a card inside item `arch1` or an item of that literal name.
 */
export function removeRefs(body: string, dead: (word: string) => boolean): string {
  const lines = splitLines(body);
  const edits: { from: number; to: number; replace: string[] | null }[] = [];
  lines.forEach((text, i) => {
    const next = stripRefs(text, dead);
    if (next !== null) edits.push({ from: i + 1, to: i + 1, replace: next });
  });
  return edits.length ? applyEdits(lines, edits) : body;
}

/** 1-based line ranges replaced or dropped, last first so the earlier ones' numbers stay true. */
function applyEdits(lines: string[], edits: { from: number; to: number; replace: string[] | null }[]): string {
  let out = lines;
  for (const e of edits.sort((a, b) => b.from - a.from)) {
    if (e.replace === null || e.replace.length === 0) out = dropRange(out, e.from - 1, e.to - 1);
    else out = [...out.slice(0, e.from - 1), ...e.replace, ...out.slice(e.to)];
  }
  return out.join("\n");
}

/**
 * Rename an id everywhere it appears — its declaration, every reference, and the head of a dotted
 * one. `rebind.ts` has done this since saved components landed; there is no second implementation.
 *
 * The one thing it cannot tell apart is an id that is also a *value*: a node called `teal` on a
 * board that writes `hue=teal` has its hue renamed too. That is the same rule that makes
 * `fk=<group>` follow a group rename, which is right, and the collision is not worth two writers.
 */
export function renameId(body: string, from: string, to: string): string {
  return from === to ? body : renameIds(body, new Map([[from, to]]));
}

/* ------------------------------------------------------------------------ moving a statement */

/** Where a statement is going: into a block, after a sibling, or to the top of the body. */
export type MoveTarget = { intoBlockLine: number } | { afterLine: number } | { toTop: true };

/**
 * Cut a statement out — with its block — and paste it somewhere else in the same body.
 *
 * The first writer that touches two places, and still not a reserialisation: the lines move as they
 * were written and only their indentation changes, by the difference between the two depths. A
 * nested group carries everything inside it, at the same relative indent.
 *
 * The insertion point is marked *before* the cut rather than computed after it, because the cut
 * takes a doubled blank line with it and the arithmetic to predict which one is arithmetic nobody
 * should have to read. Moving a statement to where it already is is a no-op by the same mechanism.
 */
export function moveStatement(body: string, line: number, target: MoveTarget): string {
  const lines = splitLines(body);
  if (line < 1 || line > lines.length) return body;
  const s = statementSpan(body, line);

  let at: number;
  let indent: string;
  if ("toTop" in target) {
    at = 0;
    indent = "";
  } else if ("intoBlockLine" in target) {
    const b = target.intoBlockLine;
    if (b < 1 || b > lines.length || (b >= s.from && b <= s.to)) return body;
    const block = blockOf(body, b);
    /* A one-line block has no line to paste onto, and a statement with no block is not a target. */
    if (!block || block.oneLine) return body;
    at = b;
    indent = `${indentOf(lines[b - 1]!)}  `;
  } else {
    const a = target.afterLine;
    if (a < 1 || a > lines.length || (a >= s.from && a <= s.to)) return body;
    at = statementSpan(body, a).to;
    indent = indentOf(lines[a - 1]!);
  }

  const MARK = "\0dag-move";
  const marked = [...lines];
  marked.splice(at, 0, MARK);
  const from = at <= s.from - 1 ? s.from : s.from - 1;
  const moved = marked.slice(from, from + (s.to - s.from + 1));

  const shift = indent.length - indentOf(moved[0]!).length;
  const reindented = moved.map((l) =>
    l.trim() === "" ? l : shift >= 0 ? " ".repeat(shift) + l : l.slice(Math.min(-shift, indentOf(l).length)),
  );

  const rest = dropRange(marked, from, from + moved.length - 1);
  const mark = rest.indexOf(MARK);
  if (mark === -1) return body;
  return [...rest.slice(0, mark), ...reindented, ...rest.slice(mark + 1)].join("\n");
}

/* --------------------------------------------------------------------- moving a mindmap topic */

/**
 * How deep a mindmap line sits, in the units its parser counts.
 *
 * A tab is two spaces there (`parseMindmap`), so it is two here. Reading the raw prefix instead
 * would make a file mixing the two re-parent to a depth nobody wrote.
 */
const depthOf = (line: string): number => indentOf(line).replace(/\t/g, "  ").length;

/** Whether a line takes part in the tree at all — a blank or a comment does not. */
const topicLine = (line: string | undefined): boolean => line !== undefined && line.trim() !== "" && !/^\s*(%%|\/\/)/.test(line);

/**
 * The 1-based lines a mindmap topic occupies: itself, and everything indented under it.
 *
 * `statementSpan` cannot answer this and never will: it counts braces, and a mindmap has none —
 * indentation *is* the grammar. A blank line inside a subtree is carried along, which is what
 * keeps an author's spacing where they put it; trailing blanks are not, or every re-parent would
 * drag the gap after it into its new home.
 */
export function topicSpan(body: string, line: number): { from: number; to: number } {
  const lines = splitLines(body);
  const own = depthOf(lines[line - 1] ?? "");
  let to = line;
  for (let n = line + 1; n <= lines.length; n++) {
    const text = lines[n - 1]!;
    if (!topicLine(text)) continue;
    if (depthOf(text) <= own) break;
    to = n;
  }
  return { from: line, to };
}

/**
 * Re-parent a topic — and everything under it — beneath another one.
 *
 * The mindmap's answer to `moveStatement`, and the same two halves in the same order: mark where
 * the lines are going before cutting them, so the arithmetic of what the cut removed never has to
 * be predicted. What is different is that the *indent* is the edit rather than a tidy-up after it,
 * so the shift is applied to the whole subtree and relative depths inside it survive.
 *
 * A topic cannot be re-parented under itself or under anything in its own subtree — that is not a
 * tree — and the body comes back untouched rather than mangled, which is this file's rule for
 * every writer.
 */
export function moveTopic(body: string, line: number, under: number): string {
  const lines = splitLines(body);
  if (line < 1 || line > lines.length || under < 1 || under > lines.length) return body;
  const s = topicSpan(body, line);
  if (under >= s.from && under <= s.to) return body;

  const target = topicSpan(body, under);
  const indent = `${indentOf(lines[under - 1]!)}  `;
  const shift = indent.length - indentOf(lines[line - 1]!).length;

  const MARK = "\0dag-topic";
  const marked = [...lines];
  marked.splice(target.to, 0, MARK);
  const from = target.to <= s.from - 1 ? s.from : s.from - 1;
  const moved = marked.slice(from, from + (s.to - s.from + 1));
  const reindented = moved.map((l) =>
    l.trim() === "" ? l : shift >= 0 ? " ".repeat(shift) + l : l.slice(Math.min(-shift, indentOf(l).length)),
  );

  const rest = dropRange(marked, from, from + moved.length - 1);
  const mark = rest.indexOf(MARK);
  if (mark === -1) return body;
  return [...rest.slice(0, mark), ...reindented, ...rest.slice(mark + 1)].join("\n");
}

/* ------------------------------------------------------------------- what is out of date */

/**
 * The words the parser still accepts and warns about (`W_RETIRED_FLAG`): they marked a card once,
 * and hovering rings it now, so the current form of a statement that wears one is the statement
 * without it. The parser's own set is private to `common.ts`; this is the same two words, and
 * `test/restate.test.ts` holds the two together by parsing what these remove.
 */
const RETIRED = new Set(["focus", "current"]);

/**
 * Bring the statements the parser called out as retired up to date: the flag comes off the line, and
 * a `legend` line explaining a mark that is no longer drawn goes entirely.
 *
 * It is handed the **lines** — the `W_RETIRED_FLAG` diagnostics' own — instead of looking for the
 * words itself, because `current` is also a perfectly good column name and only the parser knows
 * which ones it read as a flag. On those lines only the tokens before a statement's `{` are
 * looked at, so a column called `focus` on a one-line entity is left where it is.
 *
 * A **declared whole-body conversion**, like `stripCoords`: it is offered as one button that names
 * what it will do, and everything on every other line is untouched by construction.
 */
export function updateRetired(body: string, lines: readonly number[]): string {
  const out = splitLines(body);
  const gone: number[] = [];
  for (const n of new Set(lines)) {
    const text = out[n - 1];
    if (text === undefined) continue;
    const tokens = lineTokens(text);
    if (tokens[0]?.kind === "word" && tokens[0].value === "legend") {
      gone.push(n - 1);
      continue;
    }
    let next = text;
    for (;;) {
      const all = lineTokens(next);
      const brace = all.findIndex((t) => t.kind === "punct" && t.value === "{");
      const had = flagSpan(brace === -1 ? all : all.slice(0, brace), RETIRED);
      if (!had) break;
      next = cut(next, had);
    }
    out[n - 1] = next;
  }
  /* Last first, so a removal does not renumber the ones still to come. */
  let rest = out;
  for (const i of gone.sort((a, b) => b - a)) rest = dropRange(rest, i, i);
  return rest.join("\n");
}

/**
 * A `dir=LR` statement in the body, taken out and handed back as the direction it said.
 *
 * It is the parser's own and it wins over the fence's `dir=`, which is exactly why it is worth
 * moving: the Direction control writes the fence, and a body that still sets one over it would
 * answer the control with no change. The last valid one is what the parser ended on, so that is the
 * value returned; all of them are removed. `null` when the body has none — and a `dir=` with
 * anything else on its line (a group's) is not this statement and is never touched.
 */
export function takeBodyDir(body: string): { body: string; dir: "LR" | "TB" } | null {
  const hits: { line: number; dir: "LR" | "TB" }[] = [];
  for (const [line, tokens] of tokensByLine(body)) {
    const [key, eq, value] = tokens;
    if (tokens.length !== 3 || key!.kind !== "word" || key!.value !== "dir") continue;
    if (eq!.kind !== "punct" || eq!.value !== "=" || value!.kind !== "word") continue;
    if (value!.value === "LR" || value!.value === "TB") hits.push({ line, dir: value!.value });
  }
  const last = hits[hits.length - 1];
  if (!last) return null;
  let lines = splitLines(body);
  for (const h of [...hits].sort((a, b) => b.line - a.line)) lines = dropRange(lines, h.line - 1, h.line - 1);
  return { body: lines.join("\n"), dir: last.dir };
}

/* ------------------------------------------------------------ growing and restructuring a mindmap */

/**
 * One topic line as the parser reads it: where it is, how deep, and which topic it hangs from.
 *
 * The parent is found the way `parseMindmap` finds it — pop everything at least as deep, take what
 * is left — so a file that mixes tabs and spaces, or indents by three, gives the answer the page
 * draws rather than the one a fixed two-space grid would. Lines are 1-based, which is what every
 * other writer here takes.
 */
interface TopicRow {
  line: number;
  depth: number;
  parent: number | null;
}

function topicRows(lines: string[]): TopicRow[] {
  const rows: TopicRow[] = [];
  const stack: TopicRow[] = [];
  lines.forEach((text, i) => {
    if (!topicLine(text)) return;
    const depth = depthOf(text);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const row: TopicRow = { line: i + 1, depth, parent: stack[stack.length - 1]?.line ?? null };
    rows.push(row);
    stack.push(row);
  });
  return rows;
}

/** One level of indent, in whatever the author used: a tab if their tree has one, else two spaces. */
const unitOf = (lines: string[]): string => (lines.some((l) => topicLine(l) && indentOf(l).includes("\t")) ? "\t" : "  ");

/** The topic's parent line, or `null` for the top of the tree — and for a line that is not a topic. */
export function topicParent(body: string, line: number): number | null {
  return topicRows(splitLines(body)).find((r) => r.line === line)?.parent ?? null;
}

/** What a topic can be asked to do, so a control can be offered only where it would act. */
export interface TopicMoves {
  /** A child is always possible: the tree has no limit on how wide a topic grows. */
  child: boolean;
  /** The top of the tree has no siblings — a second line at depth 0 would be a second root. */
  sibling: boolean;
  /** Under the sibling just above it, which is the only thing "indent" can mean in a tree. */
  indent: boolean;
  /** Out to the parent's level. Not from directly under the root, which would make a second one. */
  outdent: boolean;
  up: boolean;
  down: boolean;
  /** Everything but the top, which already is one. */
  root: boolean;
}

export function topicMoves(body: string, line: number): TopicMoves {
  const rows = topicRows(splitLines(body));
  const at = rows.find((r) => r.line === line);
  if (!at) return { child: false, sibling: false, indent: false, outdent: false, up: false, down: false, root: false };
  const sibs = rows.filter((r) => r.parent === at.parent);
  const i = sibs.indexOf(at);
  const parent = rows.find((r) => r.line === at.parent);
  return {
    child: true,
    sibling: at.parent !== null,
    indent: at.parent !== null && i > 0,
    outdent: parent !== undefined && parent.parent !== null,
    up: at.parent !== null && i > 0,
    down: at.parent !== null && i < sibs.length - 1,
    root: at.parent !== null,
  };
}

/**
 * A new topic: the last child of the one on `line`, or the sibling right after it and its subtree.
 *
 * It goes **after** everything the topic holds, so a sibling lands where an outliner puts one — below
 * the whole branch, not between a parent and its first child — and a child joins the end of the
 * family. The indent is the one the neighbours already use (the first child's, or one level past the
 * parent), so a file written with tabs or with four spaces stays that way.
 *
 * Returns the new line's number alongside the body, because a topic has no id to hand back: the
 * parser numbers them as it reads, so the caller finds the new one by parsing and asking for that
 * line. `null` for a sibling of the top of the tree (that would be a second root) or a line that is
 * not a topic.
 */
export function addTopic(body: string, line: number, as: "child" | "sibling", text = "New topic"): TopicEdit | null {
  const lines = splitLines(body);
  const rows = topicRows(lines);
  const at = rows.find((r) => r.line === line);
  if (!at) return null;
  if (as === "sibling" && at.parent === null) return null;

  const own = indentOf(lines[line - 1]!);
  const first = rows.find((r) => r.parent === line);
  const indent = as === "sibling" ? own : first ? indentOf(lines[first.line - 1]!) : own + unitOf(lines);
  const end = topicSpan(body, line).to;
  return { body: [...lines.slice(0, end), `${indent}${text}`, ...lines.slice(end)].join("\n"), line: end + 1 };
}

/** A topic edit's answer: the new body, and the line the topic that was acted on now sits on. */
export interface TopicEdit {
  body: string;
  line: number;
}

/**
 * Lines `s` moved to sit before the original line index `at`, re-indented so the topic starts at
 * `indent`. `at` is an index into the lines as they are *now*; the cut shifts what follows it, and
 * that arithmetic is done here once rather than by every caller.
 */
function relocate(lines: string[], s: { from: number; to: number }, at: number, indent: string): TopicEdit {
  const delta = indent.replace(/\t/g, "  ").length - depthOf(lines[s.from - 1] ?? "");
  const moved = lines
    .slice(s.from - 1, s.to)
    .map((l) =>
      l.trim() === "" || delta === 0 ? l : delta > 0 ? " ".repeat(delta) + l : l.slice(Math.min(-delta, indentOf(l).length)),
    );
  const rest = [...lines.slice(0, s.from - 1), ...lines.slice(s.to)];
  const to = at >= s.to ? at - moved.length : at;
  rest.splice(to, 0, ...moved);
  return { body: rest.join("\n"), line: to + 1 };
}

/**
 * Outdent: the topic and its subtree leave their parent and sit right after it, one level out.
 *
 * Siblings that were below it stay where they were, under the old parent — the plain reading of
 * "move this one out", and the one a person can predict. `null` for the top of the tree and for a
 * child of the top, because the level above that is depth 0 and a mindmap has one root.
 */
export function outdentTopic(body: string, line: number): TopicEdit | null {
  const lines = splitLines(body);
  const rows = topicRows(lines);
  const at = rows.find((r) => r.line === line);
  const parent = rows.find((r) => r.line === at?.parent);
  if (!at || !parent || parent.parent === null) return null;
  return relocate(lines, topicSpan(body, line), topicSpan(body, parent.line).to, indentOf(lines[parent.line - 1]!));
}

/** Indent: the topic and its subtree become the last children of the sibling just above them. */
export function indentTopic(body: string, line: number): TopicEdit | null {
  const lines = splitLines(body);
  const rows = topicRows(lines);
  const at = rows.find((r) => r.line === line);
  if (!at || at.parent === null) return null;
  const sibs = rows.filter((r) => r.parent === at.parent);
  const prev = sibs[sibs.indexOf(at) - 1];
  if (!prev) return null;
  const first = rows.find((r) => r.parent === prev.line);
  const indent = first ? indentOf(lines[first.line - 1]!) : indentOf(lines[prev.line - 1]!) + unitOf(lines);
  return relocate(lines, topicSpan(body, line), topicSpan(body, prev.line).to, indent);
}

/** Swap a topic, with its subtree, past the sibling above (`-1`) or below (`1`). */
export function shiftTopic(body: string, line: number, by: -1 | 1): TopicEdit | null {
  const lines = splitLines(body);
  const rows = topicRows(lines);
  const at = rows.find((r) => r.line === line);
  if (!at || at.parent === null) return null;
  const sibs = rows.filter((r) => r.parent === at.parent);
  const next = sibs[sibs.indexOf(at) + by];
  if (!next) return null;
  const indent = indentOf(lines[next.line - 1]!);
  const to = by < 0 ? next.line - 1 : topicSpan(body, next.line).to;
  return relocate(lines, topicSpan(body, line), to, indent);
}

/**
 * Make a topic the root: the tree is turned over so the topic is the top and everything that was
 * above it hangs below it.
 *
 * What "root" means in a tree written as indentation is *the line at depth 0*, so choosing a new one
 * is re-hanging the tree from it. The topic keeps its own children, and its old parent becomes one
 * more of them — with its other children under it, and its old parent after those, and so on up to
 * the old top. Nothing is lost and no topic changes its text; the `root` word moves from the old top
 * to the new one, because it names the topic the drawing hangs from.
 *
 * The whole tree is written out again at one indent unit, which is the one place a writer here
 * touches lines it was not pointed at: depth *is* the indent, and a branch that changed parent has a
 * new depth whatever the author typed. A comment or blank line travels with the topic that follows
 * it. Lines outside the tree (above its top, or after its last topic) are not touched.
 */
export function makeRoot(body: string, line: number): TopicEdit | null {
  const lines = splitLines(body);
  const rows = topicRows(lines);
  const at = rows.find((r) => r.line === line);
  if (!at || at.parent === null) return null;

  const chain: TopicRow[] = [];
  for (let r: TopicRow | undefined = at; r; r = rows.find((x) => x.line === r!.parent)) chain.push(r);
  const top = chain[chain.length - 1]!;
  const range = topicSpan(body, top.line);

  /* A comment or blank is the lead of the topic that follows it, so it stays attached to it when
     the topics are reordered. Whatever precedes the top, or trails the last topic, is outside the
     range and is never read. */
  const lead = new Map<number, string[]>();
  let carry: string[] = [];
  for (let n = top.line; n <= range.to; n++) {
    if (topicLine(lines[n - 1])) {
      lead.set(n, carry);
      carry = [];
    } else carry.push(lines[n - 1]!);
  }

  const kids = new Map<number, number[]>();
  for (const r of rows) if (r.parent !== null) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r.line]);
  const next = (n: number): number[] => {
    const i = chain.findIndex((c) => c.line === n);
    if (i === -1) return kids.get(n) ?? [];
    const was = chain[i - 1]?.line;
    const up = chain[i + 1]?.line;
    return [...(kids.get(n) ?? []).filter((k) => k !== was), ...(up === undefined ? [] : [up])];
  };

  const unit = unitOf(lines);
  const out: string[] = [];
  const emit = (n: number, depth: number): void => {
    out.push(...(lead.get(n) ?? []));
    const text = lines[n - 1]!.trim();
    /* Only the two lines that change role touch the word: a deeper topic that merely starts with
       "root" (a root-cause analysis) is the author's text and stays exactly as written. */
    const bare = n === line || n === top.line ? text.replace(/^root\b\s*/, "") || text : text;
    out.push(unit.repeat(depth) + (n === line ? `root ${bare}` : bare));
    for (const k of next(n)) emit(k, depth + 1);
  };
  emit(line, 0);

  return {
    body: [...lines.slice(0, top.line - 1), ...out, ...lines.slice(range.to)].join("\n"),
    line: top.line + (lead.get(line)?.length ?? 0),
  };
}

/* ------------------------------------------------------------------------------ the chart */

/**
 * Writing a chart's statements.
 *
 * The data lines — `series` and `slice` — are `<kind> <id> "Label" …`, deliberately, so every writer
 * above already covers them: `setTitle` retitles one, `setModifier("hue")` recolours it, `setKind`
 * turns a slice into a series, `removeNode` deletes it, `moveStatement` reorders it. What none of
 * them can write is the run of *numbers*, and the statements a chart has that no other dialect does:
 * its form, its two flags, its four options and its categories.
 *
 * Those five are the only writers here that take a **body** rather than a line, and the reason is
 * that they are statements a chart has at most one of. There is nothing for a caller to point at
 * when the line does not exist yet, so each finds its own or writes one — after the form line, which
 * is the shape every chart body already has.
 *
 * Total like everything else in this file: handed something it cannot read, each hands the body back
 * exactly as it was.
 */

/** Where the values are on a `series`/`slice` line: the run of value words after the strings. */
function valueRun(line: string): { span: [number, number] | null; at: number } | null {
  const tokens = lineTokens(line);
  const id = idIndex(tokens);
  if (id === -1) return null;
  if (tokens.some((t) => t.kind === "arrow")) return null;

  let i = id + 1;
  while (i < tokens.length && tokens[i]!.kind === "string") i++;
  /* Where a first value would go: after the last string, or after the id when there is none. */
  const at = span(tokens[i - 1] ?? tokens[id]!)[1];

  const from = i;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind !== "word") break;
    /* A word before an `=` is a modifier key, and the run has ended: `hue=coral` and the author's
       trailing comment are what this whole shape exists to leave alone. */
    if (tokens[i + 1]?.kind === "punct" && tokens[i + 1]!.value === "=") break;
    i++;
  }
  if (i === from) return { span: null, at };
  return { span: [span(tokens[from]!)[0], span(tokens[i - 1]!)[1]], at };
}

/** How a value is written back: `-` is a gap, and nothing else is anything but a number. */
const valueText = (values: readonly (number | null)[]): string => values.map((v) => (v === null ? "-" : String(v))).join(" ");

/**
 * Rewrite the run of values on one `series` or `slice` statement.
 *
 * The run is found through the tokenizer and replaced as one span, so everything on either side of
 * it survives exactly as written — the id, the quoting of the label, a trailing `hue=coral`, and the
 * author's `%%` comment at the end of the line. An empty list takes the run off altogether.
 */
export function setValues(line: string, values: readonly (number | null)[]): string {
  const run = valueRun(line);
  if (!run) return line;
  if (values.length === 0) return run.span ? cut(line, run.span) : line;
  const text = valueText(values);
  return run.span ? replaceSpan(line, run.span, text) : splice(line, run.at, text);
}

/**
 * That same run, as the author wrote it — the inverse of `setValues`.
 *
 * Here for the reason `rowLines` is here: the panel has to show what is on the line, and a second
 * reader of it would be a regular expression that disagrees with the writer the first time somebody
 * writes `icon="two words"` before the numbers. The *parse* is not the answer either — `parseChart`
 * pads a short series out to the categories, so it reports gaps nobody typed.
 */
export function valuesText(line: string): string {
  const run = valueRun(line);
  return run?.span ? line.slice(run.span[0], run.span[1]) : "";
}

/** The 1-based line of the first statement whose head word is one of `words`, or 0. */
function headLine(body: string, words: ReadonlySet<string>): number {
  const by = tokensByLine(body);
  for (const line of [...by.keys()].sort((a, b) => a - b)) {
    const first = by.get(line)![0];
    if (first?.kind === "word" && words.has(first.value)) return line;
  }
  return 0;
}

const FORM_WORDS: ReadonlySet<string> = new Set<string>(FORMS);

/**
 * Set the chart's form, writing the line if there is none.
 *
 * A new form line goes **first**, because that is where every chart body in the documentation and
 * the library puts it, and because the form is the one thing a reader wants to know before the data.
 */
export function setChartForm(body: string, form: ChartForm): string {
  const line = headLine(body, FORM_WORDS);
  if (line === 0) return body.trim() === "" ? `${form}\n` : `${form}\n${body}`;
  const tokens = lineTokens(splitLines(body)[line - 1]!);
  return replaceLine(body, line, replaceSpan(splitLines(body)[line - 1]!, span(tokens[0]!), form));
}

/**
 * `stacked` / `horizontal`, on or off.
 *
 * They live on the form line rather than on one of their own, so turning the last one off leaves
 * `bar` standing — the line still says which shape this is. Turning one on with no form line writes
 * `bar <flag>`, which is what the chart was already drawing.
 */
export function setChartFlag(body: string, flag: "stacked" | "horizontal", on: boolean): string {
  const line = headLine(body, FORM_WORDS);
  if (line === 0) return on ? setChartFlag(setChartForm(body, "bar"), flag, true) : body;
  const text = splitLines(body)[line - 1]!;
  const tokens = lineTokens(text);
  /* From index 1: token 0 is the form word, and `bar` is not a flag however much it looks like one. */
  const had = tokens.slice(1).find((t) => t.kind === "word" && t.value === flag);
  if (on) return had ? body : replaceLine(body, line, splice(text, insertAt(text, tokens), flag));
  return had ? replaceLine(body, line, cut(text, span(had))) : body;
}

/**
 * One of the chart's single-statement options, or `null` to take the statement away.
 *
 * `values` is on the list even though it carries no value: it is a bare-word statement whose
 * *presence* is the setting, so `true` writes the line and `null` — or `false`, which is what a
 * checkbox hands you — removes it. The other four take one token after the key, and `unit` is the
 * only one quoted: a suffix is free text, and `k€` is not a word the tokenizer would give back
 * whole.
 */
export function setChartOption(
  body: string,
  key: "legend" | "unit" | "min" | "max" | "values",
  value: string | number | boolean | null,
): string {
  /* `legend` is two statements that share a head word, and this writes the placement one: a key row
     (`legend solid "…"`) written earlier in the body must not be what a change of placement finds. */
  const line = key === "legend" ? (legendLines(body).find((l) => !l.glyph)?.line ?? 0) : headLine(body, new Set([key]));

  if (value === null || value === false) {
    if (line === 0) return body;
    return dropRange(splitLines(body), line - 1, line - 1).join("\n");
  }

  const text = key === "values" ? "values" : `${key} ${key === "unit" ? JSON.stringify(String(value)) : String(value)}`;
  if (line === 0) {
    /* After the form line, which is where a reader looks for the chart's own settings; at the end
       when there is none, because appending is the only honest guess left. */
    const lines = splitLines(body);
    const form = headLine(body, FORM_WORDS);
    if (form === 0) return body.trim() === "" ? `${text}\n` : `${body.replace(/\n*$/, "")}\n${text}\n`;
    return [...lines.slice(0, form), text, ...lines.slice(form)].join("\n");
  }

  const had = splitLines(body)[line - 1]!;
  const tokens = lineTokens(had);
  if (tokens.length === 0) return body;
  /* Replace from the end of the key word to the end of the last token, so the indent in front of it
     and any `%%` comment behind it are both left exactly where they were. */
  const from = span(tokens[0]!)[1];
  const to = span(tokens[tokens.length - 1]!)[1];
  const rest = key === "values" ? "" : text.slice(key.length);
  return replaceLine(body, line, replaceSpan(had, [from, Math.max(from, to)], rest));
}

/**
 * The `x` line: the chart's categories, in order.
 *
 * A label is written bare when the tokenizer would read it back as one word and quoted when it would
 * not — which is the same rule `writeModifier` applies to a value, one grammar up. An empty list
 * takes the line away: no categories is a legitimate chart (the ticks come out `1…n`), and a bare
 * `x` with nothing after it is not something the grammar should be made to mean.
 */
export function setCategories(body: string, labels: readonly string[]): string {
  const line = headLine(body, new Set(["x"]));

  if (labels.length === 0) {
    if (line === 0) return body;
    return dropRange(splitLines(body), line - 1, line - 1).join("\n");
  }

  const text = `x ${labels.map((l) => (BARE_LABEL.test(l) ? l : JSON.stringify(l))).join(" ")}`;
  if (line === 0) {
    const lines = splitLines(body);
    const form = headLine(body, FORM_WORDS);
    if (form === 0) return body.trim() === "" ? `${text}\n` : `${text}\n${body}`;
    return [...lines.slice(0, form), text, ...lines.slice(form)].join("\n");
  }

  const had = splitLines(body)[line - 1]!;
  const tokens = lineTokens(had);
  const to = span(tokens[tokens.length - 1] ?? tokens[0]!)[1];
  return replaceLine(body, line, replaceSpan(had, [span(tokens[0]!)[0], to], text));
}

/** The tokenizer's own word shape: a label matching it round-trips bare, and nothing else does. */
const BARE_LABEL = /^[A-Za-z0-9_*+\-][A-Za-z0-9_.\-/+]*$/;

/* ------------------------------------------------------------------ the centre, the key, the data */

/**
 * Every `legend` statement of a body, and which of its two meanings each is.
 *
 * `legend bottom` places the key and `legend solid "in sync"` adds a row to it; the grammar tells
 * them apart by whether a string follows the second word, and so does this, off the tokens rather
 * than a regular expression.
 */
function legendLines(body: string): { line: number; glyph: boolean }[] {
  const by = tokensByLine(body);
  const out: { line: number; glyph: boolean }[] = [];
  for (const line of [...by.keys()].sort((a, b) => a - b)) {
    const t = by.get(line)!;
    if (t[0]?.kind !== "word" || t[0].value !== "legend") continue;
    out.push({ line, glyph: t[1]?.kind === "word" && t[2]?.kind === "string" });
  }
  return out;
}

/** A line to put a new chart-level statement on: straight after the form line, else last. */
function insertAfterForm(body: string, text: string): string {
  const form = headLine(body, FORM_WORDS);
  if (form === 0) return body.trim() === "" ? `${text}\n` : `${body.replace(/\n*$/, "")}\n${text}\n`;
  const lines = splitLines(body);
  return [...lines.slice(0, form), text, ...lines.slice(form)].join("\n");
}

/**
 * A donut's hero — the number in its hole and the word under it — or `null` to take it away.
 *
 * It lives on the form line, as strings beside the flags, so the writer swaps only the strings and
 * leaves the form word, a `%%` comment and any flag exactly where they stood. With no form line the
 * body is a `bar`, which has no hole, so there is nothing to write and the body comes back as it
 * was. A caption without a figure is not a thing the grammar has: an empty figure takes both.
 */
export function setChartHero(body: string, hero: { value: string; label?: string } | null): string {
  const line = headLine(body, FORM_WORDS);
  if (line === 0) return body;
  const text = splitLines(body)[line - 1]!;
  const tokens = lineTokens(text);
  const strings = tokens.filter((t) => t.kind === "string");
  const value = hero?.value.trim() ?? "";
  const label = hero?.label?.trim() ?? "";
  const written = value === "" ? "" : [value, ...(label === "" ? [] : [label])].map((v) => JSON.stringify(v)).join(" ");

  let next = text;
  /* From the end, so the spans of the strings still to come stay where the tokenizer put them. */
  for (let i = strings.length - 1; i >= 0; i--) {
    next = i === 0 && written !== "" ? replaceSpan(next, span(strings[0]!), written) : cut(next, span(strings[i]!));
  }
  if (strings.length === 0 && written !== "") next = splice(next, insertAt(next, lineTokens(next)), written);
  return replaceLine(body, line, next);
}

/** The key rows of a chart — its `legend <glyph> "text"` statements — in the order they were written. */
export function chartKeyRows(body: string): { glyph: string; text: string }[] {
  const by = tokensByLine(body);
  return legendLines(body)
    .filter((l) => l.glyph)
    .map((l) => ({ glyph: by.get(l.line)![1]!.value, text: by.get(l.line)![2]!.value }));
}

/**
 * The chart's key rows, replaced by `rows`.
 *
 * Rewritten in place and in order: the first row takes the first `legend <glyph> "…"` line, so a
 * trailing comment on it survives; surplus lines go, and rows past the existing ones are written
 * after the last of them (after the form line when there is none). A row whose glyph is not one
 * word, or whose text is empty, is not a statement the grammar can read back, so it is dropped.
 */
export function setChartKeyRows(body: string, rows: readonly { glyph: string; text: string }[]): string {
  const wanted = rows.filter((r) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(r.glyph) && r.text.trim() !== "");
  const row = (r: { glyph: string; text: string }) => `${r.glyph} ${JSON.stringify(r.text.trim())}`;
  const had = legendLines(body).filter((l) => l.glyph);
  let out = body;

  /* Last first, so removing a line never moves one still to be rewritten. */
  for (let i = had.length - 1; i >= 0; i--) {
    const line = had[i]!.line;
    if (i >= wanted.length) {
      out = dropRange(splitLines(out), line - 1, line - 1).join("\n");
      continue;
    }
    const text = splitLines(out)[line - 1]!;
    const tokens = lineTokens(text);
    out = replaceLine(out, line, replaceSpan(text, [span(tokens[1]!)[0], span(tokens[2]!)[1]], row(wanted[i]!)));
  }

  for (let i = had.length; i < wanted.length; i++) {
    const last = legendLines(out)
      .filter((l) => l.glyph)
      .at(-1);
    if (!last) {
      out = insertAfterForm(out, `legend ${row(wanted[i]!)}`);
      continue;
    }
    const lines = splitLines(out);
    out = [...lines.slice(0, last.line), `legend ${row(wanted[i]!)}`, ...lines.slice(last.line)].join("\n");
  }
  return out;
}

/** Every series and slice id a chart body declares, in declaration order. */
function chartIds(body: string): string[] {
  const model = parseChart(body);
  return [...model.series, ...model.slices].sort((a, b) => a.line - b.line).map((d) => d.id);
}

/**
 * A new `series` or a new `slice`, written after the last one the chart has, and the id it was given.
 *
 * The id is the kind word with the next free number (`series2`, `slice3`) and the label says the
 * same in words, because both have to exist before a person can retype either. A series gets one `1`
 * per category — a bar, a point, a wedge that is there to be seen and picked, where a zero draws
 * nothing — and a slice its one. No `hue=`: the next unused colour in the theme's list is the
 * default, and writing one would pin it.
 */
export function addChartData(body: string, kind: "series" | "slice"): { body: string; id: string } {
  const model = parseChart(body);
  const taken = new Set(chartIds(body));
  let n = 1;
  while (taken.has(`${kind}${n}`) && n < 1000) n++;
  const id = `${kind}${n}`;
  const count = Math.max(model.categories.length, ...model.series.map((s) => s.values.length), 1);
  const values = kind === "slice" ? "1" : Array.from({ length: count }, () => "1").join(" ");
  const text = `${kind} ${id} "${kind === "series" ? "Series" : "Slice"} ${n}" ${values}`;

  const last = [...model.series, ...model.slices].reduce((m, d) => Math.max(m, d.line), 0);
  if (last === 0) return { body: insertAfterForm(body, text), id };
  /* After the whole statement: a series line is one line, but the line may be followed by a block. */
  const to = statementSpan(body, last).to;
  const lines = splitLines(body);
  return { body: [...lines.slice(0, to), text, ...lines.slice(to)].join("\n"), id };
}

/** Why `to` cannot be the id of the series or slice `from`, or `null` when it can. */
export function chartIdProblem(body: string, from: string, to: string): string | null {
  if (to === from) return null;
  if (to === "") return "an id cannot be empty";
  /* No dot: `chart.web` is an item and the series on it, so the id is the part after the last one. */
  if (!/^[A-Za-z0-9_-]+$/.test(to)) return "an id is letters, digits, `-` and `_`";
  if (chartIds(body).includes(to)) return `\`${to}\` is already a series or a slice on this chart`;
  return null;
}

/**
 * Change one series' or slice's id.
 *
 * Only the declaration is written, deliberately not `renameId`: that renames every *word* equal to
 * the id, and in a chart a word is also a category — `x web mobile` beside `series web "Web"` would
 * lose a column header. A chart's body names an id nowhere but where it declares it, so the one
 * token is the whole of "every reference in the fence". Anything refused (see `chartIdProblem`)
 * hands the body back untouched.
 */
export function renameChartId(body: string, from: string, to: string): string {
  if (to === from || chartIdProblem(body, from, to) !== null) return body;
  const model = parseChart(body);
  const at = [...model.series, ...model.slices].find((d) => d.id === from);
  if (!at) return body;
  const text = splitLines(body)[at.line - 1]!;
  const tokens = lineTokens(text);
  const id = idIndex(tokens);
  if (id === -1 || tokens[id]!.value !== from) return body;
  return replaceLine(body, at.line, replaceSpan(text, span(tokens[id]!), to));
}
