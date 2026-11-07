import { defineConfig } from "@playwright/test";

/**
 * The visual gate.
 *
 * Two things are checked per board, and the second matters as much as the first: the render matches
 * its committed snapshot, and **the console is clean**. The dev-only size assertion in
 * `DiagramItem` reports through `console.error`, so "no console output" means every card rendered
 * at exactly the size it was laid out at — a check no screenshot comparison would catch, because a
 * uniformly-two-pixels-too-tall diagram still looks fine until two cards touch.
 */
/* Must agree with `vite.config.ts`, which reads the same variable — see the note there for why a
   second checkout has to be able to move the port. */
const origin = `http://localhost:${Number(process.env.ANYDAG_PORT) || 3500}`;

/* **A run started by hand is told, once, that its screenshots will not hold** — the hook's
   refusal in `scripts/e2e-local.sh`, as a line rather than a stop, because somebody running one spec
   in the system browser may be after something other than its pixels. Once: the config is loaded
   again in every worker, and a worker has an index. */
if (process.env.ANYDAG_CHROMIUM && !process.env.ANYDAG_NO_SNAPSHOTS && process.env.TEST_WORKER_INDEX === undefined) {
  console.warn(
    `playwright: ANYDAG_CHROMIUM=${process.env.ANYDAG_CHROMIUM} — the committed screenshots are Playwright's own ` +
      "Chromium's, so a screenshot check may fail on the browser rather than the change; ANYDAG_NO_SNAPSHOTS=1 compares none",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  /**
   * **One retry, because this suite now decides whether a push happens.**
   *
   * For two milestones a handful of checks failed under a full parallel run and passed on their
   * own — `tidy`, `group`, and `navigate`'s middle-drag, which is the one that turned up the day
   * the suites moved to `.githooks/pre-push`. The advice was "re-run before believing it — the tell is that the failing check moves", which is a manual retry
   * somebody performs, and it was fine while a human read the result. A hook is not a human: a
   * gate that refuses one push in five for a reason that is not there when you look is a gate
   * turned off within a week, and `--no-verify` is right there.
   *
   * This is the same policy automated, and it **hides nothing**: Playwright reports a test that
   * failed then passed as `flaky` in its own line of the summary, distinct from `passed`. So the
   * flake is still visible, still countable, and still worth fixing — it just no longer stops the
   * push. A check that fails twice is a failure and is reported as one.
   */
  retries: 1,
  /* Signs the suite in once and leaves the session in `e2e/.auth/state.json`. A `globalSetup`
     rather than a setup *project*, because a project name enters the snapshot path template and
     would rename all 45 committed baselines — see `e2e/global-setup.ts`. */
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: origin,
    /* Every route under `/__board` is behind a session. The cookie is httpOnly, which `storageState`
       carries and a page script could not set. */
    storageState: "./e2e/.auth/state.json",
    viewport: { width: 1600, height: 1200 },
    /* A machine with a Chromium already on it — a CI image, a sandbox — can point here instead of
       downloading the pinned build. Unset, Playwright uses its own — **which is the only browser the
       committed screenshots hold for**: another draws text a few pixels wider or narrower, so with
       this set `ANYDAG_NO_SNAPSHOTS=1` belongs beside it, and `scripts/e2e-local.sh` refuses to run
       the dev suite without it. A run started by hand gets the warning at the top. */
    ...(process.env.ANYDAG_CHROMIUM ? { launchOptions: { executablePath: process.env.ANYDAG_CHROMIUM } } : {}),
  },
  expect: {
    /* Font rasterisation differs by a hair between runs; anything structural is far above this. */
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  webServer: {
    command: "npm run dev",
    /* `/api/health` answers without a vault, so it is up the moment the server is — before any
       board route could say which vault it means. */
    url: `${origin}/api/health`,
    reuseExistingServer: true,
    /* The Assistant's chats run on a scripted harness (`server/chat/fake.ts`), so `assistant.spec.ts`
       spends no money and needs no login. Only a server this config starts has it: one that was
       already up is reused as it is, and the spec proves it is the fake before it says a word. */
    env: { ...(process.env as Record<string, string>), ANYDAG_CHAT_FAKE: "1" },
    /* `npm run dev` builds the server bundle when nothing answers on its port, which on a fresh
       checkout is an esbuild run before Vite answers anything. It reuses a server that is already
       up, so the long timeout costs nothing in the ordinary case. */
    timeout: 300_000,
  },
});
