/**
 * Editing a quiz one question at a time, by id, from somewhere with no form: `POST
 * /__board/quiz {name, base?, ops}`, which the `dsl` service applies with this and the api writes
 * under the version it read — the table's shape (`src/table/ops.ts`).
 *
 * Three ops, each about one question named by its `{#id}`:
 *
 * - `{op: "set", markdown, id?, before?, after?}` — the question `markdown` is (its `##` heading, its
 *   prompt, its options, its explanation) replaces the question with its id, or is added: at the end,
 *   or before or after the question named. **Its bytes are written as given**, not in the house form,
 *   so an agent's wrapping is an agent's; only a heading with no id is given one.
 * - `{op: "remove", id}` — the question, and the blank lines it leaves.
 * - `{op: "move", id, before?, after?}` — the question, before or after another; to the end with
 *   neither.
 *
 * **Every other byte of the quiz is left alone**: no other question is stamped, rewritten or moved,
 * which is the whole point — one question changed by an agent costs that question, not the file. A
 * question that names nothing, or Markdown that is not exactly one askable question, refuses the
 * whole list, so nothing is half-applied.
 *
 * No browser, no React, no `@/` aliases: the `dsl` service and the CLI import this verbatim.
 */
import { askable, parseQuiz, type Quiz } from "./parse";
import { mintQuestionId, moveQuestion, removeQuestion } from "./write";

type QuizOp =
  | { op: "set"; markdown: string; id?: string; before?: string; after?: string }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; before?: string; after?: string };

const QUIZ_OPS = ["set", "remove", "move"] as const;

export type QuizApplied =
  | { ok: true; text: string; /** The question each op was about, a new one's minted id included. */ ids: string[] }
  | { ok: false; status: number; error: string };

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isText = (v: unknown): v is string => typeof v === "string";
const optional = (v: unknown): boolean => v === undefined || v === null || isText(v);

/** What is wrong with one op's shape, or `null`. */
function shapeProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "an op is an object: `{op, …}`";
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "set":
      if (!isText(o.markdown)) return "`set` takes `markdown`: the question, from its `##` heading";
      if (!optional(o.id) || !optional(o.before) || !optional(o.after)) return "`id`, `before` and `after` are question ids";
      if (o.before && o.after) return "`before` or `after`, not both";
      return null;
    case "remove":
      return isText(o.id) && o.id ? null : "`remove` takes the `id` of a question";
    case "move":
      if (!isText(o.id) || !o.id) return "`move` takes the `id` of a question";
      if (!optional(o.before) || !optional(o.after)) return "`before` and `after` are question ids";
      if (o.before && o.after) return "`before` or `after`, not both";
      return null;
    default:
      return `\`${String(o.op)}\` is not an op: ${QUIZ_OPS.join(", ")}`;
  }
}

function indexOf(quiz: Quiz, id: string): number {
  const at = quiz.questions.findIndex((q) => q.id === id);
  if (at < 0) throw new Refused(404, `no question \`${id}\` in this quiz`);
  return at;
}

/** The text ending in exactly one newline, with one blank line before whatever is appended. */
const openEnd = (text: string): string => (text.trim() ? `${text.replace(/\s+$/, "")}\n\n` : "");

/** Blank lines off both ends, and one newline after. */
const asBlock = (md: string): string => `${md.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "")}\n`;

/**
 * The question `markdown` says, checked: exactly one question and nothing around it, askable, and
 * with an id — the one it wrote, the op's `id`, or one minted here, which `taken` must not hold.
 */
function questionOf(markdown: string, id: string | undefined, taken: ReadonlySet<string>): { md: string; id: string } {
  let md = asBlock(markdown);
  const quiz = parseQuiz(md);
  if (quiz.front) throw new Refused(400, "`markdown` is one question, from its `##` heading: no frontmatter");
  if (quiz.questions.length !== 1) {
    throw new Refused(
      400,
      quiz.questions.length === 0
        ? "`markdown` has no question in it: a question starts at a `##` heading"
        : `\`markdown\` holds ${quiz.questions.length} questions: set them one at a time`,
    );
  }
  if (quiz.description) throw new Refused(400, "`markdown` starts at the question's `##` heading: nothing may come before it");
  const q = quiz.questions[0]!;
  const errors = quiz.diagnostics.filter((d) => d.severity === "error");
  if (errors.length || !askable(q)) {
    const said = errors.map((d) => `${d.code}: ${d.message}`).join(" ");
    throw new Refused(400, `that question cannot be asked: ${said || "it needs a prompt, and options one of them right, or a model answer"}`);
  }
  if (q.id && id && q.id !== id) throw new Refused(400, `the heading says \`{#${q.id}}\` and \`id\` says \`${id}\`: give one`);
  const wanted = q.id ?? id ?? mintQuestionId(taken);
  if (q.id === undefined) {
    /* The heading gains its id inside the `{…}` a reader looks for, the other words of it kept. */
    const eol = md.indexOf("\n");
    const words = [`#${wanted}`, q.multiFlag ? "multi" : ""].filter(Boolean).join(" ");
    md = `## ${q.prompt} {${words}}` + md.slice(eol);
  }
  return { md, id: wanted };
}

/** `text` with the question `md` added: before or after the one named, or at the end, one blank line apart. */
function place(text: string, md: string, quiz: Quiz, before: string | undefined, after: string | undefined): string {
  const qs = quiz.questions;
  let at: number | undefined;
  if (before) at = indexOf(quiz, before);
  else if (after) at = indexOf(quiz, after) + 1;
  const next = at === undefined ? undefined : qs[at];
  if (next) return text.slice(0, next.span.start) + md + "\n" + text.slice(next.span.start);
  return openEnd(text) + md;
}

/** One `set`: replace the question with the id, or add it. */
function setOne(text: string, op: Extract<QuizOp, { op: "set" }>): { text: string; id: string } {
  const quiz = parseQuiz(text);
  const taken = new Set(quiz.questions.flatMap((q) => (q.id ? [q.id] : [])));
  const { md, id } = questionOf(op.markdown, op.id ?? undefined, taken);
  const at = quiz.questions.findIndex((q) => q.id === id);
  if (at < 0) return { text: place(text, md, quiz, op.before ?? undefined, op.after ?? undefined), id };
  const q = quiz.questions[at]!;
  /* A question that ended the file without a newline keeps not having one, so the diff is its lines. */
  const tail = q.span.end === text.length && !text.endsWith("\n") ? md.slice(0, -1) : md;
  const replaced = text.slice(0, q.span.start) + tail + text.slice(q.span.end);
  return { text: op.before || op.after ? moveOne(replaced, id, op.before ?? undefined, op.after ?? undefined) : replaced, id };
}

/** One `move`: before a question, after one, or to the end. */
function moveOne(text: string, id: string, before: string | undefined, after: string | undefined): string {
  const quiz = parseQuiz(text);
  const from = indexOf(quiz, id);
  if (before === id || after === id) return text;
  let to = quiz.questions.length - 1;
  if (before) {
    const b = indexOf(quiz, before);
    to = b < from ? b : b - 1;
  } else if (after) {
    const a = indexOf(quiz, after);
    to = a < from ? a + 1 : a;
  }
  return moveQuestion(text, id, to);
}

/** Apply every op, in order, to one text. */
export function applyQuizOps(text: string, ops: readonly unknown[]): QuizApplied {
  for (const raw of ops) {
    const problem = shapeProblem(raw);
    if (problem) return { ok: false, status: 400, error: problem };
  }
  let out = text;
  const ids: string[] = [];
  try {
    for (const op of ops as QuizOp[]) {
      switch (op.op) {
        case "set": {
          const done = setOne(out, op);
          out = done.text;
          ids.push(done.id);
          break;
        }
        case "remove":
          indexOf(parseQuiz(out), op.id);
          out = removeQuestion(out, op.id);
          ids.push(op.id);
          break;
        case "move":
          out = moveOne(out, op.id, op.before ?? undefined, op.after ?? undefined);
          ids.push(op.id);
          break;
      }
    }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
  return { ok: true, text: out, ids };
}
