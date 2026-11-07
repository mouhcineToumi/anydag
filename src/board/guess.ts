/**
 * The list as it will be, before the server says so.
 *
 * A rename, a move, a delete or a new folder in the sidebar waited for its round trip and then for
 * the list to be fetched again — two round trips on the document store before the row moved, which
 * read as a click that had not taken. Now the call is made and **a guess** is put on top of the list
 * at once: the row is renamed, moved or gone, or the folder is there. The guess stays on top of
 * whatever the list holds until the call answers:
 *
 * - **refused**, it is taken off at once and the row is back where it was, beside the reason the
 *   sidebar already says;
 * - **done**, it stays until a list *asked for after the answer* arrives, so the row never flickers
 *   back to how it was between the answer and the fetch that shows it.
 *
 * Module state rather than a hook's, because every list on the page draws the same guess: the
 * sidebar, and the Tasks page or the calendar behind it. A guess is about names and never about a
 * file's text, so nothing here is a write, and a reload simply drops it.
 */

import type { BoardTree, FileKind } from "./useBoard";

/* `ui/tree.ts`'s two, restated rather than imported upward into the board layer. */
const leaf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);
const rebase = (name: string, from: string, to: string): string =>
  name === from ? to : name.startsWith(`${from}/`) ? to + name.slice(from.length) : name;

export type Guess =
  /** A file renamed or moved: `to` is the name it is asked to have, which the server may number. */
  | { op: "move"; kind: FileKind; from: string; to: string }
  /** A file gone to the trash. */
  | { op: "remove"; kind: FileKind; name: string }
  /** A file being made, with the title it will carry. */
  | { op: "add"; kind: FileKind; name: string; title: string }
  /** A file called something else; its name follows, when it does, once the server answers. */
  | { op: "title"; kind: FileKind; name: string; title: string }
  | { op: "folder-move"; from: string; to: string }
  | { op: "folder-remove"; path: string }
  | { op: "folder-add"; path: string };

/** Said on the window when a guess is made or let go, so every list redraws. */
export const GUESSED = "dag:guessed";

interface Held {
  guess: Guess;
  /** The clock when the call answered yes; `null` while it is out. */
  done: number | null;
}

const held = new Map<number, Held>();
let ids = 0;
/* One clock for answers and for list fetches, so "asked after the answer" is a comparison. */
let clock = 0;

/** A tick of the clock: what a list fetch is stamped with when it is asked for. */
export function tick(): number {
  return ++clock;
}

function told(): void {
  if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent(GUESSED));
}

/**
 * Put a guess on the list. Returns what to call when the server answers: `true` keeps it until a
 * list asked for after now arrives, `false` takes it off now.
 */
export function guess(g: Guess): (ok: boolean) => void {
  const id = ++ids;
  held.set(id, { guess: g, done: null });
  told();
  let settled = false;
  return (ok) => {
    if (settled) return;
    settled = true;
    const h = held.get(id);
    if (!h) return;
    if (!ok) held.delete(id);
    else h.done = tick();
    told();
    /* The list is asked for again either way: done, to bring the row the server settled on; refused,
       to be sure nothing else moved under the guess. */
    if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent("dag:boards"));
  };
}

/**
 * Forget every guess a list asked for at `stamp` already shows: one the server agreed to before
 * that list was asked for. Called when such a list lands; a guess still out is kept.
 */
export function shown(stamp: number): void {
  let any = false;
  for (const [id, h] of held) {
    if (h.done !== null && h.done < stamp) {
      held.delete(id);
      any = true;
    }
  }
  if (any) told();
}

const LISTS: Record<FileKind, "boards" | "notes" | "quizzes" | "tables" | "files"> = {
  board: "boards",
  note: "notes",
  quiz: "quizzes",
  table: "tables",
  file: "files",
};

/* Every by-name map on the list, which a guess has to carry along with the name. */
const MAPS = ["titles", "tasks", "projects", "events", "created", "ids", "questions", "sizes"] as const;

type Mutable = { -readonly [K in keyof BoardTree]: BoardTree[K] };

function renamed(t: Mutable, kind: FileKind, from: string, to: string | null): void {
  const list = LISTS[kind];
  if (!t[list].includes(from)) return;
  t[list] = to === null ? t[list].filter((n) => n !== from) : t[list].map((n) => (n === from ? to : n));
  for (const key of MAPS) {
    const map = t[key] as Record<string, unknown> | undefined;
    if (!map || !(from in map)) continue;
    const next: Record<string, unknown> = { ...map };
    if (to !== null) next[to] = next[from];
    delete next[from];
    (t as Record<string, unknown>)[key] = next;
  }
}

const under = (name: string, path: string) => name === path || name.startsWith(`${path}/`);

/* A name some file already has. Every kind is one namespace, so a note's name is a board's too. */
const taken = (t: Mutable, name: string) => (Object.values(LISTS) as (typeof LISTS)[FileKind][]).some((l) => t[l].includes(name));

function apply(t: Mutable, g: Guess): void {
  switch (g.op) {
    case "move":
      /* Onto a name that is taken, the server numbers it — `plan-2` — and a guess of `plan` would
         be a second row under one name, carrying the other file's title and id. Not guessed: the
         row waits for the answer, as every row did before. */
      if (g.from !== g.to && !taken(t, g.to)) renamed(t, g.kind, g.from, g.to);
      return;
    case "remove":
      renamed(t, g.kind, g.name, null);
      return;
    case "add": {
      const list = LISTS[g.kind];
      if (t[list].includes(g.name)) return;
      t[list] = [...t[list], g.name];
      t.titles = { ...t.titles, [g.name]: g.title };
      return;
    }
    case "title":
      if (!t[LISTS[g.kind]].includes(g.name)) return;
      t.titles = { ...t.titles, [g.name]: g.title };
      return;
    case "folder-move":
      /* A folder is never merged into one that exists — the server refuses it — and guessing it
         would draw both folders' rows under one name until it did. */
      if (t.folders.includes(g.to)) return;
      for (const kind of Object.keys(LISTS) as FileKind[])
        for (const name of t[LISTS[kind]]) if (under(name, g.from)) renamed(t, kind, name, rebase(name, g.from, g.to));
      t.folders = t.folders.map((f) => (under(f, g.from) ? rebase(f, g.from, g.to) : f));
      if (!t.folders.includes(g.to)) t.folders = [...t.folders, g.to];
      return;
    case "folder-remove":
      for (const kind of Object.keys(LISTS) as FileKind[])
        for (const name of t[LISTS[kind]]) if (under(name, g.path)) renamed(t, kind, name, null);
      t.folders = t.folders.filter((f) => !under(f, g.path));
      return;
    case "folder-add":
      if (!t.folders.includes(g.path)) t.folders = [...t.folders, g.path];
      return;
  }
}

/**
 * The list with every guess still standing on top of it. `stamp` is the clock when the list was
 * asked for: a guess the server agreed to before then is already in it.
 */
export function guessed(tree: BoardTree, stamp: number): BoardTree {
  let t: Mutable | null = null;
  for (const h of held.values()) {
    if (h.done !== null && h.done < stamp) continue;
    t ??= { ...tree };
    apply(t, h.guess);
  }
  return t ?? tree;
}

/** The name a file moved into `folder` is asked to have — the server may number it. */
export function filedIn(name: string, folder: string): string {
  return folder ? `${folder}/${leaf(name)}` : leaf(name);
}

/** Every guess let go — for a test, and for a workspace switch, which reloads anyway. */
export function forgetGuesses(): void {
  held.clear();
}
