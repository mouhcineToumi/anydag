import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createUpdates, RECHECK_MS, type UpdateState, type Updater, updateErrorText } from "../desktop/updates";

/**
 * The shell's update state machine (#268), driven by a fake `electron-updater`. The fake emits what
 * the real one does — `checking-for-update`, then `update-available` and `download-progress` and
 * `update-downloaded`, or `update-not-available`, or `error` — so what is held is the state the page
 * is given at each step and the order the shell stops its server and quits in.
 */

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  /** What the next `checkForUpdates` does, after emitting `checking-for-update`. */
  script: () => Promise<unknown> | unknown = () => undefined;
  checks = 0;
  installed: unknown[][] = [];
  checkForUpdates(): Promise<unknown> {
    this.checks++;
    this.emit("checking-for-update");
    return Promise.resolve(this.script());
  }
  quitAndInstall(...args: unknown[]): void {
    this.installed.push(args);
  }
}

function setup(over: Partial<Parameters<typeof createUpdates>[0]> = {}) {
  const updater = new FakeUpdater();
  const order: string[] = [];
  const opened: string[] = [];
  const timers: { ms: number; run: () => void; stopped: boolean }[] = [];
  let clock = 1_000;
  const updates = createUpdates({
    updater,
    enabled: true,
    current: "0.5.0",
    canInstall: true,
    releaseUrl: (v) => `https://example.test/v${v}`,
    openExternal: (url) => opened.push(url),
    prepareToQuit: async () => {
      order.push("server stopped");
    },
    recoverFromQuit: async () => {
      order.push("server restarted");
    },
    log: () => undefined,
    now: () => clock,
    every: (ms, run) => {
      const t = { ms, run, stopped: false };
      timers.push(t);
      return () => {
        t.stopped = true;
      };
    },
    ...over,
  });
  const seen: UpdateState[] = [];
  updates.subscribe((s) => seen.push(s));
  return { updater, updates, order, opened, timers, seen, tick: (ms: number) => (clock += ms) };
}

/** An update the way the real updater finds it: available, a progress or two, downloaded. */
function download(updater: FakeUpdater, version = "0.6.0") {
  updater.script = () => {
    updater.emit("update-available", { version });
    updater.emit("download-progress", { percent: 40.4 });
    updater.emit("update-downloaded", { version });
  };
}

describe("the update state machine", () => {
  it("starts idle, with the version it runs and no answer yet", () => {
    const { updates } = setup();
    expect(updates.state()).toEqual({
      status: "idle",
      enabled: true,
      current: "0.5.0",
      version: null,
      percent: null,
      checkedAt: null,
      error: null,
    });
  });

  it("goes checking → downloading → ready when a newer version is found and fetched", async () => {
    const { updater, updates, seen } = setup();
    download(updater);
    await updates.check();
    expect(seen.map((s) => s.status)).toEqual(["checking", "downloading", "downloading", "ready"]);
    expect(seen[2]).toMatchObject({ status: "downloading", version: "0.6.0", percent: 40 });
    expect(updates.state()).toMatchObject({ status: "ready", version: "0.6.0", percent: 100, checkedAt: 1_000, error: null });
  });

  it("goes back to idle, and remembers when it looked, when nothing is newer", async () => {
    const { updater, updates, tick } = setup();
    updater.script = () => updater.emit("update-not-available", { version: "0.5.0" });
    tick(500);
    await updates.check();
    expect(updates.state()).toMatchObject({ status: "idle", version: null, checkedAt: 1_500 });
  });

  it("does not stay on checking when the updater is off and answers nothing", async () => {
    const { updates } = setup();
    await updates.check();
    expect(updates.state().status).toBe("idle");
  });

  it("asks nothing of an updater that is not enabled", async () => {
    const { updater, updates, timers } = setup({ enabled: false });
    await updates.check();
    updates.start();
    expect(updater.checks).toBe(0);
    expect(timers).toHaveLength(0);
    expect(updates.state()).toMatchObject({ status: "idle", enabled: false });
  });

  it("is one question at a time, and asks nothing while an update waits", async () => {
    const { updater, updates } = setup();
    let release: () => void = () => undefined;
    updater.script = () => new Promise<void>((resolve) => (release = resolve));
    const first = updates.check();
    await updates.check();
    expect(updater.checks).toBe(1);
    release();
    await first;

    download(updater);
    await updates.check();
    expect(updates.state().status).toBe("ready");
    await updates.check();
    expect(updater.checks).toBe(2);
  });

  describe("errors", () => {
    it("says what the person can do, and never the raw message", async () => {
      const { updater, updates, seen } = setup();
      const raw = "net::ERR_INTERNET_DISCONNECTED at Object.stack (/private/path/app.asar/x.js:1:1)";
      updater.script = () => {
        const e = new Error(raw);
        updater.emit("error", e);
        throw e;
      };
      await updates.check();
      const state = updates.state();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Could not reach GitHub. Check your connection and try again.");
      expect(JSON.stringify(seen)).not.toContain("app.asar");
    });

    it("turns a rejection that emitted no event into an error, not a spinner", async () => {
      const { updater, updates } = setup();
      updater.script = () => Promise.reject(new Error("boom"));
      await updates.check();
      expect(updates.state()).toMatchObject({ status: "error", error: "The update check failed. Try again later." });
    });

    it("can be tried again, and a good answer clears the message", async () => {
      const { updater, updates } = setup();
      updater.script = () => Promise.reject(new Error("HTTP 403 rate limit exceeded"));
      await updates.check();
      expect(updates.state().error).toBe("GitHub is limiting requests right now. Try again in a little while.");
      updater.script = () => updater.emit("update-not-available", {});
      await updates.check();
      expect(updates.state()).toMatchObject({ status: "idle", error: null });
    });

    it("maps the messages the updater and Chromium use", () => {
      expect(updateErrorText(Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }))).toMatch(
        /reach GitHub/,
      );
      expect(updateErrorText(new Error("Cannot find latest-mac.yml in the latest release artifacts (404)"))).toMatch(
        /No update information/,
      );
      expect(updateErrorText(new Error("sha512 checksum mismatch"))).toMatch(/did not check out/);
      expect(updateErrorText(undefined)).toMatch(/Try again later/);
    });
  });

  describe("a build that cannot install what it fetches", () => {
    it("downloads nothing and says manual, with the version", async () => {
      const { updater, updates } = setup({ canInstall: false });
      expect(updater.autoDownload).toBe(false);
      updater.script = () => updater.emit("update-available", { version: "0.6.0" });
      await updates.check();
      expect(updates.state()).toMatchObject({ status: "manual", version: "0.6.0" });
    });

    it("opens the release page for the install, and quits nothing", async () => {
      const { updater, updates, opened, order } = setup({ canInstall: false });
      updater.script = () => updater.emit("update-available", { version: "0.6.0" });
      await updates.check();
      await updates.install();
      expect(opened).toEqual(["https://example.test/v0.6.0"]);
      expect(order).toEqual([]);
      expect(updater.installed).toEqual([]);
      expect(updates.state().status).toBe("manual");
    });
  });

  describe("install", () => {
    it("does nothing until an update is ready", async () => {
      const { updater, updates, order } = setup();
      await updates.install();
      expect(order).toEqual([]);
      expect(updater.installed).toEqual([]);
    });

    it("stops the server first, and only then quits and installs", async () => {
      const { updater, updates, order } = setup();
      download(updater);
      await updates.check();
      const calls: string[] = [];
      const real = updater.quitAndInstall.bind(updater);
      updater.quitAndInstall = (...args) => {
        calls.push(`quitAndInstall after ${order.join(",") || "nothing"}`);
        real(...args);
      };
      await updates.install();
      expect(order).toEqual(["server stopped"]);
      expect(calls).toEqual(["quitAndInstall after server stopped"]);
      expect(updater.installed).toEqual([[false, true]]);
    });

    it("waits for a slow server to stop before the installer may run", async () => {
      let stopped = false;
      let finish: () => void = () => undefined;
      const { updater, updates } = setup({
        prepareToQuit: () =>
          new Promise<void>((resolve) => {
            finish = () => {
              stopped = true;
              resolve();
            };
          }),
      });
      download(updater);
      await updates.check();
      const pending = updates.install();
      await Promise.resolve();
      expect(updater.installed).toEqual([]);
      finish();
      await pending;
      expect(stopped).toBe(true);
      expect(updater.installed).toHaveLength(1);
    });

    it("is once only: a second click while it quits does not stop the server twice", async () => {
      const prepare = vi.fn(async () => undefined);
      const { updater, updates } = setup({ prepareToQuit: prepare });
      download(updater);
      await updates.check();
      await Promise.all([updates.install(), updates.install()]);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(updater.installed).toHaveLength(1);
    });

    it("puts the server back, and says so, when the install fails after the quit began", async () => {
      const { updater, updates, order } = setup();
      download(updater);
      await updates.check();
      updater.quitAndInstall = () => {
        updater.emit("error", new Error("EACCES: permission denied, rename '/opt/AnyDag.AppImage'"));
      };
      await updates.install();
      await Promise.resolve();
      expect(order).toEqual(["server stopped", "server restarted"]);
      expect(updates.state()).toMatchObject({
        status: "error",
        error: "The update could not be installed. Restart AnyDag and try again.",
      });
    });

    it("puts the server back when stopping it throws", async () => {
      const { updater, updates, order } = setup({
        prepareToQuit: async () => {
          throw new Error("no");
        },
      });
      download(updater);
      await updates.check();
      await updates.install();
      await Promise.resolve();
      expect(order).toEqual(["server restarted"]);
      expect(updater.installed).toEqual([]);
      expect(updates.state().status).toBe("error");
    });
  });

  describe("the periodic check", () => {
    it("checks at start and then every six hours, and stops when told", async () => {
      const { updater, updates, timers } = setup();
      updater.script = () => updater.emit("update-not-available", {});
      updates.start();
      updates.start();
      await Promise.resolve();
      expect(updater.checks).toBe(1);
      expect(timers).toHaveLength(1);
      expect(timers[0].ms).toBe(RECHECK_MS);
      expect(RECHECK_MS).toBe(6 * 60 * 60 * 1000);

      timers[0].run();
      await Promise.resolve();
      expect(updater.checks).toBe(2);

      updates.stop();
      expect(timers[0].stopped).toBe(true);
    });

    it("leaves a ready update alone", async () => {
      const { updater, updates, timers } = setup();
      download(updater);
      updates.start();
      await new Promise((r) => setTimeout(r, 0));
      expect(updates.state().status).toBe("ready");
      timers[0].run();
      await Promise.resolve();
      expect(updater.checks).toBe(1);
    });
  });

  it("tells a listener of every change, and stops when it unsubscribes", async () => {
    const { updater, updates } = setup();
    const heard: string[] = [];
    const off = updates.subscribe((s) => heard.push(s.status));
    updater.script = () => updater.emit("update-not-available", {});
    await updates.check();
    off();
    await updates.check();
    expect(heard).toEqual(["checking", "idle"]);
  });
});
