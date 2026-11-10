/**
 * The convergence harness's world: one in-process sync server — the real
 * Hono app over PGlite and a temp blob folder, shared by every seed of a test file — and two or three
 * devices on one remote vault. Each device is what the app runs: a real `Vault` in a temp folder
 * with its own home (so `tree()`'s duplicate-id tie-break runs, as it does in the app), `vaultFs`
 * over it, its own `SyncState` and `Bases`, and a `SyncEngine` whose `HttpSyncApi` calls the app
 * through `app.request` — no port. A seeded schedule of steps then edits, renames, deletes, writes
 * from outside, saves a stale open page, drops connections, takes devices offline and syncs, and
 * `settle()` runs every device until a whole round commits nothing.
 *
 * The ledger is what the three assertions read (see `check()`):
 * - every token a step **landed** on a disk (`written`), and the tokens a step deliberately removed
 *   (`deletable`): a line deleted, a file deleted from disk, a picture overwritten. A token that is
 *   not deletable must be in some file of the settled vault — a conflict copy and the trash count.
 * - every id a step deleted with its file (`deletedIds`): the only ids a `dag:` link may still name
 *   when no file carries them.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Home } from "../../../server/home";
import { ALPHABET, frontId } from "../../../server/ids";
import { classify } from "../../../server/names";
import { Bases, sha1Of } from "../../../server/sync/bases";
import { HttpSyncApi, isSyncError } from "../../../server/sync/client";
import { SyncEngine } from "../../../server/sync/engine";
import { vaultFs } from "../../../server/sync/fs";
import { SyncState } from "../../../server/sync/state";
import type { SyncFs } from "../../../server/sync/types";
import { Vault } from "../../../server/vault";
import { merge3 } from "../../../src/note/merge";
import { randomKey } from "../../protocol/crypto";
import { device as pairDevice, vault as makeVault, type Harness } from "../helpers";
import { Rng } from "./prng";

/** What every conflict copy is dated with: the engine's clock is pinned, so names replay. */
const AT = new Date(2026, 10, 6, 14, 30);
/**
 * Where a seed's own clock starts, and how far it moves between steps (ms, at most). A file's birth
 * is a second-resolution instant that decides which of two documents keeps a duplicate id, so which
 * seconds the births land in is part of the schedule: read from the disk it was the machine's speed,
 * and a seed that held with every birth in one second (an idle machine) failed once a slow one
 * spread them over several. Drawn from the seed, the same schedule makes the same births every run.
 */
const T0 = Date.parse("2026-11-06T14:30:00Z");
const TICK_MS = 900;
const WORDS = ["plan", "ideas", "log", "todo", "draft", "spec", "inbox", "notes"];
const FOLDERS = ["", "notes/", "work/deep/"];
const TOKEN = /tok-\d+-\d+/g;
const REF = /\(dag:([0-9a-z]{10})\)/g;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** How many rounds `settle` may take before it fails loudly. */
const SETTLE_ROUNDS = 12;

interface Fault {
  /** Requests that still get through before the connection drops. */
  after: number;
  /** Whether the dropped request reached the server (`response`: the answer was what was lost). */
  lose: "request" | "response";
}

interface Page {
  rel: string;
  bytes: Buffer;
}

export interface Dev {
  name: string;
  root: string;
  dirs: string[];
  home: Home;
  vault: Vault;
  fs: SyncFs;
  state: SyncState;
  engine: SyncEngine;
  online: boolean;
  fault: Fault | null;
  pages: Page[];
  /** What this device's vault reads as a file's birth, in ms; `null` reads the disk. */
  clock: number | null;
}

export type StepKind =
  | "create"
  | "append"
  | "editLine"
  | "insertLine"
  | "deleteLine"
  | "rename"
  | "caseRename"
  | "delete"
  | "trash"
  | "binary"
  | "mkdir"
  | "rmdir"
  | "pageOpen"
  | "pageSave"
  | "offline"
  | "sync"
  | "syncBoth"
  | "syncMidEdit"
  | "pull"
  | "push"
  | "list";

export const WEIGHTS: Record<StepKind, number> = {
  create: 10,
  append: 8,
  editLine: 10,
  insertLine: 5,
  deleteLine: 4,
  rename: 5,
  caseRename: 2,
  delete: 3,
  trash: 2,
  binary: 4,
  mkdir: 2,
  rmdir: 1,
  pageOpen: 3,
  pageSave: 4,
  offline: 2,
  sync: 22,
  syncBoth: 6,
  syncMidEdit: 4,
  pull: 5,
  push: 5,
  list: 3,
};

const isDoc = (rel: string): boolean => !rel.startsWith(".anydag/") && rel.toLowerCase().endsWith(".md");
const isPicture = (rel: string): boolean => !rel.startsWith(".anydag/") && rel.toLowerCase().endsWith(".png");
const docSuffix = (rel: string): string => (rel.toLowerCase().endsWith(".board.md") ? ".board.md" : ".md");
/** The name the vault lists a document under: its path less the kind's suffix, case folded. */
const docName = (rel: string): string => rel.toLowerCase().replace(/(\.(board|quiz|table|note))?\.md$/, "");
const latin1 = (b: Uint8Array): string => Buffer.from(b).toString("latin1");
const tokensIn = (b: Uint8Array): string[] => latin1(b).match(TOKEN) ?? [];

/** The lines of a document a step may edit: after the frontmatter, and not empty. */
function bodyLines(lines: string[]): number[] {
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    start = end < 0 ? lines.length : end + 1;
  }
  const out: number[] = [];
  for (let i = start; i < lines.length; i++) if (lines[i] !== "") out.push(i);
  return out;
}

let worlds = 0;

export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly devs: Dev[] = [];
  readonly log: string[] = [];
  /** Commits the server accepted. */
  commits = 0;
  /** The seed's clock — what every vault reads as a file's birth once steps run. */
  private readonly time: Rng;
  private at = T0;
  private ticking = false;
  readonly written = new Map<string, number>();
  readonly deletable = new Set<string>();
  readonly deletedIds = new Set<string>();
  private readonly minted = new Set<string>();
  private tok = 0;
  private stepNo = 0;
  private readonly h: Harness;

  private constructor(h: Harness, seed: number) {
    this.h = h;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.time = new Rng(seed ^ 0x5eed5eed);
  }

  static async create(h: Harness, seed: number, devices: number): Promise<World> {
    const w = new World(h, seed);
    const account = `conv${seed}x${++worlds}`;
    const vk = randomKey();
    const paired = [];
    for (let i = 0; i < devices; i++) paired.push(await pairDevice(h, account));
    const remote = await makeVault(h, paired[0]!.token);
    for (let i = 0; i < devices; i++) w.devs.push(w.makeDevice("ABC"[i]!, paired[i]!, remote, vk));
    return w;
  }

  private makeDevice(name: string, paired: { token: string; device: string }, remote: string, vk: Uint8Array): Dev {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `anydag-conv-${name}-`));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `anydag-conv-home-${name}-`));
    const home = new Home(homeDir);
    const dev = { name, root, dirs: [root, homeDir], home, online: true, fault: null, pages: [], clock: null } as unknown as Dev;
    const vault = new Vault(root, home, { born: () => (dev.clock === null ? null : new Date(dev.clock)) });
    const stateDir = path.join(homeDir, "sync");
    const state = new SyncState(stateDir);
    Object.assign(dev, { vault, state });
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!dev.online) throw new TypeError("offline");
      const url = String(input);
      const counted = (res: Response): Response => {
        if (res.ok && init?.method === "POST" && url.endsWith("/commit")) this.commits++;
        return res;
      };
      const f = dev.fault;
      if (f && f.after-- <= 0) {
        dev.fault = null;
        if (f.lose === "request") throw new TypeError("connection dropped");
        const res = counted(await this.h.app.request(url, init));
        await res.arrayBuffer().catch(() => undefined);
        throw new TypeError("connection dropped before the answer");
      }
      return counted(await this.h.app.request(url, init));
    }) as typeof fetch;
    dev.fs = vaultFs(vault);
    dev.engine = new SyncEngine({
      fs: dev.fs,
      api: new HttpSyncApi({ url: "http://api.test", token: paired.token, fetch: fetcher, retries: 0 }),
      state,
      bases: new Bases(path.join(stateDir, "bases")),
      vk,
      remote,
      device: { id: paired.device, name },
      types: vault.types,
      now: () => AT,
    });
    return dev;
  }

  async close(): Promise<void> {
    for (const d of this.devs) {
      await d.vault.close().catch(() => undefined);
      d.home.close();
      d.state.close();
      for (const dir of d.dirs) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // -- the disk, as a person or an agent sees it --------------------------------------------------

  private abs(d: Dev, rel: string): string {
    return path.join(d.root, ...rel.split("/"));
  }

  read(d: Dev, rel: string): Buffer | null {
    try {
      return fs.readFileSync(this.abs(d, rel));
    } catch {
      return null;
    }
  }

  write(d: Dev, rel: string, bytes: Uint8Array): void {
    const file = this.abs(d, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }

  remove(d: Dev, rel: string): void {
    fs.rmSync(this.abs(d, rel), { force: true });
  }

  mkdir(d: Dev, rel: string): void {
    fs.mkdirSync(this.abs(d, rel), { recursive: true });
  }

  rmdir(d: Dev, rel: string): void {
    fs.rmdirSync(this.abs(d, rel));
  }

  has(d: Dev, rel: string): boolean {
    return fs.existsSync(this.abs(d, rel));
  }

  private async files(d: Dev): Promise<string[]> {
    return (await d.fs.scan()).filter((e) => e.kind === "file").map((e) => e.rel);
  }

  private async taken(d: Dev, rel: string, except?: string): Promise<boolean> {
    const want = rel.toLowerCase();
    const all = await d.fs.scan();
    return all.some((e) => e.rel.toLowerCase() === want && e.rel !== except) || fs.existsSync(this.abs(d, rel));
  }

  /** Every syncing path on `d` and its bytes; a folder marker as `<dir>`. */
  async snapshot(d: Dev): Promise<Map<string, Buffer | "<dir>">> {
    const out = new Map<string, Buffer | "<dir>">();
    const entries = (await d.fs.scan()).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    for (const e of entries) out.set(e.rel, e.kind === "dir" ? "<dir>" : (this.read(d, e.rel) ?? Buffer.alloc(0)));
    return out;
  }

  // -- the ledger ---------------------------------------------------------------------------------

  private token(): string {
    return `tok-${this.seed}-${++this.tok}`;
  }

  landed(text: string): void {
    for (const t of text.match(TOKEN) ?? []) if (!this.written.has(t)) this.written.set(t, this.stepNo);
  }

  forgetting(bytes: Uint8Array): void {
    for (const t of tokensIn(bytes)) this.deletable.add(t);
  }

  private mintId(): string {
    for (;;) {
      let id = "";
      for (let i = 0; i < 10; i++) id += ALPHABET[this.rng.int(0, ALPHABET.length - 1)];
      if (!this.minted.has(id)) {
        this.minted.add(id);
        return id;
      }
    }
  }

  private say(d: Dev | null, what: string): void {
    this.log.push(`#${this.stepNo} ${d ? d.name : "-"} ${what}`);
  }

  /** After a local write: the watcher saw it (a `touch`), or nobody did and a later scan must. */
  private seen(d: Dev, rels: string[]): string {
    if (this.rng.chance(0.7)) {
      d.engine.touch(rels);
      return "";
    }
    return " (unwatched)";
  }

  private async idsOn(d: Dev): Promise<string[]> {
    const out: string[] = [];
    for (const rel of (await this.files(d)).filter(isDoc)) {
      const id = frontId(this.read(d, rel)?.toString("utf8") ?? "");
      if (typeof id === "string") out.push(id);
    }
    return out;
  }

  private async newLine(d: Dev): Promise<string> {
    const t = this.token();
    const ids = await this.idsOn(d);
    return ids.length && this.rng.chance(0.3) ? `- ${t} see [it](dag:${this.rng.pick(ids)})` : `- ${t}`;
  }

  // -- steps --------------------------------------------------------------------------------------

  /** Move the seed's clock on, every device reading the same one (a separate stream: the schedule is the seed's). */
  private tick(): void {
    this.ticking = true;
    this.at += this.time.int(0, TICK_MS);
    for (const d of this.devs) d.clock = this.at;
  }

  async step(): Promise<void> {
    this.stepNo++;
    this.tick();
    const kind = this.rng.weighted(WEIGHTS);
    const d = this.rng.pick(this.devs);
    await this.run(kind, d);
  }

  private async run(kind: StepKind, d: Dev): Promise<void> {
    switch (kind) {
      case "create":
        return this.create(d);
      case "append":
      case "editLine":
      case "insertLine":
      case "deleteLine":
        return this.editDoc(d, kind);
      case "rename":
      case "caseRename":
        return this.rename(d, kind === "caseRename");
      case "delete":
        return this.del(d);
      case "trash":
        return this.trash(d);
      case "binary":
        return this.binary(d);
      case "mkdir":
        return this.makeDir(d);
      case "rmdir":
        return this.removeDir(d);
      case "pageOpen":
        return this.pageOpen(d);
      case "pageSave":
        return this.pageSave(d);
      case "offline":
        d.online = !d.online;
        return this.say(d, d.online ? "online" : "offline");
      case "sync":
      case "pull":
      case "push":
        return this.sync(d, kind);
      case "syncBoth":
        return this.syncBoth();
      case "syncMidEdit":
        return this.syncMidEdit(d);
      case "list":
        await d.vault.tree();
        return this.say(d, "list (tree)");
    }
  }

  private async create(d: Dev): Promise<void> {
    const word = this.rng.pick(WORDS);
    const rel = `${this.rng.pick(FOLDERS)}${word}${this.rng.chance(0.15) ? ".board.md" : ".md"}`;
    if (await this.taken(d, rel)) return this.say(d, `create ${rel}: taken, skipped`);
    const lines: string[] = [];
    if (this.rng.chance(0.7)) lines.push("---", `id: ${this.mintId()}`, `title: ${word}`, "---");
    for (let i = this.rng.int(1, 4); i > 0; i--) lines.push(await this.newLine(d));
    const text = lines.join("\n") + "\n";
    this.write(d, rel, Buffer.from(text));
    this.landed(text);
    this.say(d, `create ${rel} ${JSON.stringify(text)}${this.seen(d, [rel])}`);
  }

  private async pickDoc(d: Dev): Promise<string | null> {
    const docs = (await this.files(d)).filter(isDoc);
    return docs.length ? this.rng.pick(docs) : null;
  }

  /** One edit to one line of `text`; `null` when there is nothing to edit. */
  private async editText(
    d: Dev,
    text: string,
    kind: "append" | "editLine" | "insertLine" | "deleteLine",
  ): Promise<{ text: string; what: string; dropped?: string } | null> {
    const lines = text.split("\n");
    const body = bodyLines(lines);
    // Line 1 half the time, so two devices often edit the same line.
    const at = (): number => (this.rng.chance(0.5) ? body[0]! : this.rng.pick(body));
    if (kind === "append" || !body.length) {
      const line = await this.newLine(d);
      if (lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, line);
      else lines.push(line);
      return { text: lines.join("\n"), what: `append ${JSON.stringify(line)}` };
    }
    if (kind === "editLine") {
      const i = at();
      const t = this.token();
      lines[i] = `${lines[i]} ${t}`;
      return { text: lines.join("\n"), what: `edit line ${i} +${t}` };
    }
    if (kind === "insertLine") {
      const i = this.rng.pick(body);
      const line = await this.newLine(d);
      lines.splice(i, 0, line);
      return { text: lines.join("\n"), what: `insert at ${i} ${JSON.stringify(line)}` };
    }
    const i = at();
    const [gone] = lines.splice(i, 1);
    return { text: lines.join("\n"), what: `delete line ${i} ${JSON.stringify(gone)}`, dropped: gone };
  }

  private async editDoc(d: Dev, kind: "append" | "editLine" | "insertLine" | "deleteLine"): Promise<void> {
    const rel = await this.pickDoc(d);
    if (!rel) return this.say(d, `${kind}: no document, skipped`);
    const before = this.read(d, rel)!.toString("utf8");
    const e = await this.editText(d, before, kind);
    if (!e) return this.say(d, `${kind} ${rel}: nothing to edit`);
    if (e.dropped) this.forgetting(Buffer.from(e.dropped));
    this.write(d, rel, Buffer.from(e.text));
    this.landed(e.text);
    this.say(d, `${rel}: ${e.what}${this.seen(d, [rel])}`);
  }

  private async rename(d: Dev, caseOnly: boolean): Promise<void> {
    const all = (await this.files(d)).filter((r) => isDoc(r) || isPicture(r));
    if (!all.length) return this.say(d, "rename: nothing, skipped");
    const from = this.rng.pick(all);
    let to: string;
    if (caseOnly) {
      const slash = from.lastIndexOf("/") + 1;
      const c = from[slash]!;
      const flipped = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
      if (flipped === c) return this.say(d, `case rename ${from}: no case to change`);
      to = from.slice(0, slash) + flipped + from.slice(slash + 1);
    } else {
      const word = this.rng.pick(WORDS);
      to = isPicture(from) ? `pics/${word}-${this.rng.int(1, 3)}.png` : `${this.rng.pick(FOLDERS)}${word}${docSuffix(from)}`;
      if (await this.taken(d, to)) return this.say(d, `rename ${from} → ${to}: taken, skipped`);
    }
    const bytes = this.read(d, from)!;
    if (caseOnly) {
      // The app's case-only rename: the file moves through a temp name, as Vault.rename does.
      this.remove(d, from);
      this.write(d, to, bytes);
    } else {
      this.write(d, to, bytes);
      this.remove(d, from);
    }
    this.say(d, `rename ${from} → ${to}${this.seen(d, [from, to])}`);
  }

  private async del(d: Dev): Promise<void> {
    const all = (await this.files(d)).filter((r) => isDoc(r) || isPicture(r));
    if (!all.length) return this.say(d, "delete: nothing, skipped");
    const rel = this.rng.pick(all);
    const bytes = this.read(d, rel)!;
    this.forgetting(bytes);
    const id = isDoc(rel) ? frontId(bytes.toString("utf8")) : null;
    if (typeof id === "string") this.deletedIds.add(id);
    this.remove(d, rel);
    this.say(d, `delete ${rel}${this.seen(d, [rel])}`);
  }

  private async trash(d: Dev): Promise<void> {
    const all = (await this.files(d)).filter((r) => isDoc(r) || isPicture(r));
    if (!all.length) return this.say(d, "trash: nothing, skipped");
    const rel = this.rng.pick(all);
    const c = classify(rel, d.vault.types);
    if (!c) return this.say(d, `trash ${rel}: not a document`);
    try {
      await d.vault.trash(c.name, c.kind);
    } catch (e) {
      return this.say(d, `trash ${rel}: refused (${(e as Error).message})`);
    }
    // The tokens and the id stay in `.anydag/trash/`, which syncs: they must survive.
    this.say(d, `trash ${rel}${this.seen(d, [rel])}`);
  }

  private async binary(d: Dev): Promise<void> {
    const pics = (await this.files(d)).filter(isPicture);
    const edit = pics.length > 0 && this.rng.chance(0.5);
    const rel = edit ? this.rng.pick(pics) : `pics/${this.rng.pick(WORDS)}-${this.rng.int(1, 3)}.png`;
    if (!edit && (await this.taken(d, rel))) return this.say(d, `picture ${rel}: taken, skipped`);
    const t = this.token();
    const bytes = Buffer.concat([PNG, Buffer.from(` ${t} `), Buffer.from(this.rng.bytes(12))]);
    if (edit) this.forgetting(this.read(d, rel)!);
    this.write(d, rel, bytes);
    this.landed(t);
    this.say(d, `${edit ? "overwrite" : "create"} picture ${rel} ${t}${this.seen(d, [rel])}`);
  }

  private async makeDir(d: Dev): Promise<void> {
    const rel = `dirs/${this.rng.pick(WORDS)}`;
    if (fs.existsSync(this.abs(d, rel))) return this.say(d, `mkdir ${rel}: exists`);
    fs.mkdirSync(this.abs(d, rel), { recursive: true });
    this.say(d, `mkdir ${rel}${this.seen(d, [rel])}`);
  }

  private async removeDir(d: Dev): Promise<void> {
    const dirs = (await d.fs.scan()).filter((e) => e.kind === "dir").map((e) => e.rel);
    if (!dirs.length) return this.say(d, "rmdir: no empty folder");
    const rel = this.rng.pick(dirs);
    try {
      fs.rmdirSync(this.abs(d, rel));
    } catch (e) {
      return this.say(d, `rmdir ${rel}: ${(e as Error).message}`);
    }
    this.say(d, `rmdir ${rel}${this.seen(d, [rel])}`);
  }

  private async pageOpen(d: Dev): Promise<void> {
    const rel = await this.pickDoc(d);
    if (!rel) return this.say(d, "open page: no document");
    d.pages.push({ rel, bytes: this.read(d, rel)! });
    if (d.pages.length > 2) d.pages.shift();
    this.say(d, `open page ${rel}`);
  }

  /**
   * The open page saves what it read, plus an edit, against the sha1 it read — and, refused, does
   * what `NoteView` does: merges with what is there now, or gives up its edit (*Use theirs*) when
   * the lines clash. A token is landed only when its write is.
   */
  private async pageSave(d: Dev): Promise<void> {
    const page = d.pages.shift();
    if (!page) return this.say(d, "save page: none open");
    const e = await this.editText(d, page.bytes.toString("utf8"), this.rng.pick(["append", "editLine", "insertLine"] as const));
    if (!e) return this.say(d, `save page ${page.rel}: nothing`);
    let base = page.bytes;
    let mine = Buffer.from(e.text);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await d.fs.writeIf(page.rel, mine, sha1Of(base))) {
        this.landed(mine.toString("utf8"));
        return this.say(d, `save page ${page.rel} (${e.what}) after ${attempt} merge(s)${this.seen(d, [page.rel])}`);
      }
      const disk = this.read(d, page.rel);
      if (!disk) return this.say(d, `save page ${page.rel}: the file went, edit dropped`);
      const merged = merge3(base.toString("utf8"), mine.toString("utf8"), disk.toString("utf8"));
      if (merged === null) return this.say(d, `save page ${page.rel}: clashes, *Use theirs* (${e.what} dropped)`);
      base = disk;
      mine = Buffer.from(merged);
    }
    this.say(d, `save page ${page.rel}: kept losing, dropped`);
  }

  /** Run a sync call, a dropped connection being a thing that happens rather than a failure. */
  private async guarded(d: Dev, what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.say(d, what);
    } catch (e) {
      if (isSyncError(e, "ES_NETWORK")) return this.say(d, `${what}: network (${e.message})`);
      this.say(d, `${what}: THREW ${(e as Error).stack ?? e}`);
      throw e;
    }
  }

  private maybeFault(d: Dev): string {
    if (!d.online || !this.rng.chance(0.12)) return "";
    d.fault = { after: this.rng.int(0, 6), lose: this.rng.chance(0.5) ? "request" : "response" };
    return ` [drops after ${d.fault.after}, ${d.fault.lose} lost]`;
  }

  private async sync(d: Dev, kind: "sync" | "pull" | "push"): Promise<void> {
    const scan = kind !== "pull" && this.rng.chance(0.5);
    const fault = this.maybeFault(d);
    await this.guarded(d, `${scan ? "scan+" : ""}${kind === "sync" ? "syncOnce" : kind}${fault}`, async () => {
      if (scan) await d.engine.scan();
      if (kind === "sync") await d.engine.syncOnce();
      else if (kind === "pull") await d.engine.pull();
      else await d.engine.push();
    });
    d.fault = null;
  }

  private async syncBoth(): Promise<void> {
    if (this.devs.length < 2) return;
    const [a, b] = [...this.devs].sort(() => this.rng.next() - 0.5) as [Dev, Dev];
    const fa = this.maybeFault(a);
    const fb = this.maybeFault(b);
    await Promise.all([
      this.guarded(a, `syncOnce, at once with ${b.name}${fa}`, () => a.engine.syncOnce()),
      this.guarded(b, `syncOnce, at once with ${a.name}${fb}`, () => b.engine.syncOnce()),
    ]);
    a.fault = b.fault = null;
  }

  /** A sync with a local edit landing somewhere in the middle of it. */
  private async syncMidEdit(d: Dev): Promise<void> {
    const ticks = this.rng.int(1, 30);
    const edit = this.rng.pick(["append", "editLine", "deleteLine"] as const);
    const running = this.guarded(d, `syncOnce, with an edit after ${ticks} ticks`, () => d.engine.syncOnce());
    for (let i = 0; i < ticks; i++) await new Promise((r) => setImmediate(r));
    await this.editDoc(d, edit);
    await running;
  }

  // -- settle and check ---------------------------------------------------------------------------

  /** Every device online and listing, scanning and syncing, until a whole round commits nothing. */
  async settle(): Promise<void> {
    this.stepNo++;
    for (const d of this.devs) {
      d.online = true;
      d.fault = null;
    }
    const trail: number[] = [];
    /** What moved on any device in each round: the paths that keep changing when it never ends. */
    const moved: string[] = [];
    let last = await this.fingerprint();
    for (let round = 0; round < SETTLE_ROUNDS; round++) {
      if (this.ticking) this.tick();
      const before = this.commits;
      for (const d of this.devs) {
        await d.vault.tree();
        await d.engine.scan();
        await d.engine.syncOnce();
      }
      trail.push(this.commits - before);
      const now = await this.fingerprint();
      const diff = [...new Set([...last.keys(), ...now.keys()])].filter((k) => last.get(k) !== now.get(k));
      moved.push(
        `round ${round + 1}: ${diff.length ? diff.map((k) => `${k} ${now.get(k)?.slice(0, 8) ?? "gone"}`).join(", ") : "nothing on disk"}`,
      );
      last = now;
      if (this.commits === before && this.devs.every((d) => d.engine.pending() === 0)) {
        this.say(null, `settled in ${round + 1} round(s): commits per round ${trail.join(",")}`);
        return;
      }
    }
    const pending = this.devs.map((d) => `${d.name}:${d.engine.pending()}`).join(" ");
    // What each device holds, and what its state says, for every path that kept moving.
    const paths = new Set<string>();
    for (const k of last.keys()) paths.add(k.slice(k.indexOf(":") + 1).toLowerCase());
    const late = moved.slice(-2).join(" ").toLowerCase();
    const detail: string[] = [];
    for (const d of this.devs) {
      for (const p of paths) {
        if (!late.includes(p)) continue;
        const st = d.state.entryAt(p);
        const disk = (await d.fs.scan())
          .filter((e) => e.rel.toLowerCase() === p)
          .map((e) => `${e.rel}=${JSON.stringify(this.read(d, e.rel)?.toString("utf8"))}`);
        detail.push(
          `${d.name} ${p}: disk [${disk.join(", ")}] state ${st ? `${st.rel} seq ${st.seq} sha1 ${st.sha1?.slice(0, 8)}` : "none"}`,
        );
      }
    }
    throw new Error(
      `did not settle in ${SETTLE_ROUNDS} rounds: commits per round ${trail.join(",")}, pending ${pending}\n${moved.slice(-4).join("\n")}\n${detail.join("\n")}`,
    );
  }

  /** `<device>:<path>` → the sha1 of what is there, over every device. */
  private async fingerprint(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const d of this.devs)
      for (const [rel, v] of await this.snapshot(d)) out.set(`${d.name}:${rel}`, v === "<dir>" ? "<dir>" : sha1Of(v));
    return out;
  }

  /** The three assertions. Answers every failure, worded; empty when the seed holds. */
  async check(): Promise<string[]> {
    const failures: string[] = [];
    const snaps = await Promise.all(this.devs.map((d) => this.snapshot(d)));
    const first = snaps[0]!;

    // 1. Every vault holds the same paths with the same bytes.
    for (let i = 1; i < snaps.length; i++) {
      const other = snaps[i]!;
      for (const rel of new Set([...first.keys(), ...other.keys()])) {
        const a = first.get(rel);
        const b = other.get(rel);
        const same = a === b || (a instanceof Buffer && b instanceof Buffer && a.equals(b));
        if (same) continue;
        const show = (x: Buffer | "<dir>" | undefined): string =>
          x === undefined ? "absent" : x === "<dir>" ? "<dir>" : JSON.stringify(latin1(x).slice(0, 300));
        failures.push(`converge: ${rel} differs — ${this.devs[0]!.name}: ${show(a)} · ${this.devs[i]!.name}: ${show(b)}`);
      }
    }

    // 2. Every token a step landed is in some file, unless a step deliberately removed it.
    const found = new Set<string>();
    for (const v of first.values()) if (v !== "<dir>") for (const t of tokensIn(v)) found.add(t);
    for (const [t, step] of this.written) {
      if (!found.has(t) && !this.deletable.has(t))
        failures.push(`lost: ${t} (written at step #${step}) is in no file, and no step removed it`);
    }

    // 3. No two documents share an id, and no `dag:` link names an id no file carries.
    // One name is one document: two files giving one name two kinds (`ideas.md` beside
    // `ideas.board.md`, made on two devices) are settled by the engine, never left for the vault.
    const names = new Map<string, string[]>();
    for (const [rel, v] of first)
      if (v !== "<dir>" && isDoc(rel)) names.set(docName(rel), [...(names.get(docName(rel)) ?? []), rel]);
    for (const rels of names.values()) if (rels.length > 1) failures.push(`one name, two kinds: ${rels.join(", ")}`);
    const carriers = new Map<string, string[]>();
    const anyCarrier = new Set<string>();
    for (const [rel, v] of first) {
      if (v === "<dir>" || !rel.toLowerCase().endsWith(".md")) continue;
      const id = frontId(v.toString("utf8"));
      if (typeof id !== "string") continue;
      anyCarrier.add(id);
      if (rel.startsWith(".anydag/")) continue;
      carriers.set(id, [...(carriers.get(id) ?? []), rel]);
    }
    for (const [id, rels] of carriers) if (rels.length > 1) failures.push(`duplicate id: ${id} is carried by ${rels.join(", ")}`);
    for (const [rel, v] of first) {
      if (v === "<dir>" || rel.startsWith(".anydag/") || !isDoc(rel)) continue;
      for (const m of v.toString("utf8").matchAll(REF)) {
        const id = m[1]!;
        if (!anyCarrier.has(id) && !this.deletedIds.has(id))
          failures.push(`dangling: ${rel} links dag:${id}, which no file carries and no step deleted`);
      }
    }
    return failures;
  }
}
