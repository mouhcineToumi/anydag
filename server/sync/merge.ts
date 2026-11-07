/**
 * The sync client's conflict table, as pure decisions: what a path is,
 * whether two versions of it merge, what a conflict copy is called and what it carries. No engine,
 * no disk, no network — every case is a unit test.
 *
 * Load-bearing:
 * - **A merge that breaks the grammar is not a merge.** A board, quiz or table whose line merge has
 *   errors where neither side had any becomes a conflict copy, like a merge that failed outright.
 * - **Settings and an attachment's id file merge by key** (`mergeKeys`), the favourites as a set,
 *   and are written back in one canonical form so two devices write the same bytes.
 * - **A binary never merges.** Identical bytes are the only agreement two pictures can have.
 * - **A conflict copy is a new document**, so it gets a fresh `id:`: two files with one id is the
 *   duplicate every device would otherwise have to break, and the original keeps every `dag:` link.
 * - **Never the `.sync-conflict-` spelling**, which the vault's walk hides (`ignored()`).
 */

import { diagnoseBoard } from "../../src/dsl/diagnose";
import { parseBoard } from "../../src/board/parseBoard";
import { merge3 } from "../../src/note/merge";
import { parseQuiz } from "../../src/quiz/parse";
import { mergeKeys, SETTINGS_SETS } from "../../src/settings/merge";
import { parseTable } from "../../src/table/parse";
import { frontId, mint, withId } from "../ids";
import { classify } from "../names";

const SETTINGS = ".anydag/settings.json";
const DOC_SUFFIXES = [".board.md", ".quiz.md", ".table.md", ".note.md", ".md"] as const;

const isDocument = (rel: string): boolean => {
  const lower = rel.toLowerCase();
  return DOC_SUFFIXES.some((s) => lower.endsWith(s) && rel.length > s.length) && classify(rel)?.kind !== "file";
};

/** Whether `rel` is text the client merges by line or by key: a document, or a `.json` under `.anydag/`. */
export function isText(rel: string): boolean {
  if (rel.startsWith(".anydag/") && rel.toLowerCase().endsWith(".json")) return true;
  return isDocument(rel);
}

/** Whether `rel` is JSON merged by key: the vault's settings, or an attachment's id file. */
export function isJson(rel: string): boolean {
  if (rel === SETTINGS) return true;
  const parts = rel.split("/");
  // An Assistant chat's `chat.json`: a rename here and a grant there both land.
  if (parts.length === 4 && parts[0] === ".anydag" && parts[1] === "chats" && parts[3] === "chat.json") return true;
  return parts.length === 3 && parts[0] === ".anydag" && parts[1] === "files" && parts[2]!.toLowerCase().endsWith(".json");
}

const STRICT = new TextDecoder("utf-8", { fatal: true });
const encode = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

function decode(bytes: Uint8Array): string | null {
  try {
    return STRICT.decode(bytes);
  } catch {
    return null;
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The grammar's errors in a text of the kind `rel` names; `0` for a kind with no grammar. */
function errorsIn(rel: string, text: string): number {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".board.md")) {
    const name = classify(rel)?.name ?? "board";
    return diagnoseBoard(parseBoard(name, text)).errors;
  }
  if (lower.endsWith(".quiz.md")) return parseQuiz(text).diagnostics.filter((d) => d.severity === "error").length;
  if (lower.endsWith(".table.md")) return parseTable(text).diagnostics.filter((d) => d.severity === "error").length;
  return 0;
}

export type MergeResult = { merged: Uint8Array } | { conflict: true };

/**
 * Two versions of `rel` against the version both came from. `base` is `null` when there is none
 * (both created the path independently): a text then merges against the empty text.
 */
export function mergeContent(rel: string, base: Uint8Array | null, ours: Uint8Array, theirs: Uint8Array): MergeResult {
  if (sameBytes(ours, theirs)) return { merged: theirs };
  if (!isText(rel)) return { conflict: true };

  const o = decode(ours);
  const t = decode(theirs);
  const b = base ? decode(base) : "";
  if (o === null || t === null || b === null) return { conflict: true };

  if (isJson(rel)) {
    const oo = parseObject(o);
    const to = parseObject(t);
    const bo = base ? parseObject(b) : null;
    if (!oo || !to || (base && !bo)) return { conflict: true };
    const merged = mergeKeys(bo, oo, to, rel === SETTINGS ? { sets: SETTINGS_SETS } : {});
    return { merged: encode(JSON.stringify(merged, null, 1) + "\n") };
  }

  const merged = merge3(b, o, t);
  if (merged === null) return { conflict: true };
  if (errorsIn(rel, merged) > 0 && errorsIn(rel, o) === 0 && errorsIn(rel, t) === 0) return { conflict: true };
  return { merged: encode(merged) };
}

/** `rel`'s kind suffix as it is spelled in `rel`: `.board.md`, …, `.md`, or a file's `.ext`. */
function suffixOf(rel: string): string {
  const leafAt = rel.lastIndexOf("/") + 1;
  const leaf = rel.slice(leafAt);
  const lower = leaf.toLowerCase();
  for (const s of DOC_SUFFIXES) if (lower.endsWith(s) && leaf.length > s.length) return leaf.slice(leaf.length - s.length);
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot) : "";
}

/** A device's name as a part of a file name: what Windows or macOS would refuse taken out. */
const deviceWord = (device: string): string => device.replace(/[/\\:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "device";

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Where theirs goes when it cannot merge with ours: `<stem> (conflict <device> <YYYY-MM-DD HH.mm>)<suffix>`
 * in local time, numbered ` 2`, ` 3` before the suffix while `taken` says the name is.
 */
export function conflictName(rel: string, device: string, at: Date, taken: (rel: string) => boolean): string {
  const suffix = suffixOf(rel);
  const stem = rel.slice(0, rel.length - suffix.length);
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  const head = `${stem} (conflict ${deviceWord(device)} ${when})`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${head}${suffix}` : `${head} ${n}${suffix}`;
    if (!taken(name)) return name;
  }
}

/**
 * The bytes a conflict copy is written with. Theirs was committed, so its `id:` is the one other
 * files may already link to, and it keeps it — unless ours, staying at the path, carries the same id
 * (one document edited on two devices), when the copy takes a fresh one so no two files share it.
 */
export function freshCopy(rel: string, bytes: Uint8Array, ours?: Uint8Array): Uint8Array {
  if (!isDocument(rel)) return bytes;
  const text = decode(bytes);
  if (text === null) return bytes;
  const id = frontId(text);
  if (typeof id !== "string") return bytes;
  if (ours !== undefined) {
    const mine = decode(ours);
    if (mine !== null && frontId(mine) !== id) return bytes;
  }
  return encode(withId(text, mint((x) => x === id)));
}
