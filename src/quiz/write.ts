/**
 * Writing a quiz, one question at a time.
 *
 * **A write touches the question it is about and no other byte.** Every writer here finds its
 * question's span by parsing the text it is handed — never a span remembered from earlier, which is
 * one keystroke stale the moment the other writer has saved — and splices. A question that is
 * rewritten comes back in the house form (`renderQuestion`); every other question keeps the bytes an
 * author or an agent gave it, their wrapping, their `*` bullets and their spacing included.
 * `test/quiz-format.test.ts` holds that through every writer.
 *
 * **A rewrite that means nothing is not a write.** `replaceQuestion` compares what it was given
 * with what the file already says, and a question whose meaning is unchanged keeps its bytes — so
 * a field focused and left, or a draft that round-trips, never reformats an author's question.
 */
import { withKeys } from "../note/task";
import { optionMarkdown, parseQuiz, type Question, type Quiz } from "./parse";

/** What a question says, as the editor holds it. `multi` is the effective answer, not the flag. */
export interface QuestionInput {
  id?: string;
  prompt: string;
  body?: string;
  /** `pin` is `{pin}`: the option keeps its place when a run shuffles them. */
  options: { text: string; correct: boolean; pin?: boolean }[];
  why?: string;
  multi?: boolean;
}

/** The id alphabet the store uses (`store/ids.py`): no `i`, `l`, `o` or `u` to misread. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A fresh question id: `q` and six characters, none of `taken`. */
export function mintQuestionId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    const id = "q" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!taken.has(id)) return id;
  }
}

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, " ").trim();

/**
 * A prompt as its heading line writes it: one line, and escaped where the heading's own syntax would
 * read it back as something else — a closing `#` run would be dropped, and a trailing `{…}` of bare
 * words would be taken for the question's attributes. A person typing *Learn C #* or *Fill in
 * {name}* into the form means the words. Already-escaped text is left as it is, so the file's form
 * of a prompt passes through unchanged and `sameQuestion` still compares like with like.
 */
export function promptLine(prompt: string): string {
  let line = oneLine(prompt);
  line = line.replace(/(^|[ \t])(#+)([ \t]*)$/, (_m, lead: string, hashes: string, tail: string) => `${lead}\\${hashes}${tail}`);
  line = line.replace(/(?<!\\)\{([^{}]*)\}([ \t]*)$/, (m, words: string, tail: string) =>
    words
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => /^#?[A-Za-z0-9_-]+$/.test(w))
      ? `\\{${words}}${tail}`
      : m,
  );
  return line.trim();
}

/** An option's text as the file holds it: `optionMarkdown`, and a first line ending in `{pin}` escaped, since that is the words. */
function optionLine(text: string): string {
  const md = optionMarkdown(text);
  const nl = md.indexOf("\n");
  const first = nl < 0 ? md : md.slice(0, nl);
  const escaped = first.replace(/(?<!\\)\{pin\}([ \t]*)$/, "\\{pin}$1");
  return escaped + (nl < 0 ? "" : md.slice(nl));
}

/** Blank lines off both ends, nothing else — an author's indentation inside is theirs. */
const trimBlank = (s: string): string =>
  s
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "")
    .replace(/^[ \t]+$/, "");

/** A first line that opens a block: written on a line of its own, or it would be the task's words. */
const OPENS_BLOCK = /^(?:`{3,}|~{3,}|[-*+][ \t]|\d+[.)][ \t]|>|#{1,6}(?:[ \t]|$)|\|)/;

/**
 * One option in the house form: `- [x] ` and its first line, and the rest indented two — the
 * content indent, where every reader of the file puts them back.
 */
function renderOption(o: { text: string; correct: boolean; pin?: boolean }): string {
  const lines = optionLine(o.text).split("\n");
  const own = lines.length > 1 && OPENS_BLOCK.test(lines[0]!);
  const first = own ? "" : lines[0]!;
  const head = `- [${o.correct ? "x" : " "}]${first ? ` ${first}` : ""}${o.pin ? " {pin}" : ""}`;
  const rest = (own ? lines : lines.slice(1)).map((l) => (l ? `  ${l}` : ""));
  return [head, ...rest].join("\n");
}

/** The heading's `{…}`: the id, and `multi` only where the count of ticks does not already say it. */
function attrsOf(q: QuestionInput): string {
  const correct = q.options.filter((o) => o.correct).length;
  const words = [q.id ? `#${q.id}` : "", q.multi && correct < 2 ? "multi" : ""].filter(Boolean);
  return words.length ? ` {${words.join(" ")}}` : "";
}

/** One question in the house form, ending in a newline. */
export function renderQuestion(q: QuestionInput): string {
  const parts = [`## ${promptLine(q.prompt)}${attrsOf(q)}`];
  const body = trimBlank(q.body ?? "");
  if (body) parts.push(body);
  if (q.options.length) parts.push(q.options.map(renderOption).join("\n"));
  const why = trimBlank(q.why ?? "");
  if (why)
    parts.push(
      why
        .split(/\r?\n/)
        .map((l) => (l.trim() ? `> ${l}` : ">"))
        .join("\n"),
    );
  return parts.join("\n\n") + "\n";
}

/** A parsed question as the editor holds it. */
export function inputOf(q: Question): QuestionInput {
  return {
    ...(q.id !== undefined ? { id: q.id } : {}),
    prompt: q.prompt,
    body: q.body,
    options: q.options.map((o) => ({ text: o.text, correct: o.correct, ...(o.pin ? { pin: true } : {}) })),
    why: q.why,
    multi: q.multi,
  };
}

/** Whether `input` says what `q` already says — the test that keeps an author's bytes. */
export function sameQuestion(q: Question, input: QuestionInput): boolean {
  const correct = input.options.filter((o) => o.correct).length;
  return (
    q.id === input.id &&
    q.prompt === promptLine(input.prompt) &&
    q.body === trimBlank(input.body ?? "") &&
    q.why === trimBlank(input.why ?? "") &&
    q.multi === (!!input.multi || correct > 1) &&
    q.options.length === input.options.length &&
    q.options.every(
      (o, i) =>
        o.text === optionLine(input.options[i]!.text) &&
        o.correct === input.options[i]!.correct &&
        o.pin === !!input.options[i]!.pin,
    )
  );
}

function find(quiz: Quiz, id: string): number {
  const i = quiz.questions.findIndex((q) => q.id === id);
  if (i < 0) throw new Error(`no question \`${id}\` in this quiz`);
  return i;
}

/** The text with question `id` saying `input` instead, or the text itself when that changes nothing. */
export function replaceQuestion(text: string, id: string, input: QuestionInput): string {
  const quiz = parseQuiz(text);
  const q = quiz.questions[find(quiz, id)]!;
  if (sameQuestion(q, input)) return text;
  const rendered = renderQuestion(input);
  /* A question that ended the file without a newline keeps not having one, so the diff is its lines. */
  const tail = q.span.end === text.length && !text.endsWith("\n") ? rendered.slice(0, -1) : rendered;
  return text.slice(0, q.span.start) + tail + text.slice(q.span.end);
}

/** The text ending in exactly one newline, with one blank line before whatever is appended. */
const openEnd = (text: string): string => (text.trim() ? `${text.replace(/\s+$/, "")}\n\n` : "");

/**
 * The text with a question added: before the question at `at`, or after the last when `at` is out
 * of range or absent. The gap before the next question is the one blank line the house form uses.
 */
export function addQuestion(text: string, input: QuestionInput, at?: number): string {
  const quiz = parseQuiz(text);
  const rendered = renderQuestion(input);
  const before = at === undefined ? undefined : quiz.questions[at];
  if (before) return text.slice(0, before.span.start) + rendered + "\n" + text.slice(before.span.start);
  return openEnd(text) + rendered;
}

/** Past the blank lines that start at `from`. */
function skipBlank(text: string, from: number): number {
  const m = /^(?:[ \t]*\r?\n)*/.exec(text.slice(from));
  return from + (m ? m[0].length : 0);
}

/** The text without question `id`, and without the blank lines that separated it. */
export function removeQuestion(text: string, id: string): string {
  const quiz = parseQuiz(text);
  const i = find(quiz, id);
  const q = quiz.questions[i]!;
  const next = quiz.questions[i + 1];
  if (next) return text.slice(0, q.span.start) + text.slice(next.span.start);
  const rest = text.slice(skipBlank(text, q.span.end));
  const head = text.slice(0, q.span.start).replace(/(?:\r?\n[ \t]*)+$/, "\n");
  return head + rest;
}

/**
 * The text with question `id` moved to index `to`. The blank lines between questions stay where
 * they were and the questions move through them, so nothing but the order changes.
 */
export function moveQuestion(text: string, id: string, to: number): string {
  const quiz = parseQuiz(text);
  const from = find(quiz, id);
  const qs = quiz.questions;
  const target = Math.max(0, Math.min(qs.length - 1, to));
  if (target === from) return text;
  const bodies = qs.map((q) => text.slice(q.span.start, q.span.end));
  const gaps = qs.map((q, i) => text.slice(q.span.end, i + 1 < qs.length ? qs[i + 1]!.span.start : text.length));
  const order = qs.map((_, i) => i);
  order.splice(target, 0, ...order.splice(from, 1));
  let out = text.slice(0, qs[0]!.span.start);
  order.forEach((k, i) => {
    const body = bodies[k]!;
    const last = i === order.length - 1;
    out += (!last && !body.endsWith("\n") ? body + "\n" : body) + (gaps[i] === "" && !last ? "\n" : gaps[i]!);
  });
  return out;
}

/**
 * Every question given an id it lacks, on its heading line and nowhere else. Returns the text and
 * the ids minted, in file order. The heading is rewritten in the house form because that is the only
 * way to be sure the id lands inside the `{…}` a reader will find — a closing `##` would hide it.
 */
export function stampIds(
  text: string,
  mint: (taken: ReadonlySet<string>) => string = mintQuestionId,
): { text: string; minted: string[] } {
  const quiz = parseQuiz(text);
  const taken = new Set(quiz.questions.flatMap((q) => (q.id ? [q.id] : [])));
  const minted: string[] = [];
  let out = text;
  for (const q of [...quiz.questions].reverse()) {
    if (q.id !== undefined) continue;
    const id = mint(taken);
    taken.add(id);
    minted.unshift(id);
    out = withHeading(out, q, [`#${id}`, q.multiFlag ? "multi" : ""]);
  }
  return { text: out, minted };
}

/** The text with question `q`'s heading line — and no other byte — saying its prompt and `words`. */
function withHeading(text: string, q: Question, words: string[]): string {
  const eol = text.indexOf("\n", q.span.start);
  const lineEnd = eol === -1 ? text.length : text[eol - 1] === "\r" ? eol - 1 : eol;
  const attrs = words.filter(Boolean).join(" ");
  return text.slice(0, q.span.start) + `## ${q.prompt}${attrs ? ` {${attrs}}` : ""}` + text.slice(lineEnd);
}

/*
 * Repairs. Each answers one problem the parser names, from the form, in place of a person editing
 * the file: the form has no source to send anybody to. Each touches one question — or, for an
 * unclosed fence, one line — and nothing else.
 */

/** The text with question `id` rewritten in the house form from `input`, even when that means nothing new — the repair's write. */
function rewrite(text: string, q: Question, input: QuestionInput): string {
  const rendered = renderQuestion(input);
  const tail = q.span.end === text.length && !text.endsWith("\n") ? rendered.slice(0, -1) : rendered;
  return text.slice(0, q.span.start) + tail + text.slice(q.span.end);
}

/** Lines that are all a quote, with their marks off; anything else as it is. */
function unquoted(md: string): string {
  const lines = md.split("\n");
  return lines.every((l) => !l.trim() || /^ {0,3}>/.test(l)) ? lines.map((l) => l.replace(/^ {0,3}> ?/, "")).join("\n") : md;
}

/**
 * The text with question `id`'s stray Markdown (`EQ_STRAY`) moved where the person said: into the
 * explanation, into the prompt's details above the options, or dropped.
 */
export function resolveStray(text: string, id: string, to: "why" | "body" | "drop"): string {
  const quiz = parseQuiz(text);
  const q = quiz.questions[find(quiz, id)]!;
  if (q.stray === undefined) return text;
  const input = inputOf(q);
  const join = (a: string | undefined, b: string) => [trimBlank(a ?? ""), b].filter(Boolean).join("\n\n");
  if (to === "why") input.why = join(input.why, unquoted(q.stray));
  else if (to === "body") input.body = join(input.body, q.stray);
  return rewrite(text, q, input);
}

/** The text with the question at `index` given an id of its own — the second of two sharing one (`EQ_DUPLICATE_ID`). */
export function reidQuestion(text: string, index: number, mint: (taken: ReadonlySet<string>) => string = mintQuestionId): string {
  const quiz = parseQuiz(text);
  const q = quiz.questions[index];
  if (!q) return text;
  const id = mint(new Set(quiz.questions.flatMap((x) => (x.id ? [x.id] : []))));
  return withHeading(text, q, [`#${id}`, q.multiFlag && !q.open ? "multi" : ""]);
}

/**
 * `fn` applied to the question at `index`, by its id. Every writer finds a question by id, so the
 * second of two sharing one (`EQ_DUPLICATE_ID`) would be found as the first, and a delete or a move
 * on it would act on the other question. Such a question is given an id of its own first. The text
 * must be stamped: a question with no id is left as it is.
 */
export function atQuestion(text: string, index: number, fn: (text: string, id: string) => string): string {
  const questions = parseQuiz(text).questions;
  const id = questions[index]?.id;
  if (id === undefined) return text;
  if (questions.findIndex((q) => q.id === id) === index) return fn(text, id);
  const own = reidQuestion(text, index);
  const fresh = parseQuiz(own).questions[index]?.id;
  return fresh === undefined ? text : fn(own, fresh);
}

/**
 * The text with question `id`'s heading saying only what a heading can — its id, and `multi` where a
 * question has options to choose between (`WQ_UNKNOWN_ATTR`).
 */
export function cleanHeading(text: string, id: string): string {
  const quiz = parseQuiz(text);
  const q = quiz.questions[find(quiz, id)]!;
  return withHeading(text, q, [`#${id}`, q.multiFlag && !q.open ? "multi" : ""]);
}

/**
 * The text with the code block opened on `line` (1-based, the file's) closed (`WQ_OPEN_FENCE`):
 * before the next line that would start a question had the block been closed, so the questions it
 * swallowed come back, or at the end when there is none.
 */
export function closeFence(text: string, line: number): string {
  const lines = text.split("\n");
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[line - 1] ?? "");
  if (!open) return text;
  const fence = `${lines[line - 1]!.match(/^ */)![0]}${open[1]}`;
  let at = lines.findIndex((l, i) => i >= line && /^ {0,3}##(?=[ \t]|$)/.test(l));
  if (at < 0) {
    const body = text.replace(/\s+$/, "");
    return `${body}\n${fence}\n`;
  }
  while (at > line && !lines[at - 1]!.trim()) at--;
  lines.splice(at, 0, fence);
  return lines.join("\n");
}

/** The text with its description — the prose before the first question — saying `md`. */
export function setDescription(text: string, md: string): string {
  const quiz = parseQuiz(text);
  const desc = trimBlank(md);
  if (desc === quiz.description) return text;
  const { start, end } = quiz.descriptionSpan;
  const more = quiz.questions.length > 0 || end < text.length;
  const lead = quiz.front ? "\n" : "";
  const replacement = desc ? `${lead}${desc}\n${more ? "\n" : ""}` : quiz.front && more ? "\n" : "";
  return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * The text with `shuffle: true` in its frontmatter, or without it — that one line, and no
 * other byte: `withKeys`, the task bar's writer.
 */
export function setShuffle(text: string, on: boolean): string {
  if (parseQuiz(text).shuffle === on) return text;
  return withKeys(text, { shuffle: on ? "true" : null }, ["shuffle"]);
}

/** A new quiz: a title and nothing else, which the editor opens on its empty state. */
export const blankQuizText = (title = "Untitled"): string => `---\ntitle: ${title}\n---\n`;
