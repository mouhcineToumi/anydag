/**
 * A quiz: `<name>.quiz.md`, the third kind of file.
 *
 *     ---
 *     title: Postgres internals
 *     ---
 *
 *     Anything before the first question is the quiz's description.
 *
 *     ## What does VACUUM reclaim? {#q7f3a2}
 *
 *     Anything between the heading and the options is the rest of the prompt.
 *
 *     - [ ] Index bloat only
 *     - [x] The space of dead tuples
 *
 *     > Optional: the explanation, shown once the question has been answered.
 *
 * **A question is a level-2 heading and everything up to the next one.** Only `##` delimits: a `#`
 * or a `###` inside a question is prose and belongs to it, and so is anything inside a fenced code
 * block — a `##` or a `- [ ]` in a code sample is code, which is why fences are tracked across the
 * whole file rather than per question. The options are the question's one GFM task list; a quote
 * after them is the explanation; anything else after them is `EQ_STRAY`, refused with its line
 * rather than guessed at.
 *
 * **An option is block Markdown**: a line indented under it continues it, the CommonMark
 * way — a wrapped line, a list, a fenced code block with blank lines in it — and the option's text is
 * those lines with their common indent taken off. One line is what it always was.
 *
 * **`shuffle: true` in the frontmatter shuffles each question's options for each run**,
 * except the pinned ones: an option ending in `{pin}`, or one that begins *All of the above*, *None
 * of the above*, *Both* or *Neither*. The order is a run's (`optionOrder`), never the file's.
 *
 * **A question with no checklist and a quote at its end is an open question**: the quote is
 * the model answer, which is its explanation too. The run asks for an answer in words, shows the model
 * one, and the person says whether they had it. No checklist and no quote is still `EQ_NO_OPTIONS`.
 *
 * **Every question knows its span**, so a writer (`write.ts`) can rewrite exactly one question and
 * leave every other byte of the file alone — the property a note's span map buys for BlockNote, and
 * cheaper here, because a question is its own span.
 *
 * **Held to one fixture**, `test/fixtures/quizzes.json` — the cases the hosted api's heading reader
 * was held to as well, kept because they are the clearest statement of where a question starts.
 *
 * No browser, no React, no `@/` aliases: the local server and the CLI import this verbatim.
 */
import type { QuizCode, QuizDiagnostic } from "./codes";

/** A range of the text, `[start, end)`, in string offsets. */
interface Span {
  start: number;
  end: number;
}

interface QuizOption {
  /**
   * Markdown: the option's first line, then every line that continues it with their common indent
   * taken off. One line for most options; a code block for some.
   */
  text: string;
  correct: boolean;
  /** `{pin}` written at the end of its first line: it keeps its place when the options shuffle. */
  pin: boolean;
  line: number;
}

export interface Question {
  /** `{#…}` on the heading; absent until something mints one (`WQ_NO_ID`). */
  id?: string;
  /** The heading's words, without its `{…}`. */
  prompt: string;
  /** Markdown between the heading and the options, trimmed of blank lines; `""` when there is none. */
  body: string;
  options: QuizOption[];
  /**
   * The explanation, with the quote marks taken off; `""` when there is none. On an open question it
   * is the model answer.
   */
  why: string;
  /** No options, and a quote at its end: answered in words and graded by the person. */
  open: boolean;
  /** `multi` written on the heading. */
  multiFlag: boolean;
  /** Whether it asks for every correct option: the flag, or more than one ticked. */
  multi: boolean;
  /** The heading's line. */
  line: number;
  /**
   * From the start of the heading line to the end of the question's last line that is not blank,
   * that line's newline included. The blank lines after it belong to nobody, which is what lets a
   * writer replace a question without touching the gap before the next one.
   */
  span: Span;
}

export interface Quiz {
  /** The frontmatter block, delimiters and newline included, or `""`. */
  front: string;
  /** Everything between the frontmatter and the first question, trimmed of blank lines. */
  description: string;
  /** Where the description sits: after the frontmatter, up to the first question or the end. */
  descriptionSpan: Span;
  questions: Question[];
  diagnostics: QuizDiagnostic[];
  /** `shuffle: true` in the frontmatter: a run shows each question's options in an order of its own. */
  shuffle: boolean;
}

/** The frontmatter pattern `splitNote`, `titleOf` and `taskOf` use: a block at the very start. */
const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** `##` and nothing more, then a space or the end of the line. Three spaces of indent, as CommonMark. */
const HEADING = /^ {0,3}##(?=[ \t]|$)(.*)$/;
/** CommonMark's closing sequence: `## Title ##`. It needs a space before it, or it is the title. */
const CLOSING = /(?:^|[ \t]+)#+[ \t]*$/;
/** A trailing `{…}` whose every word is `#id` or a bare word. Anything else is prompt text. */
const ATTRS = /[ \t]*\{([^{}]*)\}[ \t]*$/;
const ATTR_WORD = /^#?[A-Za-z0-9_-]+$/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const OPTION = /^ {0,3}[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*?))?[ \t]*$/;
const QUOTE = /^ {0,3}>/;
/** `{pin}` at the end of an option's first line. */
const PIN = /[ \t]*\{pin\}[ \t]*$/;
/** `shuffle: true` in the frontmatter, lenient in case and in its synonyms, as `task:` is. */
const SHUFFLE = /^shuffle[ \t]*:[ \t]*["']?(?:true|yes|on)["']?[ \t]*$/im;

/** How far a line is indented, a tab reaching the next multiple of four. */
function indentOf(line: string): number {
  let col = 0;
  for (const c of line) {
    if (c === " ") col++;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** `line` with up to `n` columns of indent taken off. */
function dedent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i]!;
    if (c === " ") col++;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
    i++;
  }
  return line.slice(i);
}

/** An option being read: its first line, and the lines that continue it as written. */
interface OptionLines {
  option: QuizOption;
  /** Where its content starts — `- [x] ` is two, the CommonMark content indent. */
  indent: number;
  rest: string[];
  /** Blank lines read since its last line, kept only if an indented line follows them. */
  held: number;
}

/**
 * An option's text in the one form every reader and writer holds it in: blank lines off
 * both ends, the first line trimmed, the rest with their common indent taken off and blank lines
 * emptied. The parser reads an option into it and `write.ts` compares and writes the form's text in
 * it, so a rewrite that means nothing is still no write.
 */
export function optionMarkdown(text: string): string {
  const lines = trimBlank(text.replace(/\r\n?/g, "\n").split("\n"));
  if (lines.length <= 1) return (lines[0] ?? "").trim();
  const rest = lines.slice(1).map((l) => (l.trim() === "" ? "" : l));
  const filled = rest.filter(Boolean);
  const common = filled.length ? Math.min(...filled.map(indentOf)) : 0;
  return [lines[0]!.trim(), ...rest.map((l) => dedent(l, common))].join("\n");
}

const optionText = (o: OptionLines): string => optionMarkdown([o.option.text, ...o.rest].join("\n"));

interface Line {
  text: string;
  start: number;
  /** After its newline. */
  end: number;
  n: number;
}

function linesOf(text: string, from: number, firstLine: number): Line[] {
  const out: Line[] = [];
  let at = from;
  let n = firstLine;
  while (at < text.length) {
    const nl = text.indexOf("\n", at);
    const stop = nl === -1 ? text.length : nl + 1;
    const raw = text.slice(at, nl === -1 ? text.length : nl);
    out.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start: at, end: stop, n });
    at = stop;
    n++;
  }
  return out;
}

/** A fence the line opens, or `null`. A backtick fence's info string may not hold a backtick. */
function fenceOpen(line: string): { char: string; len: number } | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  if (m[1]![0] === "`" && m[2]!.includes("`")) return null;
  return { char: m[1]![0]!, len: m[1]!.length };
}

function fenceCloses(line: string, fence: { char: string; len: number }): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1]![0] === fence.char && m[1]!.length >= fence.len;
}

interface Heading {
  prompt: string;
  id?: string;
  multi: boolean;
  /** Words in the `{…}` that are neither `#id` nor `multi`. */
  unknown: string[];
}

/** A `##` line read as a question's heading, or `null` when the line is not one. */
function headingOf(line: string): Heading | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  let rest = m[1]!.trim();
  rest = rest.replace(CLOSING, "").trim();
  let id: string | undefined;
  let multi = false;
  const unknown: string[] = [];
  const attrs = ATTRS.exec(rest);
  if (attrs) {
    const words = attrs[1]!.trim().split(/\s+/).filter(Boolean);
    if (words.every((w) => ATTR_WORD.test(w))) {
      rest = rest.slice(0, attrs.index).trim();
      for (const w of words) {
        if (w.startsWith("#")) id ??= w.slice(1);
        else if (w === "multi") multi = true;
        else unknown.push(w);
      }
    }
  }
  return { prompt: rest, id, multi, unknown };
}

type Phase = "body" | "options" | "why" | "after";

interface Building {
  heading: Heading;
  line: Line;
  body: Line[];
  /** Which of `body` were inside a fenced code block: a `>` there is code, never an answer. */
  fencedBody: Set<number>;
  options: QuizOption[];
  why: string[];
  phase: Phase;
  /** The last line that is not blank: where the span ends. */
  last: Line;
  /** The option a continuation would join: the last one read, until something that is not one. */
  open: OptionLines | null;
  /** Every option's lines, to make its text from when the question ends. */
  read: OptionLines[];
  /** The last line was part of the explanation, so a lazy continuation may follow. */
  inQuote: boolean;
  stray?: Line;
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === "") a++;
  while (b > a && lines[b - 1]!.trim() === "") b--;
  return lines.slice(a, b);
}

/**
 * Where a question's model answer starts in its body — the quote it ends in — or `-1`. A quote is
 * `>` lines and the lazy lines straight after one; a blank line ends it, so of two quotes only the
 * last is the answer, and anything after the quote that is not blank means there is none. A `>` in a
 * code block is code.
 */
function answerAt(body: Line[], fenced: ReadonlySet<number>): number {
  let start = -1;
  let inQuote = false;
  body.forEach((l, i) => {
    if (fenced.has(i)) {
      start = -1;
      inQuote = false;
    } else if (l.text.trim() === "") {
      inQuote = false;
    } else if (QUOTE.test(l.text)) {
      if (!inQuote) start = i;
      inQuote = true;
    } else if (!inQuote) {
      start = -1;
    }
  });
  return start;
}

/** A quote's lines with the marks taken off, lazy lines trimmed — what `why` holds. */
function unquote(lines: Line[]): string {
  return trimBlank(lines.map((l) => (QUOTE.test(l.text) ? l.text.replace(/^ {0,3}> ?/, "") : l.text.trim()))).join("\n");
}

/** An option line read: a new option, open for the lines that continue it. */
function startOption(b: Building, m: RegExpExecArray, line: Line): void {
  const first = (m[2] ?? "").trim();
  const pin = PIN.test(first);
  const option: QuizOption = { text: pin ? first.replace(PIN, "") : first, correct: m[1] !== " ", pin, line: line.n };
  b.options.push(option);
  const o: OptionLines = { option, indent: indentOf(line.text) + line.text.trimStart().indexOf("["), rest: [], held: 0 };
  b.read.push(o);
  b.open = o;
}

/** Parse a quiz. Never throws: whatever is wrong is a diagnostic. */
export function parseQuiz(text: string): Quiz {
  const fm = FRONT.exec(text);
  const front = fm ? fm[0] : "";
  const firstLine = 1 + (front.match(/\n/g)?.length ?? 0);
  const lines = linesOf(text, front.length, firstLine);
  const diagnostics: QuizDiagnostic[] = [];
  const say = (code: QuizCode, line: number, col: number, message: string, question?: string) =>
    diagnostics.push({
      code,
      severity: code.startsWith("W") ? "warning" : "error",
      line,
      col,
      message,
      ...(question ? { question } : {}),
    });

  const questions: Question[] = [];
  const description: Line[] = [];
  let descEnd = text.length;
  let cur: Building | null = null;
  let fence: { char: string; len: number; line: Line; option?: OptionLines } | null = null;

  const finish = (b: Building) => {
    for (const o of b.read) o.option.text = optionText(o);
    const h = b.heading;
    /* No checklist: a quote at the end of the question is its model answer. */
    const answer = b.options.length === 0 ? answerAt(b.body, b.fencedBody) : -1;
    const open = answer >= 0;
    const body = trimBlank((open ? b.body.slice(0, answer) : b.body).map((l) => l.text)).join("\n");
    const why = open ? unquote(b.body.slice(answer)) : trimBlank(b.why).join("\n");
    const correct = b.options.filter((o) => o.correct).length;
    const q: Question = {
      ...(h.id !== undefined ? { id: h.id } : {}),
      prompt: h.prompt,
      body,
      options: b.options,
      why,
      open,
      multiFlag: h.multi,
      multi: h.multi || correct > 1,
      line: b.line.n,
      span: { start: b.line.start, end: b.last.end },
    };
    const who = h.id;
    if (!h.prompt) say("EQ_NO_PROMPT", b.line.n, 1, "This question has no prompt. Write what it asks after the `##`.", who);
    if (open) {
      if (h.multi)
        say(
          "WQ_UNKNOWN_ATTR",
          b.line.n,
          1,
          "`multi` means nothing on an open question: it has no options to choose between.",
          who,
        );
    } else if (b.options.length === 0) {
      say(
        "EQ_NO_OPTIONS",
        b.line.n,
        1,
        "This question has no options and no answer. List options as a checklist under it (`- [ ] wrong`, `- [x] right`), or end it with the model answer as a `>` quote to ask it in words.",
        who,
      );
    } else {
      if (b.options.length === 1)
        say("EQ_ONE_OPTION", b.options[0]!.line, 1, "A question needs at least two options to choose between.", who);
      if (correct === 0)
        say("EQ_NO_ANSWER", b.options[0]!.line, 1, "No option is marked correct. Tick the right one with `- [x]`.", who);
      for (const o of b.options) if (!o.text) say("EQ_EMPTY_OPTION", o.line, 1, "This option has no text.", who);
    }
    if (b.stray)
      say(
        "EQ_STRAY",
        b.stray.n,
        1,
        "Only the explanation can follow the options, as one quote (`> …`). Move this into the prompt above the options, or into the explanation.",
        who,
      );
    for (const w of h.unknown)
      say(
        "WQ_UNKNOWN_ATTR",
        b.line.n,
        1,
        `\`${w}\` means nothing on a question. The heading takes \`{#id}\` and \`multi\`.`,
        who,
      );
    questions.push(q);
  };

  for (const line of lines) {
    const blank = line.text.trim() === "";

    if (fence) {
      if (cur) {
        if (cur.phase === "body") {
          cur.fencedBody.add(cur.body.length);
          cur.body.push(line);
        } else if (fence.option) {
          /* A code block inside an option is the option's, its blank lines included. */
          fence.option.rest.push(...Array<string>(fence.option.held).fill(""), line.text);
          fence.option.held = 0;
        }
        cur.last = line;
      } else description.push(line);
      if (fenceCloses(line.text, fence)) fence = null;
      continue;
    }

    const heading = headingOf(line.text);
    if (heading) {
      if (cur) finish(cur);
      else descEnd = line.start;
      cur = {
        heading,
        line,
        body: [],
        fencedBody: new Set(),
        options: [],
        why: [],
        phase: "body",
        last: line,
        open: null,
        read: [],
        inQuote: false,
      };
      continue;
    }

    const opens = fenceOpen(line.text);
    if (!cur) {
      description.push(line);
      if (opens) fence = { ...opens, line };
      continue;
    }

    if (!blank) cur.last = line;
    const option = OPTION.exec(line.text);

    switch (cur.phase) {
      case "body":
        if (option) {
          cur.phase = "options";
          startOption(cur, option, line);
        } else {
          cur.body.push(line);
          if (opens) fence = { ...opens, line };
        }
        break;
      case "options": {
        const open = cur.open;
        const indent = indentOf(line.text);
        if (blank) {
          if (open) open.held++;
        } else if (open && (indent >= open.indent || (indent >= 2 && !option && !QUOTE.test(line.text)))) {
          /* A line indented under an option is the option's: CommonMark's rule, and two
             spaces is always enough, which is the leniency the joined continuation line had. A fence
             it opens is still a fence — the one rule a reader can state: a line that opens a fence
             outside one always opens it — and everything up to its close is the option's too. */
          open.rest.push(...Array<string>(open.held).fill(""), line.text);
          open.held = 0;
          if (opens) fence = { ...opens, line, option: open };
        } else if (option) {
          startOption(cur, option, line);
        } else if (QUOTE.test(line.text)) {
          cur.phase = "why";
          cur.why.push(line.text.replace(/^ {0,3}> ?/, ""));
          cur.inQuote = true;
          cur.open = null;
        } else {
          cur.stray ??= line;
          cur.phase = "after";
          cur.open = null;
          if (opens) fence = { ...opens, line };
        }
        break;
      }
      case "why":
        if (blank) {
          cur.inQuote = false;
          cur.phase = "after";
        } else if (QUOTE.test(line.text)) {
          cur.why.push(line.text.replace(/^ {0,3}> ?/, ""));
        } else if (cur.inQuote && !option && !opens) {
          /* A lazy continuation: Markdown keeps a line that follows a quoted one in the quote. */
          cur.why.push(line.text.trim());
        } else {
          cur.stray ??= line;
          cur.phase = "after";
          if (opens) fence = { ...opens, line };
        }
        break;
      case "after":
        if (!blank) {
          cur.stray ??= line;
          if (opens) fence = { ...opens, line };
        }
        break;
    }
  }
  if (cur) finish(cur);
  if (fence)
    say("WQ_OPEN_FENCE", fence.line.n, 1, "This code block is never closed, so everything after it is code and asks nothing.");

  const seen = new Set<string>();
  for (const q of questions) {
    if (q.id === undefined) {
      say(
        "WQ_NO_ID",
        q.line,
        1,
        "This question has no id yet. It is given one, `{#q…}`, the first time it is edited or answered.",
      );
    } else if (seen.has(q.id)) {
      say("EQ_DUPLICATE_ID", q.line, 1, `Another question already has the id \`${q.id}\`. Give this one its own.`, q.id);
    } else seen.add(q.id);
  }
  if (questions.length === 0)
    say("WQ_EMPTY", firstLine, 1, "This quiz has no questions yet. A question starts at a `##` heading.");

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  const descStart = front.length;
  return {
    front,
    description: trimBlank(description.filter((l) => l.start < descEnd).map((l) => l.text)).join("\n"),
    descriptionSpan: { start: descStart, end: Math.max(descStart, questions.length ? questions[0]!.span.start : descEnd) },
    questions,
    diagnostics,
    shuffle: SHUFFLE.test(front),
  };
}

/** A question a run can ask: a prompt, and two options one of them right — or a model answer. */
export function askable(q: Question): boolean {
  if (!q.prompt) return false;
  if (q.open) return !!q.why;
  return q.options.length >= 2 && q.options.some((o) => o.correct) && q.options.every((o) => o.text);
}

/**
 * The words that keep an option in its place when the others shuffle, because they speak about the
 * others: *All of the above* only means something below them. Emphasis around them is
 * read through.
 */
const STAYS = /^[*_`\s]*(?:all of the above|none of the above|both|neither)\b/i;

/** Whether an option keeps its place when the options shuffle: `{pin}`, or the words above. */
export function pinned(o: Pick<QuizOption, "text" | "pin">): boolean {
  return o.pin || STAYS.test(o.text);
}

/**
 * The order a run shows a question's options in: indices into `options`, a pinned one at
 * its own index and the rest shuffled into the places left. `random` is `Math.random` but in a test.
 * A pick is still an option's index in the file, so grading and what is recorded never see this.
 */
export function optionOrder(options: readonly Pick<QuizOption, "text" | "pin">[], random: () => number = Math.random): number[] {
  const free = options.flatMap((o, i) => (pinned(o) ? [] : [i]));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  let k = 0;
  return options.map((o, i) => (pinned(o) ? i : free[k++]!));
}

/**
 * Whether what was picked answers the question: exactly the correct options, no more and no fewer.
 * `picked` holds option indices; order and repeats do not matter.
 */
export function isRight(q: Pick<Question, "options">, picked: readonly number[]): boolean {
  const chosen = new Set(picked);
  return q.options.every((o, i) => o.correct === chosen.has(i));
}
