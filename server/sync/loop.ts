/**
 * When a linked vault syncs: the engine decides *what*, this decides
 * *when*. One `SyncLoop` per linked vault, for as long as the vault is open.
 *
 * - **On start** it scans and syncs once, catching up with whatever happened while the app was shut.
 * - **A pull** on a poke (`GET /v1/vaults/{v}/poke`, a server-sent stream that says a `seq`), or on
 *   a poll every thirty seconds — a lost poke costs one poll interval, never a change.
 * - **A push** on the vault's raw watcher (`subscribeRaw`), filtered by `syncs()`/`dirSyncs()`,
 *   handed to `engine.heard`, and debounced: two seconds of quiet, ten at most.
 *
 * Load-bearing:
 * - **The loop never dies of a failure.** `ES_NETWORK` is `offline`, retried on a backoff; `ES_AUTH`
 *   and a quota are `paused` with a sentence saying why — a revoked device stops asking, `now` asks
 *   again; anything else is `error`, with the message, and retried. Nothing thrown leaves `once`.
 * - **One run at a time, and runs coalesce**: a poke, the poll and a burst of saves arriving while a
 *   run is out make one more run, not three.
 * - **Sync's own writes wake nothing.** The watcher starts with the loop, so what a pull, a download
 *   or a merge wrote comes back as events, often after the run that wrote it. `engine.heard` drops
 *   every path whose disk is still what the engine wrote there (`echo.ts`); a batch with nothing
 *   left neither raises `pending` nor arms the debounce, so the run that applied a pull is the only
 *   `syncing` it causes. A path somebody else wrote meanwhile is left, and pushed as before.
 * - **The status is said only when it changes**, through `vault.emit({type: "sync"})`, which the
 *   change feed sends as `dag:vault-sync`. A poll does not flash `syncing`: the one thing a quiet poll
 *   changes is `last`.
 * - **Timers are the tune's**, so a test runs the whole loop in milliseconds.
 */

import { Bases } from "./bases";
import { HttpSyncApi, isSyncError, type SyncApi } from "./client";
import { SyncEngine } from "./engine";
import { vaultFs } from "./fs";
import { dirSyncs, syncs } from "./scope";
import { SyncState } from "./state";
import type { SyncStatus } from "./types";
import type { Vault } from "../vault";

export interface Tune {
  /** How often a linked vault asks the server for changes when no poke arrives. */
  pollMs: number;
  /** How long the vault must be quiet after a change before it is pushed. */
  quietMs: number;
  /** How long a run of changes may keep a push waiting, however busy the vault is. */
  maxMs: number;
  /** The first retry after a failure; doubled each time, up to `backoffMaxMs`. */
  backoffMs: number;
  backoffMaxMs: number;
  /** Whether to hold the poke stream open. */
  poke: boolean;
  /** How many times one request that got no answer is asked again. */
  retries: number;
  fetch?: typeof fetch;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

export const TUNE: Tune = {
  pollMs: 30_000,
  quietMs: 2_000,
  maxMs: 10_000,
  backoffMs: 2_000,
  backoffMaxMs: 5 * 60_000,
  poke: true,
  retries: 2,
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (t) => clearTimeout(t as NodeJS.Timeout),
};

/**
 * The most a poke event may hold before its blank line. A poke is `data: {"seq":N}`; anything near
 * this is not one, and a stream that never sends a blank line is not a stream of pokes (#9).
 */
export const POKE_EVENT_MAX = 64 * 1024;

/** A poke event past `POKE_EVENT_MAX`: the stream is dropped, and counted as a failure. */
export class PokeTooLarge extends Error {
  constructor() {
    super(`poke: an event longer than ${POKE_EVENT_MAX} characters`);
    this.name = "PokeTooLarge";
  }
}

/**
 * The poke stream cut into events, as it arrives. Each chunk is searched for the blank line from
 * where the last search stopped — one character back, for a `\n` the chunk before ended on — never
 * from the start, and what has no blank line yet is at most `POKE_EVENT_MAX`. The buffer used to be
 * searched whole after every chunk and grow without end, so a server sending no blank line held the
 * event loop for seconds at a time (#9).
 */
export class PokeEvents {
  private buf = "";
  /** A `\r` that ended a chunk: the `\n` that may complete it is in the next one. */
  private cr = false;

  /** The events this chunk completes, in order. Throws `PokeTooLarge` past the bound. */
  feed(chunk: string): string[] {
    let text = (this.cr ? "\r" : "") + chunk;
    this.cr = text.endsWith("\r");
    if (this.cr) text = text.slice(0, -1);
    let from = Math.max(0, this.buf.length - 1);
    this.buf += text.replace(/\r\n?/g, "\n");
    const out: string[] = [];
    for (let at = this.buf.indexOf("\n\n", from); at >= 0; at = this.buf.indexOf("\n\n", from)) {
      out.push(this.buf.slice(0, at));
      this.buf = this.buf.slice(at + 2);
      from = 0;
    }
    if (this.buf.length > POKE_EVENT_MAX) throw new PokeTooLarge();
    return out;
  }
}

/** What a device kept when it paired: `<home>/sync/<vault>/pair.json`, mode 0600. */
export interface Pairing {
  server: string;
  token: string;
  account: { id: string; name: string };
  device: { id: string; name: string };
  /** The folder the link was made from. Absent on a pairing made before the root was recorded. */
  root?: string;
}

export interface LoopOptions {
  vault: Vault;
  /** `<home>/sync/<vault>/`: `state.sqlite`, `bases/`, `key`, `pair.json`. */
  dir: string;
  pairing: Pairing;
  vk: Uint8Array;
  tune: Tune;
  /** Every status, as it changes — the vault's feed already hears it. */
  onStatus?: (s: SyncStatus) => void;
}

type State = SyncStatus["state"];

/**
 * The first run of a link that brought files from the remote: every head, not the log, with the
 * vault's duplicate-id fixes held out of the files while they land — and for `merge`, then a scan
 * and a push of what this vault had. Repeated until it once succeeds; a resync is idempotent.
 */
export type First = "resync" | "merge";

const REASONS = {
  auth: "The sync server no longer accepts this device: it was signed out or revoked. Pair it again to go on syncing.",
  quota:
    "The sync account is out of room: nothing more is pushed until there is space. Changes here are kept and go when there is.",
  forbidden: "The sync server refuses this device the remote vault: it belongs to another account, or was removed.",
  gone: "The remote vault is not on the sync server any more.",
} as const;

export class SyncLoop {
  readonly engine: SyncEngine;
  readonly state: SyncState;
  readonly api: SyncApi;
  readonly remote: string;
  private readonly vault: Vault;
  private readonly o: LoopOptions;
  private readonly tune: Tune;

  private now: State = "idle";
  private reason: string | null = null;
  private said = "";
  private stopped = false;
  /** A revoked device stops asking on its own; `now()` asks again. */
  private halted = false;
  private failures = 0;

  private chain: Promise<void> = Promise.resolve();
  private queued: Promise<void> | null = null;
  private wantScan = false;
  private wantLoud = false;
  private first: First | null = null;

  private quiet: unknown = null;
  private most: unknown = null;
  private poll: unknown = null;
  private retry: unknown = null;
  private sleeps = new Set<{ t: unknown; done: () => void }>();
  private pokeAbort: AbortController | null = null;
  private unwatch: (() => void) | null = null;

  constructor(o: LoopOptions) {
    this.o = o;
    this.vault = o.vault;
    this.tune = o.tune;
    this.state = new SyncState(o.dir);
    const remote = this.state.get("remote");
    if (!remote) {
      this.state.close();
      throw new Error("this vault's sync state names no remote vault");
    }
    this.remote = remote;
    this.api = new HttpSyncApi({ url: o.pairing.server, token: o.pairing.token, fetch: o.tune.fetch, retries: o.tune.retries });
    this.engine = new SyncEngine({
      fs: vaultFs(o.vault),
      api: this.api,
      state: this.state,
      bases: new Bases(`${o.dir}/bases`),
      vk: o.vk,
      remote,
      device: { id: o.pairing.device.id, name: o.pairing.device.name },
      types: o.vault.types,
    });
  }

  /** Watch, poke, poll, and catch up — the catch-up is what the promise is. */
  async start(first: First | null = null): Promise<void> {
    this.first = first;
    this.unwatch = await this.vault.subscribeRaw((rels) => this.changed(rels));
    if (this.stopped) {
      this.unwatch();
      return;
    }
    if (this.tune.poke) void this.pokes();
    this.schedulePoll();
    await this.kick(true);
  }

  /** A pull and a push now, after a scan; the status once both finished (or failed). */
  async sync(): Promise<SyncStatus> {
    this.halted = false;
    await this.kick(true);
    if (this.tune.poke && !this.pokeAbort && !this.stopped) void this.pokes();
    return this.status();
  }

  status(): SyncStatus {
    return {
      vault: this.vault.id,
      linked: true,
      state: this.now,
      reason: this.reason,
      server: this.o.pairing.server,
      remote: this.remote,
      device: this.o.pairing.device.name,
      pending: this.engine.pending(),
      conflicts: this.engine.conflicts(),
      last: this.state.get("last"),
    };
  }

  /** Stop every timer, the poke and the watcher, wait for a run that is out, and close the state. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of [this.quiet, this.most, this.poll, this.retry]) if (t !== null) this.tune.clearTimeout(t);
    this.quiet = this.most = this.poll = this.retry = null;
    for (const s of [...this.sleeps]) {
      this.tune.clearTimeout(s.t);
      s.done();
    }
    this.pokeAbort?.abort();
    this.unwatch?.();
    await this.chain;
    this.state.close();
  }

  // -- runs ---------------------------------------------------------------------------------------

  /** One more run, unless one is already waiting to start — then that one. */
  private kick(scan = false, loud = true): Promise<void> {
    this.wantScan ||= scan;
    this.wantLoud ||= loud;
    if (this.queued) return this.queued;
    const run = this.chain.then(async () => {
      this.queued = null;
      const s = this.wantScan;
      const l = this.wantLoud;
      this.wantScan = this.wantLoud = false;
      await this.once(s, l);
    });
    this.queued = run;
    this.chain = run;
    return run;
  }

  private async once(scan: boolean, loud: boolean): Promise<void> {
    if (this.stopped) return;
    if (loud || this.now !== "idle") this.set("syncing", this.now === "paused" || this.now === "error" ? this.reason : null);
    try {
      if (this.first) {
        this.vault.holdFixes(true);
        try {
          await this.engine.resync();
          if (this.first === "merge") await this.engine.scan();
          await this.engine.syncOnce();
        } finally {
          this.vault.holdFixes(false);
        }
        this.first = null;
      } else {
        if (scan) await this.engine.scan();
        await this.engine.syncOnce();
      }
      this.failures = 0;
      this.set("idle", null);
    } catch (e) {
      if (this.stopped) return;
      this.failed(e);
    }
  }

  private failed(e: unknown): void {
    this.failures++;
    if (isSyncError(e, "ES_NETWORK")) {
      this.set("offline", null);
      this.retryLater();
    } else if (isSyncError(e, "ES_AUTH")) {
      this.halted = true;
      this.pokeAbort?.abort();
      this.set("paused", REASONS.auth);
    } else if (isSyncError(e, "ES_QUOTA")) {
      this.set("paused", REASONS.quota);
    } else if (isSyncError(e, "ES_FORBIDDEN")) {
      this.halted = true;
      this.set("paused", REASONS.forbidden);
    } else if (isSyncError(e, "ES_NOT_FOUND")) {
      this.halted = true;
      this.set("paused", REASONS.gone);
    } else {
      this.set("error", e instanceof Error ? e.message : String(e));
      this.retryLater();
    }
  }

  private retryLater(): void {
    if (this.stopped || this.retry !== null) return;
    const ms = Math.min(this.tune.backoffMaxMs, this.tune.backoffMs * 2 ** Math.max(0, this.failures - 1));
    this.retry = this.tune.setTimeout(() => {
      this.retry = null;
      if (!this.stopped && !this.halted) void this.kick(false);
    }, ms);
  }

  // -- triggers -----------------------------------------------------------------------------------

  private changed(rels: string[]): void {
    if (this.stopped) return;
    const types = this.vault.types;
    const ours = rels.filter((r) => syncs(r, types) || dirSyncs(r));
    if (!ours.length) return;
    void this.engine.heard(ours).then(
      (any) => {
        if (any) this.arm();
      },
      // `heard` reads the disk and throws nothing it does not catch; a path it could not judge is
      // still a change, so a failure here arms the debounce rather than lose one.
      () => {
        this.engine.touch(ours);
        this.arm();
      },
    );
  }

  /** Something changed here: say `pending`, and push after the quiet (or at the most). */
  private arm(): void {
    if (this.stopped) return;
    this.say();
    if (this.quiet !== null) this.tune.clearTimeout(this.quiet);
    this.quiet = this.tune.setTimeout(() => this.fire(), this.tune.quietMs);
    if (this.most === null) this.most = this.tune.setTimeout(() => this.fire(), this.tune.maxMs);
  }

  private fire(): void {
    for (const t of [this.quiet, this.most]) if (t !== null) this.tune.clearTimeout(t);
    this.quiet = this.most = null;
    if (!this.stopped && !this.halted) void this.kick(false);
  }

  private schedulePoll(): void {
    if (this.stopped) return;
    this.poll = this.tune.setTimeout(() => {
      this.poll = null;
      if (!this.halted) void this.kick(false, false);
      this.schedulePoll();
    }, this.tune.pollMs);
  }

  /** A timer `stop()` can end early. */
  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      const s = { t: null as unknown, done };
      s.t = this.tune.setTimeout(() => {
        this.sleeps.delete(s);
        done();
      }, ms);
      this.sleeps.add(s);
    });
  }

  /** Hold the poke stream open, and pull whenever it says a `seq` past the cursor. */
  private async pokes(): Promise<void> {
    const fetcher = this.tune.fetch ?? fetch;
    const url = `${this.o.pairing.server.replace(/\/+$/, "")}/v1/vaults/${encodeURIComponent(this.remote)}/poke`;
    let failures = 0;
    while (!this.stopped && !this.halted) {
      const ctl = new AbortController();
      this.pokeAbort = ctl;
      /* Whether this stream said something whole. The backoff is taken back by that, not by a 200 —
         or a server sending one endless event would be asked again every two seconds for ever — and
         never by a stream that then sent an event past the bound (#9). */
      let heard = false;
      try {
        const res = await fetcher(url, {
          headers: { authorization: `Bearer ${this.o.pairing.token}`, accept: "text/event-stream" },
          signal: ctl.signal,
        });
        // Pokes switched off on the server: the poll is all there is.
        if (res.status === 204) break;
        if (!res.ok || !res.body) throw new Error(`poke: ${res.status}`);
        const reader = res.body.getReader();
        const text = new TextDecoder();
        const events = new PokeEvents();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const block of events.feed(text.decode(value, { stream: true }))) {
              heard = true;
              const data = /^data:\s?(.*)$/m.exec(block)?.[1];
              if (data === undefined) continue;
              let seq = Number.NaN;
              try {
                seq = Number((JSON.parse(data) as { seq?: unknown }).seq);
              } catch {
                /* a poke that says nothing readable still says something changed */
              }
              if (!(seq <= this.state.cursor())) void this.kick(false);
            }
          }
        } catch (e) {
          await reader.cancel().catch(() => undefined);
          throw e;
        }
        if (heard) failures = 0;
      } catch (e) {
        if (heard && !(e instanceof PokeTooLarge)) failures = 0;
        failures++;
      } finally {
        if (this.pokeAbort === ctl) this.pokeAbort = null;
      }
      if (this.stopped || this.halted) break;
      await this.sleep(Math.min(this.tune.backoffMaxMs, this.tune.backoffMs * 2 ** Math.min(failures, 8)));
    }
  }

  // -- the status ---------------------------------------------------------------------------------

  private set(state: State, reason: string | null): void {
    this.now = state;
    this.reason = reason;
    this.say();
  }

  private say(): void {
    if (this.stopped) return;
    const s = this.status();
    const text = JSON.stringify(s);
    if (text === this.said) return;
    this.said = text;
    this.vault.emit({ type: "sync", status: s });
    this.o.onStatus?.(s);
  }
}
