import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  createUpdates,
  RECHECK_MS,
  type UpdateChannel,
  type UpdateState,
  type Updater,
  updateErrorText,
  versionChannel,
} from "../desktop/updates";

/**
 * The shell's update state machine (#268), driven by a fake `electron-updater`. The fake emits what
 * the real one does — `checking-for-update`, then `update-available` and `download-progress` and
 * `update-downloaded`, or `update-not-available`, or `error` — so what is held is the state the page
 * is given at each step and the order the shell stops its server and quits in.
 */

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  allowPrerelease = false;
  allowDowngrade = false;
  /** What the next `checkForUpdates` does, after emitting `checking-for-update`. */
  script: () => Promise<unknown> | unknown = () => undefined;
  checks = 0;
  /** `allowDowngrade` as each check found it, in order. */
  downgradeAtCheck: boolean[] = [];
  /** `autoDownload` as each check found it, in order. */
  autoDownloadAtCheck: boolean[] = [];
  /** What `downloadUpdate` fetches: the version the last check made available. */
  available: string | null = null;
  downloads = 0;
  installed: unknown[][] = [];
  /** The real updater's `channel` setter turns on `allowDowngrade`; it must never be reached. */
  channelSet = 0;
  set channel(_value: unknown) {
    this.channelSet++;
    this.allowDowngrade = true;
  }
  checkForUpdates(): Promise<unknown> {
    this.checks++;
    this.downgradeAtCheck.push(this.allowDowngrade);
    this.autoDownloadAtCheck.push(this.autoDownload);
    this.emit("checking-for-update");
    return Promise.resolve(this.script());
  }
  downloadUpdate(): Promise<unknown> {
    this.downloads++;
    if (this.available) this.emit("update-downloaded", { version: this.available });
    return Promise.resolve([]);
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
  const saved: UpdateChannel[] = [];
  const feeds: (UpdateChannel | null)[] = [];
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
    channel: null,
    saveChannel: (channel) => saved.push(channel),
    useFeed: (channel) => feeds.push(channel),
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
  return { updater, updates, order, opened, timers, seen, saved, feeds, tick: (ms: number) => (clock += ms) };
}

/**
 * The newest release on the channel the updater is pointed at is `version`, and the fake answers the
 * way `AppUpdater.isUpdateAvailable` does: newer is available, older only with `allowDowngrade`,
 * anything else is not available — with the version found, which is what a `downgrade` is made of.
 */
function newest(updater: FakeUpdater, version: string, current: string) {
  updater.script = () => {
    const order = compareVersions(version, current);
    if (order > 0 || (order < 0 && updater.allowDowngrade)) {
      updater.available = version;
      updater.emit("update-available", { version });
      if (updater.autoDownload) void updater.downloadUpdate();
    } else updater.emit("update-not-available", { version });
  };
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
      channel: "latest",
      versionChannel: "latest",
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

  describe("the update channel (#525)", () => {
    const NIGHTLY = "0.8.0-nightly.202611170230";

    it("with no channel chosen, nothing differs from before there was a choice", async () => {
      for (const [current, word] of [
        ["0.5.0", "latest"],
        ["0.6.0-beta.1", "beta"],
        [NIGHTLY, "nightly"],
      ] as const) {
        const { updater, updates, feeds, saved } = setup({ current });
        /* What `main.ts` set before #525: `allowPrerelease = UPDATE_CHANNEL !== "latest"`, nothing else. */
        expect(updater.allowPrerelease).toBe(word !== "latest");
        expect(updater.allowDowngrade).toBe(false);
        expect(feeds).toEqual([]);
        expect(saved).toEqual([]);
        expect(updater.channelSet).toBe(0);
        expect(updates.state()).toMatchObject({ channel: word, versionChannel: word });
        /* An older release on the version's own channel is never offered, as before. */
        newest(updater, "0.1.0", current);
        await updates.check();
        expect(updates.state()).toMatchObject({ status: "idle", version: null });
        expect(updater.downgradeAtCheck).toEqual([false]);
      }
    });

    it("choosing the version's own channel is the same as choosing none", () => {
      const { updater, feeds, updates } = setup({ current: NIGHTLY, channel: "nightly" });
      expect(feeds).toEqual([]);
      expect(updater.allowPrerelease).toBe(true);
      expect(updates.state().channel).toBe("nightly");
    });

    it("a stable build set to Nightly is offered the newest nightly, and nothing asks to confirm it", async () => {
      const { updater, updates, feeds } = setup({ current: "0.7.0", channel: "nightly" });
      expect(feeds).toEqual(["nightly"]);
      expect(updater.allowPrerelease).toBe(true);
      newest(updater, "0.8.0-nightly.202611180230", "0.7.0");
      await updates.check();
      expect(updates.state()).toMatchObject({ status: "ready", version: "0.8.0-nightly.202611180230", channel: "nightly" });
      expect(updater.downgradeAtCheck).toEqual([false]);
      expect(updater.channelSet).toBe(0);
    });

    it("…and after it installs, the channel is still Nightly: the version's own now, so the plain feed", () => {
      const { updater, updates, feeds } = setup({ current: "0.8.0-nightly.202611180230", channel: "nightly" });
      expect(updates.state()).toMatchObject({ channel: "nightly", versionChannel: "nightly" });
      expect(feeds).toEqual([]);
      expect(updater.allowPrerelease).toBe(true);
    });

    it("choosing at run time keeps the choice and points the updater at it from the next check", async () => {
      const { updater, updates, feeds, saved } = setup({ current: "0.7.0" });
      await updates.setChannel("nightly");
      expect(saved).toEqual(["nightly"]);
      expect(feeds).toEqual(["nightly"]);
      expect(updater.allowPrerelease).toBe(true);
      expect(updater.checks).toBe(0);
      expect(updates.state().channel).toBe("nightly");

      /* Back to the version's own: the plain feed, and stable sees no pre-release again. */
      await updates.setChannel("latest");
      expect(saved).toEqual(["nightly", "latest"]);
      expect(feeds).toEqual(["nightly", null]);
      expect(updater.allowPrerelease).toBe(false);
      expect(updater.channelSet).toBe(0);
      expect(updater.allowDowngrade).toBe(false);
    });

    it("a nightly build set to Stable offers the older stable, and never installs it unasked", async () => {
      const { updater, updates, feeds, timers } = setup({ current: NIGHTLY, channel: "latest" });
      expect(feeds).toEqual(["latest"]);
      expect(updater.allowPrerelease).toBe(false);
      newest(updater, "0.7.0", NIGHTLY);
      updates.start();
      await new Promise((r) => setTimeout(r, 0));
      expect(updates.state()).toMatchObject({ status: "downgrade", version: "0.7.0", current: NIGHTLY, channel: "latest" });
      /* Asked again, every six hours or by the button: still an offer, still nothing fetched. */
      timers[0].run();
      await new Promise((r) => setTimeout(r, 0));
      await updates.check();
      expect(updates.state().status).toBe("downgrade");
      expect(updater.downgradeAtCheck).toEqual([false, false, false]);
      expect(updater.downloads).toBe(0);
      expect(updater.allowDowngrade).toBe(false);
      updates.stop();
    });

    it("the confirmed path turns allowDowngrade on for that one check, and fetches what was confirmed", async () => {
      const { updater, updates, order } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();

      /* A press on a stale offer, for another version, does nothing. */
      await updates.downgrade("0.6.0");
      expect(updater.checks).toBe(1);

      await updates.downgrade("0.7.0");
      expect(updater.downgradeAtCheck).toEqual([false, true]);
      /* The confirmed check downloads nothing by itself; the state machine fetches after looking. */
      expect(updater.autoDownloadAtCheck).toEqual([true, false]);
      expect(updater.downloads).toBe(1);
      expect(updates.state()).toMatchObject({ status: "ready", version: "0.7.0" });
      expect(updater.allowDowngrade).toBe(false);
      expect(updater.autoDownload).toBe(true);

      await updates.install();
      expect(order).toEqual(["server stopped"]);
      expect(updater.installed).toEqual([[false, true]]);
      expect(updater.channelSet).toBe(0);
    });

    it("a confirmed check that finds another older version asks again rather than fetch it", async () => {
      const { updater, updates } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();
      newest(updater, "0.6.0", NIGHTLY);
      await updates.downgrade("0.7.0");
      expect(updates.state()).toMatchObject({ status: "downgrade", version: "0.6.0" });
      expect(updater.downloads).toBe(0);
      expect(updater.allowDowngrade).toBe(false);
    });

    it("a confirmed check that finds something newer fetches it as an ordinary update", async () => {
      const { updater, updates } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();
      newest(updater, "0.8.0", NIGHTLY);
      await updates.downgrade("0.7.0");
      expect(updates.state()).toMatchObject({ status: "ready", version: "0.8.0" });
    });

    it("a newer stable than the nightly is an upgrade, with no question", async () => {
      const { updater, updates } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.8.0", NIGHTLY);
      await updates.check();
      expect(updates.state()).toMatchObject({ status: "ready", version: "0.8.0" });
      expect(updater.downgradeAtCheck).toEqual([false]);
    });

    it("allowDowngrade goes off again when the confirmed check fails", async () => {
      const { updater, updates } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();
      updater.script = () => Promise.reject(new Error("socket hang up"));
      await updates.downgrade("0.7.0");
      expect(updates.state().status).toBe("error");
      expect(updater.allowDowngrade).toBe(false);
      expect(updater.autoDownload).toBe(true);
    });

    it("a build that cannot install opens the older release's page, and never allows a downgrade", async () => {
      const { updater, updates, opened } = setup({ current: NIGHTLY, channel: "latest", canInstall: false });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();
      expect(updates.state().status).toBe("downgrade");
      await updates.downgrade("0.7.0");
      expect(opened).toEqual(["https://example.test/v0.7.0"]);
      expect(updater.downgradeAtCheck).toEqual([false]);
    });

    it("a change of channel drops what the old one found, but keeps a download in hand", async () => {
      const { updater, updates } = setup({ current: NIGHTLY, channel: "latest" });
      newest(updater, "0.7.0", NIGHTLY);
      await updates.check();
      await updates.setChannel("nightly");
      expect(updates.state()).toMatchObject({ status: "idle", version: null, channel: "nightly" });

      newest(updater, "0.8.0-nightly.202611180230", NIGHTLY);
      await updates.check();
      expect(updates.state().status).toBe("ready");
      await updates.setChannel("beta");
      expect(updates.state()).toMatchObject({ status: "ready", version: "0.8.0-nightly.202611180230", channel: "beta" });
    });

    it("a change made while a check runs waits for its answer", async () => {
      const { updater, updates, feeds } = setup({ current: "0.7.0" });
      let release: () => void = () => undefined;
      updater.script = () =>
        new Promise<void>((resolve) => {
          release = () => {
            updater.emit("update-not-available", { version: "0.7.0" });
            resolve();
          };
        });
      const checking = updates.check();
      const choosing = updates.setChannel("nightly");
      await Promise.resolve();
      expect(feeds).toEqual([]);
      release();
      await Promise.all([checking, choosing]);
      expect(feeds).toEqual(["nightly"]);
      expect(updates.state()).toMatchObject({ status: "idle", channel: "nightly" });
    });

    it("does nothing in a run that cannot update, or for a word that is not a channel", async () => {
      const off = setup({ enabled: false });
      await off.updates.setChannel("nightly");
      expect(off.saved).toEqual([]);
      const on = setup();
      await on.updates.setChannel("canary" as UpdateChannel);
      expect(on.saved).toEqual([]);
      expect(on.feeds).toEqual([]);
    });
  });
});

describe("versions and channels", () => {
  it("reads the channel off the version, as the release workflows name it", () => {
    expect(versionChannel("0.2.0")).toBe("latest");
    expect(versionChannel("0.2.0-beta.1")).toBe("beta");
    expect(versionChannel("0.2.0-nightly.202611070230")).toBe("nightly");
    expect(versionChannel("dev")).toBe("latest");
  });

  it("orders versions the way the updater does", () => {
    const ordered = [
      "0.6.9",
      "0.7.0-beta.1",
      "0.7.0-beta.2",
      "0.7.0-beta.10",
      "0.7.0-nightly.202611170230",
      "0.7.0-nightly.202611180230",
      "0.7.0",
      "0.8.0-nightly.202611170230",
      "0.8.0",
      "0.10.0",
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect(Math.sign(compareVersions(ordered[i], ordered[j])), `${ordered[i]} vs ${ordered[j]}`).toBe(Math.sign(i - j));
      }
    }
    expect(compareVersions("v1.0.0", "1.0.0+build.5")).toBe(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("dev", "1.0.0")).toBeNaN();
  });
});
