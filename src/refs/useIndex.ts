/**
 * Every board, note and quiz this account has, with its title and the references it makes — the page's
 * copy of `GET /__board/index`.
 *
 * One copy for the whole page, however many things read it: a reference in a note, an embed, the
 * autocomplete and the backlinks panel all want the same answer, and a fetch each would be the
 * same request four times. Kept current by the change feed, **debounced**, because every drag on a
 * board is a write and the index reads every text the account has — a refetch per drag, per tab,
 * would be the most expensive thing the page did.
 */
import { useEffect, useSyncExternalStore } from "react";

import { onBoard, onBoards, onNote, onQuiz, onTable } from "@/board/events";
import { refresher } from "@/board/refresher";
import type { FileKind } from "@/board/useBoard";

import type { Project } from "@/note/project";
import type { NoteEvent } from "@/note/event";
import type { Task } from "@/note/task";
import { withVault } from "@/vault/current";

import type { Ref } from "./extract";

export interface IndexDoc {
  id: string;
  name: string;
  kind: FileKind;
  title?: string;
  /** What makes a note a task, when it is one — what a card that embeds it draws. */
  task?: Task | null;
  /** What makes a note a project, when it is one — what a card that places it says. */
  project?: Project | null;
  /** What makes a note an event, when it is one — when a card that places it says it is. */
  event?: NoteEvent | null;
  /** How many questions a quiz asks — what a quiz's card says. Only a quiz carries one. */
  questions?: number | null;
  /** How big an attachment is — what its card says beside its type. Only a file carries one. */
  bytes?: number | null;
  refs: Ref[];
}

export interface RefIndex {
  docs: IndexDoc[];
  byId: ReadonlyMap<string, IndexDoc>;
  /** Whether the first answer has arrived — before it, a missing target is unknown, not missing. */
  loaded: boolean;
}

const EMPTY: RefIndex = { docs: [], byId: new Map(), loaded: false };
let current: RefIndex = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let off: (() => void) | null = null;
/* The last answer as the server sent it, to tell a new answer from the same one again. */
let said = "";
/* Ids a reader met that the index did not know, each asked about once — see `seek`. */
const sought = new Set<string>();

/** After a change, how long to wait for more before asking again. */
const SETTLE = 800;

/* One request at a time; a caller arriving while one is out waits for that one — and a change
   arriving while one is out asks again once it lands, or the page keeps the answer from before the
   change for as long as nothing else happens to change. A request that gets no answer is asked again
   on its own, after a wait (`refresher`): waiting for the feed's next change left the index without
   a board the Assistant had just made, for good, once the Assistant had stopped writing (#123). */
const index = refresher(fetchIndex);
const load = (): Promise<void> => index.ask();

async function fetchIndex(): Promise<boolean> {
  const r = await fetch("/__board/index");
  if (!r.ok) return false;
  const body = await r.text();
  /* Most writes change nothing this says — a drag moves a card, a keystroke changes a word — and
     the same answer as a fresh object re-rendered every reader: the backlinks, the open library,
     and on a note page the editor under the caret, once a second while somebody typed. */
  if (current.loaded && body === said) return true;
  const { docs } = JSON.parse(body) as { docs: IndexDoc[] };
  said = body;
  current = { docs, byId: new Map(docs.map((d) => [d.id, d])), loaded: true };
  for (const l of listeners) l();
  return true;
}

/* At most one wait after the first change, not after the last: a debounce that restarts on every
   change never fires while other tabs keep writing, and an account with an agent at work is exactly
   that. */
function soon() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, SETTLE);
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  if (!off) {
    void load();
    const a = onBoard(soon);
    const b = onNote(soon);
    /* A quiz is a document with references and a title too, and a feed that heard only
       boards and notes would leave a renamed quiz under its old title on every card that names it. */
    const q = onQuiz(soon);
    /* And a table, whose link cells are references and whose title a card shows. */
    const t = onTable(soon);
    const c = onBoards(soon);
    off = () => (a(), b(), q(), t(), c());
  }
  return () => {
    listeners.delete(listen);
    if (listeners.size === 0 && off) {
      off();
      off = null;
      index.cancel();
    }
  };
}

/**
 * A reader met `id` and the index, which has answered, does not know it: ask the server again, once
 * per id. An id is minted by the server before anything can name it, so the first answer asked
 * for after something named it knows it — unless the document is gone, and then asking once is
 * enough. This is what makes an embed of a board the page has not heard of yet draw it, rather than
 * staying a card until somebody else happens to write: the feed's change for the new board can be
 * missed (a stream reconnecting, a tab that dozed), and the note naming it arrives on its own.
 */
export function seek(id: string): void {
  if (!current.loaded || current.byId.has(id) || sought.has(id)) return;
  sought.add(id);
  soon();
}

/** `seek`, from a component, for as long as it draws `id` and the index does not know it. */
export function useSeek(id: string | undefined, known: boolean, loaded: boolean): void {
  useEffect(() => {
    if (id && loaded && !known) seek(id);
  }, [id, known, loaded]);
}

/**
 * The index as it is right now, without subscribing to it — for a reader that asks at a moment of
 * its own choosing, like a picker opening, and must not re-render every time somebody else writes.
 * Starts the subscription if nothing has, so the answer is there by the time anybody asks.
 */
export async function readIndex(): Promise<RefIndex> {
  if (!off) subscribe(() => {});
  /* A picker opened before the first answer would otherwise offer nothing, and BlockNote does not
     ask again when the answer lands — so the first question waits for it. */
  if (!current.loaded) await load();
  return current;
}

export function useIndex(): RefIndex {
  return useSyncExternalStore(subscribe, () => current);
}

/** What a document is called: its own title, or the last part of its name. */
export const titleOf = (d: Pick<IndexDoc, "title" | "name">): string => d.title ?? d.name.slice(d.name.lastIndexOf("/") + 1);

/** Every document that references this one — the backlinks — each once, in name order. */
export function backlinksOf(index: RefIndex, id: string): IndexDoc[] {
  return index.docs.filter((d) => d.id !== id && d.refs.some((r) => r.id === id));
}

/**
 * Where following a reference goes. Inside the read-only view it stays read-only; anywhere else it
 * opens the target to be worked on. `?ref=` is resolved by whichever page reads it, so the link
 * carries the id and never a name that a rename would break.
 */
export function hrefFor(id: string, part?: string): string {
  const view = new URLSearchParams(location.search).get("view") === "1";
  /* In this tab's workspace: an id resolves within the workspace it is asked in. */
  return withVault(`?${view ? "view=1&" : ""}ref=${id}${part ? `#${encodeURIComponent(part)}` : ""}`);
}
