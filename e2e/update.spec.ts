import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSettings } from "./sidebar";

/**
 * The Update button beside Settings, and Settings → About's update facts (#268).
 *
 * There is no Electron here, so the desktop bridge is a stub — and it is `desktop/preload.ts`'s
 * `updates`, member for member: `state()` resolves the state, `onChange(listener)` returns its
 * unsubscribe, `check()` resolves the state the check ended in, `install()` resolves nothing,
 * `setChannel(channel)` and `downgrade(version)` resolve the state after (#525). The
 * state is `desktop/updates.ts`'s `UpdateState`. What a stub cannot show is the restart itself
 * (the shell stopping the server and `quitAndInstall`) or the release page opening: those are the
 * main process's, held by `test/desktop-updates.test.ts` against a fake updater, and by a packaged
 * build, which no test here can run. This spec holds the page's half: when the button shows, what
 * it says, and that a click reaches `install()`.
 */

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-update-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, `---\ntitle: Update scratch\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\nhi\n\`\`\`\n`);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
});

/* The suite puts the sidebar away; the button lives in it, so start as a person would. */
test.use({
  storageState: async ({}, use) => {
    const seeded = JSON.parse(fs.readFileSync(path.resolve("e2e/.auth/state.json"), "utf8"));
    for (const o of seeded.origins) o.localStorage = o.localStorage.filter((e: { name: string }) => e.name !== "dag:sidebar");
    await use(seeded);
  },
});

interface State {
  status: "idle" | "checking" | "downloading" | "ready" | "manual" | "downgrade" | "error";
  enabled: boolean;
  current: string;
  version: string | null;
  percent: number | null;
  checkedAt: number | null;
  error: string | null;
  channel: string;
  versionChannel: string;
}

const IDLE: State = {
  status: "idle",
  enabled: true,
  current: "0.5.0",
  version: null,
  percent: null,
  checkedAt: null,
  error: null,
  channel: "latest",
  versionChannel: "latest",
};

declare global {
  interface Window {
    /** The stub's remote: make the shell say a new state. */
    shellSays: (state: State) => void;
    /** What the page asked of the stub, in order. */
    shellHeard: string[];
  }
}

/** The bridge's `updates`, as `desktop/preload.ts` exposes it, with a remote to move its state. */
async function bridge(page: Page, first: State = IDLE): Promise<void> {
  await page.addInitScript((initial: State) => {
    let state = initial;
    const listeners: ((s: State) => void)[] = [];
    window.shellHeard = [];
    window.shellSays = (next) => {
      state = next;
      for (const l of [...listeners]) l(state);
    };
    (window as unknown as { anydagDesktop: unknown }).anydagDesktop = {
      platform: "linux",
      updates: {
        state: async () => state,
        onChange: (listener: (s: State) => void) => {
          listeners.push(listener);
          return () => void listeners.splice(listeners.indexOf(listener), 1);
        },
        check: async () => {
          window.shellHeard.push("check");
          return state;
        },
        install: async () => {
          window.shellHeard.push("install");
        },
        setChannel: async (channel: string) => {
          window.shellHeard.push(`channel:${channel}`);
          window.shellSays({ ...state, channel });
          return state;
        },
        downgrade: async (version: string) => {
          window.shellHeard.push(`downgrade:${version}`);
          return state;
        },
      },
    };
  }, first);
}

async function open(page: Page): Promise<void> {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator('[data-dag-sidebar][data-mode="docked"]')).toBeVisible();
}

const button = (page: Page) => page.locator("[data-dag-update]");
const says = (page: Page, state: State) => page.evaluate((s) => window.shellSays(s), state);

test("in a browser, with no desktop bridge, there is no Update button", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-dag-settings-toggle]")).toBeVisible();
  await expect(button(page)).toHaveCount(0);
  /* ...and Settings → About has no update facts to show. */
  await openSettings(page, "about");
  await expect(page.locator("[data-dag-setting-version]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-update]")).toHaveCount(0);
  await expect(page.locator("[data-dag-setting-update-channel]")).toHaveCount(0);
});

test("the button shows only when an update is ready, beside Settings, and a click installs", { tag: "@smoke" }, async ({
  page,
}) => {
  await bridge(page);
  await open(page);
  await expect(button(page)).toHaveCount(0);

  /* Looking, and fetching, interrupt nobody. */
  await says(page, { ...IDLE, status: "checking" });
  await expect(button(page)).toHaveCount(0);
  await says(page, { ...IDLE, status: "downloading", version: "0.6.0", percent: 40 });
  await expect(button(page)).toHaveCount(0);

  await says(page, { ...IDLE, status: "ready", version: "0.6.0", percent: 100, checkedAt: Date.now() });
  await expect(button(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("data-dag-update", "ready");
  await expect(button(page)).toHaveText("Update");
  await expect(button(page)).toHaveAttribute("title", /0\.6\.0/);

  /* Beside Settings: the same row of the foot, to its right, not on top of it. */
  const settings = (await page.locator("[data-dag-settings-toggle]").boundingBox())!;
  const update = (await button(page).boundingBox())!;
  expect(update.x).toBeGreaterThanOrEqual(settings.x + settings.width - 1);
  expect(Math.abs(update.y + update.height / 2 - (settings.y + settings.height / 2))).toBeLessThan(settings.height / 2);
  await expect(page.locator("[data-dag-sidebar] .dag-sidebar__foot").locator("[data-dag-update]")).toHaveCount(1);

  await button(page).click();
  await expect.poll(() => page.evaluate(() => window.shellHeard)).toEqual(["install"]);
  /* It cannot be pressed twice while the app goes. */
  await expect(button(page)).toBeDisabled();
  await expect(button(page)).toContainText("Restarting");

  /* An update that is no longer there takes the button with it. */
  await says(page, IDLE);
  await expect(button(page)).toHaveCount(0);
});

test("on a build that cannot install, the button says it takes you to the download", async ({ page }) => {
  await bridge(page, { ...IDLE, status: "manual", version: "0.6.0", checkedAt: Date.now() });
  await open(page);
  await expect(button(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("data-dag-update", "manual");
  await expect(button(page)).toHaveText("Download update");
  await expect(button(page)).toHaveAttribute("title", /release page/);

  await button(page).click();
  await expect.poll(() => page.evaluate(() => window.shellHeard)).toEqual(["install"]);
  /* Nothing restarts, so the button is still there for the next try. */
  await expect(button(page)).toBeEnabled();
});

test("a desktop run with nothing packaged shows no button and no update facts", async ({ page }) => {
  await bridge(page, { ...IDLE, enabled: false });
  await open(page);
  await expect(button(page)).toHaveCount(0);
  await openSettings(page, "about");
  await expect(page.locator("[data-dag-setting-version]")).toBeVisible();
  await expect(page.locator("[data-dag-setting-update]")).toHaveCount(0);
  await expect(page.locator("[data-dag-setting-update-channel]")).toHaveCount(0);
});

test("About shows the version, checks on request, and says what went wrong in words", async ({ page }) => {
  await bridge(page);
  await open(page);
  await openSettings(page, "about");
  const version = fs.readFileSync(path.resolve("VERSION"), "utf8").trim();
  await expect(page.locator("[data-dag-setting-version]")).toHaveText(version);
  await expect(page.locator("[data-dag-setting-update]")).toHaveAttribute("data-dag-setting-update", "idle");
  await expect(page.locator("[data-dag-setting-update]")).toHaveText("Not checked yet");
  await expect(page.locator("[data-dag-setting-update-checked]")).toHaveCount(0);

  await page.locator("[data-dag-setting-update-check]").click();
  await expect.poll(() => page.evaluate(() => window.shellHeard)).toEqual(["check"]);

  /* While the shell is looking, there is nothing to press. */
  await says(page, { ...IDLE, status: "checking" });
  await expect(page.locator("[data-dag-setting-update-check]")).toBeDisabled();
  await expect(page.locator("[data-dag-setting-update]")).toHaveText("Checking…");

  const stamp = new Date(2026, 10, 14, 9, 30).getTime();
  await says(page, { ...IDLE, checkedAt: stamp });
  await expect(page.locator("[data-dag-setting-update]")).toHaveText("You are on the latest version");
  await expect(page.locator("[data-dag-setting-update-checked]")).toHaveText(new Date(stamp).toLocaleString());
  await expect(page.locator("[data-dag-setting-update-check]")).toBeEnabled();

  const said = "Could not reach GitHub. Check your connection and try again.";
  await says(page, { ...IDLE, status: "error", checkedAt: stamp, error: said });
  await expect(page.locator("[data-dag-setting-update-error]")).toHaveText(said);
  await expect(page.locator("[data-dag-setting-update-error]")).toHaveAttribute("role", "alert");
  /* An error is something to try again, not the end of the road. */
  await expect(page.locator("[data-dag-setting-update-check]")).toBeEnabled();
  await expect(button(page)).toHaveCount(0);

  await says(page, { ...IDLE, status: "ready", version: "0.6.0", percent: 100, checkedAt: stamp });
  await expect(page.locator("[data-dag-setting-update]")).toContainText("Version 0.6.0 is ready");
  await expect(page.locator("[data-dag-setting-update-check]")).toBeDisabled();
});

test("the update channel shows the version's own, and a choice goes to the shell", async ({ page }) => {
  await bridge(page, { ...IDLE, current: "0.8.0-nightly.202611170230", channel: "nightly", versionChannel: "nightly" });
  await open(page);
  await openSettings(page, "about");
  const channel = page.locator("[data-dag-setting-update-channel]");
  await expect(channel).toHaveValue("nightly");
  await expect(channel.locator("option")).toHaveText(["Stable", "Beta", "Nightly"]);
  await expect(page.getByText("This version's own is Nightly.", { exact: false })).toBeVisible();

  await channel.selectOption("latest");
  await expect.poll(() => page.evaluate(() => window.shellHeard)).toEqual(["channel:latest"]);
  await expect(channel).toHaveValue("latest");
  /* A choice is a preference, and says it was kept, like every row in Settings. */
  await expect(page.locator("[data-dag-setting-saved]")).toBeVisible();
});

test("a downgrade is said in words, and goes to the shell only after a yes", async ({ page }) => {
  const nightly = "0.8.0-nightly.202611170230";
  await bridge(page, {
    ...IDLE,
    status: "downgrade",
    current: nightly,
    version: "0.7.0",
    checkedAt: Date.now(),
    channel: "latest",
    versionChannel: "nightly",
  });
  await open(page);
  /* Not something the sidebar offers: it waits for the person in Settings. */
  await expect(button(page)).toHaveCount(0);
  await openSettings(page, "about");
  const line = `You are on ${nightly}; the newest stable is 0.7.0. Installing it is a downgrade.`;
  await expect(page.locator("[data-dag-setting-update]")).toHaveText(line);
  await expect(page.locator("[data-dag-setting-update-check]")).toBeEnabled();

  const offer = page.locator('[data-dag-setting-update-downgrade="0.7.0"]');
  await offer.click();
  const ask = page.locator('[data-dag-update-downgrade-ask="0.7.0"]');
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("alertdialog")).toContainText(line);
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  expect(await page.evaluate(() => window.shellHeard)).toEqual([]);

  await offer.click();
  await page.locator("[data-dag-update-downgrade-confirm]").click();
  await expect.poll(() => page.evaluate(() => window.shellHeard)).toEqual(["downgrade:0.7.0"]);
  await expect(ask).toHaveCount(0);
});
