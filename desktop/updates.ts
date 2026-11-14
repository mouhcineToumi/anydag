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
 *                                └─ failed ──▶ error ──check──▶ checking
 *
 * `ready` and `manual` are final until the app restarts: a newer release than the one found is
 * found by the next launch, and re-checking while one waits would only repeat the answer.
 */

type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "manual" | "error";

/** What the page reads. Plain data, so it crosses the bridge as it is. */
export interface UpdateState {
  status: UpdateStatus;
  /** Whether this run can look for updates at all: `false` in `desktop:dev`, where nothing is packaged. */
  enabled: boolean;
  /** The version running now. */
  current: string;
  /** The newer version, from `downloading` to `manual`; `null` before and after. */
  version: string | null;
  /** Download progress, 0–100, while `downloading` and only once the updater has reported one. */
  percent: number | null;
  /** When the last check that got an answer finished, as epoch milliseconds; `null` before the first. */
  checkedAt: number | null;
  /** What to tell the person when `status` is `error` — a sentence they can act on, never a stack. */
  error: string | null;
}

/** The slice of `electron-updater`'s `AppUpdater` this file uses; the tests fake it. */
export interface Updater {
  autoDownload: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
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

  let state: UpdateState = {
    status: "idle",
    enabled: opts.enabled,
    current: opts.current,
    version: null,
    percent: null,
    checkedAt: null,
    error: null,
  };
  const listeners = new Set<(state: UpdateState) => void>();
  /* Set once `quitAndInstall` is called: an `error` after it is the install failing, not a check. */
  let installing = false;
  let stopTimer: (() => void) | null = null;

  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener({ ...state });
  };

  /* Nothing is downloaded on a build that cannot install what it fetched. */
  updater.autoDownload = opts.canInstall;

  updater.on("checking-for-update", () => {
    if (state.status !== "checking") set({ status: "checking", error: null });
  });
  updater.on("update-available", (info) => {
    set({
      status: opts.canInstall ? "downloading" : "manual",
      version: info.version,
      percent: null,
      checkedAt: now(),
      error: null,
    });
  });
  updater.on("update-not-available", () => {
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

  const check = async (): Promise<void> => {
    /* One question at a time, and no second answer for an update already in hand. */
    if (!opts.enabled || (status() !== "idle" && status() !== "error")) return;
    set({ status: "checking", error: null });
    try {
      await updater.checkForUpdates();
    } catch (e) {
      /* `error` was also emitted, normally; make sure a rejection that was not leaves no spinner. */
      if (status() === "checking") set({ status: "error", error: updateErrorText(e) });
      opts.log(`update check failed: ${(e as Error).message ?? e}`);
      return;
    }
    /* An updater that is switched off resolves with nothing and says nothing. */
    if (status() === "checking") set({ status: "idle", checkedAt: now() });
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
