/**
 * A vault: a folder on disk, read and written as the page's documents — a folder somebody else
 * may also be writing.
 *
 * What is load-bearing:
 *
 * - **Writes are atomic** — a temp file beside the target, then a rename, retried while Windows holds
 *   the target — and **an unchanged write does not touch the file**, so the watcher is not woken.
 * - **A write against a version that moved is refused** with the text that beat it: the sha1 base is
 *   the whole concurrency story, and it is what a sync tool relies on too.
 * - **A rename arrives holding its edited text**, in one step, never as a version nobody
 *   wrote on one name or the other.
 *
 * And what the folder alone does not give:
 *
 * - **A document's id is in its frontmatter**, the SQLite index in `home.ts` a cache of
 *   where each id is. **Opening never writes**: a file with no `id:` is given one in the index only,
 *   and it is written into the file the first time something refers to it — `write` and `create` mint
 *   every target a new `dag:` link in their text names, in the same request. A file the app makes is
 *   born with one. Two files with one id — a copy made in a file manager — leave the id with the older
 *   and give the copy a new one, written in.
 * - **An attachment's id is `.anydag/files/<id>.json`** (`{path, title}`), one file each so two
 *   machines syncing never edit one file, and minted the same lazy way.
 * - **Names are the person's** (`names.ts`): verbatim, portable, and case-insensitively unique.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import watcher from "@parcel/watcher";

import { parseQuiz } from "../src/quiz/parse";
import { eventOf, type NoteEvent } from "../src/note/event";
import { projectOf, type Project } from "../src/note/project";
import { taskOf, type Task } from "../src/note/task";
import { titleOf } from "../src/refs/extract";
import type { DocRow, Home } from "./home";
import { derivedId, frontId, instant, mint, validId, validInstant, withId } from "./ids";
import {
  assetsPrefix,
  classify,
  extOf,
  fileNameFrom,
  fileTarget,
  folderFrom,
  folderMove,
  ignored,
  type Kind,
  KINDS,
  leafOf,
  nameFrom,
  NOTE_SUFFIXES,
  refusal,
  same,
  SUFFIX,
  type TextKind,
  TEXT_KINDS,
  unique,
  uniqueFile,
} from "./names";
import { DEFAULT_TYPES } from "./uploads";
import type { SyncStatus } from "./sync/types";

export const sha1 = (text: string | Uint8Array): string => createHash("sha1").update(text).digest("hex");

export class Refused extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {
  constructor(
    readonly base: string,
    readonly text: string,
  ) {
    super("the file changed underneath this edit");
  }
}

export interface Version {
  text: string;
  base: string;
}

export const version = (text: string): Version => ({ text, base: sha1(text) });

export interface Tree {
  boards: string[];
  notes: string[];
  quizzes: string[];
  tables: string[];
  files: string[];
  folders: string[];
  ids: Record<string, string>;
  titles: Record<string, string>;
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  events: Record<string, NoteEvent>;
  created: Record<string, string>;
  /** Each quiz's question ids in file order, `null` for one with none yet. */
  questions: Record<string, (string | null)[]>;
  sizes: Record<string, number>;
}

/** Every listed name by its kind — the one place a kind picks its list. */
export const byKind = (t: Tree): Record<Kind, string[]> => ({
  board: t.boards,
  note: t.notes,
  quiz: t.quizzes,
  table: t.tables,
  file: t.files,
});

/** What removing a folder took with it, by kind, and every folder, itself included. */
export interface Removed {
  boards: string[];
  notes: string[];
  quizzes: string[];
  tables: string[];
  files: string[];
  folders: string[];
}

export interface FileInfo {
  name: string;
  title: string | null;
  bytes: number;
}

export interface AssetFile {
  path: string;
  bytes: number;
}

/** What the change feed says: a document changed (`sha1` `null` when it went), or the folders did. */
export type Change =
  | {
      type: "doc";
      kind: Kind;
      name: string;
      sha1: string | null;
      title: string | null;
      task?: Task | null;
      project?: Project | null;
      event?: NoteEvent | null;
      questions?: number | null;
    }
  | { type: "tree" }
  | { type: "trash" }
  | { type: "gone" }
  /** A linked vault's sync status moved (`server/sync/loop.ts`): the feed's `dag:vault-sync`. */
  | { type: "sync"; status: SyncStatus };

/**
 * One thing in the trash: a file somebody deleted, or a folder with everything in it, as
 * its `entry.json` says it. `doc` is a file's own id; `holds` a folder's contents, itself included.
 */
export interface Trashed {
  id: string;
  name: string;
  kind: Kind | "folder";
  title: string | null;
  deleted: string;
  doc: string | null;
  holds: Removed | null;
}

/** What an entry remembers of each document in it — the index's row, path made relative to the entry. */
interface Kept {
  id: string;
  kind: Kind;
  created: string;
  minted: number;
  title: string | null;
}

/** Where the trash is kept: in the vault, so it travels with it, and out of every listing (a dot-folder). */
const TRASH = ".anydag/trash";

/** What one text's frontmatter says, against the stat it was read at. */
interface Front {
  stamp: string;
  id: string | null | false;
  title: string | undefined;
  task: Task | undefined;
  project: Project | undefined;
  event: NoteEvent | undefined;
  asks: (string | null)[] | undefined;
}

interface Listed {
  kind: Kind;
  name: string;
  /** The stored file, vault-relative and `/`-separated. */
  file: string;
}

/** Where the person's saved components live: in the vault, out of its listing. */
const COMPONENTS = ".anydag/components";
/** The wire's name for one: `components/<name>` (`useEditor`'s Keep). */
const COMPONENT_PREFIX = "components/";

export interface VaultOptions {
  /** The extensions this vault lists as attachments. */
  types?: readonly string[];
  /** The folder new attachments go into. */
  attachments?: string;
  /** When a file was born, for a test that needs two devices' clocks apart; `null` asks the disk. */
  born?: (abs: string) => Date | null;
}

export class Vault {
  readonly root: string;
  readonly id: string;
  readonly home: Home;
  readonly types: ReadonlySet<string>;
  attachments: string;
  private readonly born: (abs: string) => Date | null;
  private fronts = new Map<string, Front>();
  private listeners = new Set<(c: Change) => void>();
  /**
   * The documents on disk at the last walk, lowercased, kept up to date by the watcher. A save is a
   * rename onto the file, which the watcher reports as a create; one at a path already here is an
   * edit, and does not change the tree.
   */
  private present: Set<string> | null = null;
  private stopping: Promise<() => Promise<void>> | null = null;
  /** Created instants sync adopted for documents it is about to write, keyed by lowercased path. */
  private adopted = new Map<string, string>();
  /** The same, by the id sync wrote it under: a document renamed here before the index walked it. */
  private adoptedIds = new Map<string, Map<string, string>>();
  /** The raw channel: every path the watcher reports, for the sync client. */
  private rawListeners = new Set<(rels: string[]) => void>();
  private held = false;
  /** Whether sync has ever read or written created here — kept in the index, so it outlives a restart. */
  private syncing: boolean | null = null;
  /** The vault's own path with every link followed, read once: `abs` holds every other path to it. */
  private realRoot: string | null = null;

  /**
   * A folder as a vault. Its id is `.anydag/vault.json`'s, made the first time the folder is opened
   * as one — that file, like Obsidian's `.obsidian/`, is what opening a folder as a vault means; no
   * document is written.
   */
  constructor(root: string, home: Home, opts: VaultOptions = {}) {
    this.root = path.resolve(root);
    if (!fs.statSync(this.root, { throwIfNoEntry: false })?.isDirectory()) throw new Refused(`not a folder: ${this.root}`);
    this.home = home;
    this.types = new Set((opts.types ?? DEFAULT_TYPES).map((t) => t.toLowerCase()));
    this.attachments = opts.attachments ?? "attachments";
    this.born = opts.born ?? (() => null);
    this.id = vaultId(this.root);
  }

  // -- paths -----------------------------------------------------------------

  /** The absolute path of a vault-relative `/` path, refused if it would leave the vault. */
  abs(rel: string): string {
    const out = path.resolve(this.root, ...rel.split("/"));
    if (out !== this.root && !out.startsWith(this.root + path.sep)) throw new Refused(`outside the vault: ${rel}`);
    this.confine(out, rel);
    return out;
  }

  /**
   * Refuse `out` when it, or the deepest existing folder on the way to it, is a link out of the
   * vault. The root may itself be a link (a temp folder on macOS), so the comparison is against its
   * real path. A link that leads nowhere is refused too: nobody can say where it would go.
   */
  private confine(out: string, rel: string): void {
    const real = (this.realRoot ??= fs.realpathSync(this.root));
    let probe = out;
    while (probe !== this.root && !fs.lstatSync(probe, { throwIfNoEntry: false })) probe = path.dirname(probe);
    if (probe === this.root) return;
    const st = fs.lstatSync(probe);
    let resolved: string;
    try {
      resolved = fs.realpathSync(probe);
    } catch {
      throw new Refused(`a link that leads nowhere: ${rel}`);
    }
    if (resolved !== real && !resolved.startsWith(real + path.sep)) throw new Refused(`outside the vault: ${rel}`);
    if (probe === out && st.isSymbolicLink()) throw new Refused(`a link: ${rel}`);
  }

  /** `abs`, checked again immediately before a write: a folder can become a link in between. */
  private writeAt(rel: string): string {
    const out = this.abs(rel);
    this.confine(out, rel);
    return out;
  }

  private rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  private component(name: string): string | null {
    return name.startsWith(COMPONENT_PREFIX) ? name.slice(COMPONENT_PREFIX.length) : null;
  }

  /**
   * The stored file of a document, vault-relative. A note is `.md` unless only `.note.md` exists —
   * and a new one is `.md`. A board named `components/<x>` is a saved component.
   */
  fileOf(name: string, kind: Kind): string {
    const comp = kind === "board" ? this.component(name) : null;
    const why = refusal(comp ?? name);
    if (why) throw new Refused(why);
    if (comp !== null) return `${COMPONENTS}/${comp}${SUFFIX.board}`;
    if (kind === "file") {
      if (!this.isAttachment(name)) throw new Refused(`not a file name \`${name}\``);
      return name;
    }
    if (kind !== "note") return name + SUFFIX[kind];
    for (const ext of NOTE_SUFFIXES) if (exists(this.abs(name + ext))) return name + ext;
    return name + NOTE_SUFFIXES[0];
  }

  isAttachment(name: string): boolean {
    const ext = extOf(name);
    return !!ext && this.types.has(ext) && refusal(name) === null;
  }

  /** Whether any kind of document answers to `name`, case ignored — see `names.ts` on why. */
  taken(name: string): boolean {
    const dir = this.abs(path.posix.dirname(name) === "." ? "" : path.posix.dirname(name));
    const leaf = path.posix.basename(name).toLowerCase();
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    const wanted = new Set([leaf, ...TEXT_KINDS.map((k) => leaf + SUFFIX[k]), leaf + ".md"]);
    return entries.some((e) => wanted.has(e.toLowerCase()));
  }

  // -- the walk --------------------------------------------------------------

  /** Every document of every kind, and every folder, sorted. */
  private walk(): { docs: Listed[]; folders: string[] } {
    const docs: Listed[] = [];
    const folders: string[] = [];
    const seen = new Set<string>();
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // a folder listed a moment ago and gone now: the disk's other writer
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (ignored(e.name)) continue;
        const rel = prefix + e.name;
        if (e.isDirectory()) {
          if (refusal(rel)) continue;
          folders.push(rel);
          walk(path.join(dir, e.name), `${rel}/`);
          continue;
        }
        if (!e.isFile()) continue;
        const found = classify(rel, this.types);
        if (!found || refusal(found.name)) continue;
        // `plan.md` beside `plan.note.md` is one name twice; the `.md` is the note.
        const key = `${found.kind === "file" ? "file" : "text"}:${found.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        docs.push({ kind: found.kind, name: found.name, file: rel });
      }
    };
    walk(this.root, "");
    this.present = new Set(docs.map((d) => d.file.toLowerCase()));
    return { docs, folders };
  }

  /** What a text's frontmatter says, read only when its stat moved. */
  private front(listed: Listed): Front | null {
    const abs = this.abs(listed.file);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return null;
    }
    const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
    const had = this.fronts.get(listed.file);
    if (had?.stamp === stamp) return had;
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      return null;
    }
    const f = frontOf(listed.kind as TextKind, text, stamp);
    this.fronts.set(listed.file, f);
    return f;
  }

  async tree(): Promise<Tree> {
    const { docs, folders } = this.walk();
    const t: Tree = {
      boards: [],
      notes: [],
      quizzes: [],
      tables: [],
      files: [],
      folders,
      ids: {},
      titles: {},
      tasks: {},
      projects: {},
      events: {},
      created: {},
      questions: {},
      sizes: {},
    };
    const lists = byKind(t);
    const fronts = new Map<string, Front>();
    const kept = new Map<string, Front>();
    for (const d of docs) {
      lists[d.kind].push(d.name);
      if (d.kind === "file") {
        try {
          t.sizes[d.name] = fs.statSync(this.abs(d.file)).size;
        } catch {
          /* gone between the walk and here */
        }
        continue;
      }
      const f = this.front(d);
      // A document nobody titled is called by its file's name.
      t.titles[d.name] = f?.title || leafOf(d.name);
      if (!f) continue;
      fronts.set(d.file, f);
      kept.set(d.file, f);
      if (f.task) t.tasks[d.name] = f.task;
      if (f.project) t.projects[d.name] = f.project;
      if (f.event) t.events[d.name] = f.event;
      if (f.asks) t.questions[d.name] = f.asks;
    }
    this.fronts = kept;
    const rows = this.reconcile(docs, fronts);
    for (const d of docs) {
      const row = rows.get(d.file);
      if (!row) continue;
      t.ids[d.name] = row.id;
      t.created[d.name] = row.created;
      if (d.kind === "file") t.titles[d.name] = row.title || leafOf(d.name);
    }
    for (const l of Object.values(lists)) l.sort(byName);
    return t;
  }

  // -- ids -------------------------------------------------------------------

  /** Every attachment id the vault has written down: `.anydag/files/<id>.json`. */
  private fileIds(): Map<string, { path: string; title: string | null }> {
    const out = new Map<string, { path: string; title: string | null }>();
    const dir = this.abs(".anydag/files");
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      const id = e.slice(0, -5);
      if (!validId(id)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, e), "utf8")) as { path?: unknown; title?: unknown } | null;
        /* The record syncs, and anybody who writes the folder writes it: a `path` no vault name can
           be — `../../x.pdf` — is a record of nothing, dropped like one that does not parse. Kept, it
           reached `abs()`, which refused it, and that refusal failed the whole listing (#9). */
        if (data && typeof data.path === "string" && refusal(data.path) === null)
          out.set(id, { path: data.path, title: typeof data.title === "string" && data.title ? data.title : null });
      } catch {
        /* a half-synced file: read again next time */
      }
    }
    return out;
  }

  private writeFileId(id: string, file: string, title: string | null): void {
    const target = this.writeAt(`.anydag/files/${id}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeAtomic(target, `${JSON.stringify({ path: file, ...(title ? { title } : {}) }, null, 1)}\n`);
  }

  private dropFileId(id: string): void {
    fs.rmSync(this.abs(`.anydag/files/${id}.json`), { force: true });
    this.home.set(this.digestKey(id), null);
  }

  /** Where the index keeps an attachment's size and sha1, which find it again after a move by hand. */
  private digestKey(id: string): string {
    return `digest:${this.id}:${id}`;
  }

  /**
   * Sync is about to write the document at `rel`: it was made at `instant` on another device, and
   * that, not this file's birth time, is its created. Remembered until the file is indexed.
   */
  adoptCreated(rel: string, at: string): void {
    this.markSynced();
    this.adopted.set(rel.toLowerCase(), at);
    const row = this.home.docByPath(this.id, rel);
    if (row && row.created !== at) this.home.putDoc({ ...row, created: at });
  }

  /**
   * The created instant the index holds for `rel`, else the one adopted for it, else — a file the
   * index has not walked yet, such as a conflict copy sync has just written — the one the index will
   * give it, its birth; `null` when nothing is there. So a push always carries a created, and every
   * device dates one file alike. **A birth said here is remembered** as though adopted: the file may
   * be written again or renamed before the index walks it — a new birth each time — and the index
   * must then hold the created this device already pushed, or it and every other device disagree.
   */
  createdOf(rel: string): string | null {
    this.markSynced();
    const known = this.home.docByPath(this.id, rel)?.created ?? this.adopted.get(rel.toLowerCase());
    if (known) return known;
    if (!exists(this.abs(rel))) return null;
    const at = this.movedCreated(rel) ?? this.bornAt(rel);
    this.adopted.set(rel.toLowerCase(), at);
    return at;
  }

  /**
   * A document renamed here before the index walked it: its frontmatter names an id whose row is at
   * a path no longer on disk, and that row's created is the document's. Its new path's birth is not —
   * a rename is a new birth wherever the clock is the file's — and a push carrying it dated one
   * document twice: this device's index kept the row's created at the walk, the other device adopted
   * the birth, and a duplicate of that id was then settled differently on each (seed 90).
   */
  private movedCreated(rel: string): string | null {
    const found = classify(rel, this.types);
    if (!found || found.kind === "file") return null;
    const id = this.front({ kind: found.kind, name: found.name, file: rel })?.id;
    return id ? this.createdOfId(id, rel, this.home.docById(this.id, id)) : null;
  }

  /**
   * The created of the document `id` names, for a file at `rel` that is that document moved: the
   * index's row for the id when its path is gone from disk, else — the index never walked it — what
   * sync adopted for it, when that path is gone. `null` when the id's file is still where it was,
   * which makes `rel` a copy and its birth its created.
   */
  private createdOfId(id: string, rel: string, row: DocRow | null | undefined): string | null {
    const gone = (p: string): boolean => p.toLowerCase() !== rel.toLowerCase() && !exists(this.abs(p));
    if (row) return gone(row.path) ? row.created : null;
    // Every path sync wrote under the id, not the last: a later pull of the same document under
    // another name is still on disk, and the one this file was renamed from is the one that is gone.
    for (const [p, at] of this.adoptedIds.get(id) ?? []) if (gone(p)) return at;
    return null;
  }

  /** Sync wrote `rel` with a created it adopted: remember that created by the document's id too. */
  private noteAdopted(rel: string, bytes: Uint8Array): void {
    const at = this.adopted.get(rel.toLowerCase());
    const found = at ? classify(rel, this.types) : null;
    if (!at || !found || found.kind === "file") return;
    const id = frontOf(found.kind, Buffer.from(bytes).toString("utf8"), "").id;
    if (!id) return;
    const paths = this.adoptedIds.get(id) ?? new Map<string, string>();
    paths.set(rel, at);
    this.adoptedIds.set(id, paths);
  }

  /**
   * Sync reads and writes created only through `createdOf` and `adoptCreated`, so either one called
   * means this vault syncs — and a duplicate id is then settled by what every device sees alike.
   */
  private markSynced(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.home.set(`syncs:${this.id}`, "1");
  }

  private synced(): boolean {
    this.syncing ??= this.home.get(`syncs:${this.id}`) === "1";
    return this.syncing;
  }

  /** While sync's first download runs, a duplicate id's fix stays in the index and out of the file. */
  holdFixes(on: boolean): void {
    this.held = on;
  }

  private bornAt(file: string): string {
    const adopted = this.adopted.get(file.toLowerCase());
    if (adopted) return adopted;
    try {
      const abs = this.abs(file);
      const st = fs.statSync(abs);
      return instant(this.born(abs) ?? (st.birthtimeMs ? st.birthtime : st.mtime));
    } catch {
      return instant();
    }
  }

  /**
   * The index brought into line with the disk, returning each listed file's row. The files are the
   * truth: an id in a frontmatter or a `.anydag/files/` record wins; a file with none
   * keeps the provisional id the index gave its path, or is given one; two files claiming one id
   * leave it with the one the index already knew there, or the older, and the other is given a new
   * one — written into it, and said on the console.
   */
  private reconcile(docs: Listed[], fronts: Map<string, Front>): Map<string, DocRow> {
    const vault = this.id;
    const rows = this.home.docs(vault);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const byPath = new Map(rows.map((r) => [r.path.toLowerCase(), r]));
    const fileIds = docs.some((d) => d.kind === "file") || rows.some((r) => r.kind === "file") ? this.fileIds() : new Map();
    const filePaths = new Map([...fileIds].map(([id, v]) => [v.path.toLowerCase(), id]));
    // A record whose file is gone, and a file with no record: moved outside the app with the record
    // left behind. The bytes the app last saw it holding say whether they are one file.
    // A path the vault refuses is no file of its own to lose: not an orphan, and never a throw.
    const at = (rel: string): string | null => {
      try {
        return this.abs(rel);
      } catch {
        return null;
      }
    };
    const orphans = [...fileIds].filter(([, v]) => {
      const abs = at(v.path);
      return abs !== null && !exists(abs);
    });
    if (orphans.length) {
      for (const d of docs) {
        if (d.kind !== "file" || filePaths.has(d.file.toLowerCase())) continue;
        let size: number;
        try {
          size = fs.statSync(this.abs(d.file)).size;
        } catch {
          continue;
        }
        const want = orphans.filter(([id]) => this.home.get(this.digestKey(id))?.startsWith(`${size}:`));
        if (!want.length) continue;
        let digest: string;
        try {
          digest = digestOf(fs.readFileSync(this.abs(d.file)));
        } catch {
          continue;
        }
        const hit = want.find(([id]) => this.home.get(this.digestKey(id)) === digest);
        if (!hit) continue;
        const [id, rec] = hit;
        orphans.splice(orphans.indexOf(hit), 1);
        this.writeFileId(id, d.file, rec.title);
        fileIds.set(id, { path: d.file, title: rec.title });
        filePaths.set(d.file.toLowerCase(), id);
      }
    }
    const out = new Map<string, DocRow>();
    const claimed = new Map<string, Listed>();
    const fixes: { listed: Listed; id: string }[] = [];

    const claim = (d: Listed, id: string): boolean => {
      const other = claimed.get(id);
      if (!other) {
        claimed.set(id, d);
        return true;
      }
      // Two files, one id. The one the index already had there keeps it — a copy made in a file
      // manager is born in the same second as its original — else the earlier created, else the
      // path first in code-point order. **Not the known path in a vault that syncs**: each device's
      // index knows its own path for an id (moved here, edited there; a conflict copy written here,
      // the original renamed there), and each would keep its own, the id then on neither. Created
      // travels with every push (`createdOf`, `adoptCreated`), and created and path are what every
      // device sees alike: whichever file is first by them is never the loser on any device, so the
      // id survives on it whatever order the devices meet the two files in.
      const known = this.synced() ? undefined : byId.get(id)?.path.toLowerCase();
      // Read as `createdOf` reads it, or the created this device pushed for a file is not the one it
      // decides by: a document renamed here before the walk is its document's created, not its birth.
      const createdAt = (f: string): string =>
        byPath.get(f.toLowerCase())?.created ??
        this.adopted.get(f.toLowerCase()) ??
        this.createdOfId(id, f, byId.get(id)) ??
        this.bornAt(f);
      const [co, cd] = [createdAt(other.file), createdAt(d.file)];
      const older = co !== cd ? co < cd : other.file.toLowerCase() < d.file.toLowerCase();
      const keepOther = known === other.file.toLowerCase() || (known !== d.file.toLowerCase() && older);
      const loser = keepOther ? d : other;
      if (!keepOther) claimed.set(id, d);
      fixes.push({
        listed: loser,
        id: derivedId(
          id,
          loser.file,
          (x) => (byId.has(x) && byId.get(x)!.path.toLowerCase() !== loser.file.toLowerCase()) || claimed.has(x),
        ),
      });
      return !keepOther;
    };

    this.home.tx(() => {
      for (const d of docs) {
        const own = d.kind === "file" ? (filePaths.get(d.file.toLowerCase()) ?? null) : (fronts.get(d.file)?.id ?? null);
        const row = byPath.get(d.file.toLowerCase());
        if (own) {
          if (!claim(d, own)) continue;
          const was = byId.get(own);
          const next: DocRow = {
            vault,
            id: own,
            path: d.file,
            kind: d.kind,
            // A document renamed before this walk is its id's created, not the rename's birth: the
            // tie-break above and `createdOf` read it so, and the row must too (seed 2, loaded).
            created: was?.created ?? row?.created ?? this.createdOfId(own, d.file, was) ?? this.bornAt(d.file),
            minted: 1,
            title: d.kind === "file" ? (fileIds.get(own)?.title ?? null) : null,
          };
          if (!was || was.path !== next.path || was.minted !== 1 || was.kind !== next.kind || was.title !== next.title)
            this.home.putDoc(next);
          out.set(d.file, next);
          continue;
        }
        // No id of its own: the provisional one the index gave this path, or a new one.
        if (row && !claimed.has(row.id) && !(row.minted && row.kind === "file" && fileIds.has(row.id))) {
          claimed.set(row.id, d);
          const next = { ...row, path: d.file, kind: d.kind, minted: 0 };
          if (row.minted !== 0 || row.path !== d.file || row.kind !== d.kind) this.home.putDoc(next);
          out.set(d.file, next);
          continue;
        }
        const id = mint((x) => byId.has(x) || claimed.has(x));
        claimed.set(id, d);
        const next: DocRow = { vault, id, path: d.file, kind: d.kind, created: this.bornAt(d.file), minted: 0, title: null };
        this.home.putDoc(next);
        byId.set(id, next);
        out.set(d.file, next);
      }
      for (const r of rows)
        if (!claimed.has(r.id) || claimed.get(r.id)!.file.toLowerCase() !== r.path.toLowerCase()) {
          if (!claimed.has(r.id)) this.home.dropDoc(vault, r.id);
        }
    });

    for (const { listed, id } of fixes) {
      console.warn(`anydag: ${listed.file} carried an id another file has; it is ${id} now`);
      const row: DocRow = {
        vault,
        id,
        path: listed.file,
        kind: listed.kind,
        created: this.bornAt(listed.file),
        minted: 0,
        title: null,
      };
      this.home.putDoc(row);
      if (this.held) {
        out.set(listed.file, row);
        continue;
      }
      this.mintRow(row, true);
      out.set(listed.file, { ...row, minted: 1 });
    }
    return out;
  }

  /** The row for a document, reconciling the vault when the index has not seen it. */
  private row(name: string, kind: Kind): DocRow | null {
    const file = this.fileOf(name, kind);
    if (!exists(this.abs(file))) return null;
    const hit = this.home.docByPath(this.id, file);
    if (hit) return hit;
    const listed: Listed = { kind, name, file };
    const fronts = new Map<string, Front>();
    if (kind !== "file") {
      const f = this.front(listed);
      if (f) fronts.set(file, f);
    }
    // One document: the full walk is the only place a duplicate is told apart, so only the cheap
    // half here — its own id, or a provisional one.
    const own = kind === "file" ? null : (fronts.get(file)?.id ?? null);
    if (own && !this.home.docById(this.id, own)) {
      const r: DocRow = { vault: this.id, id: own, path: file, kind, created: this.bornAt(file), minted: 1, title: null };
      this.home.putDoc(r);
      return r;
    }
    return this.reconcileAll(file);
  }

  private reconcileAll(file: string): DocRow | null {
    const { docs } = this.walk();
    const fronts = new Map<string, Front>();
    for (const d of docs) {
      if (d.kind === "file") continue;
      const f = this.front(d);
      if (f) fronts.set(d.file, f);
    }
    return this.reconcile(docs, fronts).get(file) ?? null;
  }

  /**
   * Write a row's id into its file — a text's frontmatter, an attachment's `.anydag/files/` record.
   * A frontmatter whose `id:` holds somebody else's key is left alone, and the id stays the index's.
   */
  private mintRow(row: DocRow, force = false): boolean {
    if (row.minted && !force) return true;
    if (row.kind === "file") {
      this.writeFileId(row.id, row.path, row.title);
    } else {
      const abs = this.writeAt(row.path);
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        return false;
      }
      const had = frontId(text);
      if (had === false && !force) return false;
      if (had !== row.id) writeAtomic(abs, withId(text, row.id));
    }
    this.home.putDoc({ ...row, minted: 1 });
    return true;
  }

  /** Every target a `dag:` link in `text` names that `before` did not, given its id in its file. */
  private mintTargets(text: string, before = ""): void {
    const had = new Set(idsIn(before));
    for (const id of idsIn(text)) {
      if (had.has(id)) continue;
      const row = this.home.docById(this.id, id);
      if (row && !row.minted) this.mintRow(row);
    }
  }

  /** This document's id, written into it if it was only the index's. `null` when it does not exist. */
  async ident(name: string, kind: Kind = "board"): Promise<string | null> {
    const row = this.row(name, kind);
    if (!row) return null;
    this.mintRow(row);
    return row.id;
  }

  /** The id the listing gives a document, without writing anything. */
  async peekId(name: string, kind: Kind = "board"): Promise<string | null> {
    return this.row(name, kind)?.id ?? null;
  }

  /** The `{name, kind}` answering to an id in this vault, or `null`. */
  async resolve(id: string): Promise<{ name: string; kind: Kind } | null> {
    if (!validId(id)) return null;
    let row = this.home.docById(this.id, id);
    if (!row || !exists(this.abs(row.path))) {
      await this.tree();
      row = this.home.docById(this.id, id);
    }
    if (!row) return null;
    const found = classify(row.path, this.types);
    return found ? { name: found.name, kind: found.kind } : null;
  }

  async created(name: string, kind: Kind): Promise<string | null> {
    return this.row(name, kind)?.created ?? null;
  }

  // -- texts -----------------------------------------------------------------

  async read(name: string, kind: TextKind = "board"): Promise<Version | null> {
    try {
      return version(fs.readFileSync(this.abs(this.fileOf(name, kind)), "utf8"));
    } catch (e) {
      if (e instanceof Refused) throw e;
      return null;
    }
  }

  /**
   * Replace a document's text. `base` of `null`/`undefined` is "I have not seen it", which overwrites
   * — what `/asset` does when it appends a fence. Raises `Conflict` when it is not the current sha1.
   */
  async write(name: string, kind: TextKind, text: string, base?: string | null): Promise<Version> {
    const file = this.writeAt(this.fileOf(name, kind));
    let now: Version;
    try {
      now = version(fs.readFileSync(file, "utf8"));
    } catch {
      throw new NotFound(`no ${kind} \`${name}\``);
    }
    if (base && base !== now.base) throw new Conflict(now.base, now.text);
    if (now.text !== text) {
      writeAtomic(file, text);
      this.mintTargets(text, now.text);
      if (this.component(name) !== null)
        this.emit({ type: "doc", kind: "board", name, sha1: sha1(text), title: titleOf(text) ?? null });
    }
    return version(text);
  }

  /**
   * Make a document under `name` — made portable, and numbered when any kind already answers to it —
   * returning **the name the vault settled on**. It is born with an id in its frontmatter: `id` when
   * that is free here (an export imported again keeps every link to it), else a new one.
   */
  async create(name: string, kind: TextKind, text: string, opts: { id?: string; created?: string } = {}): Promise<string> {
    const comp = kind === "board" ? this.component(name) : null;
    const stem = comp !== null ? `${COMPONENT_PREFIX}${nameFrom(comp, "component")}` : nameFrom(name);
    const settled = comp !== null ? this.uniqueComponent(stem) : unique(stem, (n) => this.taken(n));
    const file = this.fileOf(settled, kind);
    const abs = this.writeAt(file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (comp !== null) {
      writeAtomic(abs, text);
      this.emit({ type: "doc", kind: "board", name: settled, sha1: sha1(text), title: titleOf(text) ?? null });
      return settled;
    }
    const taken = (x: string): boolean => !!this.home.docById(this.id, x);
    const own = frontId(text);
    const id = validId(opts.id) && !taken(opts.id) ? opts.id : own && !taken(own) ? own : mint(taken);
    const body = own === false ? text : withId(text, id);
    writeAtomic(abs, body);
    this.home.putDoc({
      vault: this.id,
      id,
      path: file,
      kind,
      created: validInstant(opts.created) ? opts.created : instant(),
      minted: own === false ? 0 : 1,
      title: null,
    });
    this.mintTargets(body);
    return settled;
  }

  private uniqueComponent(name: string): string {
    return unique(name, (n) => exists(this.abs(this.fileOf(n, "board"))));
  }

  /**
   * Rename or copy, returning the settled name. `edit` is what the text becomes on the way, in the
   * one step that moves it; ignored on a copy. A rename keeps the id — it is in the file —
   * and a copy gets a new one. Moving between folders is this and nothing else. A rename to a name
   * that differs only by case is a rename: a person fixing a capital means it.
   */
  async rename(
    name: string,
    kind: Kind,
    to: string,
    opts: { copy?: boolean; edit?: (text: string) => string } = {},
  ): Promise<string> {
    const copy = !!opts.copy;
    const from = this.fileOf(name, kind);
    const fromAbs = this.abs(from);
    if (!isFile(fromAbs)) throw new NotFound(`no ${kind} \`${name}\``);
    const stem = kind === "file" ? fileTarget(name, to, this.types) : nameFrom(to);
    if (!copy && stem === name) {
      if (opts.edit) await this.write(name, kind as TextKind, opts.edit(fs.readFileSync(fromAbs, "utf8")), null);
      return name;
    }
    const caseOnly = !copy && same(stem, name);
    const settled = caseOnly
      ? stem
      : kind === "file"
        ? uniqueFile(stem, (n) => this.taken(n))
        : unique(stem, (n) => this.taken(n));
    const target = kind === "note" ? settled + from.slice(name.length) : this.fileOf(settled, kind);
    const toAbs = this.writeAt(target);
    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    const row = this.row(name, kind);

    if (kind === "file") {
      if (copy) {
        fs.copyFileSync(fromAbs, toAbs);
        const id = mint((x) => !!this.home.docById(this.id, x));
        this.home.putDoc({ vault: this.id, id, path: target, kind, created: instant(), minted: 0, title: row?.title ?? null });
      } else {
        moveFile(fromAbs, toAbs);
        if (row) {
          const next = { ...row, path: target };
          this.home.putDoc(next);
          if (row.minted) this.writeFileId(row.id, target, row.title);
        }
      }
      return settled;
    }

    const text = fs.readFileSync(fromAbs, "utf8");
    if (copy) {
      const own = frontId(text);
      const id = mint((x) => !!this.home.docById(this.id, x));
      writeAtomic(toAbs, own === false ? text : own ? withId(text, id) : text);
      this.home.putDoc({ vault: this.id, id, path: target, kind, created: instant(), minted: own ? 1 : 0, title: null });
      const assets = this.abs(assetsPrefix(name));
      if (isDir(assets)) fs.cpSync(assets, this.abs(assetsPrefix(settled)), { recursive: true });
      return settled;
    }
    const next = opts.edit ? opts.edit(text) : text;
    if (caseOnly || next !== text) {
      writeAtomic(toAbs, next);
      if (!caseOnly || !sameFile(fromAbs, toAbs)) fs.rmSync(fromAbs, { force: true });
    } else moveFile(fromAbs, toAbs);
    const assets = this.abs(assetsPrefix(name));
    if (isDir(assets)) moveFile(assets, this.abs(assetsPrefix(settled)));
    if (row) this.home.putDoc({ ...row, path: target });
    if (next !== text) this.mintTargets(next, text);
    return settled;
  }

  /** Delete a document. Its legacy `.assets/` go with it; an attachment's id record too. */
  async delete(name: string, kind: Kind = "board"): Promise<void> {
    const file = this.fileOf(name, kind);
    const abs = this.writeAt(file);
    if (!isFile(abs)) throw new NotFound(`no ${kind} \`${name}\``);
    const row = this.home.docByPath(this.id, file);
    fs.rmSync(abs);
    if (this.component(name) !== null) {
      this.emit({ type: "doc", kind: "board", name, sha1: null, title: null });
      return;
    }
    if (row) {
      this.home.dropDoc(this.id, row.id);
      if (row.kind === "file") this.dropFileId(row.id);
    }
    if (kind !== "file") fs.rmSync(this.abs(assetsPrefix(name)), { recursive: true, force: true });
  }

  // -- folders ---------------------------------------------------------------

  private folder(name: string): string {
    const stem = folderFrom(name);
    if (stem === null) throw new Refused(`not a folder name \`${name}\``);
    return stem;
  }

  async mkdir(name: string): Promise<string> {
    const stem = this.folder(name);
    if (!stem) throw new Refused(`not a folder name \`${name}\``);
    fs.mkdirSync(this.writeAt(stem), { recursive: true });
    return stem;
  }

  /**
   * Remove a folder. Empty unless `recursive`: one click that takes N documents with it is how
   * somebody loses work, so the default is the refusal and only the modal's answer sends it.
   */
  async rmdir(name: string, recursive = false): Promise<Removed> {
    const stem = this.folder(name);
    if (!stem) throw new Refused("the top level is not a folder");
    const abs = this.writeAt(stem);
    if (!isDir(abs)) throw new NotFound(`no folder \`${name}\``);
    if (!recursive) {
      if (fs.readdirSync(abs).length) throw new Refused(`\`${name}\` is not empty`);
      fs.rmdirSync(abs);
      return { ...emptyRemoved(), folders: [stem] };
    }
    const { docs, folders } = this.walk();
    const inside = `${stem}/`.toLowerCase();
    const gone = emptyRemoved();
    gone.folders = [stem, ...folders.filter((f) => f.toLowerCase().startsWith(inside))];
    for (const d of docs) {
      if (!d.file.toLowerCase().startsWith(inside)) continue;
      gone[pluralOf(d.kind)].push(d.name);
      const row = this.home.docByPath(this.id, d.file);
      if (row) {
        this.home.dropDoc(this.id, row.id);
        if (row.kind === "file") this.dropFileId(row.id);
      }
    }
    fs.rmSync(abs, { recursive: true, force: true });
    return gone;
  }

  /**
   * Rename or move a folder with everything under it, in one `rename(2)`. A destination that exists
   * is refused rather than numbered — merging two folders is not a rename — and so is a folder moved
   * into its own subtree. The same name is a no-op; one that differs only by case is a rename.
   */
  async moveFolder(name: string, to: string): Promise<string> {
    const ends = folderMove(name, to);
    if (typeof ends === "string") throw new Refused(ends);
    const [src, dst] = ends;
    if (src === dst) return dst;
    const srcAbs = this.abs(src);
    const dstAbs = this.writeAt(dst);
    if (!isDir(srcAbs)) throw new NotFound(`no folder \`${src}\``);
    if (!same(src, dst) && (exists(dstAbs) || this.caseTwin(dst))) throw new Refused(`\`${dst}\` already exists`);
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    moveFile(srcAbs, dstAbs);
    const prefix = `${src}/`.toLowerCase();
    this.home.tx(() => {
      for (const r of this.home.docs(this.id)) {
        if (!r.path.toLowerCase().startsWith(prefix)) continue;
        const moved = `${dst}/${r.path.slice(prefix.length)}`;
        this.home.putDoc({ ...r, path: moved });
        if (r.kind === "file" && r.minted) this.writeFileId(r.id, moved, r.title);
      }
    });
    return dst;
  }

  /** Something beside `rel` whose name differs from it only by case: one name on macOS and Windows. */
  private caseTwin(rel: string): boolean {
    const leaf = path.posix.basename(rel).toLowerCase();
    try {
      return fs.readdirSync(path.dirname(this.abs(rel))).some((e) => e.toLowerCase() === leaf);
    } catch {
      return false;
    }
  }

  // -- the trash -----------------------------------------------------
  //
  // `<vault>/.anydag/trash/<entry>/`: `entry.json`, and `files/` holding what went exactly as it sat
  // in the vault, moved there and back with `rename(2)`. **The manifest is written before the payload
  // moves**, so a crash leaves an entry naming nothing to restore — which a restore says and Delete
  // forever clears — and never a payload nothing names. A text's id is in its own frontmatter and goes
  // with it; the index's row (its created day, and an id it had only given provisionally) and an
  // attachment's `.anydag/files/` record are kept in the manifest and written back on restore.

  private trashDir(id?: string): string {
    if (id !== undefined && !validId(id)) throw new NotFound(`nothing in the trash is \`${id}\``);
    return this.abs(id === undefined ? TRASH : `${TRASH}/${id}`);
  }

  private openEntry(entry: Trashed, docs: Record<string, Kept>): string {
    const at = this.trashDir(entry.id);
    fs.mkdirSync(path.join(at, "files"), { recursive: true });
    const manifest = { ...entry, docs };
    writeAtomic(this.writeAt(`${TRASH}/${entry.id}/entry.json`), `${JSON.stringify(manifest, null, 1)}\n`);
    return at;
  }

  /**
   * The stored files a document of `name` and `kind` may have in an entry: `fileNameFrom` for an
   * attachment, `refusal` for a text. `null` when the name is one the vault would not accept from
   * the wire. A note has two suffixes, so an old `.note.md` restores as it was.
   */
  private ownFiles(name: string, kind: Kind): string[] | null {
    if (kind === "file") {
      if (name.split("/").some((s) => s.startsWith("."))) return null;
      const asked = fileNameFrom(name, this.types);
      return asked && same(asked, name) ? [name] : null;
    }
    if (refusal(name)) return null;
    if (kind === "note") return [`${name}.md`, `${name}.note.md`];
    return [name + SUFFIX[kind]];
  }

  /** A folder name a trashed folder may restore to, or `null` when it is not one. */
  private ownFolder(name: string): string | null {
    const stem = folderFrom(name);
    return stem && stem === name ? stem : null;
  }

  /** A relative path a manifest may name: no root, no climb, no empty or dot segment. */
  private safeRel(rel: string): boolean {
    if (!rel || rel.includes("\0") || path.posix.isAbsolute(rel) || path.isAbsolute(rel)) return false;
    return rel.split("/").every((s) => !!s && s !== "." && s !== "..");
  }

  /** A manifest's `docs` entry as a kept row, or `null` when it is not one. */
  private keptOfManifest(raw: unknown): Kept | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const k = raw as Record<string, unknown>;
    if (!validId(k.id) || typeof k.kind !== "string" || !(KINDS as readonly string[]).includes(k.kind)) return null;
    if (!validInstant(k.created)) return null;
    if (typeof k.minted !== "number" || !Number.isInteger(k.minted) || k.minted < 0) return null;
    if (k.title !== null && k.title !== undefined && typeof k.title !== "string") return null;
    return {
      id: k.id,
      kind: k.kind as Kind,
      created: k.created,
      minted: k.minted,
      title: typeof k.title === "string" ? k.title : null,
    };
  }

  /** The `docs` map of a manifest, every key and kept row checked, or `null` when any is not one. */
  private keptDocs(raw: unknown): Record<string, Kept> | null {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, Kept> = {};
    for (const [file, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!this.safeRel(file)) return null;
      const kept = this.keptOfManifest(value);
      if (!kept) return null;
      out[file] = kept;
    }
    return out;
  }

  private manifest(id: string): (Trashed & { docs: Record<string, Kept> }) | null {
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.trashDir(id), "entry.json"), "utf8"));
      // `null` parses, and reading `.id` off it threw out of every trash route (#9).
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!validId(data.id) || typeof data.name !== "string") return null;
    const kind =
      typeof data.kind === "string" && (data.kind === "folder" || (KINDS as readonly string[]).includes(data.kind))
        ? (data.kind as Kind | "folder")
        : "board";
    if (kind === "folder" ? this.ownFolder(data.name) === null : this.ownFiles(data.name, kind) === null) return null;
    const docs = this.keptDocs(data.docs);
    if (!docs) return null;
    const holds =
      data.holds && typeof data.holds === "object" ? { ...emptyRemoved(), ...(data.holds as Partial<Removed>) } : null;
    return {
      id: data.id,
      name: data.name,
      kind,
      title: typeof data.title === "string" && data.title ? data.title : null,
      deleted: validInstant(data.deleted) ? data.deleted : instant(new Date(0)),
      doc: validId(data.doc) ? data.doc : null,
      holds: kind === "folder" ? (holds ?? emptyRemoved()) : null,
      docs,
    };
  }

  private keptOf(row: DocRow): Kept {
    return { id: row.id, kind: row.kind as Kind, created: row.created, minted: row.minted, title: row.title };
  }

  private toldTrash(): void {
    this.emit({ type: "trash" });
  }

  /** Move a document to the trash, its legacy `.assets/` with it. A saved component goes for good. */
  async trash(name: string, kind: Kind = "board"): Promise<Trashed> {
    if (kind === "board" && this.component(name) !== null) {
      await this.delete(name, kind);
      return { id: mint(), name, kind, title: null, deleted: instant(), doc: null, holds: null };
    }
    const file = this.fileOf(name, kind);
    const abs = this.abs(file);
    if (!isFile(abs)) throw new NotFound(`no ${kind} \`${name}\``);
    const row = this.row(name, kind);
    const title = kind === "file" ? (row?.title ?? null) : (titleOf(fs.readFileSync(abs, "utf8")) ?? null);
    const entry: Trashed = {
      id: mint((x) => exists(this.trashDir(x))),
      name,
      kind,
      title,
      deleted: instant(),
      doc: row?.id ?? null,
      holds: null,
    };
    const at = this.openEntry(entry, row ? { [file]: this.keptOf(row) } : {});
    const target = path.join(at, "files", ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    moveFile(abs, target);
    const assets = this.abs(assetsPrefix(name));
    if (kind !== "file" && isDir(assets)) {
      const dst = path.join(at, "files", ...assetsPrefix(name).split("/"));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      moveFile(assets, dst);
    }
    if (row) {
      this.home.dropDoc(this.id, row.id);
      if (row.kind === "file") fs.rmSync(this.abs(`.anydag/files/${row.id}.json`), { force: true });
    }
    this.toldTrash();
    return entry;
  }

  /**
   * Move a folder to the trash with everything under it, as one entry. Empty unless `recursive`: the
   * refusal is the contract an old tab, a script and an MCP client were written against.
   */
  async trashFolder(name: string, recursive = false): Promise<Trashed> {
    const stem = this.folder(name);
    if (!stem) throw new Refused("the top level is not a folder");
    const abs = this.writeAt(stem);
    if (!isDir(abs)) throw new NotFound(`no folder \`${name}\``);
    if (!recursive && fs.readdirSync(abs).length) throw new Refused(`\`${name}\` is not empty`);
    // Listed, and every document under it given a row, before anything moves — so what the entry
    // says it holds is what was there.
    const { docs, folders } = this.walk();
    const fronts = new Map<string, Front>();
    for (const d of docs) {
      if (d.kind === "file") continue;
      const f = this.front(d);
      if (f) fronts.set(d.file, f);
    }
    const rows = this.reconcile(docs, fronts);
    const inside = `${stem}/`.toLowerCase();
    const holds = emptyRemoved();
    holds.folders = [stem, ...folders.filter((f) => f.toLowerCase().startsWith(inside))];
    const kept: Record<string, Kept> = {};
    const under: DocRow[] = [];
    for (const d of docs) {
      if (!d.file.toLowerCase().startsWith(inside)) continue;
      holds[pluralOf(d.kind)].push(d.name);
      const row = rows.get(d.file);
      if (row) {
        kept[d.file] = this.keptOf(row);
        under.push(row);
      }
    }
    const entry: Trashed = {
      id: mint((x) => exists(this.trashDir(x))),
      name: stem,
      kind: "folder",
      title: null,
      deleted: instant(),
      doc: null,
      holds,
    };
    const at = this.openEntry(entry, kept);
    const target = path.join(at, "files", ...stem.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    moveFile(abs, target); // one `rename(2)`: every file, every `.assets/` and every empty folder
    this.home.tx(() => {
      for (const row of under) {
        this.home.dropDoc(this.id, row.id);
        if (row.kind === "file") fs.rmSync(this.abs(`.anydag/files/${row.id}.json`), { force: true });
      }
    });
    this.toldTrash();
    return entry;
  }

  /** Everything in the trash, newest first. Expiry is the caller's (`trash.ts`). */
  async trashList(): Promise<Trashed[]> {
    let names: string[];
    try {
      names = fs.readdirSync(this.trashDir());
    } catch {
      return [];
    }
    const out: Trashed[] = [];
    for (const n of names) {
      if (!validId(n)) continue;
      /* One entry is one thing deleted, and one that cannot be read is skipped: a manifest is written
         by whoever wrote the folder, and one that threw used to take the whole trash with it (#9). */
      let m: (Trashed & { docs: Record<string, Kept> }) | null;
      try {
        m = this.manifest(n);
      } catch {
        continue;
      }
      if (!m) continue;
      const { docs: _docs, ...entry } = m;
      out.push(entry);
    }
    return out.sort((a, b) => (a.deleted === b.deleted ? byName(b.id, a.id) : a.deleted < b.deleted ? 1 : -1));
  }

  /** A kept row written back at `file`: under its own id unless a live document has taken it since. */
  private back(kept: Kept, file: string): string {
    const holder = this.home.docById(this.id, kept.id);
    let id = kept.id;
    if (holder && holder.path.toLowerCase() !== file.toLowerCase() && exists(this.abs(holder.path))) {
      id = mint((x) => !!this.home.docById(this.id, x));
      if (kept.kind !== "file" && kept.minted) {
        const abs = this.writeAt(file);
        try {
          writeAtomic(abs, withId(fs.readFileSync(abs, "utf8"), id));
        } catch {
          /* a file that would not take it: the next walk gives it one */
        }
      }
    }
    this.home.putDoc({
      vault: this.id,
      id,
      path: file,
      kind: kept.kind,
      created: kept.created,
      minted: kept.minted,
      title: kept.title,
    });
    if (kept.kind === "file" && kept.minted) this.writeFileId(id, file, kept.title);
    return id;
  }

  private damaged(entry: Trashed): NotFound {
    return new NotFound(`\`${entry.name}\` is a damaged trash entry`);
  }

  /**
   * The path of `rel` under an entry's `files/`, refused when it leaves that folder or is a link.
   * The entry's own `files/` is checked too: a planted link there would make every source path
   * look like a file in the vault.
   */
  private trashSource(entry: Trashed, rel: string): string {
    if (!this.safeRel(rel)) throw this.damaged(entry);
    const filesRel = `${TRASH}/${entry.id}/files`;
    const filesRoot = this.abs(filesRel);
    if (fs.lstatSync(filesRoot, { throwIfNoEntry: false })?.isSymbolicLink()) throw this.damaged(entry);
    const src = this.abs(`${filesRel}/${rel}`);
    if (!src.startsWith(filesRoot + path.sep)) throw this.damaged(entry);
    if (fs.lstatSync(src, { throwIfNoEntry: false })?.isSymbolicLink()) throw this.damaged(entry);
    return src;
  }

  /**
   * Put an entry back where it was, returning it as it landed. A name taken since is numbered — a
   * folder's too, never merged — and every document keeps its id and the day it was made.
   *
   * **The manifest is untrusted input**: a synced or shared folder carries one its author wrote.
   * The name is put through the same rules a name from the wire is, the `docs` key must be the file
   * that name stores, and the source stays under this entry's `files/` with no link on the way.
   */
  async restore(id: string): Promise<Trashed> {
    const m = this.manifest(id);
    if (!m) throw new NotFound(`nothing in the trash is \`${id}\``);
    const at = this.trashDir(id);
    const { docs, ...entry } = m;
    let settled: string;
    let doc: string | null = null;
    let holds: Removed | null = null;
    if (entry.kind === "folder") {
      const own = this.ownFolder(entry.name);
      if (!own) throw this.damaged(entry);
      for (const file of Object.keys(docs)) {
        if (!file.startsWith(`${own}/`)) throw this.damaged(entry);
        this.trashSource(entry, file);
      }
      const src = this.trashSource(entry, own);
      if (!isDir(src)) throw new NotFound(`\`${entry.name}\` has nothing left to restore`);
      settled = unique(entry.name, (n) => exists(this.abs(n)) || this.caseTwin(n));
      const dst = this.writeAt(settled);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      moveFile(src, dst);
      const moved = (n: string): string => settled + n.slice(entry.name.length);
      const was = entry.holds ?? emptyRemoved();
      holds = {
        boards: was.boards.map(moved),
        notes: was.notes.map(moved),
        quizzes: was.quizzes.map(moved),
        tables: was.tables.map(moved),
        files: was.files.map(moved),
        folders: was.folders.map(moved),
      };
      this.home.tx(() => {
        for (const [file, kept] of Object.entries(docs)) this.back(kept, moved(file));
      });
    } else {
      const kind = entry.kind;
      const own = this.ownFiles(entry.name, kind);
      if (!own) throw this.damaged(entry);
      const keys = Object.keys(docs);
      if (keys.length > 1) throw this.damaged(entry);
      const file = keys[0] ?? own.find((f) => isFile(this.trashSource(entry, f))) ?? own[0]!;
      if (!own.includes(file)) throw this.damaged(entry);
      const src = this.trashSource(entry, file);
      if (!isFile(src)) throw new NotFound(`\`${entry.name}\` has nothing left to restore`);
      settled = kind === "file" ? uniqueFile(entry.name, (n) => this.taken(n)) : unique(entry.name, (n) => this.taken(n));
      const target = kind === "file" ? settled : settled + file.slice(entry.name.length);
      const dst = this.writeAt(target);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      moveFile(src, dst);
      const images = this.trashSource(entry, assetsPrefix(entry.name));
      if (isDir(images)) fs.cpSync(images, this.writeAt(assetsPrefix(settled)), { recursive: true });
      const kept = docs[file];
      if (kept) doc = this.back(kept, target);
    }
    fs.rmSync(at, { recursive: true, force: true });
    this.toldTrash();
    this.emit({ type: "tree" });
    return { ...entry, name: settled, doc, holds };
  }

  /** Delete an entry for good, with everything it holds. */
  async forget(id: string): Promise<void> {
    const at = this.trashDir(id);
    if (!isDir(at)) throw new NotFound(`nothing in the trash is \`${id}\``);
    fs.rmSync(at, { recursive: true, force: true });
    this.toldTrash();
  }

  // -- attachments -----------------------------------------------------------

  /**
   * Store an attachment under `name` — a file's name, extension and all — returning the name the vault
   * settled on, numbered before its extension when taken. Its id record is written as it is made.
   */
  async putFile(
    name: string,
    data: Uint8Array,
    title: string | null,
    opts: { id?: string; created?: string } = {},
  ): Promise<string> {
    const asked = fileNameFrom(name, this.types);
    if (!asked) throw new Refused(`not a file name \`${name}\``);
    const settled = uniqueFile(asked, (n) => this.taken(n));
    const abs = this.writeAt(settled);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, data);
    moveFile(tmp, abs);
    const taken = (x: string): boolean => !!this.home.docById(this.id, x);
    const id = validId(opts.id) && !taken(opts.id) ? opts.id : mint(taken);
    const clean = title?.trim() || null;
    this.writeFileId(id, settled, clean);
    this.home.putDoc({
      vault: this.id,
      id,
      path: settled,
      kind: "file",
      created: validInstant(opts.created) ? opts.created : instant(),
      minted: 1,
      title: clean,
    });
    this.home.set(this.digestKey(id), digestOf(data));
    return settled;
  }

  async getFile(name: string): Promise<Buffer | null> {
    try {
      return fs.readFileSync(this.abs(this.fileOf(name, "file")));
    } catch {
      return null;
    }
  }

  async fileInfo(name: string): Promise<FileInfo | null> {
    let file: string;
    try {
      file = this.fileOf(name, "file");
    } catch {
      return null;
    }
    const st = fs.statSync(this.abs(file), { throwIfNoEntry: false });
    if (!st?.isFile()) return null;
    const row = this.row(name, "file");
    return { name, title: row?.title ?? null, bytes: st.size };
  }

  /** Call an attachment something. A PDF has no frontmatter, so the title is its id record's. */
  async titleFile(name: string, title: string): Promise<void> {
    const row = this.row(name, "file");
    if (!row) throw new NotFound(`no file \`${name}\``);
    if (row.title === title) return;
    const next = { ...row, title, minted: 1 };
    this.writeFileId(row.id, row.path, title);
    this.home.putDoc(next);
    const bytes = await this.getFile(name);
    this.emit({ type: "doc", kind: "file", name, sha1: bytes ? sha1(bytes) : null, title });
  }

  // -- legacy pictures -------------------------------------------------------

  /** A path to a document's legacy picture, confined to its `.assets/` folders. */
  private assetPath(rel: string): string {
    const clean = rel.replace(/\\/g, "/");
    if (!clean.split("/").some((s) => s.endsWith(".assets"))) throw new Refused("not a picture of a document");
    return this.abs(clean);
  }

  async getAsset(rel: string): Promise<Buffer | null> {
    const abs = this.assetPath(rel);
    return isFile(abs) ? fs.readFileSync(abs) : null;
  }

  async assetFiles(name: string): Promise<AssetFile[]> {
    const dir = this.abs(assetsPrefix(name));
    if (!isDir(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((e) => ({ path: `${assetsPrefix(name)}/${e.name}`, bytes: fs.statSync(path.join(dir, e.name)).size }));
  }

  async dropAssets(paths: readonly string[]): Promise<void> {
    for (const p of paths) {
      const abs = this.assetPath(p);
      if (isFile(abs)) fs.rmSync(abs);
    }
  }

  // -- reading many ----------------------------------------------------------

  /**
   * Every text, for the index, the corpus and the sweep: a board under its name, any other kind
   * under `<name>.<kind>.md` so nothing mistakes one for a board, and the saved components under
   * `components/<name>`.
   */
  async texts(tree?: Tree): Promise<Record<string, string>> {
    const t = tree ?? (await this.tree());
    const out: Record<string, string> = {};
    for (const kind of TEXT_KINDS) {
      for (const name of byKind(t)[kind]) {
        try {
          out[textKey(name, kind)] = fs.readFileSync(this.abs(this.fileOf(name, kind)), "utf8");
        } catch {
          /* gone since the listing */
        }
      }
    }
    Object.assign(out, await this.components());
    return out;
  }

  /** Every saved component's text, keyed `components/<name>`. */
  async components(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const root = this.abs(COMPONENTS);
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else if (e.name.toLowerCase().endsWith(SUFFIX.board)) {
          try {
            out[`${COMPONENT_PREFIX}${prefix}${e.name.slice(0, -SUFFIX.board.length)}`] = fs.readFileSync(
              path.join(dir, e.name),
              "utf8",
            );
          } catch {
            /* gone */
          }
        }
      }
    };
    walk(root, "");
    return out;
  }

  // -- the change feed -------------------------------------------------------

  /**
   * Hear what changes, as it changes. **One watcher per vault**, started by the first listener and
   * kept until the vault is closed: tabs come and go all day, and stopping a watcher while another is
   * being started on the same folder is a race `@parcel/watcher` loses — its unsubscribe rejects
   * with "Unable to remove watcher", unhandled, and took the whole server down under the e2e suite.
   * `@parcel/watcher` is N-API with prebuilt binaries for the three platforms, needs no rebuild for
   * Electron, and reports a whole tree on every one.
   */
  async subscribe(on: (c: Change) => void): Promise<() => void> {
    this.listeners.add(on);
    if (!this.stopping) this.stopping = this.startWatch();
    try {
      await this.stopping;
    } catch (e) {
      this.listeners.delete(on);
      this.stopping = null;
      throw e;
    }
    return () => {
      this.listeners.delete(on);
    };
  }

  // -- raw IO for the sync client --------------------------------------------

  /** The bytes at `rel`, or `null` when nothing (or a folder) is there. */
  readRaw(rel: string): Buffer | null {
    try {
      return fs.readFileSync(this.abs(rel));
    } catch {
      return null;
    }
  }

  /**
   * Write `bytes` at `rel` only if what is there has sha1 `expect` (`null`: nothing is). The same
   * bytes already there are a success that touches nothing. **Never** mints ids or changes a byte:
   * what sync writes is what the other device had.
   */
  writeRawIf(rel: string, bytes: Uint8Array, expect: string | null): boolean {
    const abs = this.writeAt(rel);
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (st && !st.isFile()) return false;
    if (st) {
      const cur = fs.readFileSync(abs);
      if (Buffer.compare(cur, bytes) === 0) {
        this.noteAdopted(rel, bytes);
        return true;
      }
      if (expect === null || sha1(cur) !== expect) return false;
    } else if (expect !== null) return false;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeAtomic(abs, bytes);
    this.noteAdopted(rel, bytes);
    return true;
  }

  /** Remove the file at `rel` if its sha1 is `expect`. Its folder stays. */
  removeRawIf(rel: string, expect: string): boolean {
    const abs = this.writeAt(rel);
    const cur = this.readRaw(rel);
    if (!cur || sha1(cur) !== expect) return false;
    fs.rmSync(abs, { force: true });
    return true;
  }

  mkdirRaw(rel: string): void {
    fs.mkdirSync(this.writeAt(rel), { recursive: true });
  }

  rmdirRawIfEmpty(rel: string): boolean {
    try {
      fs.rmdirSync(this.writeAt(rel));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Every path the watcher reports, vault-relative, before any filtering by kind: a second channel
   * on the **same** subscription (never a second watcher on the folder), ended with the vault.
   */
  async subscribeRaw(on: (rels: string[]) => void): Promise<() => void> {
    this.rawListeners.add(on);
    if (!this.stopping) this.stopping = this.startWatch();
    try {
      await this.stopping;
    } catch (e) {
      this.rawListeners.delete(on);
      this.stopping = null;
      throw e;
    }
    return () => {
      this.rawListeners.delete(on);
    };
  }

  /** Say something to every listener — a change the watcher cannot see, such as an attachment's title. */
  emit(c: Change): void {
    for (const l of [...this.listeners]) {
      try {
        l(c);
      } catch {
        /* a listener that threw is its own problem */
      }
    }
  }

  /** End every feed on this vault — it is being closed. */
  async close(): Promise<void> {
    this.emit({ type: "gone" });
    this.listeners.clear();
    this.rawListeners.clear();
    const stop = this.stopping;
    this.stopping = null;
    if (stop) await (await stop.catch(() => async () => undefined))();
  }

  private async startWatch(): Promise<() => Promise<void>> {
    if (!this.present) this.walk();
    const sub = await watcher.subscribe(
      this.root,
      (err, events) => {
        if (err) return;
        if (this.rawListeners.size) {
          const rels = [...new Set(events.map((ev) => this.rel(ev.path)).filter(Boolean))];
          if (rels.length) {
            for (const l of [...this.rawListeners]) {
              try {
                l(rels);
              } catch {
                /* a listener that threw is its own problem */
              }
            }
          }
        }
        let tree = false;
        const seen = new Set<string>();
        for (const ev of events) {
          const rel = this.rel(ev.path);
          if (rel.startsWith(`${COMPONENTS}/`)) {
            const leaf = rel.slice(COMPONENTS.length + 1);
            if (leaf.toLowerCase().endsWith(SUFFIX.board)) {
              const name = `${COMPONENT_PREFIX}${leaf.slice(0, -SUFFIX.board.length)}`;
              this.emit({ type: "doc", kind: "board", name, sha1: ev.type === "delete" ? null : "", title: null });
            }
            continue;
          }
          if (rel.split("/").some(ignored)) continue;
          const found = classify(rel, this.types);
          if (!found) {
            if (ev.type !== "update") tree = true; // a folder came or went
            continue;
          }
          const key = `${found.kind}:${found.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const gone = ev.type === "delete" || !isFile(ev.path);
          const low = rel.toLowerCase();
          if (gone) {
            this.present?.delete(low);
            tree = true;
          } else if (ev.type === "create" && !this.present?.has(low)) {
            this.present?.add(low);
            tree = true;
          }
          if (gone) {
            this.emit({ type: "doc", kind: found.kind, name: found.name, sha1: null, title: null });
            continue;
          }
          if (found.kind === "file") {
            let bytes: Buffer;
            try {
              bytes = fs.readFileSync(ev.path);
            } catch {
              continue;
            }
            const row = this.home.docByPath(this.id, rel);
            this.emit({ type: "doc", kind: "file", name: found.name, sha1: sha1(bytes), title: row?.title ?? null });
            continue;
          }
          let text: string;
          try {
            text = fs.readFileSync(ev.path, "utf8");
          } catch {
            continue;
          }
          const f = frontOf(found.kind, text, "");
          this.emit({
            type: "doc",
            kind: found.kind,
            name: found.name,
            sha1: sha1(text),
            title: f.title ?? null,
            ...(found.kind === "note" ? { task: f.task ?? null, project: f.project ?? null, event: f.event ?? null } : {}),
            ...(found.kind === "quiz" ? { questions: f.asks?.length ?? 0 } : {}),
          });
        }
        if (tree) this.emit({ type: "tree" });
      },
      { ignore: [".git", ".obsidian", ".trash", ".stversions", "node_modules", ".anydag/vault.json"] },
    );
    return async () => {
      try {
        await sub.unsubscribe();
      } catch {
        /* the folder went first, or the watcher with it: nothing left to stop */
      }
    };
  }
}

/** The key `texts` gives a document: a board its name, any other kind `<name>.<kind>.md`. */
export const textKey = (name: string, kind: TextKind): string => (kind === "board" ? name : `${name}.${kind}.md`);

function frontOf(kind: TextKind, text: string, stamp: string): Front {
  let asks: (string | null)[] | undefined;
  if (kind === "quiz") {
    try {
      asks = parseQuiz(text).questions.map((q) => q.id ?? null);
    } catch {
      asks = [];
    }
  }
  return {
    stamp,
    id: frontId(text),
    title: titleOf(text),
    task: kind === "note" ? taskOf(text) : undefined,
    project: kind === "note" ? projectOf(text) : undefined,
    event: kind === "note" ? eventOf(text) : undefined,
    asks,
  };
}

const DAG_ID = /dag:([0-9a-z]{10})(?![0-9a-z])/g;
const idsIn = (text: string): string[] => [...new Set([...text.matchAll(DAG_ID)].map((m) => m[1]!))];

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function emptyRemoved(): Removed {
  return { boards: [], notes: [], quizzes: [], tables: [], files: [], folders: [] };
}

function pluralOf(kind: Kind): Exclude<keyof Removed, "folders"> {
  return ({ board: "boards", note: "notes", quiz: "quizzes", table: "tables", file: "files" } as const)[kind];
}

const exists = (abs: string): boolean => fs.existsSync(abs);
const isFile = (abs: string): boolean => !!fs.statSync(abs, { throwIfNoEntry: false })?.isFile();
const isDir = (abs: string): boolean => !!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory();

function sameFile(a: string, b: string): boolean {
  const x = fs.statSync(a, { throwIfNoEntry: false });
  const y = fs.statSync(b, { throwIfNoEntry: false });
  return !!x && !!y && x.ino === y.ino && x.dev === y.dev;
}

/** The id `.anydag/vault.json` claims, or `null` when the folder is not a vault yet. Reads only. */
export function readVaultId(root: string): string | null {
  const file = path.join(root, ".anydag", "vault.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { id?: unknown };
    if (validId(data.id)) return data.id;
  } catch {
    /* not a vault yet */
  }
  return null;
}

/**
 * Write a vault's id. The `.anydag` folder is the app's own, so a link where it should be is
 * refused: opening a downloaded folder must not write through it into somebody else's vault.
 */
export function writeVaultId(root: string, id: string): void {
  const dir = path.join(root, ".anydag");
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) throw new Refused(`\`.anydag\` is a link: ${root}`);
  if (st && !st.isDirectory()) throw new Refused(`\`.anydag\` is not a folder: ${root}`);
  if (!st) fs.mkdirSync(dir, { recursive: true });
  const realDir = fs.realpathSync(dir);
  if (realDir !== path.join(fs.realpathSync(root), ".anydag")) throw new Refused(`\`.anydag\` is outside the vault: ${root}`);
  writeAtomic(path.join(dir, "vault.json"), `${JSON.stringify({ id }, null, 1)}\n`);
}

/** The vault's own id, kept in `.anydag/vault.json` so caches keyed by it survive a moved folder. */
function vaultId(root: string): string {
  const had = readVaultId(root);
  if (had) return had;
  const id = mint();
  writeVaultId(root, id);
  return id;
}

/** A rename retried while Windows holds the target, as `writeAtomic` is. */
function moveFile(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
        return;
      }
      if (i >= 10 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
    }
  }
}

/**
 * A temp file beside the target, then a rename. Retried for a moment on `EPERM`/`EBUSY`/`EACCES`,
 * which is Windows saying an antivirus or the search indexer has the target open.
 */
export function writeAtomic(file: string, text: string | Uint8Array): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  if (typeof text === "string") fs.writeFileSync(tmp, text, "utf8");
  else fs.writeFileSync(tmp, text);
  try {
    moveFile(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** `${size}:${sha1}` of an attachment's bytes. */
function digestOf(data: Uint8Array): string {
  return `${data.byteLength}:${sha1(data)}`;
}
