/**
 * What the app knows about its own updates, as one small state machine that owns the answer the
 * page draws from (#268).
 *
 * `electron-updater` is told nothing it can say on its own: the notification `checkForUpdatesAndNotify`
 * raised is gone, and every event the updater emits lands here and becomes a {@link UpdateState}
 * the shell pushes to the page. This file imports nothing from Electron — the updater, the clock,
 * the timer and the two things the shell does (stop the server, open a page) are handed in — so
 * `test/desktop-updates.test.ts` can drive it with a fake updater.
 *
 *     idle ──check──▶ checking ──┬─ nothing newer ──▶ idle
 *                                ├─ newer, installable ──▶ downloading ──▶ ready ──install──▶ (quit)
 *                                ├─ newer, not installable ──▶ manual ──install──▶ (the release page)
 *                                ├─ only older, on a chosen channel ──▶ downgrade ──confirmed──▶ checking
 *                                └─ failed ──▶ error ──check──▶ checking
 *
 * `ready` and `manual` are final until the app restarts: a newer release than the one found is
 * found by the next launch, and re-checking while one waits would only repeat the answer.
 *
 * **The channel** (#525). With no choice made, the channel is the version's own word and nothing here
 * differs from before there was a choice: `allowPrerelease` is what it always was and the updater is
 * pointed nowhere new. A person who chooses another channel gets `allowPrerelease` and the feed of the
 * one they chose (`useFeed`, `desktop/feed.ts`); `autoUpdater.channel` is never set, because its setter
 * turns on `allowDowngrade`. **`allowDowngrade` is on only inside one check**, the one `downgrade(version)`
 * runs after the person confirmed that version — and that check downloads nothing by itself, so a
 * different older version it might find is offered again rather than fetched.
 */

type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "manual" | "downgrade" | "error";

/** The channels a person may follow. `latest` is the stable one: GitHub's word, and the update files'. */
const UPDATE_CHANNELS = ["latest", "beta", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const isUpdateChannel = (value: unknown): value is UpdateChannel =>
  typeof value === "string" && (UPDATE_CHANNELS as readonly string[]).includes(value);

/** The version's own channel: `0.2.0` is `latest`, `0.2.0-beta.1` is `beta`, `0.2.0-nightly.…` is
 *  `nightly` (see `UPDATE_CHANNEL` in `desktop/main.ts`). Any other pre-release word is its own. */
export function versionChannel(version: string): string {
  return /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)?.[1] ?? "latest";
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Semantic-version precedence, the order the updater itself uses: negative when `a` is older than
 * `b`, positive when newer, `0` when the same, and `NaN` when either is not a version. A release is
 * newer than its pre-releases, and `0.8.0-beta.1` is older than `0.8.0-nightly.…` (`beta` < `nightly`).
 */
export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return Number.NaN;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  const p = x[4];
  const q = y[4];
  if (p === undefined || q === undefined) return p === q ? 0 : p === undefined ? 1 : -1;
  const ps = p.split(".");
  const qs = q.split(".");
  for (let i = 0; i < Math.max(ps.length, qs.length); i++) {
    if (i >= ps.length) return -1;
    if (i >= qs.length) return 1;
    const m = ps[i];
    const n = qs[i];
    const mNum = /^\d+$/.test(m);
    const nNum = /^\d+$/.test(n);
    if (mNum && nNum) {
      const d = Number(m) - Number(n);
      if (d !== 0) return Math.sign(d);
    } else if (mNum !== nNum) return mNum ? -1 : 1;
    else if (m !== n) return m < n ? -1 : 1;
  }
  return 0;
}

/** What the page reads. Plain data, so it crosses the bridge as it is. */
export interface UpdateState {
  status: UpdateStatus;
  /** Whether this run can look for updates at all: `false` in `desktop:dev`, where nothing is packaged. */
  enabled: boolean;
  /** The version running now. */
  current: string;
  /** The newer version, from `downloading` to `manual`; the older one a `downgrade` offers; `null`
   *  before and after. */
  version: string | null;
  /** Download progress, 0–100, while `downloading` and only once the updater has reported one. */
  percent: number | null;
  /** When the last check that got an answer finished, as epoch milliseconds; `null` before the first. */
  checkedAt: number | null;
  /** What to tell the person when `status` is `error` — a sentence they can act on, never a stack. */
  error: string | null;
  /** The channel followed: the person's choice, or the version's own when they made none. */
  channel: string;
  /** The version's own channel, which is followed until the person chooses another. */
  versionChannel: string;
}

/** The slice of `electron-updater`'s `AppUpdater` this file uses; the tests fake it. */
export interface Updater {
  autoDownload: boolean;
  allowPrerelease: boolean;
  /** Never set here except inside the one confirmed check (`downgrade`). */
  allowDowngrade: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available", listener: (info: { version: string }) => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdatesOptions {
  updater: Updater;
  /** Whether updates are looked for at all: only a packaged app has anything to replace. */
  enabled: boolean;
  /** The version running now. */
  current: string;
  /** Whether this build can install an update itself. When it cannot — an unsigned macOS build, an
   *  AppImage whose file the person cannot write to — nothing is downloaded and the answer is `manual`. */
  canInstall: boolean;
  /** The channel the person chose, kept on this machine; `null` when they chose none, and then the
   *  version's own is followed exactly as it was before there was a choice. */
  channel: UpdateChannel | null;
  /** Keep the person's choice for the next launch. */
  saveChannel(channel: UpdateChannel): void;
  /** Point the updater at the releases of `channel`, or back at the version's own with `null`.
   *  Called only for a choice that differs from the version's own, or when one is taken back. */
  useFeed(channel: UpdateChannel | null): void;
  /** Where a version's release is, for `manual`. */
  releaseUrl(version: string): string;
  /** Show the person a page: the release, in their browser. */
  openExternal(url: string): void;
  /** Everything that has to be finished before the app quits: the server stopped the way a normal
   *  quit stops it. Resolves when the process may go. */
  prepareToQuit(): Promise<void>;
  /** The install did not quit the app (the updater reported an error after `quitAndInstall`): put
   *  back what `prepareToQuit` took away, so the app is whole again. */
  recoverFromQuit(): Promise<void>;
  /** Written to the console; the person is never shown this. */
  log(message: string): void;
  now?(): number;
  /** `setInterval`, injected so a test does not wait six hours. Returns what stops it. */
  every?(ms: number, run: () => void): () => void;
}

/** How often a running app asks again. Not only at launch: many people never quit it. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;

export interface Updates {
  state(): UpdateState;
  /** Told of every change, with the new state. Returns the unsubscribe. */
  subscribe(listener: (state: UpdateState) => void): () => void;
  /** Ask whether a newer version exists. Nothing happens while one is already being looked for,
   *  downloaded or waiting; resolves when the answer is known. */
  check(): Promise<void>;
  /** The Update button: restart into the new version when `ready`, open the release page when `manual`. */
  install(): Promise<void>;
  /** Follow `channel` from the next check on, and keep the choice. A check in flight finishes on
   *  the channel it asked; an answer about the old channel is dropped, a download is not. */
  setChannel(channel: UpdateChannel): Promise<void>;
  /** The confirmed path, and the only way `allowDowngrade` is ever on: the person said yes to
   *  installing `version`, the older one a `downgrade` offers. Anything else is ignored. */
  downgrade(version: string): Promise<void>;
  /** Check now, and then every {@link RECHECK_MS}. */
  start(): void;
  stop(): void;
}

/**
 * The sentence for an error. The person gets what they can do about it; the raw message goes to the
 * console through `log`. Matched on what `electron-updater` and Chromium put in the message, because
 * neither gives a code that survives both.
 */
export function updateErrorText(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (/\b(403|429)\b|rate limit/i.test(`${message} ${code}`)) {
    return "GitHub is limiting requests right now. Try again in a little while.";
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|net::|ERR_INTERNET|ERR_NETWORK|socket hang up|getaddrinfo|timed? ?out/i.test(
      `${message} ${code}`,
    )
  ) {
    return "Could not reach GitHub. Check your connection and try again.";
  }
  if (/\b404\b|cannot find (channel|latest)|no published versions|latest[^ ]*\.yml/i.test(message)) {
    return "No update information was found for this version. Try again later.";
  }
  if (/sha512|checksum|signature|verif/i.test(message)) {
    return "The downloaded update did not check out, so it was not kept. Try again.";
  }
  return "The update check failed. Try again later.";
}

export function createUpdates(opts: UpdatesOptions): Updates {
  const { updater } = opts;
  const now = opts.now ?? Date.now;
  const every =
    opts.every ??
    ((ms, run) => {
      const timer = setInterval(run, ms);
      /* A timer must never be what keeps the process alive. */
      timer.unref?.();
      return () => clearInterval(timer);
    });

  const own = versionChannel(opts.current);
  let state: UpdateState = {
    status: "idle",
    enabled: opts.enabled,
    current: opts.current,
    version: null,
    percent: null,
    checkedAt: null,
    error: null,
    channel: opts.channel ?? own,
    versionChannel: own,
  };
  const listeners = new Set<(state: UpdateState) => void>();
  /* Set once `quitAndInstall` is called: an `error` after it is the install failing, not a check. */
  let installing = false;
  let stopTimer: (() => void) | null = null;
  /* The version the person confirmed, while the check that may fetch it runs. */
  let confirmed: string | null = null;
  /* The check in flight, so a change of channel waits for its answer. */
  let running: Promise<void> = Promise.resolve();
  const older = (version: string): boolean => compareVersions(version, opts.current) < 0;

  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener({ ...state });
  };

  /* Nothing is downloaded on a build that cannot install what it fetched. */
  updater.autoDownload = opts.canInstall;
  /* A pre-release is seen on every channel but the stable one. With no choice made this is the
     version's own word, as it always was; only a choice that differs is pointed at another feed. */
  updater.allowPrerelease = state.channel !== "latest";
  updater.allowDowngrade = false;
  if (state.channel !== own) opts.useFeed(state.channel as UpdateChannel);

  updater.on("checking-for-update", () => {
    if (state.status !== "checking") set({ status: "checking", error: null });
  });
  updater.on("update-available", (info) => {
    if (confirmed !== null && info.version !== confirmed && older(info.version)) {
      /* Not the version the person said yes to, and older: it is asked about again, not fetched. */
      set({ status: "downgrade", version: info.version, percent: null, checkedAt: now(), error: null });
      return;
    }
    set({
      status: opts.canInstall ? "downloading" : "manual",
      version: info.version,
      percent: null,
      checkedAt: now(),
      error: null,
    });
  });
  updater.on("update-not-available", (info) => {
    /* Only on a channel the person chose: the version's own channel never offers going back. */
    if (state.channel !== own && typeof info?.version === "string" && older(info.version)) {
      set({ status: "downgrade", version: info.version, percent: null, checkedAt: now(), error: null });
      return;
    }
    set({ status: "idle", version: null, percent: null, checkedAt: now(), error: null });
  });
  updater.on("download-progress", (progress) => {
    if (state.status !== "downloading") return;
    const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, Math.round(progress.percent))) : null;
    set({ percent });
  });
  updater.on("update-downloaded", (info) => {
    set({ status: "ready", version: info.version, percent: 100, error: null });
  });
  updater.on("error", (error) => {
    opts.log(`update error: ${(error as Error | undefined)?.message ?? error}`);
    if (installing) {
      /* The install could not quit the app; it is still here, and its server is not. */
      installing = false;
      void opts.recoverFromQuit().catch((e) => opts.log(`could not restart the server: ${(e as Error).message ?? e}`));
      set({ status: "error", error: "The update could not be installed. Restart AnyDag and try again." });
      return;
    }
    set({ status: "error", percent: null, error: updateErrorText(error) });
  });

  /* Read fresh: the updater's events move `state` while `check` awaits, which narrowing cannot see. */
  const status = (): UpdateStatus => state.status;

  /** One question to the updater, and the state it leaves; `false` when it failed. */
  const ask = async (): Promise<boolean> => {
    set({ status: "checking", error: null });
    try {
      await updater.checkForUpdates();
    } catch (e) {
      /* `error` was also emitted, normally; make sure a rejection that was not leaves no spinner. */
      if (status() === "checking") set({ status: "error", error: updateErrorText(e) });
      opts.log(`update check failed: ${(e as Error).message ?? e}`);
      return false;
    }
    /* An updater that is switched off resolves with nothing and says nothing. */
    if (status() === "checking") set({ status: "idle", checkedAt: now() });
    return true;
  };

  const check = async (): Promise<void> => {
    /* One question at a time, and no second answer for an update already in hand. A `downgrade`
       is asked again: the chosen channel may have something newer by now. */
    if (!opts.enabled || (status() !== "idle" && status() !== "error" && status() !== "downgrade")) return;
    const asked = ask().then(() => undefined);
    running = asked;
    await asked;
  };

  return {
    state: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    check,
    async install() {
      if (state.status === "manual" && state.version) {
        opts.openExternal(opts.releaseUrl(state.version));
        return;
      }
      if (state.status !== "ready" || installing) return;
      installing = true;
      try {
        await opts.prepareToQuit();
        /* Not silent, and run the new version after: the person asked for the restart. */
        updater.quitAndInstall(false, true);
      } catch (e) {
        installing = false;
        opts.log(`install failed: ${(e as Error).message ?? e}`);
        void opts.recoverFromQuit().catch((err) => opts.log(`could not restart the server: ${(err as Error).message ?? err}`));
        set({ status: "error", error: "The update could not be installed. Restart AnyDag and try again." });
      }
    },
    async setChannel(next) {
      if (!opts.enabled || !isUpdateChannel(next)) return;
      /* The question in flight was asked of the old channel; let it answer first. */
      await running;
      opts.saveChannel(next);
      if (next === state.channel) return;
      updater.allowPrerelease = next !== "latest";
      opts.useFeed(next === own ? null : next);
      /* What was found on the old channel says nothing about the new one. A download in flight or
         waiting is kept: it is installed as it would have been, and the new channel is asked next. */
      const stale = status() === "idle" || status() === "error" || status() === "downgrade" || status() === "manual";
      set(stale ? { channel: next, status: "idle", version: null, percent: null, error: null } : { channel: next });
    },
    async downgrade(version) {
      if (state.status !== "downgrade" || state.version !== version || typeof version !== "string") return;
      if (!opts.canInstall) {
        /* Nothing is installed here by this build: the person fetches the release themselves. */
        opts.openExternal(opts.releaseUrl(version));
        return;
      }
      confirmed = version;
      updater.autoDownload = false;
      updater.allowDowngrade = true;
      let answered: boolean;
      try {
        const asked = ask();
        running = asked.then(() => undefined);
        answered = await asked;
      } finally {
        /* Off again the moment the one confirmed question is answered, whatever it was. */
        updater.allowDowngrade = false;
        updater.autoDownload = opts.canInstall;
        confirmed = null;
      }
      /* The check found what to fetch (the confirmed version, or anything newer); fetch it now. */
      if (answered && status() === "downloading") {
        try {
          await updater.downloadUpdate();
        } catch (e) {
          /* `error` was emitted and has said so. */
          opts.log(`update download failed: ${(e as Error).message ?? e}`);
          if (status() === "downloading") set({ status: "error", percent: null, error: updateErrorText(e) });
        }
      }
    },
    start() {
      if (stopTimer || !opts.enabled) return;
      void check();
      stopTimer = every(RECHECK_MS, () => void check());
    },
    stop() {
      stopTimer?.();
      stopTimer = null;
    },
  };
}
