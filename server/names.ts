/**
 * What a file in a vault is, read off its path — and what a name off the wire becomes.
 *
 * A name here is any **portable** file name, not a lower-case slug: an Obsidian vault holds
 * `Meeting notes.md`, `Q3 Plan.md`, and a file the app makes is named after its title, verbatim —
 * the rules Windows and macOS impose, applied on Linux too, because a vault made on one has to
 * open on the others. Case-insensitively unique for the same reason: two names that differ only by
 * case are one file on a Mac.
 *
 * A name is vault-relative, `/`-separated, and carries no kind suffix: `work/plan` is the board
 * `work/plan.board.md`, or the note `work/plan.md`. An attachment's name is its file's, extension
 * and all: `attachments/q3 report.pdf`.
 */

import { DEFAULT_TYPES } from "./uploads";

export type TextKind = "board" | "note" | "quiz" | "table";
export type Kind = TextKind | "file";

export const TEXT_KINDS: readonly TextKind[] = ["board", "note", "quiz", "table"];
export const KINDS: readonly Kind[] = [...TEXT_KINDS, "file"];

/** Every text kind and the suffix it is stored under. A note has two: `.md` first. */
export const SUFFIX: Readonly<Record<TextKind, string>> = {
  board: ".board.md",
  quiz: ".quiz.md",
  table: ".table.md",
  note: ".note.md",
};

/** The suffixes a note may be stored under, the one a new note is written with first. */
export const NOTE_SUFFIXES = [".md", ".note.md"] as const;

/** What each kind is called when there are several — the key a listing and a removal answer under. */
export const PLURAL: Readonly<Record<Kind, string>> = {
  board: "boards",
  note: "notes",
  quiz: "quizzes",
  table: "tables",
  file: "files",
};

/** A kind off the wire: `board` when absent, `null` when it is not a text kind. */
export function kindOf(raw: unknown): TextKind | null {
  if (raw === undefined || raw === null || raw === "") return "board";
  return typeof raw === "string" && (TEXT_KINDS as readonly string[]).includes(raw) ? (raw as TextKind) : null;
}

/** `kindOf`, with `file` as well — for the routes that act on a document without reading its text. */
export function anyKindOf(raw: unknown): Kind | null {
  return raw === "file" ? "file" : kindOf(raw);
}

/** A file's extension, lower case, without its dot; `""` when it has none. */
export function extOf(name: string): string {
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}

/**
 * What a file is, by its vault-relative path, or `null` when it is none of the kinds. `types` are
 * the extensions this vault lists as attachments.
 */
export function classify(path: string, types: ReadonlySet<string> = DEFAULT_SET): { kind: Kind; name: string } | null {
  const lower = path.toLowerCase();
  for (const kind of ["board", "quiz", "table", "note"] as const) {
    const ext = SUFFIX[kind];
    if (lower.endsWith(ext) && path.length > ext.length) return { kind, name: path.slice(0, -ext.length) };
  }
  if (lower.endsWith(".md") && path.length > 3) return { kind: "note", name: path.slice(0, -3) };
  const ext = extOf(path);
  if (ext && types.has(ext)) return { kind: "file", name: path };
  return null;
}

const DEFAULT_SET: ReadonlySet<string> = new Set(DEFAULT_TYPES);

/**
 * A directory or file the walk never enters or lists: a dot-entry (`.anydag`, `.obsidian`, `.git`,
 * `.trash`, `.stversions`), a document's legacy picture folder, `node_modules`, and what sync tools
 * leave beside the files they sync.
 */
export function ignored(segment: string): boolean {
  return (
    segment.startsWith(".") ||
    segment.endsWith(".assets") ||
    segment.includes(".sync-conflict-") ||
    segment.endsWith(".icloud") ||
    segment === "node_modules"
  );
}

const ILLEGAL = /[:*?"<>|\\\x00-\x1f]/;
const ILLEGAL_ALL = /[:*?"<>|\\\x00-\x1f]/g;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Longer than anyone names a file, short enough that the path stays inside Windows' limits. */
const SEGMENT_MAX = 120;

/**
 * Why `name` cannot be a name in a vault, or `null` when it can.
 *
 * Refused on every platform: a segment with a character Windows will not store, a Windows device
 * name, a trailing dot or space (Windows strips both, so two names would be one file), an empty or
 * `.`/`..` segment, and an absolute path. A hidden segment is refused as well, because the walk
 * never lists one and a file nobody can see is a file nobody can open again.
 */
export function refusal(name: string): string | null {
  if (!name) return "a name cannot be empty";
  if (name.startsWith("/")) return "a name is relative to the vault";
  for (const seg of name.split("/")) {
    if (!seg) return "a name cannot have an empty part";
    if (seg === "." || seg === "..") return "a name cannot climb out of the vault";
    if (ILLEGAL.test(seg)) return `\`${seg}\` holds a character Windows cannot store`;
    if (DEVICE.test(seg)) return `\`${seg}\` is a name Windows reserves`;
    if (/[. ]$/.test(seg)) return `\`${seg}\` ends in a dot or a space`;
    if (ignored(seg)) return `\`${seg}\` is hidden from the vault`;
  }
  return null;
}

/**
 * One segment off the wire made portable: what a name may not hold taken out, never replaced by
 * something it did not say — `Q3: plan?` is `Q3 plan` — whitespace collapsed, leading dots and
 * trailing dots and spaces dropped, a device name given a trailing `_`, capped. `""` when nothing is
 * left.
 */
export function cleanSegment(raw: string): string {
  let s = raw.replace(ILLEGAL_ALL, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  if (s.length > SEGMENT_MAX) s = s.slice(0, SEGMENT_MAX).replace(/[. ]+$/, "");
  if (DEVICE.test(s)) s += "_";
  if (ignored(s)) s = s.replace(/\.assets$/i, " assets").replace(/\.sync-conflict-/gi, " sync-conflict-").replace(/\.icloud$/i, " icloud");
  return s === "node_modules" ? "node modules" : s;
}

const KIND_SUFFIX = /\.board\.md$|\.note\.md$|\.quiz\.md$|\.table\.md$|\.md$/i;

/**
 * A document's name off the wire: its kind's suffix taken off, every segment made portable, and
 * empty segments dropped — so `a//b` and `a/b` are one name. `fallback` when nothing is left.
 */
export function nameFrom(raw: unknown, fallback = "Untitled"): string {
  const text = String(raw ?? "").replace(/\\/g, "/").replace(KIND_SUFFIX, "");
  const segs = text.split("/").map(cleanSegment).filter(Boolean);
  return segs.length ? segs.join("/") : fallback;
}

/**
 * The name a title files a document under, in `folder`: the title verbatim, with what
 * a file name may not hold taken out — and a `/` is a character of the title, never a folder.
 */
export function titleName(title: string, folder = ""): string {
  const leaf = cleanSegment(title.replace(/\//g, "-")) || "Untitled";
  return folder ? `${folder}/${leaf}` : leaf;
}

/** A name's last segment — what a file nobody titled is called. */
export const leafOf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

/** The folder a name is in, `""` at the top. */
export const folderOf = (name: string): string => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");

/**
 * An attachment's name off the wire: its folder and stem made portable, its extension kept, or
 * `null` when it has none this vault could list.
 */
export function fileNameFrom(raw: unknown, types: ReadonlySet<string> = DEFAULT_SET): string | null {
  const text = String(raw ?? "").replace(/\\/g, "/").trim();
  const leaf = text.slice(text.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0 && !(dot === 0 && leaf.length > 1)) return null;
  const ext = leaf.slice(dot + 1).trim().toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(ext) || ext === "md" || ext === "assets" || !types.has(ext)) return null;
  const folder = text.slice(0, text.lastIndexOf("/") + 1);
  const stem = cleanSegment(leaf.slice(0, dot)) || "file";
  const dir = folder ? nameFrom(folder, "") : "";
  return `${dir ? `${dir}/` : ""}${stem}.${ext}`;
}

/**
 * Where an attachment renamed or moved to `to` lands: `to` made a file's name, **with the file's own
 * extension** whatever `to` ends in — a rename does not change what a file is.
 */
export function fileTarget(name: string, to: string, types: ReadonlySet<string> = DEFAULT_SET): string {
  const ext = extOf(name);
  const asked = extOf(to) === ext ? fileNameFrom(to, types) : null;
  return asked ?? fileNameFrom(`${to}.${ext}`, new Set([ext])) ?? name;
}

/**
 * A folder name off the wire: a name allowed to be empty (`""` is the top level). `null` is a
 * refusal: a hidden folder, or a document's legacy picture folder, is not a folder a person may make.
 */
export function folderFrom(raw: unknown): string | null {
  const asked = String(raw ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (asked.some((p) => p.startsWith(".") || /\.assets$/i.test(p) || p === "node_modules")) return null;
  return asked.map(cleanSegment).filter(Boolean).join("/");
}

/** The two ends of a folder move, made portable — or the reason it is refused. */
export function folderMove(rawFrom: unknown, rawTo: unknown): [string, string] | string {
  const src = folderFrom(rawFrom);
  const dst = folderFrom(rawTo);
  if (src === null || dst === null) return `\`${String(src === null ? rawFrom : rawTo)}\` is not a folder name`;
  if (!src || !dst) return "the top level is not a folder";
  if (same(dst, src) || lower(dst).startsWith(`${lower(src)}/`)) {
    if (same(dst, src)) return [src, dst];
    return `\`${src}\` cannot go inside itself`;
  }
  return [src, dst];
}

const lower = (s: string): string => s.toLowerCase();

/** Whether two names are one file on a case-insensitive disk. */
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The first name in this family nobody is using: `plan`, then `plan 2`, `plan 3` — Obsidian's
 * spelling, which reads as a name a person would give. **It numbers any name that is taken, the
 * caller's own included**: a rename to the name a document already has is refused before it gets
 * here. `taken` is asked case-insensitively by the store.
 */
export function unique(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  let n = 2;
  while (taken(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/** `unique` for an attachment: the number goes before the extension — `q3 report 2.pdf`. */
export function uniqueFile(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  let n = 2;
  while (taken(`${stem} ${n}${ext}`)) n++;
  return `${stem} ${n}${ext}`;
}

/** Where a document's pasted images sat before attachments took them: `work/plan` → `work/plan.assets`. */
export const assetsPrefix = (name: string): string => `${name}.assets`;
