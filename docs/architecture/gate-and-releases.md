# The gate and releases

> Versions, how a release is cut, and what `npm run gate`, `checks` and CI run.

> **Note.** This file is the original text, kept as it was. Where it describes the branch model,
> which CI jobs run, or how a release is cut, [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and
> [`docs/RELEASING.md`](../RELEASING.md) are authoritative; the rest of it (versions, the layout of
> `scripts/checks.sh`, what each `check:*` holds) still stands.

## Versions and releases

The version is semver, `MAJOR.MINOR.PATCH` with an optional pre-release (`0.2.0-beta.1`), and it is
said in two files that must agree: `VERSION`, which every build reads, and `package.json`'s
`version`, which electron-builder names a release by. `check:version` (in `npm run checks`) refuses a
tree where they differ or where either is not semver.

It reaches the server's `/api/health` through `server/build.mjs`'s `__ANYDAG_VERSION__`, the desktop
shell through `desktop/build.mjs`, the page's `<meta name="version">` and Settings' About tab through
`vite.config.ts`, and `anydag --version`.

| Bump | For |
|---|---|
| `MINOR` | a feature, a page, a route — anything a person would notice (while `MAJOR` is 0, a breaking change too) |
| `PATCH` | a fix to something already released |

**A release is a tag.** Bump `VERSION` and `package.json` together in one commit on `main`, then push
`v<version>`: `.github/workflows/release.yml` checks the tag against both files
(`node scripts/check-version.mjs v0.2.0`), runs the fast tier once, packages the app on Linux,
Windows and macOS (signing where the secrets allow — see *The desktop app*), opens each on a temp
vault, and creates the GitHub Release with every installer, its blockmap and the three files the
app's updater reads: `latest-linux.yml`, `latest.yml` (Windows) and `latest-mac.yml`. The release is
not created unless all three are there. A tag with a `-` in it is a pre-release. The notes are
generated from the merged pull requests and can be edited on GitHub afterwards.

**The file names are the updater's URLs**, so none has a space: `AnyDag-<v>.AppImage`,
`AnyDag-Setup-<v>.exe`, `AnyDag-<v>-<arm64|x64>.dmg` and `.zip`. electron-builder's default
Windows name has spaces, which GitHub turns into dots on upload, and `latest.yml` would then name a
file the release does not have.

## Gate

`npm run gate` runs everything in the order that fails fastest: typecheck (all three tsconfigs) →
`check:version` → `check:case` → `check:theme` → `check:literals` → `check:icons` → `check:skill` →
vitest → the Playwright suite. `npm run typecheck && npm test` is the quick loop.

**Everything before Playwright is `npm run checks`** (`scripts/checks.sh`), and it has three readers:
`gate.sh`, the pre-commit hook, and the `checks` job in CI — one list, so a check added is added
everywhere. It needs no browser and no network and takes seconds, which is what lets it sit in a
commit hook: `tsc` is incremental (its build info under `node_modules/.cache/tsc/`) and the unit
suite shares modules between the files each worker runs. `.githooks/pre-commit` is the hook, and
`npm run prepare` installs it with `git config core.hooksPath .githooks` — relative on purpose, so one
setting serves every worktree. `prepare` is `scripts/hooks.mjs`, which does nothing without git or a
repository, because `npm ci` runs it where there may be neither — and is Node, because npm runs a
script line with `cmd.exe` on Windows, where `command -v` and `true` are not commands and the shell
form failed `npm ci` there. `ANYDAG_NO_HOOK=1` skips the hooks.

**CI runs the fast tier and no Playwright.** The screenshot baselines are compared against one pinned
Chromium, and a runner's fonts rasterise differently, so a green tick on GitHub does not mean the app
was opened in a browser. The browser suite is `npm run e2e:local` (`scripts/e2e-local.sh`): against
the dev server, baselines compared, the only run that can fire the dev size assertion, under `nice`
and three browsers wide (`ANYDAG_E2E_WORKERS`). `.githooks/pre-push` runs it.

**`playwright.config.ts` sets `retries: 1`.** A check that passes on its second try is reported as
`flaky` on Playwright's summary line; one that fails twice is a failure.

**The hooks never stash**, the usual trick for checking the index rather than the working tree: the
stash stack is shared with every worktree, so a hook that pushes and pops could restore somebody
else's work over yours. They check the working tree, and `tsc` and `vitest` are whole-project
questions anyway.

`check:icons` fails on a manifest name that did not make it into the bundle, on a stale
`src/dsl/icon-names.ts`, and on any `icon=` in `boards/` that resolves to nothing — the vocabulary is
dense with near-misses, and `groq`/`grok`, `together`/`tether` and `zookeeper`/`keeper` are each two
different companies.

`check:skill` holds `skills/anydag/SKILL.md` — the document an agent reads before it draws anything —
to the code it describes, through the closed sets a prose document still contains: every theme is
named; the *Which type* table, `docs/dsl/` and `DiagramType` + `OWN_MODEL_TYPES` list the same
fourteen; the *Library* section names every layer and `GET /__board/library`; `docs/dsl/chart.md`'s
vocabulary is `chart`'s statement and form words; *Writing a note* names every block in
`NOTE_BLOCKS`; *Through MCP* names every tool in `TOOLS` and no other; every `anydag …` in *Through
the CLI* is a command `anydag help --json` lists, and every command group is named; and the quiz and
table code tables match `QUIZ_CODES` and `TABLE_CODES`. A missing skill is a failure, not a skip. The
cheat sheets under `skills/anydag/references/dsl` are a symlink to `docs/dsl/`, so they cannot drift.

`test/parity.test.ts` runs in `npm run checks` too, so **a route, a command or a tool that
`docs/parity.json` does not name fails the commit that adds it** (see *Parity*).

Two things about the Playwright run. Baselines are `-linux` and will not match elsewhere;
regenerate rather than fight them. And a stale HMR module can fail every check at once with a
"does not provide an export named …" error, or make the size assertion fire — restart the dev server
before believing a mass failure.
