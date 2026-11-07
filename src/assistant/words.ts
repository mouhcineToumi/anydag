/**
 * What a turn says, in words: a tool call as one readable line, a block's files, a chat's age. No
 * React here, so `test/` can hold it in Node if it is ever worth it.
 */

import type { Block, Step, UndoRecord } from "./types";

/** `mcp__anydag__note_create` (Claude Code), `anydag_note_create` (OpenCode) and `note_create` are one tool. */
const toolName = (name: string): string => name.replace(/^mcp__anydag__/, "").replace(/^anydag_/, "");

const KINDS: Record<string, [one: string, many: string]> = {
  note: ["a note", "notes"],
  board: ["a board", "boards"],
  quiz: ["a quiz", "quizzes"],
  table: ["a table", "tables"],
  task: ["a task", "tasks"],
  project: ["a project", "projects"],
  event: ["an event", "events"],
  file: ["a file", "files"],
  image: ["an image", "images"],
  folder: ["a folder", "folders"],
  component: ["a component", "components"],
  workspace: ["a vault", "vaults"],
  vault: ["a vault", "vaults"],
  trash: ["the trash", "the trash"],
  library: ["the library", "the library"],
  dsl: ["the diagram grammar", "the diagram grammar"],
};

/* The verb a tool's last word names: past tense for one thing, and how it reads for a list. */
const VERBS: Record<string, string> = {
  create: "Made",
  read: "Read",
  get: "Opened",
  write: "Rewrote",
  edit: "Edited",
  patch: "Changed",
  set: "Updated",
  delete: "Deleted",
  rename: "Renamed",
  title: "Retitled",
  duplicate: "Duplicated",
  move: "Moved",
  mv: "Moved",
  mkdir: "Made a folder",
  rmdir: "Removed a folder",
  mvdir: "Moved a folder",
  restore: "Restored",
  empty: "Emptied",
  upload: "Added",
  add: "Added",
  share: "Shared",
  answer: "Answered",
  check: "Checked",
  diagnose: "Checked",
  fences: "Read the diagrams in",
  questions: "Read the questions of",
  mistakes: "Read the mistakes of",
};

/** What a tool call was about, if its input says: a name, a title, a query. */
export function targetOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  for (const k of ["name", "title", "query", "q", "folder", "path", "to", "id"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  }
  return null;
}

/**
 * One line for a tool call, in the plan's words: `note_create` is *Made a note*, `note_list` *Listed
 * notes*, `doc_create` with `kind: "note"` the same, a tool this does not know is its own name with
 * the underscores taken out.
 */
export function verbOf(raw: string, input?: unknown): string {
  let name = toolName(raw);
  /* A chat's `doc_<op>` takes its kind as an argument (`server/mcp/chat.ts`): it reads as the named tool would. */
  const of = input && typeof input === "object" ? (input as { kind?: unknown }).kind : undefined;
  if (name.startsWith("doc_") && typeof of === "string" && KINDS[of]) name = `${of}_${name.slice(4)}`;
  if (name === "change_block") return "Started a block of changes";
  if (name === "vault_request") return "Asked for another vault";
  const [noun, ...rest] = name.split("_");
  const action = rest.join("_");
  const kind = noun ? KINDS[noun] : undefined;
  if (kind) {
    if (action === "list") return `Listed ${kind[1]}`;
    if (action === "search" || action === "find") return `Searched ${kind[1]}`;
    const verb = VERBS[action];
    if (verb) return /^(Made a|Removed a|Moved a|Read the|Emptied)/.test(verb) ? verb : `${verb} ${kind[0]}`;
  }
  if (name === "search") return "Searched the vault";
  if (name === "refs") return "Looked up references";
  if (name === "resolve") return "Looked up a reference";
  if (name === "whoami") return "Checked who it is";
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a tool call returned, trimmed to a line, for a collapsed row's hover. */
export const oneLine = (text: string | undefined, n = 120): string => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The files a block changed, by path, each once, in the order they were first touched. */
export function touched(block: Block): string[] {
  const seen = new Set<string>();
  for (const op of block.ops) for (const im of op.images) if (!im.rel.startsWith(".anydag/")) seen.add(im.rel);
  return [...seen];
}

/** Whether every op of a block can be undone; one that cannot says so, and the button is not offered. */
export const undoable = (block: Block): boolean => block.ops.length > 0 && block.ops.some((o) => o.undoable);

const OPENABLE: [suffix: string, kind: "board" | "note" | "quiz" | "table"][] = [
  [".board.md", "board"],
  [".quiz.md", "quiz"],
  [".table.md", "table"],
  [".note.md", "note"],
  /* A note is a plain `.md` in a vault (`server/names.ts`), so this is last: every other kind's suffix ends in it. */
  [".md", "note"],
];

/** A path the page can open, as the kind and name `open` takes; `null` for anything else. */
export function openable(rel: string): { kind: "board" | "note" | "quiz" | "table"; name: string } | null {
  for (const [suffix, kind] of OPENABLE) if (rel.endsWith(suffix)) return { kind, name: rel.slice(0, -suffix.length) };
  return null;
}

/** Whether a step is waiting for the person. */
export const waiting = (s: Step): boolean => (s.kind === "approval" || s.kind === "access") && s.answer === null;

/** How a block conflicted, in a sentence: the files an undo left alone and why. */
export function conflictLines(rec: UndoRecord): string[] {
  const why = { changed: "changed since", closed: "its vault is not open", big: "too big to have been kept", refused: "not a change this chat could have made" } as const;
  return rec.conflicts.map((c) => `${c.paths.length ? c.paths.join(", ") : c.what}: ${why[c.why]}`);
}

/** Today, Yesterday, or the date — what the history groups a chat under. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** The time of day a turn was said, for its header. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
