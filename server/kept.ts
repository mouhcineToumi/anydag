/**
 * The listing kept between answers (#280): every document the last listing found, what its text's
 * frontmatter said at which stat, its row in the index, every folder with the mtime it was read at —
 * and the `Tree` they make, rebuilt **only where something changed**. `Vault` keeps one of these while
 * its watcher runs and changes it from what the watcher and its own writes say moved, so a warm
 * `/__board/list` costs what changed rather than what the vault holds.
 *
 * A `Tree` handed out is never changed afterwards: a reader may hold one across a change (`relinking`
 * compares the list before a rename with the list after) and `resolveWiki` memoises on its arrays. A
 * change copies each field it touches, once, into the next tree.
 *
 * Plain data and arithmetic: nothing here reads the disk or the index.
 */

import type { DocRow } from "./home";
import type { Found, Listed } from "./listing";
import { type Kind, leafOf } from "./names";
import type { Tree } from "./vault";

/** One listed document: where it is, what the listing read of it, and its row. */
export interface Entry {
  listed: Listed;
  found: Found;
  row: DocRow | null;
}

/** The folder a document or folder is in, `""` for the vault's root. */
export const dirOf = (rel: string): string => {
  const at = rel.lastIndexOf("/");
  return at < 0 ? "" : rel.slice(0, at);
};

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The walk's order for folders — depth first, each folder's entries sorted — as one comparison. */
function byWalk(a: string, b: string): number {
  const x = a.split("/");
  const y = b.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = byName(x[i]!, y[i]!);
    if (c) return c;
  }
  return x.length - y.length;
}

const LIST: Record<Kind, "boards" | "notes" | "quizzes" | "tables" | "files"> = {
  board: "boards",
  note: "notes",
  quiz: "quizzes",
  table: "tables",
  file: "files",
};

type Keyed = "ids" | "titles" | "tasks" | "projects" | "events" | "created" | "questions" | "sizes";
const KEYED: readonly Keyed[] = ["ids", "titles", "tasks", "projects", "events", "created", "questions", "sizes"];

/** Where `name` is, or would go, in a sorted list. */
function seek(list: readonly string[], name: string): { at: number; has: boolean } {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! < name) lo = mid + 1;
    else hi = mid;
  }
  return { at: lo, has: list[lo] === name };
}

const same = (a: unknown, b: unknown): boolean =>
  a === b ||
  (typeof a === "object" && typeof b === "object" && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

export class KeptListing {
  /** Every listed document, by its file lowercased. */
  readonly entries = new Map<string, Entry>();
  /** The documents directly in each folder, lowercased; `""` is the root. */
  readonly byDir = new Map<string, Set<string>>();
  /** Every folder walked, `""` the root, with its mtime when it was last read. */
  readonly folders = new Map<string, number>();
  /** The documents answering to each name — a board and a note can share one. */
  private readonly byName = new Map<string, Set<string>>();
  /** The names whose keys in the tree are to be worked out again, and whether the folders moved. */
  private readonly touched = new Set<string>();
  private foldersMoved = false;
  /** What `commit` last made: what a listing answers while nothing moves. */
  tree: Tree;

  /** Each listed text's stamp by the key `keyOf` gives it — kept as documents come, change and go. */
  readonly stamps = new Map<string, string>();

  constructor(
    entries: Iterable<Entry>,
    marks: Record<string, number>,
    tree: Tree,
    private readonly keyOf: (d: Listed) => string,
  ) {
    for (const e of entries) this.put(e);
    for (const [dir, mark] of Object.entries(marks)) this.folders.set(dir, mark);
    this.touched.clear();
    this.tree = tree;
  }

  /** The nearest folder walked that holds `rel` — at worst the root. */
  nearest(rel: string): string {
    for (let dir = dirOf(rel); ; dir = dirOf(dir)) if (dir === "" || this.folders.has(dir)) return dir;
  }

  /** The folders walked directly in `dir`. */
  subfolders(dir: string): string[] {
    const prefix = dir ? `${dir}/` : "";
    return [...this.folders.keys()].filter((f) => f !== "" && f.startsWith(prefix) && !f.slice(prefix.length).includes("/"));
  }

  /** A document listed now, or listed again with what was read of it. */
  put(e: Entry): void {
    const low = e.listed.file.toLowerCase();
    const had = this.entries.get(low);
    if (had && had.listed.name !== e.listed.name) this.drop(low);
    else if (had) this.stamps.delete(this.keyOf(had.listed));
    this.entries.set(low, e);
    if (e.listed.kind !== "file" && e.found.front) this.stamps.set(this.keyOf(e.listed), e.found.front.stamp);
    const dir = dirOf(e.listed.file);
    let inDir = this.byDir.get(dir);
    if (!inDir) this.byDir.set(dir, (inDir = new Set()));
    inDir.add(low);
    let named = this.byName.get(e.listed.name);
    if (!named) this.byName.set(e.listed.name, (named = new Set()));
    named.add(low);
    this.touched.add(e.listed.name);
  }

  /** A document no longer listed. */
  drop(low: string): Entry | undefined {
    const e = this.entries.get(low);
    if (!e) return undefined;
    this.entries.delete(low);
    this.stamps.delete(this.keyOf(e.listed));
    this.byDir.get(dirOf(e.listed.file))?.delete(low);
    this.byName.get(e.listed.name)?.delete(low);
    this.touched.add(e.listed.name);
    return e;
  }

  /** A folder walked now, at `mark`. */
  folder(dir: string, mark: number): void {
    if (!this.folders.has(dir)) this.foldersMoved = true;
    this.folders.set(dir, mark);
  }

  /** A folder gone, everything in it with it; what was listed there is returned. */
  dropFolder(dir: string): Entry[] {
    const gone: Entry[] = [];
    const prefix = `${dir}/`;
    for (const f of [...this.folders.keys()]) {
      if (f !== dir && !f.startsWith(prefix)) continue;
      this.folders.delete(f);
      this.foldersMoved = true;
      for (const low of [...(this.byDir.get(f) ?? [])]) {
        const e = this.drop(low);
        if (e) gone.push(e);
      }
      this.byDir.delete(f);
    }
    return gone;
  }

  /**
   * The tree with every change since the last `commit` in it: the same object when none changed what
   * a listing says, else a new one sharing every field nothing touched.
   */
  commit(): Tree {
    const old = this.tree;
    const copied: Partial<Tree> = {};
    const list = (kind: Kind): string[] => {
      const field = LIST[kind];
      return (copied[field] ??= [...old[field]]);
    };
    const keyed = <K extends Keyed>(field: K): Tree[K] => (copied[field] ??= { ...old[field] }) as Tree[K];

    for (const name of this.touched) {
      const want = this.wanted(name);
      for (const kind of Object.keys(LIST) as Kind[]) {
        const now = copied[LIST[kind]] ?? old[LIST[kind]];
        const { at, has } = seek(now, name);
        if (has === want.kinds.has(kind)) continue;
        if (has) list(kind).splice(at, 1);
        else list(kind).splice(at, 0, name);
      }
      for (const field of KEYED) {
        const now = (copied[field] ?? old[field]) as Record<string, unknown>;
        const value = want.keys[field];
        if (value === undefined ? !(name in now) : same(now[name], value)) continue;
        const into = keyed(field) as Record<string, unknown>;
        if (value === undefined) delete into[name];
        else into[name] = value;
      }
    }
    this.touched.clear();
    if (this.foldersMoved) {
      copied.folders = [...this.folders.keys()].filter((f) => f !== "").sort(byWalk);
      this.foldersMoved = false;
    }
    if (Object.keys(copied).length) this.tree = { ...old, ...copied };
    return this.tree;
  }

  /**
   * What the tree says of `name`, worked out the way `Vault.treeOf` does: the documents answering to
   * it in the walk's order, what each read says, then what each row says, the later winning.
   */
  private wanted(name: string): { kinds: Set<Kind>; keys: Partial<Record<Keyed, unknown>> } {
    const es = [...(this.byName.get(name) ?? [])]
      .map((low) => this.entries.get(low)!)
      .sort((a, b) => byName(a.listed.file, b.listed.file));
    const kinds = new Set<Kind>();
    const keys: Partial<Record<Keyed, unknown>> = {};
    for (const { listed: d, found: f } of es) {
      kinds.add(d.kind);
      if (d.kind === "file") {
        if (f.size !== null) keys.sizes = f.size;
        continue;
      }
      keys.titles = f.front?.title || leafOf(d.name);
      if (!f.front) continue;
      if (f.front.task) keys.tasks = f.front.task;
      if (f.front.project) keys.projects = f.front.project;
      if (f.front.event) keys.events = f.front.event;
      if (f.front.asks) keys.questions = f.front.asks;
    }
    for (const { listed: d, row } of es) {
      if (!row) continue;
      keys.ids = row.id;
      keys.created = row.created;
      if (d.kind === "file") keys.titles = row.title || leafOf(d.name);
    }
    return { kinds, keys };
  }
}
