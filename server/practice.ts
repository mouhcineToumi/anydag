/**
 * What a person has answered, per question, and which of those they still get wrong — the hosted
 * api's `app/practice.py`, ported. The reasons are
 * there and hold word for word: **the rule lives here and the page only reports events**, a record
 * is never deleted, and the threshold is read, never stored in a stat.
 *
 * What changed is where it is kept. It was the account's, beside the settings; there is no account,
 * so it is the app's — `~/.anydag/anydag.sqlite`, keyed by the vault and the quiz's id — and never
 * the vault's: a quiz file is shared and synced, and somebody's mistakes are not part of it.
 */

import { validId } from "./ids";
import type { Home } from "./home";
import type { Tree } from "./vault";

export const GRADUATE = 2;
export const GRADUATE_MIN = 1;
export const GRADUATE_MAX = 10;
export const MAX_EVENTS = 100;
const QUESTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Run = "quiz" | "mistakes";
const RUNS: readonly Run[] = ["quiz", "mistakes"];

export interface Stat {
  wrong: number;
  right: number;
  streak: number;
  at: string;
}

export const inPool = (s: Stat, graduate: number): boolean => s.wrong > 0 && s.streak < graduate;

/** One answer. The whole rule, and the only writer of these three numbers. */
export function record(s: Stat, correct: boolean, run: Run, at: string): Stat {
  if (!correct) return { ...s, wrong: s.wrong + 1, streak: 0, at };
  return { ...s, right: s.right + 1, streak: s.streak + (run === "mistakes" ? 1 : 0), at };
}

/** A stored record read back. Anything unreadable in it is zero, never an error. */
export function statOf(raw: unknown): Stat {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const count = (k: string) => {
    const v = r[k];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
  };
  return { wrong: count("wrong"), right: count("right"), streak: count("streak"), at: typeof r.at === "string" ? r.at : "" };
}

export interface Answer {
  quiz: string;
  question: string;
  correct: boolean;
  run: Run;
}

export class PracticeRefused extends Error {}

/** `{events: [{quiz, question, correct, run}]}`'s list, checked. */
export function answersOf(raw: unknown): Answer[] {
  if (!Array.isArray(raw)) throw new PracticeRefused("`events` is a list of answers");
  if (raw.length > MAX_EVENTS)
    throw new PracticeRefused(`${raw.length} answers in one request; the limit is ${MAX_EVENTS}. Send them as they happen.`);
  return raw.map((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new PracticeRefused(`answer ${i} is not an object`);
    const { quiz, question, correct, run } = e as Record<string, unknown>;
    if (!validId(quiz)) throw new PracticeRefused(`answer ${i}: \`quiz\` is a quiz's id`);
    if (typeof question !== "string" || !QUESTION_ID.test(question))
      throw new PracticeRefused(`answer ${i}: \`question\` is a question's id`);
    if (typeof correct !== "boolean") throw new PracticeRefused(`answer ${i}: \`correct\` is true or false`);
    if (!RUNS.includes(run as Run)) throw new PracticeRefused(`answer ${i}: \`run\` is one of ${RUNS.join(", ")}`);
    return { quiz, question, correct, run: run as Run };
  });
}

export const graduateOf = (raw: unknown): number =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= GRADUATE_MIN && raw <= GRADUATE_MAX ? raw : GRADUATE;

export type Records = Record<string, Record<string, Stat>>;

export interface PoolEntry extends Stat {
  quiz: string;
  question: string;
}

/** Every question Mistakes asks, in the order it asks them: by streak, then longest ago. */
export function pool(records: Records, graduate: number, alive: Map<string, Set<string>>): PoolEntry[] {
  const out: PoolEntry[] = [];
  for (const [quiz, questions] of Object.entries(records)) {
    const there = alive.get(quiz);
    if (!there) continue;
    for (const [question, s] of Object.entries(questions))
      if (there.has(question) && inPool(s, graduate)) out.push({ quiz, question, ...s });
  }
  const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => cmp(a.streak, b.streak) || cmp(a.at, b.at) || cmp(a.quiz, b.quiz) || cmp(a.question, b.question));
}

export function counts(entries: readonly PoolEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.quiz] = (out[e.quiz] ?? 0) + 1;
  return out;
}

export const statsOf = (questions: Record<string, Stat>, graduate: number): Record<string, Stat & { inPool: boolean }> =>
  Object.fromEntries(Object.entries(questions).map(([q, s]) => [q, { ...s, inPool: inPool(s, graduate) }]));

/** Every quiz the vault lists, by id, with the question ids it still holds. */
export function aliveOf(tree: Tree): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const name of tree.quizzes) {
    const id = tree.ids[name];
    if (id) out.set(id, new Set((tree.questions[name] ?? []).filter((q): q is string => !!q)));
  }
  return out;
}

const GRADUATE_KEY = "practice.graduate";

/** The store: one row per question, in the app's home, scoped by the vault's id. */
export class Practice {
  constructor(
    private readonly home: Home,
    private readonly vault: string,
  ) {}

  graduate(): number {
    const raw = this.home.get(GRADUATE_KEY);
    return graduateOf(raw === undefined ? undefined : Number(raw));
  }

  setGraduate(n: number): void {
    this.home.set(GRADUATE_KEY, String(n));
  }

  records(quiz?: string): Records {
    const rows = (quiz === undefined
      ? this.home.sql("select quiz, question, record from practice where vault = ?").all(this.vault)
      : this.home
          .sql("select quiz, question, record from practice where vault = ? and quiz = ?")
          .all(this.vault, quiz)) as unknown as { quiz: string; question: string; record: string }[];
    const out: Records = {};
    for (const r of rows) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(r.record);
      } catch {
        /* zero */
      }
      (out[r.quiz] ??= {})[r.question] = statOf(parsed);
    }
    return out;
  }

  /** Every answer applied in order, in one transaction; the touched quizzes' records come back. */
  fold(answers: readonly Answer[], at = new Date().toISOString()): Records {
    return this.home.tx(() => {
      const touched = new Set(answers.map((a) => a.quiz));
      const before: Records = {};
      for (const q of touched) Object.assign(before, this.records(q));
      for (const a of answers) {
        const quiz = (before[a.quiz] ??= {});
        quiz[a.question] = record(quiz[a.question] ?? statOf(null), a.correct, a.run, at);
        this.home
          .sql(
            "insert into practice (vault, quiz, question, record) values (?, ?, ?, ?) on conflict (vault, quiz, question) do update set record = excluded.record",
          )
          .run(this.vault, a.quiz, a.question, JSON.stringify(quiz[a.question]));
      }
      return Object.fromEntries([...touched].map((q) => [q, before[q] ?? {}]));
    });
  }
}
