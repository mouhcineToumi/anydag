import { splitNote } from "@/note/format";
import { applyQuizOps } from "@/quiz/ops";
import { LlmRequestError, reasonOf } from "@/settings/llmReason";

/**
 * Flashcards from a model (#140), the half with no dialog in it: asking `/generate` for them, and
 * what keeping some of them *means* as a write — `src/edit/generate.ts`'s split, one kind over.
 *
 * The server checks the answer with `parseQuiz` before it is sent (`plugins/generate/cards.ts`), and
 * the write checks every card again: each goes in through the quiz's own `set` op, which refuses
 * anything that is not exactly one askable question, mints its id against the quiz it lands in, and
 * adds one question's span at the end. Nothing else in the file moves — no other question is
 * stamped, rewritten or reordered — and nothing at all is written if any card is refused.
 */

/** One card, as `/generate` answers it: `markdown` is what the `set` op is handed. */
export interface GeneratedCard {
  front: string;
  body: string;
  back: string;
  markdown: string;
}

export interface CardProblem {
  card: number;
  front: string;
  code: string;
  message: string;
}

/** The body of `POST /__board/generate` with `kind: "flashcards"`. */
export interface GeneratedCards {
  ok: boolean;
  cards: GeneratedCard[];
  problems: CardProblem[];
  attempts: number;
  error?: string;
}

export interface CardsRequest {
  /** The topic, or — with a note — what to focus on in it. */
  prompt: string;
  /** The note's text, its frontmatter left off. */
  source?: string;
  count: number;
  provider?: string | null;
  model?: string | null;
  reasoning?: string | null;
}

/** How many cards the dialog offers to ask for: the server's range (`CARDS_MIN`…`CARDS_MAX`). */
export const COUNT_MIN = 1;
export const COUNT_MAX = 30;
export const COUNT_DEFAULT = 10;

/**
 * Ask for flashcards. A refusal the server explains — no model set up, a note too long, the
 * provider down — is thrown as an `Error` carrying that explanation, which the dialog shows.
 */
export async function requestCards(req: CardsRequest, signal?: AbortSignal): Promise<GeneratedCards> {
  const res = await fetch("/__board/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "flashcards", ...req }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GeneratedCards> & { error?: string; reason?: unknown };
  if (!res.ok) throw new LlmRequestError(body.error ?? `the server answered ${res.status}`, reasonOf(body.reason));
  return { ok: false, cards: [], problems: [], attempts: 0, ...body };
}

/** A note's text as the model is handed it: the body, without its frontmatter. */
export const noteMaterial = (text: string): string => splitNote(text).body.trim();

/**
 * The quiz with the kept cards added at its end, one `set` op each — or why it could not be, and
 * then nothing is written. `markdown` is each card's, as `/generate` answered it.
 */
export function addCards(text: string, markdown: readonly string[]): { ok: true; text: string } | { ok: false; error: string } {
  const done = applyQuizOps(
    text,
    markdown.map((md) => ({ op: "set", markdown: md })),
  );
  return done.ok ? { ok: true, text: done.text } : { ok: false, error: done.error };
}
