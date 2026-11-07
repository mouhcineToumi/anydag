import type { QuizDiagnostic } from "../../src/quiz/codes";
import { askable, isRight, optionOrder, parseQuiz, type Question } from "../../src/quiz/parse";
import { folderQuizzes } from "../../src/quiz/folder";
import { stampIds } from "../../src/quiz/write";

import { ApiError, EXIT } from "../api";
import { UsageError, bool, str } from "../args";
import { kindQuery } from "../board";
import { emit, readText, short, table, type Command, type Ctx } from "../context";
import { checked, quizLines } from "./docs";

/**
 * Quizzes: the third kind of file.
 *
 * Reading, writing, moving and deleting one are the `quiz` commands `docCommands` makes, the way a
 * note's are. What is here is what only a quiz has: the gallery's list, the parser's word on one
 * without writing it, a run, the Mistakes a person is carrying, and the threshold that takes a
 * question out.
 *
 * **Answers are given in a run, never posted**. `POST /api/practice` is refused here because a
 * command that posted answers would clear Mistakes without anybody knowing anything; `quiz practice`
 * is the other way to reach it — a question at a time, in a terminal, answered by whoever is at it —
 * and it will not run without one.
 */

interface Listed {
  quizzes?: string[];
  questions?: Record<string, number>;
  ids: Record<string, string>;
  titles?: Record<string, string>;
}

interface Pool {
  graduate: number;
  pool: { quiz: string; question: string; wrong: number; right: number; streak: number; at: string }[];
  counts: Record<string, number>;
}

const title = (listed: Listed, name: string) => listed.titles?.[name] ?? name.slice(name.lastIndexOf("/") + 1);

export const QUIZ: Command[] = [
  {
    name: ["quiz", "ls"],
    args: "[<folder>]",
    summary: "every quiz — how many questions it asks and how many are in Mistakes",
    routes: ["GET /__board/list", "GET /api/practice"],
    async run(ctx, p) {
      const [listed, pool] = await Promise.all([ctx.api.get<Listed>("/__board/list"), ctx.api.get<Pool>("/api/practice")]);
      const under = p.pos[0]?.replace(/\/+$/, "");
      const rows = (listed.quizzes ?? [])
        .filter((n) => !under || n.startsWith(`${under}/`))
        .map((name) => ({
          name,
          title: title(listed, name),
          questions: listed.questions?.[name] ?? 0,
          mistakes: pool.counts[listed.ids[name] ?? ""] ?? 0,
        }));
      emit(ctx, rows, () => {
        if (!rows.length) return ctx.io.err("no quizzes");
        for (const line of table(rows.map((r) => [r.name, `${r.questions} q`, r.mistakes ? `${r.mistakes} in Mistakes` : "", r.title])))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["quiz", "check"],
    args: "[name]",
    min: 0,
    summary: "what the parser says about a quiz, without writing it; exit 4 on an error",
    help:
      "Every problem with its line and its code — EQ_ for a question a run cannot ask, WQ_ for one that still " +
      "works — read with the page's own parser. `quiz write` and `quiz edit` print the same after writing. " +
      "--file checks a draft that is not in the account, writing nothing.",
    flags: [{ name: "file", type: "string", value: "<path|->", help: "check this draft instead of a file in the account; `-` is stdin" }],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      /* The route's answer, which is the page's parser run by the grammar service — so this,
         `quiz_check` over MCP and the quiz's own page cannot disagree about a quiz. */
      const got = await checked<{ questions: number; diagnostics: QuizDiagnostic[] }>(ctx, p, "quiz");
      if (ctx.json) {
        ctx.io.out(JSON.stringify(got, null, 2));
        return got.diagnostics.some((d) => d.severity === "error") ? 4 : 0;
      }
      const code = quizLines(ctx, got.diagnostics);
      if (code === 0) ctx.io.err(`${p.pos[0] ?? str(p, "file")}: ${got.questions} question(s), nothing wrong`);
      return code;
    },
  },
  {
    name: ["quiz", "practice"],
    args: "[<name>|<folder>]",
    summary: "run a quiz in the terminal, a question at a time — every quiz in a folder as one run, or with --mistakes the questions in Mistakes",
    help:
      "The quiz's description is printed first. Each question is printed with its options numbered; type the number " +
      "of your answer (several, separated by spaces, where it asks for every right one), s to skip it, or q to stop. " +
      "An open question is answered in words: type it, an empty line shows the model answer, and you say whether you had it. " +
      "Name a folder rather than a quiz and every quiz under it, subfolders included, is one run in the order the sidebar shows " +
      "them, each answer recorded against its own quiz. " +
      "A skipped question records nothing, and the end offers the skipped ones again. Each answer is recorded as the page records one, so " +
      "a wrong one goes into Mistakes, and in the --mistakes run enough right in a row (`quiz threshold`) take it out. " +
      "A question with no id is given one first, which writes the quiz — what the page does before a run. It needs " +
      "a terminal: an answer is somebody's, not a script's.",
    flags: [{ name: "mistakes", type: "boolean", help: "ask the questions in Mistakes instead of one quiz" }],
    routes: ["GET /__board/get", "POST /__board/put", "GET /__board/list", "GET /api/practice", "POST /api/practice"],
    async run(ctx, p) {
      const mistakes = bool(p, "mistakes");
      const name = p.pos[0];
      if (mistakes === Boolean(name)) throw new UsageError("name a quiz, or ask for --mistakes — one of the two");
      if (!ctx.io.stdinIsTTY) throw new UsageError("a run asks a person: run it in a terminal");
      const run = mistakes ? "mistakes" : "quiz";
      const { asks, folder } = mistakes ? { asks: await mistakesToAsk(ctx), folder: false } : await quizOrFolder(ctx, name!);
      if (!asks.length) {
        ctx.io.err(mistakes ? "nothing in Mistakes" : `${name} has no question a run can ask`);
        return;
      }
      /* A run from several quizzes names each question's quiz: Mistakes, and a folder. */
      const several = mistakes || folder;
      let right = 0;
      let asked = 0;
      let wrong = 0;
      let queue = asks;
      let skipped: Ask[] = [];
      /* What was skipped and never answered after, for the summary — whether or not the run ended
         with q, which offers nothing more but still says what was left. */
      const unanswered = new Set<string>();
      /* Each quiz's description once, before its first question: a run of one quiz prints
         it at the start, and Mistakes before the first question it asks from each quiz. */
      const told = new Set<string>();
      run: for (;;) {
        skipped = [];
        for (const [i, a] of queue.entries()) {
          const q = a.question;
          if (a.description && !told.has(a.quiz)) {
            ctx.io.out("");
            ctx.io.out(a.description);
          }
          told.add(a.quiz);
          ctx.io.out("");
          ctx.io.out(`${i + 1}/${queue.length}${several ? `  ${a.name}` : ""}  ${q.prompt}`);
          if (q.body) ctx.io.out(q.body);
          /* Shuffled where the quiz says so: the numbers are places, mapped back to the
             file's options before anything is graded or recorded. */
          const order = a.shuffle ? optionOrder(q.options) : q.options.map((_, n) => n);
          order.forEach((i, n) => ctx.io.out(numbered(n + 1, q.options[i]!.text)));
          /* An open question is answered in words and graded by the person. */
          const typed = q.open ? await inWords(ctx, q) : await pick(ctx, q);
          const picked = Array.isArray(typed) ? typed.map((n) => order[n]!) : typed;
          /* Stopped: nothing more is offered, and what was not reached is not skipped. */
          if (picked === null) break run;
          /* A skip is no answer: nothing recorded, and offered again at the end. */
          if (picked === "skip") {
            skipped.push(a);
            unanswered.add(`${a.quiz}#${q.id}`);
            continue;
          }
          unanswered.delete(`${a.quiz}#${q.id}`);
          asked++;
          const ok = typeof picked === "boolean" ? picked : isRight(q, picked);
          if (ok) right++;
          else wrong++;
          if (!q.open) {
            const answer = order.flatMap((i, n) => (q.options[i]!.correct ? [String(n + 1)] : [])).join(" ");
            ctx.io.out(ok ? "right" : `wrong — ${q.multi ? "the answers are" : "the answer is"} ${answer}`);
            if (q.why) ctx.io.out(quoted(q.why));
          }
          /* Recorded as it is given, so a run stopped halfway keeps what was answered. */
          await ctx.api.post("/api/practice", { events: [{ quiz: a.quiz, question: q.id, correct: ok, run }] });
        }
        if (!skipped.length) break;
        let again: string;
        try {
          again = (await ctx.io.ask(`answer the ${skipped.length} skipped? (y/n) `)).trim().toLowerCase();
        } catch {
          break;
        }
        if (again !== "y" && again !== "yes") break;
        queue = skipped;
      }
      const left = unanswered.size;
      emit(ctx, { run, asked, right, wrong, skipped: left }, () => {
        const parts = [wrong ? `${wrong} ${mistakes ? "stay" : "went"} into Mistakes` : "", left ? `${left} skipped` : ""].filter(Boolean);
        ctx.io.err(`${right}/${asked} right${parts.length ? ` — ${parts.join(", ")}` : ""}`);
      });
    },
  },
  {
    name: ["quiz", "question", "set"],
    args: "<name>",
    min: 1,
    summary: "write one question — add it, or replace the one with its {#id} — and no other byte of the quiz",
    help:
      "The question is Markdown from its `##` heading, read from --file (`-` for stdin): its prompt, its options as a " +
      "checklist, its `>` explanation — or no checklist and a `>` model answer for one answered in words. It is written " +
      "as given. Its id is the heading's {#id}, or --id; with neither it is new and one is minted, which is printed. A new " +
      "one goes at the end, or --before or --after a question. Refused, with why, if it is not one question a run could ask.",
    flags: [
      { name: "file", type: "string", value: "<path|->", help: "the question's Markdown; `-` reads stdin" },
      { name: "id", type: "string", value: "<id>", help: "the question it is, when its heading names none" },
      { name: "before", type: "string", value: "<id>", help: "put a new question before this one" },
      { name: "after", type: "string", value: "<id>", help: "put a new question after this one" },
      { name: "base", type: "string", value: "<sha1>", help: "refuse the write if the quiz moved since this base" },
    ],
    routes: ["POST /__board/quiz"],
    async run(ctx, p) {
      const markdown = await readText(ctx, str(p, "file"), "the question");
      const op: Record<string, unknown> = { op: "set", markdown, ...placedAt(p) };
      const id = str(p, "id");
      if (id) op.id = id;
      return questionEdit(ctx, p.pos[0]!, op, str(p, "base"), (done) => `wrote question ${done.ids[0]} of ${p.pos[0]}`);
    },
  },
  {
    name: ["quiz", "question", "rm"],
    args: "<name> <id>",
    min: 2,
    summary: "remove one question by its {#id}, and the blank lines it leaves",
    flags: [{ name: "base", type: "string", value: "<sha1>", help: "refuse the write if the quiz moved since this base" }],
    routes: ["POST /__board/quiz"],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      return questionEdit(ctx, name, { op: "remove", id }, str(p, "base"), () => `removed question ${id} from ${name}`);
    },
  },
  {
    name: ["quiz", "question", "mv"],
    args: "<name> <id>",
    min: 2,
    summary: "move one question --before or --after another, or to the end — every question's bytes kept",
    flags: [
      { name: "before", type: "string", value: "<id>", help: "the question it goes before" },
      { name: "after", type: "string", value: "<id>", help: "the question it goes after" },
      { name: "base", type: "string", value: "<sha1>", help: "refuse the write if the quiz moved since this base" },
    ],
    routes: ["POST /__board/quiz"],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      return questionEdit(ctx, name, { op: "move", id, ...placedAt(p) }, str(p, "base"), () => `moved question ${id} of ${name}`);
    },
  },
  {
    name: ["quiz", "mistakes"],
    args: "",
    summary: "every question in Mistakes, in the order the Mistakes run asks them",
    routes: ["GET /api/practice", "GET /__board/list"],
    async run(ctx) {
      const [pool, listed] = await Promise.all([ctx.api.get<Pool>("/api/practice"), ctx.api.get<Listed>("/__board/list")]);
      const byId = Object.fromEntries(Object.entries(listed.ids).map(([name, id]) => [id, name]));
      emit(ctx, pool, () => {
        if (!pool.pool.length) return ctx.io.err("nothing in Mistakes");
        for (const line of table(pool.pool.map((e) => [byId[e.quiz] ?? e.quiz, e.question, `${e.streak}/${pool.graduate} right`, `${e.wrong} wrong`])))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["quiz", "threshold"],
    args: "[<n>]",
    summary: "how many right in a row, in Mistakes, take a question out — or set it",
    routes: ["GET /api/practice", "PUT /api/practice"],
    async run(ctx, p) {
      const raw = p.pos[0];
      if (raw === undefined) {
        const pool = await ctx.api.get<Pool>("/api/practice");
        emit(ctx, { graduate: pool.graduate }, () => ctx.io.out(String(pool.graduate)));
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError(`\`${raw}\` is not a whole number from 1 to 10`);
      const done = await ctx.api.put<{ graduate: number }>("/api/practice", { graduate: n });
      emit(ctx, done, () => ctx.io.err(`a question now leaves Mistakes after ${done.graduate} right in a row`));
    },
  },
];

/** What `POST /__board/quiz` answers. */
interface QuestionEdited {
  name: string;
  changed: boolean;
  ids: string[];
  base: string;
  text: string;
  diagnostics: QuizDiagnostic[];
}

/** `--before` or `--after`, as an op's, and never both. */
function placedAt(p: Parameters<Command["run"]>[1]): { before?: string; after?: string } {
  const before = str(p, "before");
  const after = str(p, "after");
  if (before && after) throw new UsageError("--before or --after, not both");
  return { ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/**
 * One question edited through the route: it applies the op to the text it reads and writes it under
 * that version, so a write that meets another writer's is redone there — or, with `--base`, refused.
 * The quiz's problems are printed after, the exit code `quiz check`'s.
 */
async function questionEdit(ctx: Ctx, name: string, op: Record<string, unknown>, base: string | undefined, said: (d: QuestionEdited) => string): Promise<number> {
  const done = await ctx.api.post<QuestionEdited>("/__board/quiz", { name, ops: [op], ...(base ? { base } : {}) });
  if (ctx.json) {
    ctx.io.out(JSON.stringify(done, null, 2));
    return done.diagnostics.some((d) => d.severity === "error") ? EXIT.errors : EXIT.ok;
  }
  ctx.io.err(done.changed ? `${said(done)} — base ${short(done.base)}` : `${name} unchanged`);
  return quizLines(ctx, done.diagnostics.filter((d) => d.code !== "WQ_NO_ID"));
}

/** One question to ask in a run, with the quiz it is recorded against. */
interface Ask {
  quiz: string;
  name: string;
  /** The quiz's description, printed before the first question asked from it. */
  description: string;
  /** The quiz shuffles its options. */
  shuffle: boolean;
  question: Question & { id: string };
}

/**
 * A quiz's questions in its own order — every one a run can ask — each with an id to record it
 * under. One that has none is given one first and the quiz written, as the page does on Practice.
 */
async function quizToAsk(ctx: Ctx, name: string): Promise<Ask[]> {
  const got = await ctx.api.get<{ id: string; text: string; base: string }>("/__board/get", { name, kind: kindQuery("quiz") });
  let text = got.text;
  const stamped = stampIds(text);
  if (stamped.minted.length) {
    await ctx.api.post("/__board/put", { text: stamped.text, base: got.base }, { name, kind: kindQuery("quiz") });
    text = stamped.text;
  }
  const { description, questions, shuffle } = parseQuiz(text);
  return questions
    .filter((q): q is Question & { id: string } => askable(q) && q.id !== undefined)
    .map((question) => ({ quiz: got.id, name, description, shuffle, question }));
}

/**
 * A quiz's questions — or, when no quiz has the name and a folder holds quizzes, every quiz under it
 * in the sidebar's order, each one's questions stamped and asked as its own quiz run's are.
 */
async function quizOrFolder(ctx: Ctx, name: string): Promise<{ asks: Ask[]; folder: boolean }> {
  try {
    return { asks: await quizToAsk(ctx, name), folder: false };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    const listed = await ctx.api.get<Listed>("/__board/list");
    const folder = name.replace(/^\/+|\/+$/g, "");
    const names = folderQuizzes(listed.quizzes ?? [], listed.titles ?? {}, folder);
    if (!names.length) throw e;
    const asks: Ask[] = [];
    for (const quiz of names) asks.push(...(await quizToAsk(ctx, quiz)));
    return { asks, folder: true };
  }
}

/** Every question in Mistakes, in the order the Mistakes run asks them, read out of its quiz. */
async function mistakesToAsk(ctx: Ctx): Promise<Ask[]> {
  const [pool, listed] = await Promise.all([ctx.api.get<Pool>("/api/practice"), ctx.api.get<Listed>("/__board/list")]);
  const byId = Object.fromEntries(Object.entries(listed.ids).map(([n, id]) => [id, n]));
  const quizzes = new Map<string, { description: string; shuffle: boolean; questions: Question[] }>();
  const out: Ask[] = [];
  for (const e of pool.pool) {
    const name = byId[e.quiz];
    if (!name) continue;
    if (!quizzes.has(name)) {
      const got = await ctx.api.get<{ text: string }>("/__board/get", { name, kind: kindQuery("quiz") });
      quizzes.set(name, parseQuiz(got.text));
    }
    const { description, shuffle, questions } = quizzes.get(name)!;
    const question = questions.find((q) => q.id === e.question);
    if (question && askable(question)) out.push({ quiz: e.quiz, name, description, shuffle, question: question as Question & { id: string } });
  }
  return out;
}

/**
 * One option as the terminal shows it: its number, and a code block or a second line indented
 * under it, so the next number still starts the next option.
 */
export function numbered(n: number, text: string): string {
  const head = `  ${n}. `;
  const pad = " ".repeat(head.length);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? head + line : line ? pad + line : ""))
    .join("\n");
}

/** Markdown as a quote, each line marked — an explanation, or a model answer. */
const quoted = (md: string): string =>
  md
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/**
 * An open question: the answer typed over as many lines as it takes, an empty line to end
 * it; the model answer; and the person's own verdict — `true` or `false`, `"skip"`, or `null` to
 * stop. What was typed is for comparing, and nothing grades it.
 */
async function inWords(ctx: Ctx, q: Question): Promise<boolean | "skip" | null> {
  const lines: string[] = [];
  for (;;) {
    let typed: string;
    try {
      typed = await ctx.io.ask(lines.length ? "  … " : "your answer (an empty line to see the model answer, s to skip, q to stop): ");
    } catch {
      return null;
    }
    const word = typed.trim().toLowerCase();
    if (!lines.length && (word === "q" || word === "quit")) return null;
    if (!lines.length && (word === "s" || word === "skip")) return "skip";
    if (word === "") break;
    lines.push(typed);
  }
  ctx.io.out("the model answer:");
  ctx.io.out(quoted(q.why));
  for (;;) {
    let typed: string;
    try {
      typed = (await ctx.io.ask("did you get it? (y/n) ")).trim().toLowerCase();
    } catch {
      return null;
    }
    if (typed === "y" || typed === "yes") return true;
    if (typed === "n" || typed === "no") return false;
    if (typed === "q" || typed === "quit") return null;
    ctx.io.err("type y if your answer says what the model answer says, n if it does not");
  }
}

/** The option numbers typed, 0-based — `"skip"` to skip, `null` to stop. Asked again until it is an answer. */
async function pick(ctx: Ctx, q: Question): Promise<number[] | "skip" | null> {
  const hint = q.multi ? `every right one, 1–${q.options.length}, separated by spaces` : `1–${q.options.length}`;
  for (;;) {
    let typed: string;
    try {
      typed = (await ctx.io.ask(`answer (${hint}, s to skip, q to stop): `)).trim().toLowerCase();
    } catch {
      /* Ctrl+D, or the input closing: the person has stopped, which is what `q` says. */
      return null;
    }
    if (typed === "q" || typed === "quit") return null;
    if (typed === "s" || typed === "skip") return "skip";
    const nums = typed.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= q.options.length) && (q.multi || nums.length === 1))
      return [...new Set(nums.map((n) => n - 1))];
    ctx.io.err(q.multi ? `type the numbers of every right option, 1 to ${q.options.length}` : `type one number, 1 to ${q.options.length}`);
  }
}
