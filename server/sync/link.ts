/**
 * Which vaults are linked, and what pairing, linking and unlinking do.
 * `Session` owns one `SyncLinks`; `server/routes/sync.ts` is the routes over the functions below.
 *
 * On disk, all of it in the app's home and none of it in the vault — `<home>/sync/<vault>/`:
 *
 * | `pair.json` | the server, the device token, the account and the device — mode 0600, the folder 0700 |
 * | `key`       | the vault key, sealed under the home secret (`keys.ts`) |
 * | `state.sqlite`, `bases/` | the engine's |
 *
 * Load-bearing:
 * - **Linked is a file**: a vault is linked when its folder holds `key` and `pair.json`. Opening a
 *   vault that is not costs one `existsSync` and nothing else, so there is no switch to turn sync off.
 * - **Pairing is the vault's**, as every `/api/` route is the current vault's: two vaults may sync to
 *   two servers, or to two accounts on one.
 * - **The passphrase never leaves this function**: it opens or seals the vault key and is dropped;
 *   the recovery code is answered once and kept nowhere.
 * - **Download and merge adopt the remote's id** through `Session.rekeyVault`, which moves this
 *   folder with it — the page then reloads onto `?vault=<new id>`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  deriveKek,
  fromRecoveryCode,
  keysOf,
  newParams,
  randomKey,
  recoveryCode,
  sealText,
  Unsealed,
  unwrapKey,
  wrapKey,
} from "../../sync/protocol/crypto";
import type { VaultKey } from "../../sync/protocol/wire";
import { err } from "../http";
import type { Vault } from "../vault";
import { HttpSyncApi, isSyncError } from "./client";
import { vaultFs } from "./fs";
import { homeSecret, loadVaultKey, saveVaultKey, SecretElsewhere } from "./keys";
import { SyncLoop, TUNE, type First, type Pairing, type Tune } from "./loop";
import { SyncState } from "./state";
import type { SyncDevices, SyncLinked, SyncLinkRequest, SyncPaired, SyncPairRequest, SyncRemotes, SyncStatus } from "./types";

/** What linking needs of the session: re-keying a vault onto a remote's id. */
export interface Rekeys {
  rekeyVault(oldId: string, newId: string): Promise<Vault>;
}

const MIN_PASSPHRASE = 8;

/** Two paths that name the same folder, links followed; a path that is gone compares as itself. */
function sameFolder(a: string, b: string): boolean {
  const real = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

export class SyncLinks {
  /** The loop's timers and `fetch`; a test sets it before a vault opens. */
  tune: Tune = TUNE;
  /**
   * Whether opening a linked vault starts its loop. A server that stays up — the app, `anydag serve`,
   * `anydag mcp` — wants that; a CLI command served in-process lives for one request, and a loop
   * there was a whole catch-up sync, over the network, before every `ls`. Off, a loop starts only
   * when something asks (`sync now`), and anything written meanwhile is pushed by the next catch-up.
   */
  auto = true;
  private readonly loops = new Map<string, SyncLoop>();
  /** A linked vault whose loop could not start, and why: an error, or a pause waiting on the person. */
  private readonly broken = new Map<string, { state: "paused" | "error"; reason: string }>();
  private readonly starting = new Map<string, Promise<SyncLoop | null>>();

  constructor(
    private readonly homeDir: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  dir(id: string): string {
    return path.join(this.homeDir, "sync", id);
  }

  pairing(id: string): Pairing | null {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(this.dir(id), "pair.json"), "utf8")) as Pairing;
      return p && typeof p.server === "string" && typeof p.token === "string" && p.device?.id ? p : null;
    } catch {
      return null;
    }
  }

  savePairing(id: string, p: Pairing): void {
    const dir = this.dir(id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, "pair.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(p, null, 1)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  linked(id: string): boolean {
    const dir = this.dir(id);
    return fs.existsSync(path.join(dir, "key")) && fs.existsSync(path.join(dir, "pair.json"));
  }

  secret(): Uint8Array {
    return homeSecret(this.homeDir, this.env);
  }

  get(id: string): SyncLoop | undefined {
    return this.loops.get(id);
  }

  /** A vault was opened: start its loop when it is linked, and do nothing at all when it is not. */
  opened(vault: Vault): void {
    if (!this.auto || !this.linked(vault.id)) return;
    const mismatch = this.rootMismatch(vault, this.pairing(vault.id));
    if (mismatch) {
      this.broken.set(vault.id, { state: "paused", reason: mismatch });
      vault.emit({ type: "sync", status: this.status(vault) });
      return;
    }
    void this.start(vault).catch(() => undefined);
  }

  /** The sentence refusing a link made for another folder, or `null` when the roots agree. */
  private rootMismatch(vault: Vault, pairing: Pairing | null): string | null {
    if (!pairing?.root) return null;
    if (sameFolder(pairing.root, vault.root)) return null;
    return `This vault's sync link was made for ${pairing.root}; ${vault.root} claims its id. Confirm before syncing.`;
  }

  /** The loop for a linked vault, started — its catch-up (or `first`) run finished — or `null`. */
  start(vault: Vault, first: First | null = null): Promise<SyncLoop | null> {
    const had = this.loops.get(vault.id);
    if (had) return Promise.resolve(had);
    const pending = this.starting.get(vault.id);
    if (pending) return pending;
    const run = this.begin(vault, first).finally(() => this.starting.delete(vault.id));
    this.starting.set(vault.id, run);
    return run;
  }

  private async begin(vault: Vault, first: First | null): Promise<SyncLoop | null> {
    const id = vault.id;
    const pairing = this.pairing(id);
    if (!pairing) return null;
    const mismatch = this.rootMismatch(vault, pairing);
    if (mismatch) {
      this.broken.set(id, { state: "paused", reason: mismatch });
      vault.emit({ type: "sync", status: this.status(vault) });
      return null;
    }
    let loop: SyncLoop;
    try {
      const vk = loadVaultKey(this.dir(id), this.secret());
      if (!vk) return null;
      loop = new SyncLoop({ vault, dir: this.dir(id), pairing, vk, tune: this.tune });
    } catch (e) {
      const why =
        e instanceof SecretElsewhere
          ? e.message
          : `The vault key kept on this machine will not open (${(e as Error).message}). Unlink this vault and link it again.`;
      this.broken.set(id, { state: "error", reason: why });
      vault.emit({ type: "sync", status: this.status(vault) });
      return null;
    }
    this.broken.delete(id);
    this.loops.set(id, loop);
    await loop.start(first);
    return loop;
  }

  /** A vault is being closed, or re-keyed: its loop stops and nothing on disk changes. */
  async closed(id: string): Promise<void> {
    const pending = this.starting.get(id);
    if (pending) await pending.catch(() => undefined);
    const loop = this.loops.get(id);
    this.loops.delete(id);
    this.broken.delete(id);
    if (loop) await loop.stop();
  }

  /** A vault took another id: its sync folder follows it. */
  moved(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const from = this.dir(oldId);
    if (!fs.existsSync(from)) return;
    const to = this.dir(newId);
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
  }

  /** Stop the loop and forget the token, the key at rest and the state. The vault and the remote stay. */
  async forget(id: string): Promise<void> {
    await this.closed(id);
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  status(vault: Vault): SyncStatus {
    const loop = this.loops.get(vault.id);
    if (loop) return loop.status();
    const p = this.pairing(vault.id);
    const broken = this.broken.get(vault.id);
    if (broken === undefined && p && this.linked(vault.id)) return this.resting(vault, p);
    return {
      vault: vault.id,
      linked: broken !== undefined,
      state: broken ? broken.state : "unlinked",
      reason: broken?.reason ?? null,
      server: p?.server ?? null,
      remote: null,
      device: p?.device.name ?? null,
      pending: 0,
      conflicts: [],
      last: null,
    };
  }

  /**
   * A linked vault with no loop in this process (`auto` off): what the state on disk says, read
   * without starting anything. Nothing is pending that a scan has not looked for, so `pending` is 0.
   */
  private resting(vault: Vault, p: Pairing): SyncStatus {
    let remote: string | null = null;
    let last: string | null = null;
    let conflicts: string[] = [];
    try {
      const state = new SyncState(this.dir(vault.id));
      try {
        remote = state.get("remote");
        last = state.get("last");
        conflicts = state.conflicts().map((c) => c.rel);
      } finally {
        state.close();
      }
    } catch {
      /* no state yet: the link was kept and nothing has run */
    }
    return {
      vault: vault.id,
      linked: true,
      state: "idle",
      reason:
        "Not syncing from this process: AnyDag syncs this vault while it is open, and `anydag sync now` syncs it from here.",
      server: p.server,
      remote,
      device: p.device.name,
      pending: 0,
      conflicts,
      last,
    };
  }

  /** A client for the vault's pairing, or a 409 saying to pair first. */
  api(id: string): { api: HttpSyncApi; pairing: Pairing } {
    const pairing = this.pairing(id);
    if (!pairing) throw err(409, "This vault is not paired with a sync server: pair it first.", { code: "unpaired" });
    return {
      api: new HttpSyncApi({ url: pairing.server, token: pairing.token, fetch: this.tune.fetch, retries: this.tune.retries }),
      pairing,
    };
  }
}

// -- what the routes do ------------------------------------------------------------------------------

/** A sync server's refusal as the app's own failure, its `ES_*` kept in `code`. */
function refusal(e: unknown, server: string | null): never {
  if (isSyncError(e)) {
    if (e.code === "ES_NETWORK")
      throw err(502, `The sync server${server ? ` at ${server}` : ""} did not answer.`, { code: "ES_NETWORK" });
    // A 401 here would be read by the page as its own token gone; it is the sync server's word.
    if (e.code === "ES_AUTH")
      throw err(403, "The sync server no longer accepts this device: pair it again.", { code: "ES_AUTH" });
    throw err(e.status >= 400 && e.status < 600 ? e.status : 502, e.message, { code: e.code });
  }
  throw e;
}

function serverUrl(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw err(400, "Give the sync server's address, such as https://sync.example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw err(400, "A sync server's address starts with https:// (or http:// on this machine).");
  return url.toString().replace(/\/+$/, "");
}

export async function pair(links: SyncLinks, vault: Vault, req: Partial<SyncPairRequest>): Promise<SyncPaired> {
  if (links.linked(vault.id)) throw err(409, "This vault is linked: unlink it before pairing it again.", { code: "linked" });
  const server = serverUrl(req.server);
  const code = typeof req.code === "string" ? req.code.trim() : "";
  if (!code) throw err(400, "Give the one-time code the sync server's admin made for you.");
  const name = (typeof req.device === "string" && req.device.trim()) || os.hostname() || "this device";
  const api = new HttpSyncApi({ url: server, fetch: links.tune.fetch, retries: links.tune.retries });
  let got: Awaited<ReturnType<HttpSyncApi["pair"]>>;
  try {
    got = await api.pair({ code, device: { name, platform: process.platform } });
  } catch (e) {
    refusal(e, server);
  }
  links.savePairing(vault.id, {
    server,
    token: got.token,
    account: got.account,
    device: { id: got.device.id, name: got.device.name },
    root: vault.root,
  });
  vault.emit({ type: "sync", status: links.status(vault) });
  return { server, account: got.account.name, device: got.device.name };
}

export async function remotes(links: SyncLinks, vault: Vault): Promise<SyncRemotes> {
  const { api, pairing } = links.api(vault.id);
  const mine = links.get(vault.id)?.remote ?? vault.id;
  try {
    const { vaults } = await api.vaults();
    return { remotes: vaults.map((v) => ({ id: v.id, created: v.created, seq: v.seq, keyed: v.keyed, mine: v.id === mine })) };
  } catch (e) {
    refusal(e, pairing.server);
  }
}

/** The vault key a passphrase or a recovery code opens, or a 400 in a plain sentence. */
function openKey(key: VaultKey, passphrase: unknown, recovery: unknown): Uint8Array {
  if (typeof recovery === "string" && recovery.trim()) {
    const rk = fromRecoveryCode(recovery);
    if (!rk)
      throw err(400, "That recovery code is mistyped: it is fourteen groups of four letters and digits.", { code: "recovery" });
    try {
      return unwrapKey(rk, key.recovery);
    } catch (e) {
      if (e instanceof Unsealed) throw err(400, "That recovery code is not this vault's.", { code: "recovery" });
      throw e;
    }
  }
  if (typeof passphrase === "string" && passphrase) {
    try {
      return unwrapKey(deriveKek(passphrase, key.params), key.wrapped);
    } catch (e) {
      if (e instanceof Unsealed) throw err(400, "That passphrase does not open this vault.", { code: "passphrase" });
      throw e;
    }
  }
  throw err(400, "Give the vault's passphrase, or its recovery code.");
}

/** Keep what a link decided: the vault key at rest, the root it was made for, and the engine's state naming the remote. */
function keep(links: SyncLinks, vault: Vault, pairing: Pairing, remote: string, vk: Uint8Array): void {
  const dir = links.dir(vault.id);
  fs.rmSync(path.join(dir, "state.sqlite"), { force: true });
  fs.rmSync(path.join(dir, "bases"), { recursive: true, force: true });
  links.savePairing(vault.id, { ...pairing, root: vault.root });
  saveVaultKey(dir, links.secret(), vk);
  const st = new SyncState(dir);
  try {
    st.set("server", pairing.server);
    st.set("remote", remote);
    st.set("device", pairing.device.id);
    st.set("deviceName", pairing.device.name);
  } finally {
    st.close();
  }
}

export async function link(
  links: SyncLinks,
  s: Rekeys,
  vault: Vault,
  req: Partial<SyncLinkRequest> & Record<string, unknown>,
): Promise<SyncLinked> {
  if (links.linked(vault.id)) throw err(409, "This vault is already linked: unlink it first.", { code: "linked" });
  /* Before the server is asked anything: a link this process could not keep the key of would
     create a remote and leave it unkeyed. */
  try {
    links.secret();
  } catch (e) {
    if (e instanceof SecretElsewhere) throw err(409, e.message, { code: "secret" });
    throw e;
  }
  const { api, pairing } = links.api(vault.id);
  const mode = req.mode;
  if (mode !== "upload" && mode !== "download" && mode !== "merge") throw err(400, "`mode` is `upload`, `download` or `merge`.");

  if (mode === "upload") {
    const passphrase = typeof req.passphrase === "string" ? req.passphrase : "";
    if (passphrase.length < MIN_PASSPHRASE)
      throw err(400, `A passphrase is at least ${MIN_PASSPHRASE} characters.`, { code: "passphrase" });
    const vk = randomKey();
    const rk = randomKey();
    let remote: string;
    try {
      const made = await api.createVault({
        name: sealText(keysOf(vk).enc, "vault-name", path.basename(vault.root)),
        id: vault.id,
      });
      const params = newParams();
      await api.putKey(made.id, { wrapped: wrapKey(deriveKek(passphrase, params), vk), recovery: wrapKey(rk, vk), params });
      remote = made.id;
    } catch (e) {
      refusal(e, pairing.server);
    }
    // The server keeps the vault's id when it is free; when it is not, the vault takes the server's.
    const v = remote === vault.id ? vault : await s.rekeyVault(vault.id, remote);
    keep(links, v, pairing, remote, vk);
    const loop = await links.start(v);
    if (!loop) throw err(500, "the link was kept but its sync did not start");
    return { status: loop.status(), recovery: recoveryCode(rk), vault: v.id };
  }

  const want = typeof req.remote === "string" ? req.remote.trim() : "";
  if (!want) throw err(400, "Name the remote vault to link to: `GET /api/sync/remotes` lists them.");
  let key: VaultKey | null;
  try {
    const { vaults } = await api.vaults();
    const there = vaults.find((v) => v.id === want);
    if (!there) throw err(404, `The sync account has no vault \`${want}\`.`, { code: "ES_NOT_FOUND" });
    key = there.keyed ? await api.getKey(want) : null;
  } catch (e) {
    if (isSyncError(e)) refusal(e, pairing.server);
    throw e;
  }
  if (!key) throw err(409, "That remote vault has no key: the upload that made it never finished.", { code: "unkeyed" });
  const vk = openKey(key, req.passphrase, req.recovery);
  if (mode === "download") {
    const files = (await vaultFs(vault).scan()).filter((e) => e.kind === "file" && !e.rel.startsWith(".anydag/"));
    if (files.length) {
      throw err(
        409,
        `This vault holds ${files.length} file${files.length === 1 ? "" : "s"}: a download goes into an empty vault. Merge instead, or open an empty folder.`,
        { code: "not-empty" },
      );
    }
  }
  if (links.get(want) || (want !== vault.id && links.linked(want)))
    throw err(409, `Vault \`${want}\` is already linked on this machine.`, { code: "linked" });
  const v = want === vault.id ? vault : await s.rekeyVault(vault.id, want);
  keep(links, v, pairing, want, vk);
  const loop = await links.start(v, mode === "download" ? "resync" : "merge");
  if (!loop) throw err(500, "the link was kept but its sync did not start");
  return { status: loop.status(), vault: v.id };
}

export async function unlink(links: SyncLinks, vault: Vault): Promise<SyncStatus> {
  await links.forget(vault.id);
  const status = links.status(vault);
  vault.emit({ type: "sync", status });
  return status;
}

export async function now(links: SyncLinks, vault: Vault): Promise<SyncStatus> {
  const loop = links.get(vault.id) ?? (links.linked(vault.id) ? await links.start(vault) : null);
  if (!loop) throw err(409, "This vault is not linked to a sync server.", { code: "unlinked" });
  return loop.sync();
}

type WireDevices = Awaited<ReturnType<HttpSyncApi["devices"]>>;
const devicesOf = (got: WireDevices, me: string): SyncDevices => ({
  devices: got.devices.map((d) => ({
    id: d.id,
    name: d.name,
    platform: d.platform,
    created: d.created,
    seen: d.seen,
    revoked: d.revoked,
    me: d.current ?? d.id === me,
  })),
});

export async function devices(links: SyncLinks, vault: Vault): Promise<SyncDevices> {
  const { api, pairing } = links.api(vault.id);
  try {
    return devicesOf(await api.devices(), pairing.device.id);
  } catch (e) {
    refusal(e, pairing.server);
  }
}

export async function revoke(links: SyncLinks, vault: Vault, id: unknown): Promise<SyncDevices> {
  if (typeof id !== "string" || !id) throw err(400, "Name the device to sign out by its `id`.");
  const { api, pairing } = links.api(vault.id);
  try {
    const before = devicesOf(await api.devices(), pairing.device.id);
    if (!before.devices.some((d) => d.id === id))
      throw err(404, `The sync account has no device \`${id}\`.`, { code: "ES_NOT_FOUND" });
    await api.revokeDevice(id);
    try {
      return devicesOf(await api.devices(), pairing.device.id);
    } catch (e) {
      // This device signed itself out: the list it had, with itself revoked.
      if (!isSyncError(e, "ES_AUTH")) throw e;
      const at = new Date().toISOString();
      return { devices: before.devices.map((d) => (d.id === id ? { ...d, revoked: d.revoked ?? at } : d)) };
    }
  } catch (e) {
    if (isSyncError(e)) refusal(e, pairing.server);
    throw e;
  }
}
