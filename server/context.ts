/**
 * What every route reads: the vault a request is about, the app's home, and what is cached per vault.
 *
 * **One server, several vaults**. A request names its vault with
 * `?vault=<id>` — the query key the page's workspace machinery already adds to every scoped request —
 * and leaves it out for the one opened last, which is the default. `within` runs the rest of the
 * request with that vault as `s.vault`, through `AsyncLocalStorage`, so a route reads `s.vault` and
 * never learns there is more than one.
 *
 * Opening a folder makes it a vault — `.anydag/vault.json`, nothing else written — and puts it on the
 * recent list in the home's database. Closing one stops serving it and keeps it on the list.
 * **Nothing here ever removes a folder.**
 */

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

import { Parsed, grammar } from "./grammar";
import type { Home } from "./home";
import { err } from "./http";
import { Practice } from "./practice";
import { SyncLinks } from "./sync/link";
import { Telemetry } from "./telemetry";
import { DEFAULT_MAX_MB } from "./uploads";
import { validId } from "./ids";
import { Refused, Vault, type VaultOptions, writeAtomic } from "./vault";

export interface Limits {
  maxBytes: number;
  types: readonly string[];
}

/** One vault being served, and the caches that describe it. */
export interface Open {
  vault: Vault;
  index: Parsed;
  corpus: Parsed;
  practice: Practice;
}

/** A vault on the recent list, as the switcher shows it. */
export interface Recent {
  id: string;
  name: string;
  path: string;
  opened: string;
  /** Being served now. */
  open: boolean;
  /** What a request naming no vault is about. */
  default: boolean;
  /** The folder is not there any more — moved, unplugged, deleted outside the app. */
  missing: boolean;
}

/** What a vault reads from its own `.anydag/settings.json` when it opens. */
function vaultOptions(root: string, base: VaultOptions = {}): VaultOptions {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, ".anydag", "settings.json"), "utf8")) as Record<string, unknown>;
    const at = raw["dag:attachments"];
    if (typeof at === "string") return { ...base, attachments: at.replace(/^\/+|\/+$/g, "") };
  } catch {
    /* no settings yet */
  }
  return base;
}

export class Session {
  private open = new Map<string, Open>();
  private here = new AsyncLocalStorage<Open>();
  private defaultId: string | null = null;
  private links: SyncLinks | null = null;
  private logs: Telemetry | null = null;

  constructor(
    readonly home: Home,
    first: Vault | null,
    readonly version: string,
    readonly env: NodeJS.ProcessEnv = process.env,
    /** How every vault this session opens is set up: the attachment types, mainly. */
    readonly options: VaultOptions = {},
  ) {
    if (first) this.adopt(first);
  }

  /** Which open vaults sync, and their loops (`server/sync/link.ts`). Nothing for a vault not linked. */
  get sync(): SyncLinks {
    return (this.links ??= new SyncLinks(this.home.dir, this.env));
  }

  /** Logs: the person's answer, what waits to be sent, and where it goes (`server/telemetry.ts`). */
  get telemetry(): Telemetry {
    return (this.logs ??= new Telemetry(this.home, this.version, this.env));
  }

  /** The vault this request is about. */
  get vault(): Vault {
    return this.current().vault;
  }
  get index(): Parsed {
    return this.current().index;
  }
  get corpus(): Parsed {
    return this.current().corpus;
  }
  get practice(): Practice {
    return this.current().practice;
  }

  private current(): Open {
    const at = this.here.getStore() ?? (this.defaultId ? this.open.get(this.defaultId) : undefined);
    if (!at) throw err(404, "no vault is open", { code: "vault" });
    return at;
  }

  /** Whether any vault is open — the page shows the vault picker when none is. */
  get any(): boolean {
    return this.open.size > 0;
  }

  /** The vault a request names, or the default; a 404 naming the vault when it is not open. */
  pick(id: string | null | undefined): Open {
    if (id) {
      const at = this.open.get(id);
      if (!at) throw err(404, `vault \`${id}\` is not open`, { code: "vault" });
      return at;
    }
    return this.current();
  }

  /** Run `fn` with `id`'s vault as `s.vault`. */
  within<T>(id: string | null | undefined, fn: () => T): T {
    return id || this.defaultId ? this.here.run(this.pick(id), fn) : fn();
  }

  /** Another vault, by id, for a route that reads two (`/__board/transfer`). */
  other(id: string): Vault {
    return this.pick(id).vault;
  }

  /** Every vault being served. */
  served(): Vault[] {
    return [...this.open.values()].map((o) => o.vault);
  }

  private adopt(vault: Vault): Open {
    const had = this.open.get(vault.id);
    if (had) {
      this.defaultId = vault.id;
      this.remember(vault);
      return had;
    }
    const at: Open = {
      vault,
      index: new Parsed(grammar.index),
      corpus: new Parsed(grammar.corpus),
      practice: new Practice(this.home, vault.id),
    };
    this.open.set(vault.id, at);
    this.defaultId = vault.id;
    this.remember(vault);
    this.sync.opened(vault);
    return at;
  }

  private remember(vault: Vault): void {
    this.home
      .sql(
        "insert into vaults (id, path, name, opened) values (?, ?, ?, ?) on conflict(id) do update set path = excluded.path, name = excluded.name, opened = excluded.opened",
      )
      .run(vault.id, vault.root, path.basename(vault.root), new Date().toISOString());
  }

  /**
   * Open a folder as a vault, or bring one already open to the front. Refused when it is not a
   * folder, and when it is inside a vault or holds one — two vaults would each list the other's files.
   */
  openFolder(folder: string): Vault {
    const root = path.resolve(folder);
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Refused(`\`${root}\` is not a folder`);
    const nested = this.nesting(root);
    if (nested) throw new Refused(nested);
    for (const o of this.open.values()) if (o.vault.root === root) return this.adopt(o.vault).vault;
    return this.adopt(new Vault(root, this.home, vaultOptions(root, this.options))).vault;
  }

  /** Make a folder and open it as a vault. Refused when something is already there. */
  createVault(parent: string, name: string): Vault {
    const clean = name.trim();
    if (!clean || /[\\/:*?"<>|]/.test(clean) || clean.startsWith(".")) throw new Refused(`\`${name}\` is not a folder name`);
    const root = path.join(path.resolve(parent), clean);
    if (fs.existsSync(root)) throw new Refused(`\`${root}\` is already there`);
    if (!fs.statSync(path.resolve(parent), { throwIfNoEntry: false })?.isDirectory())
      throw new Refused(`\`${parent}\` is not a folder`);
    const nested = this.nesting(root);
    if (nested) throw new Refused(nested);
    fs.mkdirSync(root);
    return this.openFolder(root);
  }

  /** Why a folder cannot be a vault because of another vault, or null. */
  private nesting(root: string): string | null {
    for (let up = path.dirname(root); ; up = path.dirname(up)) {
      if (fs.existsSync(path.join(up, ".anydag", "vault.json"))) return `\`${root}\` is inside the vault \`${up}\``;
      if (path.dirname(up) === up) break;
    }
    if (fs.existsSync(path.join(root, ".anydag", "vault.json"))) return null;
    const inside = findVault(root, 4);
    return inside ? `\`${root}\` holds the vault \`${inside}\`` : null;
  }

  /** Stop serving a vault. Its folder, and its place on the recent list, stay. */
  async close(id: string): Promise<void> {
    const at = this.open.get(id);
    if (!at) return;
    this.open.delete(id);
    if (this.defaultId === id) {
      const last = this.recent().find((r) => r.open);
      this.defaultId = last?.id ?? null;
    }
    await this.sync.closed(id);
    await at.vault.close();
  }

  /**
   * A vault links to a remote one and adopts its id: the old vault is closed, the home's rows and
   * keys are re-keyed, `.anydag/vault.json` says the new id, and the folder opens again as the same
   * vault under it — the default again if it was.
   */
  async rekeyVault(oldId: string, newId: string): Promise<Vault> {
    if (!validId(newId)) throw new Refused(`\`${newId}\` is not a vault id`);
    if (this.open.has(newId)) throw new Refused(`vault \`${newId}\` is already open`);
    const at = this.open.get(oldId);
    if (!at) throw err(404, `vault \`${oldId}\` is not open`, { code: "vault" });
    const root = at.vault.root;
    const types = [...at.vault.types];
    const attachments = at.vault.attachments;
    const wasDefault = this.defaultId === oldId;
    this.open.delete(oldId);
    await this.sync.closed(oldId);
    await at.vault.close();
    this.home.rekeyVault(oldId, newId);
    this.sync.moved(oldId, newId);
    writeAtomic(path.join(root, ".anydag", "vault.json"), `${JSON.stringify({ id: newId }, null, 1)}\n`);
    const vault = new Vault(root, this.home, vaultOptions(root, { ...this.options, types, attachments }));
    const next = this.adopt(vault);
    if (!wasDefault) this.defaultId = [...this.open.keys()].find((k) => k !== newId) ?? newId;
    return next.vault;
  }

  /** Take a vault off the recent list — closing it first. The folder stays. */
  async forget(id: string): Promise<void> {
    await this.close(id);
    this.home.sql("delete from vaults where id = ?").run(id);
  }

  /** The recent list, newest first. */
  recent(): Recent[] {
    const rows = this.home.sql("select id, path, name, opened from vaults order by opened desc").all() as unknown as Omit<
      Recent,
      "open" | "default" | "missing"
    >[];
    return rows.map((r) => ({
      ...r,
      open: this.open.has(r.id),
      default: r.id === this.defaultId,
      missing: !fs.existsSync(path.join(r.path, ".anydag", "vault.json")),
    }));
  }

  /** Re-read a vault's own settings — the attachments folder — after they were written. */
  reconfigure(vault: Vault): void {
    const opts = vaultOptions(vault.root);
    vault.attachments = opts.attachments ?? "attachments";
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.open.keys()]) await this.close(id);
  }

  limits(): Limits {
    const mb = Number(this.env.ANYDAG_UPLOAD_MAX_MB);
    return {
      maxBytes: Math.round((Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024),
      types: [...this.vault.types].sort(),
    };
  }
}

/** A vault somewhere under `root`, `depth` folders down at most; skipping what a vault skips. */
function findVault(root: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const sub = path.join(root, e.name);
    if (fs.existsSync(path.join(sub, ".anydag", "vault.json"))) return sub;
    const deeper = findVault(sub, depth - 1);
    if (deeper) return deeper;
  }
  return null;
}
