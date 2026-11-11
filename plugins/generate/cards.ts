import { CODES } from "../../src/dsl/codes";
import { askable, parseQuiz, type Question } from "../../src/quiz/parse";
import { renderQuestion } from "../../src/quiz/write";
import type { Complete, Message } from "./llm";

/**
 * A topic or a note in, a deck of checked flashcards out (#140) — the prompt card's loop, with the
 * quiz parser where the diagram's was.
 *
 * Ask; read the reply with **`parseQuiz`**, the parser the quiz page and the server run; keep only
 * what is an askable flashcard (`card` on the heading, a front, and a `>` back); and if anything in
 * the reply is not, send back what is wrong, by card and by code, and ask for the whole deck again.
 * The best attempt wins: the most cards, then the fewest problems.
 *
 * **Nothing here writes a quiz.** The page shows the cards, the person drops any of them and
 * confirms, and only then does each one go in through the quiz's own `set` op
 * (`src/quiz/ops.ts`), one question's span at a time — the prompt card's rule that the server
 * drafts and the client commits, for the same reason: the write is the person's, made once, where
 * they can see it.
 *
 * **Where a card goes and what it is called are never the model's**: an id it wrote is dropped,
 * and a card comes back in the house form (`renderQuestion`) with no `{#id}`, so the writer mints
 * one against the quiz it lands in.
 */

/** How many cards may be asked for, and how many when nobody says. */
export const CARDS_MIN = 1;
export const CARDS_MAX = 30;
export const CARDS_DEFAULT = 10;

/** One flashcard, as the page shows it and the `set` op writes it. */
export interface Card {
  /** The front: the heading's words. */
  front: string;
  /** More on the front, between the heading and the back — usually `""`. */
  body: string;
  /** The back: the quote, its marks taken off. */
  back: string;
  /** The question in the house form, from its `##` heading, with no `{#id}`: what `set` is handed. */
  markdown: string;
}

/** Something wrong with one card of a reply: which, and the code a program branches on. */
export interface CardProblem {
  /** 1-based, in the order the reply wrote them. */
  card: number;
  front: string;
  code: string;
  message: string;
}

export interface CardsResult {
  /** True when at least one card came back. Problems with other cards may remain; those cards were left out. */
  ok: boolean;
  cards: Card[];
  /** What was wrong with the cards left out of the best attempt. */
  problems: CardProblem[];
  attempts: number;
  /** Set when no attempt gave a single card: what the model said instead, or why it could not be read. */
  error?: string;
}

export interface CardsOptions {
  /** What the cards are about, or what to focus on in the note. One of this and `note` is given. */
  topic?: string;
  /** The text of a note to make the cards from: its body, the frontmatter left off. */
  note?: string;
  count?: number;
  system: string;
  complete: Complete;
  attempts?: number;
  signal?: AbortSignal;
}

/** The count asked for, held to the range: a number the person typed, or the default. */
export function cardCount(n: unknown): number {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : NaN;
  if (!Number.isFinite(v)) return CARDS_DEFAULT;
  return Math.min(CARDS_MAX, Math.max(CARDS_MIN, Math.round(v)));
}

/**
 * The first user turn. It starts with a word, never with the person's text, so a CLI never reads it
 * as a flag; the note, when there is one, is fenced off as material rather than instructions.
 */
export function cardsRequest(o: { topic?: string; note?: string; count: number }): string {
  const topic = o.topic?.trim() ?? "";
  const note = o.note?.trim() ?? "";
  const n = `${o.count} flashcard${o.count === 1 ? "" : "s"}`;
  if (!note) return `Write ${n} about this topic:\n\n${topic}`;
  return [
    `Write ${n} from the note below${topic ? ", focusing on what the person asks for after it" : ""}. Take every fact from the note; do not add what it does not say.`,
    "",
    "<note>",
    note,
    "</note>",
    ...(topic ? ["", "What to focus on:", "", topic] : []),
  ].join("\n");
}

/** A reply wrapped whole in a fence — ```markdown around the deck — is unwrapped first. */
function unwrapped(reply: string): string {
  const outer = /^\s*(`{3,}|~{3,})[ \t]*(?:markdown|md)?[ \t]*\n([\s\S]*?)\n\1\s*$/i.exec(reply);
  return outer ? outer[2]! : reply;
}

/** The codes that are about the reply as a deck rather than about one card — none stops a card. */
const IGNORED = new Set<string>([
  /* Ids are dropped and minted by the writer, so a missing or shared one is no problem here. */
  "WQ_NO_ID",
  "EQ_DUPLICATE_ID",
  "WQ_EMPTY",
  /* `multi` or an unknown word on a card's heading: the house form writes neither. */
  "WQ_UNKNOWN_ATTR",
]);

const notACard = (q: Question): string | null => {
  if (q.options.length > 0)
    return "this card has answers to choose between; a flashcard is a front and a `>` back, with no checklist";
  if (!q.card) return "the heading has no `card`: write `{card}` at the end of it";
  return null;
};

/** What a reply holds: the cards that pass, and what is wrong with the ones that do not. */
export type Read = { cards: Card[]; problems: CardProblem[] } | { none: string };

/**
 * Read one reply: every `##` question in it through `parseQuiz`, and only the askable flashcards
 * kept. A reply with no question in it at all — a refusal, a paragraph — is `none`, and what it said
 * is kept so the page can say why nothing came back.
 */
export function readCards(reply: string, count: number = CARDS_MAX): Read {
  const quiz = parseQuiz(unwrapped(reply));
  if (quiz.questions.length === 0) {
    const said = reply.trim().replace(/\s+/g, " ");
    return {
      none: said
        ? `The model answered without a single flashcard: “${said.length > 280 ? `${said.slice(0, 279)}…` : said}”`
        : "The model gave an empty answer.",
    };
  }
  const cards: Card[] = [];
  const problems: CardProblem[] = [];
  quiz.questions.forEach((q, i) => {
    const from = q.line;
    const to = i + 1 < quiz.questions.length ? quiz.questions[i + 1]!.line : Infinity;
    const said = quiz.diagnostics.filter((d) => d.line >= from && d.line < to && !IGNORED.has(d.code));
    const wrong: { code: string; message: string }[] = said.map((d) => ({ code: d.code, message: d.message }));
    const not = notACard(q);
    if (not) wrong.unshift({ code: CODES.EG_NOT_A_CARD, message: not });
    if (wrong.length === 0 && !askable(q)) wrong.push({ code: "EQ_NO_OPTIONS", message: "this card has no back" });
    if (wrong.length) {
      for (const w of wrong) problems.push({ card: i + 1, front: q.prompt, ...w });
      return;
    }
    if (cards.length >= count) return;
    cards.push({
      front: q.prompt,
      body: q.body,
      back: q.why,
      markdown: renderQuestion({ prompt: q.prompt, body: q.body, options: [], why: q.why, card: true }),
    });
  });
  /* A code block opened and never closed swallowed whatever came after it: a problem with the deck. */
  for (const d of quiz.diagnostics)
    if (d.code === "WQ_OPEN_FENCE" && d.line < (quiz.questions[0]?.line ?? Infinity))
      problems.push({ card: 0, front: "", code: d.code, message: d.message });
  return { cards, problems };
}

/** What the model is told about its last answer: every problem, one line each, by card and code. */
export function cardsFeedback(problems: readonly CardProblem[]): string {
  return [
    "AnyDag's quiz parser reported these problems with your flashcards:",
    "",
    ...problems.map(
      (p) =>
        `- ${p.card ? `card ${p.card}${p.front ? ` (“${p.front}”)` : ""}` : "before the first card"} ${p.code} — ${p.message}`,
    ),
    "",
    "Fix every one of them and answer with the whole deck again — every card, in the same form, nothing after the last one.",
  ].join("\n");
}

/** More cards wins, then fewer problems. */
const better = (a: { cards: Card[]; problems: CardProblem[] }, b: { cards: Card[]; problems: CardProblem[] }) =>
  b.cards.length - a.cards.length || a.problems.length - b.problems.length;

export async function generateCards(o: CardsOptions): Promise<CardsResult> {
  const count = cardCount(o.count);
  const max = Math.max(1, o.attempts ?? 3);
  const messages: Message[] = [
    { role: "system", content: o.system },
    { role: "user", content: cardsRequest({ topic: o.topic, note: o.note, count }) },
  ];

  let best: { cards: Card[]; problems: CardProblem[] } | undefined;
  let lastNone = "";
  let used = 0;

  for (let n = 1; n <= max; n++) {
    o.signal?.throwIfAborted();
    used = n;
    const reply = await o.complete(messages, o.signal);
    const read = readCards(reply, count);
    if ("none" in read) {
      lastNone = read.none;
      if (n < max)
        messages.push(
          { role: "assistant", content: reply },
          {
            role: "user",
            content:
              "I could not find a flashcard in your reply. Answer with the cards only: each a `## Front {card}` heading and a `> back` quote under it.",
          },
        );
      continue;
    }
    if (!best || better(read, best) < 0) best = read;
    if (read.problems.length === 0 && read.cards.length > 0) break;
    if (n < max) messages.push({ role: "assistant", content: reply }, { role: "user", content: cardsFeedback(read.problems) });
  }

  if (!best || best.cards.length === 0)
    return {
      ok: false,
      cards: [],
      problems: best?.problems ?? [],
      attempts: used,
      error:
        lastNone ||
        (best?.problems.length
          ? `None of the model's cards could be read as a flashcard: ${best.problems[0]!.message}.`
          : "The model gave no answer."),
    };
  return { ok: true, cards: best.cards, problems: best.problems, attempts: used };
}
