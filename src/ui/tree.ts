import type { FileKind } from "@/board/useBoard";

/**
 * What the board list and the sidebar know about a set of files, with no DOM in it.
 *
 * These lived inside `BoardBrowser.tsx` while it was the only surface over them, which meant the only thing that had
 * ever run them was a Playwright check opening a dialog — and every defect fixed in them along the
 * way (a flat list headed by whole paths, a string sort that put `round-10` before
 * `round-2`, a folder holding only a subfolder called empty, emptiness read off the *filtered*
 * list) was found that way. Two surfaces read them now, the sidebar and the search, so they are a
 * module, and `test/tree.test.ts` is the first unit test they have had.
 */

/**
 * Every token has to appear somewhere in the path, in any order.
 *
 * A board name is words joined by `-` and `/`, so a single substring match makes a reader type the
 * separators from memory — `data-model`, not `data model`. Splitting the query on whitespace and
 * requiring each piece instead means "gym data" finds `gym-data-model` and "ref seq" finds
 * `reference/sequence`, which is how anyone actually reaches for a file they half remember.
 */
export function tokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

const matches = (name: string, terms: string[]): boolean => {
  const hay = name.toLowerCase();
  return terms.every((t) => hay.includes(t));
};

/**
 * One file in the list: a board, a note, a quiz or an attachment, by name. Two
 * files of different kinds never share a name, but the list does not rely on it.
 */
export interface Entry {
  kind: FileKind;
  name: string;
  /**
   * What the file is called, when its frontmatter says. The name is its identity here —
   * in a key, in a favourite, in every request — and the title is only ever what is drawn.
   */
  title?: string;
}

/** What a row says: the file's title, or the last part of its name for a file nobody titled. */
export const labelOf = (e: Entry): string => e.title ?? leaf(e.name);

/** What a search looks through for a file: what it is called and where it is. */
const hayOf = (e: Entry): string => (e.title ? `${e.title} ${e.name}` : e.name);

/** A stable key for an entry, for React and for the one question the list asks at a time. */
export const keyOf = (e: Entry): string => `${e.kind}:${e.name}`;

/** A folder and what is directly in it. The root is one of these, with an empty path. */
export interface Tree {
  /** The whole path, which is what the server calls this folder. `""` is the top level. */
  path: string;
  /** The last segment, which is all the heading says — its parents are drawn above it. */
  name: string;
  folders: Tree[];
  /** Boards, notes and quizzes together, sorted by what they are called: they are all files in this folder. */
  files: Entry[];
}

/* Numerically, so `round-2` comes before `round-10` rather than after `round-15`. Board names here
   are as often numbered as worded — `1-today`, `201-notes` — and a
   plain string sort scatters exactly the sets somebody made a folder for. */
const by = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * The folders as they actually are: nested.
 *
 * **This was a flat list of `{ folder, boards }` sorted by full path**, which is what a heading
 * saying `PROJECTS/201-NOTES/SVG` in 11px letterspaced caps came from — three levels of
 * structure spelled out on one line, at the one size in the card that is hardest to read, above a
 * board indented exactly as far as a board at the top level. Sorting by path put the descendants
 * next to their ancestor and left it at that; nothing said they were *in* it.
 *
 * A parent is created on demand, so a folder the server never listed still gets one rather than
 * being drawn at the top level under a name with slashes in it. The known folders are seeded
 * before the boards are walked, which is what keeps an empty folder visible — a person presses
 * "new folder", the directory appears on disk, and without this the list shows nothing back.
 *
 * **Folders before boards at every level**, which is every file browser's order and the other half
 * of the answer: the structure is the first thing on screen instead of being buried under twenty
 * loose boards. `last`, the vault's attachments folder, is the one folder that goes after its siblings.
 */
export function tree(entries: Entry[], folders: string[], last?: string): Tree {
  const root: Tree = { path: "", name: "", folders: [], files: [] };
  const at = new Map<string, Tree>([["", root]]);
  const open = (path: string): Tree => {
    const had = at.get(path);
    if (had) return had;
    const cut = path.lastIndexOf("/");
    const node: Tree = { path, name: path.slice(cut + 1), folders: [], files: [] };
    at.set(path, node);
    open(cut === -1 ? "" : path.slice(0, cut)).folders.push(node);
    return node;
  };
  for (const f of folders) open(f);
  for (const entry of entries) {
    const cut = entry.name.lastIndexOf("/");
    open(cut === -1 ? "" : entry.name.slice(0, cut)).files.push(entry);
  }
  /* Files by what they are called — a list drawn in titles and sorted by names
     would put "Zebra" first because its file is `a-plan` — and by name among files called the
     same, which is two boards both called Untitled, in the order they were made. */
  const sort = (node: Tree): Tree => {
    /* The vault's attachments folder goes after the other folders beside it: it is where the vault
       keeps what was pasted and dropped, not a place anybody files work (the UI review). */
    node.folders.sort((a, b) => Number(a.path === last) - Number(b.path === last) || by(a.name, b.name));
    node.files.sort((a, b) => by(labelOf(a), labelOf(b)) || by(a.name, b.name) || by(a.kind, b.kind));
    node.folders.forEach(sort);
    return node;
  };
  return sort(root);
}

/**
 * The same tree with everything the search excludes taken out, or `null` when nothing survives.
 *
 * A folder whose own path matches keeps *all* of its contents — `archive` means the folder, not
 * the boards in it whose names happen to contain the word — which is why `whole` rides down the
 * walk. Everything else survives by having something under it that matched, however deep, so an
 * ancestor is never dropped out from under a hit.
 */
export function prune(node: Tree, terms: string[], whole = false): Tree | null {
  const mine = whole || matches(node.path, terms);
  const files = mine ? node.files : node.files.filter((b) => matches(hayOf(b), terms));
  const folders = node.folders.map((f) => prune(f, terms, mine)).filter((f): f is Tree => f !== null);
  if (!mine && files.length === 0 && folders.length === 0) return null;
  return { ...node, files, folders };
}

/** Every file in the tree, in the order it is drawn — which is what Enter opens the first of. */
export function flatten(node: Tree): Entry[] {
  return [...node.folders.flatMap(flatten), ...node.files];
}

/**
 * The folders that really are empty, from the tree *before* the search narrowed it.
 *
 * `/rmdir` is never recursive and refuses anything with a single entry in it, subfolders included
 * — so the delete button may only appear on a folder that holds neither. Both halves of that were
 * wrong: it tested `boards.length === 0` on a flat section, which made a folder — holding
 * `svg/` and nothing else — draw "empty" and offer a delete the server would refuse, and it tested
 * the *filtered* list, which makes any folder look empty the moment a search excludes what is in
 * it. A button that would be refused is a lie, which is the rule the button was added under.
 */
export function emptyFolders(node: Tree, into = new Set<string>()): Set<string> {
  if (node.path && node.files.length === 0 && node.folders.length === 0) into.add(node.path);
  for (const f of node.folders) emptyFolders(f, into);
  return into;
}

/** What a folder holds, however deep: every file under it, and every folder under it — not itself. */
export interface Contents {
  files: Entry[];
  folders: string[];
}

/**
 * Everything under the folder at `path`, in the order it is drawn — what the delete-folder modal
 * counts and lists before anybody confirms. `null` for a folder the tree does not have.
 *
 * Read off the tree the sidebar draws, so what the modal says is what the person was looking at.
 * The server answers with what it really removed, which is what the page then lets go of.
 */
export function contents(root: Tree, path: string): Contents | null {
  const find = (node: Tree): Tree | null =>
    node.path === path ? node : node.folders.reduce<Tree | null>((hit, f) => hit ?? (path.startsWith(`${f.path}/`) || f.path === path ? find(f) : null), null);
  const node = path ? find(root) : null;
  if (!node) return null;
  const out: Contents = { files: [], folders: [] };
  const walk = (n: Tree) => {
    for (const f of n.folders) {
      out.folders.push(f.path);
      walk(f);
    }
    out.files.push(...n.files);
  };
  walk(node);
  return out;
}

/**
 * What one file of each kind is called, and more than one. Keyed on `FileKind`, so a fourth kind is
 * a type error here rather than a count that calls it a note — which is what `files − boards` did to
 * a quiz in the delete-folder modal once.
 */
export const KIND_WORDS: Readonly<Record<FileKind, readonly [one: string, many: string]>> = {
  board: ["board", "boards"],
  note: ["note", "notes"],
  quiz: ["quiz", "quizzes"],
  table: ["table", "tables"],
  file: ["file", "files"],
};

/** "3 boards", "1 quiz": a count and the word it counts, agreeing. */
export const counted = (n: number, [one, many]: readonly [string, string]): string => `${n} ${n === 1 ? one : many}`;

/** How many files of each kind a list holds. */
export function tally(files: readonly Entry[]): Record<FileKind, number> {
  const out: Record<FileKind, number> = { board: 0, note: 0, quiz: 0, table: 0, file: 0 };
  for (const f of files) out[f.kind] += 1;
  return out;
}

/**
 * What a folder holds, as the parts of the sentence the delete-folder modal says — each
 * kind of file counted on its own, boards first, then the folders, and nothing it holds none of:
 * `["2 boards", "1 quiz", "3 folders"]`.
 */
export function holds(inside: Contents): string[] {
  const n = tally(inside.files);
  return [
    ...(Object.keys(KIND_WORDS) as FileKind[]).filter((k) => n[k] > 0).map((k) => counted(n[k], KIND_WORDS[k])),
    ...(inside.folders.length ? [counted(inside.folders.length, ["folder", "folders"])] : []),
  ];
}

/** The leaf, which is what a reader is scanning for; the folder is already the heading above it. */
export const leaf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

/** The folder a board sits in, with its trailing slash, kept when it is renamed: renaming is not moving. */
export const folderOf = (name: string): string => (name.includes("/") ? `${name.slice(0, name.lastIndexOf("/"))}/` : "");

/** The folder a file or a folder sits in, without the slash — `""` for the top level. */
export const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * Every folder a file or a folder is inside, outermost first — `a/b/c` gives `a` and `a/b`.
 *
 * What the sidebar opens to show where somebody is: the file itself is not a folder, so it is not
 * in the answer, and neither is the root, which is never shut.
 */
export function ancestors(name: string): string[] {
  const parts = name.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * Where a name goes when the folder `from` becomes `to` — the name itself when it is not inside it.
 *
 * A folder renamed or moved takes everything under it, so every remembered name that starts with
 * it — an open folder, a favourite — has to follow, and nothing else may. `from` alone matches
 * itself and `from/…`, never `from-2/…`: a prefix test on the bare string would drag a sibling
 * whose name merely begins the same way.
 */
export function rebase(name: string, from: string, to: string): string {
  if (name === from) return to;
  if (name.startsWith(`${from}/`)) return to + name.slice(from.length);
  return name;
}

/** One line of the sidebar's tree, in the order it is drawn. */
export type Row =
  | { type: "folder"; path: string; name: string; depth: number; open: boolean; empty: boolean; size: number; pos: number }
  | { type: "file"; entry: Entry; depth: number; size: number; pos: number };

/**
 * The tree as the lines that are visible, with the folders that are shut left shut.
 *
 * **Flat, with a depth on each line, rather than nested elements**, which is the one way the
 * sidebar differs from the search. A WAI tree can be either, and a flat one is what makes the rest
 * of it simple: the keyboard walks `rows` in order instead of a nested DOM, every line carries the
 * folder a drop onto it means, and `size`/`pos` are `aria-setsize`/`aria-posinset` — which a
 * nested tree gets from its markup and a flat one has to say. `depth` is also how far the guide
 * rules reach, one per level.
 */
export function rows(node: Tree, open: ReadonlySet<string>, depth = 0, out: Row[] = []): Row[] {
  const size = node.folders.length + node.files.length;
  let pos = 0;
  for (const f of node.folders) {
    const shown = open.has(f.path);
    const empty = f.folders.length === 0 && f.files.length === 0;
    out.push({ type: "folder", path: f.path, name: f.name, depth, open: shown, empty, size, pos: ++pos });
    if (shown) rows(f, open, depth + 1, out);
  }
  for (const entry of node.files) out.push({ type: "file", entry, depth, size, pos: ++pos });
  return out;
}

/** What happened to a file or a folder, as far as a remembered name cares. */
export type Change =
  | { kind: "file"; file: FileKind; from: string; to: string | null }
  | { kind: "folder"; from: string; to: string | null };

/**
 * A list of remembered files — the favourites, `kind:name` each — after something moved.
 *
 * **A name is the identity in both stores**, so a favourite is a name and has to be told when the
 * name changes: a file renamed or moved, a folder renamed or moved with it inside, or either
 * deleted. This is the whole of that, with no DOM, so it is a unit test rather than a browser. What
 * it cannot see is a change made somewhere else — an agent renaming a board over MCP, a file moved
 * on disk, another device — and a favourite left naming nothing is dropped from what is drawn rather
 * than drawn broken.
 */
export function follow(keys: readonly string[], change: Change): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const at = key.indexOf(":");
    const kind = key.slice(0, at) as FileKind;
    const name = key.slice(at + 1);
    let next: string | null = name;
    if (change.kind === "file") {
      if (kind === change.file && name === change.from) next = change.to;
    } else if (name.startsWith(`${change.from}/`)) {
      next = change.to === null ? null : rebase(name, change.from, change.to);
    }
    if (next !== null) out.push(keyOf({ kind, name: next }));
  }
  return [...new Set(out)];
}

/**
 * What a selection in the sidebar is, as the things a bulk action acts on: the files and
 * the folders picked, **less anything inside a folder that is picked too** — that goes with its
 * folder, and moving or deleting it on its own as well would be doing it twice, the second time to
 * something that is no longer there. `keys` are the sidebar's row keys, `kind:name` for a file and
 * `folder:path` for a folder; a key naming nothing in `entries` is left out.
 */
export interface Picked {
  files: Entry[];
  folders: string[];
}

const FOLDER = "folder:";

export function picked(keys: Iterable<string>, entries: readonly Entry[]): Picked {
  const set = new Set(keys);
  const folders = [...set].filter((k) => k.startsWith(FOLDER)).map((k) => k.slice(FOLDER.length));
  const inside = (name: string) => folders.some((f) => name.startsWith(`${f}/`));
  return {
    folders: folders.filter((f) => !inside(f)).sort(by),
    files: entries.filter((e) => set.has(keyOf(e)) && !inside(e.name)),
  };
}

/** How many things a selection is, counting a folder once however much is in it. */
export const pickedCount = (p: Picked): number => p.files.length + p.folders.length;

/**
 * Where a selection may be moved: every folder but the ones picked and anything under them — a
 * folder cannot go inside itself — with the top level, `""`, first. A folder everything picked is
 * already in is still offered; moving there is simply nothing to do.
 */
export function moveTargets(known: Iterable<string>, p: Picked): string[] {
  const under = (f: string) => p.folders.some((g) => f === g || f.startsWith(`${g}/`));
  return ["", ...[...known].filter((f) => !under(f)).sort(by)];
}

/**
 * Everything a selection takes with it when it is deleted: the files picked, the folders picked, and
 * whatever is in those — what the modal counts before anybody confirms. `null` folders the tree does
 * not have count as themselves alone.
 */
export function pickedContents(root: Tree, p: Picked): Contents {
  const out: Contents = { files: [...p.files], folders: [...p.folders] };
  for (const f of p.folders) {
    const inside = contents(root, f);
    if (!inside) continue;
    out.files.push(...inside.files);
    out.folders.push(...inside.folders);
  }
  return out;
}

/**
 * The rows between two, inclusive, in the order they are drawn — what a shift-click selects. Either
 * end missing from `order` (scrolled into a shut folder, deleted) makes the range the one row that is.
 */
export function between(order: readonly string[], from: string | null, to: string): string[] {
  const b = order.indexOf(to);
  if (b === -1) return [];
  const a = from === null ? -1 : order.indexOf(from);
  if (a === -1) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
