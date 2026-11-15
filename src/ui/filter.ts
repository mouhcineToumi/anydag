import { assertNever } from "@/board/useBoard";
import type { NoteEvent } from "@/note/event";
import type { Project } from "@/note/project";
import type { Task } from "@/note/task";

import { keyOf, type Entry, type Tree } from "./tree";

/**
 * Which kinds of file the Files tree shows (#360), with no DOM in it.
 *
 * **The rows are the kinds the tree already tells apart by its own mark.** A note, a task, a
 * project, an event, a board, a quiz, a table and an attachment each wear a different icon in a row
 * (`FileIcon` in `Sidebar.tsx`), so the menu that hides them is a row each and not a second
 * vocabulary. An event — a note with a `start:` and no `status:` — has a row of its own rather than
 * counting as a note: the tree draws it with a calendar clock, and a *Notes* row that also took
 * events away would hide a file wearing a mark the row does not carry. The three note-shaped kinds
 * are read in the order the icon is chosen — project, then task, then event — so the row that hides
 * a file is the row whose mark it wears.
 *
 * The choice is view state, so it is a list of what is **hidden** rather than what is shown: a kind
 * added in a later version is shown to everybody who has not said otherwise. `parseHidden` reads
 * what `Sidebar.tsx` keeps under `dag:sidebar-hidden`, per vault and this browser's, the way
 * `dag:sidebar-open` remembers the folders.
 */
export type ShownKind = "note" | "task" | "project" | "event" | "board" | "quiz" | "table" | "attachment";

/** The rows of *Show in Files*, in the order they are drawn: the note-shaped kinds first, then the rest. */
export const SHOWN_KINDS: readonly ShownKind[] = ["note", "task", "project", "event", "board", "quiz", "table", "attachment"];

/** What a row calls its kind, and what the heading says when it is hidden — agreeing in number. */
export const SHOWN_WORDS: Readonly<Record<ShownKind, readonly [one: string, many: string]>> = {
  note: ["note", "notes"],
  task: ["task", "tasks"],
  project: ["project", "projects"],
  event: ["event", "events"],
  board: ["board", "boards"],
  quiz: ["quiz", "quizzes"],
  table: ["table", "tables"],
  attachment: ["attachment", "attachments"],
};

/** The menu's row labels. Sentence case everywhere else, but a row of kinds is a list of names. */
export const SHOWN_LABEL: Readonly<Record<ShownKind, string>> = {
  note: "Notes",
  task: "Tasks",
  project: "Projects",
  event: "Events",
  board: "Boards",
  quiz: "Quizzes",
  table: "Tables",
  attachment: "Attachments",
};

/**
 * The three note-shaped records the listing carries, by name. A note wears the mark of the first one
 * it is in, which is the order `FileIcon` already uses: a project note that also has a status is a
 * project.
 */
export interface Kinds {
  tasks: Readonly<Record<string, Task>>;
  projects: Readonly<Record<string, Project>>;
  events: Readonly<Record<string, NoteEvent>>;
}

/** What kind of file a row would show this as — the mark it wears, which is what a filter row hides. */
export function shownKind(e: Entry, kinds: Kinds): ShownKind {
  switch (e.kind) {
    case "board":
      return "board";
    case "quiz":
      return "quiz";
    case "table":
      return "table";
    case "file":
      return "attachment";
    case "note":
      if (kinds.projects[e.name]) return "project";
      if (kinds.tasks[e.name]) return "task";
      if (kinds.events[e.name]) return "event";
      return "note";
    default:
      return assertNever(e.kind);
  }
}

/**
 * The tree with the kinds in `hidden` taken out, and **every folder left where it was**.
 *
 * A folder stays even when everything in it is hidden, so a filtered tree keeps the vault's shape
 * and a folder does not appear at a moment's notice when a kind is shown again. `keep` is the open
 * file's key: the file somebody is looking at stays in the tree whatever its kind, so the column
 * never hides where they are. The same tree feeds the virtual rows, the keyboard walk and every drop
 * target, so a filtered tree is walked, scrolled and dragged exactly like an unfiltered one.
 */
export function filterByKind(node: Tree, hidden: ReadonlySet<ShownKind>, kinds: Kinds, keep: string | null = null): Tree {
  if (!hidden.size) return node;
  const files = node.files.filter((e) => !hidden.has(shownKind(e, kinds)) || keyOf(e) === keep);
  const folders = node.folders.map((f) => filterByKind(f, hidden, kinds, keep));
  return { ...node, files, folders };
}

/** How many files of each kind a list holds, for the counts beside the menu's rows. */
export function kindCounts(entries: readonly Entry[], kinds: Kinds): Record<ShownKind, number> {
  const out: Record<ShownKind, number> = {
    note: 0,
    task: 0,
    project: 0,
    event: 0,
    board: 0,
    quiz: 0,
    table: 0,
    attachment: 0,
  };
  for (const e of entries) out[shownKind(e, kinds)] += 1;
  return out;
}

/**
 * What this browser kept under `dag:sidebar-hidden`, as the set of hidden kinds.
 *
 * Anything the list does not know — a kind this version has no row for, a value half written — is
 * dropped rather than treated as hidden. A missing value means everything is shown.
 */
export function parseHidden(raw: string | null): ReadonlySet<ShownKind> {
  if (!raw) return new Set();
  try {
    const kept = JSON.parse(raw) as unknown;
    if (!Array.isArray(kept)) return new Set();
    return new Set(
      kept.filter((kind): kind is ShownKind => typeof kind === "string" && (SHOWN_KINDS as readonly string[]).includes(kind)),
    );
  } catch {
    return new Set();
  }
}

/**
 * What the Files heading says after its name: `tasks hidden`, `notes and boards hidden`, or
 * `3 kinds hidden` — so a filtered tree is never mistaken for an empty vault. Empty for nothing
 * hidden, which is what keeps the heading plain while everything is shown.
 */
export function hiddenWords(hidden: ReadonlySet<ShownKind>): string {
  const words = SHOWN_KINDS.filter((kind) => hidden.has(kind)).map((kind) => SHOWN_WORDS[kind][1]);
  if (words.length === 0) return "";
  if (words.length === 1) return `${words[0]} hidden`;
  if (words.length === 2) return `${words[0]} and ${words[1]} hidden`;
  return `${words.length} kinds hidden`;
}
