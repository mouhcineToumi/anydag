/**
 * The search card's answer to what is typed: asked of the server, one query at a time.
 *
 * **The page never holds the vault's text.** `GET /__board/search` reads, matches, ranks and cuts the
 * snippets (`server/routes/docs.ts`, `src/search/engine.ts`), and this draws what comes back — a few
 * dozen hits, not the vault. Memory in the page does not grow with the vault, and a window
 * opened on a big vault no longer builds an index of its own to answer one question.
 *
 * Two rules keep the requests few:
 *
 * - **Debounced.** A request goes out once typing has paused, not on every key, so `payments` is one
 *   request and not eight. The server reads the vault on each one, which is the cost to spare it.
 * - **Cancelled when superseded.** A newer query, a change, or the card shutting aborts the request
 *   in flight, and an answer that arrives late is dropped, so a slow answer to `pay` never replaces
 *   the fast one to `payments`.
 *
 * What is drawn stays until the next answer lands, so the list does not blink between keys; `settled`
 * says whether it is the answer to the query now in the box, which is what "nothing matches" and
 * the offer to make a file wait for.
 *
 * Because every query reads the vault, a word an agent wrote a moment ago is found on the next one.
 * While the card is open the same query is asked again after the change feed says something moved
 * — at most one wait after the *first* change, for the reason `useIndex` gives: a debounce that restarts
 * on every change never fires while an agent keeps writing.
 */
import { useEffect, useRef, useState } from "react";

import { onBoard, onBoards, onNote, onQuiz, onTable } from "@/board/events";

import { asker, type Asker } from "./ask";
import type { Found } from "./wire";

/** After a change, how long to wait for more before asking again. */
const SETTLE = 800;

export interface Answer {
  hits: Found[];
  /** Whether `hits` answers the query as it stands now — before it, "no hits" means "not yet". */
  settled: boolean;
}

const NONE: Found[] = [];

export function useSearch(query: string): Answer {
  const [answer, setAnswer] = useState<{ query: string; hits: Found[] } | null>(null);
  /* Bumped by the change feed: the same query, asked again. */
  const [changed, setChanged] = useState(0);
  const asking = useRef<Asker | null>(null);

  useEffect(() => {
    const a = asker((q, hits) => setAnswer({ query: q, hits }));
    asking.current = a;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setChanged((n) => n + 1);
      }, SETTLE);
    };
    /* A quiz's questions and a table's rows are search results too. */
    const off = [onBoard(soon), onNote(soon), onQuiz(soon), onTable(soon), onBoards(soon)];
    return () => {
      for (const f of off) f();
      if (timer) clearTimeout(timer);
      a.stop();
      asking.current = null;
    };
  }, []);

  useEffect(() => {
    if (query.trim()) asking.current?.ask(query);
    else {
      asking.current?.stop();
      setAnswer(null);
    }
  }, [query, changed]);

  if (!answer || !query.trim()) return { hits: NONE, settled: false };
  return { hits: answer.hits, settled: answer.query === query };
}
