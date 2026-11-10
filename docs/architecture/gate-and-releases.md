# The gate and releases

> Versions, the branch model, how a release is cut, and what `npm run checks`, the hooks and CI run.
> [`CONTRIBUTING.md`](../../CONTRIBUTING.md) is the contributor's view of the same rules, and
> [`docs/RELEASING.md`](../RELEASING.md) the step-by-step for a maintainer.

## Versions and releases

The version is semver: `MAJOR.MINOR.PATCH`, a beta `X.Y.Z-beta.N`, or a nightly
`X.Y.Z-nightly.YYYYMMDDHHmm` (UTC, one numeric identifier, because a semver number may not start with
a zero and `0230` would). `scripts/lib/version.mjs` defines the three forms. They are said in three
places that must agree — `VERSION`, which every build reads, `package.json`'s `version`, which
electron-builder names a release by, and the lockfile's root — and `node scripts/set-version.mjs`
writes all three. `check:version` (in `npm run checks`) refuses a tree where they differ or where
any is not one of the forms.

It reaches the server's `/api/health` through `server/build.mjs`'s `__ANYDAG_VERSION__`, the desktop
shell through `desktop/build.mjs`, the page's `<meta name="version">` and Settings' About tab through
`vite.config.ts`, and `anydag --version`.

| Bump | For |
|---|---|
| `MINOR` | a feature, a page, a route — anything a person would notice (while `MAJOR` is 0, a breaking change too) |
| `PATCH` | a fix to something already released |

**The branches are Git Flow.** `develop` is the default branch, every pull request targets it, and
its `VERSION` is always the *next* version to be released. `main` holds released code only and
changes only through a pull request from `release/X.Y.Z` or `hotfix/X.Y.Z` (a merge commit; the
`PR target` check refuses anything else). A `release/X.Y.Z` branch is cut from develop to stabilise a
version and kept after it ships; betas are tagged on it. Every merge into `main` is tagged `vX.Y.Z`,
and main is merged back into develop with the version bumped. Branches are never deleted after a
merge. Rulesets on GitHub hold all of it: a pull request for `main`, `develop`, `release/**` and
`hotfix/**`, the code owner's approval for anybody but the owner, no force-push or deletion, and
`v*` tags and `nightly/**` branches that cannot be moved once made.

**A release is a tag, and the workflow checks where it stands.** `release.yml` runs on `v*` tags that
are not nightlies: a stable tag must be on `main` and a beta on `release/<core>` or `hotfix/<core>`.
It runs the whole tier — `checks.yml` with the api's harness and its Postgres suites, `e2e.yml` with
`scope: full`, the desktop app packaged and opened on Linux, Windows and macOS (signing where the
secrets allow — see *The desktop app*) — and publishes only when `scripts/check-release-assets.mjs`
finds every installer and the update feeds for the version's channel.

**A nightly is built from develop by itself.** `nightly.yml` runs at 02:00 UTC (and by hand): if
develop has moved since the last one, it makes a `nightly/<version>` branch holding one commit that
stamps the version, tags it `v<version>`, runs the whole tier against it, and publishes a
pre-release. It keeps the GitHub *releases* of the newest seven nightlies and never deletes a tag or a
branch — electron-updater reads the ten newest releases, and ten nightlies in a row would hide a
beta's next version from it.

**The update channel is the version's own word.** `0.2.0` is `latest`, `0.2.0-beta.1` is `beta`,
`0.2.0-nightly.…` is `nightly`. The update files are named after it (`latest*.yml`, `beta*.yml`,
`nightly*.yml`) and electron-updater reads the same word off the running version, so a
stable build never sees a pre-release and a nightly build follows nightlies. `desktop/main.ts` sets
`allowPrerelease` from it and never sets `autoUpdater.channel`, whose setter turns on
`allowDowngrade`. **electron-builder does not read the channel off the version for the `github`
provider** (its `detectUpdateChannel` is for `generic` and S3-like ones), so `desktop/package.mjs`
passes `-c.publish.channel=<word>` for a pre-release, and fails a build whose update files do not match
its channel. Without it every nightly wrote `latest*.yml` and none published (#116).

**The file names are the updater's URLs**, so none has a space: `AnyDag-<v>.AppImage`,
`AnyDag-Setup-<v>.exe`, `AnyDag-<v>-<arm64|x64>.dmg` and `.zip`. electron-builder's default
Windows name has spaces, which GitHub turns into dots on upload, and `latest.yml` would then name a
file the release does not have.

## Gate

**`npm run checks` is the fast tier** (`scripts/checks.sh`): `biome lint` → `biome format` (check only) → knip → typecheck →
`check:version` → `check:case` → `check:theme` → `check:literals` → `check:icons` → `check:skill` →
vitest (parity included). It has three readers — the pre-commit hook, CI's `checks.yml`, and
`scripts/gate.sh` — one list, so a check added is added everywhere. It needs no browser and no
network and takes about half a minute, which is what lets it sit in a commit hook: `tsc` is
incremental (its build info under `node_modules/.cache/tsc/`, which CI caches too) and the unit suite
shares modules between the files each worker runs. `npm run gate` is the fast tier and then the
browser suite.

**Lint is Biome, and promises are typescript-eslint.** `biome.jsonc` holds Biome's recommended
*correctness* and *suspicious* rules, with every rule turned off or narrowed carrying its reason;
`useExhaustiveDependencies` is off on purpose (effects here deliberately have no dependency lists).
`npm run format` and `format:check` are Biome's formatter over `ts/tsx/mjs/cjs/js`; the fast tier
fails on a file it would change, so run `npm run format` before committing (or let your editor's
Biome extension do it). A whole-tree reformat is its own commit, listed in `.git-blame-ignore-revs`. `npm run lint:promises` is typescript-eslint's
three promise rules (`no-floating-promises`, `no-misused-promises`, `await-thenable`) over one program
that includes `e2e/` and `desktop/`, which no `tsc` step checks — about 40 s, so it is CI's `promises`
job and not in the hook. Biome's own promise rules are not used: they infer types without `tsc`, and
missed an unawaited `fs.readFile()` while flagging correct code. **knip** (`knip.jsonc`) holds the count
of unused files, exports and dependencies at zero; each exception in it says why.

**Secrets are refused before anything else** (`scripts/secrets.sh`, gitleaks with `.gitleaks.toml`).
The repository is public — the API server too — so a pushed secret is a published one, and no later
commit or history rewrite takes it back; the scan is the one check whose failure cannot be fixed after
the fact. It runs in three places: the pre-commit hook over the **staged** changes (`staged` — it reads
the index, which the rest of the hook does not, and needs no stash to do it), before the fast tier and
whether or not `node_modules` exists; `ci.yml`'s `secrets` job over the commits a pull request or push
adds (`range`, or `all` for a new branch), part of `CI passed`; and `nightly.yml` over the whole history
of `develop` (`all`), because a pull request's scan sees only its own commits and a newer gitleaks knows
key shapes an older one did not. Both CI jobs first run `selftest`, which plants a GitHub token in a
throwaway repository and fails if it is not refused — the guard against an allowance written so wide
that every scan passes. **An allowance in `.gitleaks.toml` names a file and a string, both**
(`condition = "AND"`), never a directory or a rule. Without gitleaks the hook warns and lets the commit
through (a hook that refuses every commit on a machine without the binary is a hook people turn off);
in CI, where `CI` is set, a missing binary is a failure. CI installs one pinned version, checked against
its published sha256 (`.github/actions/gitleaks/`). GitHub's own secret scanning and push protection are
on for the repository too (Settings → Code security). If a secret gets through: revoke it first
(`SECURITY.md`, *If a secret was committed*).

`.githooks/pre-commit` runs the secret scan and then the fast tier, and `npm run prepare` installs the hooks with
`git config core.hooksPath .githooks` — relative on purpose, so one setting serves every worktree.
`prepare` is `scripts/hooks.mjs`, which does nothing without git or a repository, because `npm ci`
runs it where there may be neither — and is Node, because npm runs a script line with `cmd.exe` on
Windows, where `command -v` and `true` are not commands. `ANYDAG_NO_HOOK=1` skips the hooks.

**The browser suite runs in one place, and that place is a Docker image.** Every screenshot is taken
and compared inside `mcr.microsoft.com/playwright:v<version>-noble`, where `<version>` is the exact
`@playwright/test` pin in `package.json` (`test/e2e-image.test.ts` holds `package.json`, the lockfile and
`.github/workflows/e2e.yml` to one number). `npm run e2e:docker` is that run on a laptop
(`scripts/e2e-docker.sh`: the repo mounted at `/work`, the host user's uid so the baselines and
`test-results/` it writes are yours, `node_modules` in a per-checkout named volume installed inside the
container, the dev server started by `playwright.config.ts` inside it, so it never meets your own on
3500); everything after the script's name goes to `playwright test`. `npm run e2e:smoke` is its `@smoke`
tier. **Regenerating baselines is `npm run e2e:docker -- --update-snapshots=all`, and nothing else
produces a valid one.** `npm run e2e:local` is the host's own browser and compares **no** screenshots
(`ANYDAG_NO_SNAPSHOTS=1` is set for it): the `neutral` theme is `system-ui`, so its cards are measured
by whatever fonts the machine has, and a host's layout is not the image's.

**CI is a handful of workflows, and each required check always reports.**

| Workflow | Runs | On |
|---|---|---|
| `ci.yml` → `CI passed` | the fast tier and `promises` (`checks.yml`); the desktop app (`desktop-build.yml`) on Linux when something it is built from changed, on all three systems for `main`, `release/**` and `hotfix/**`; actionlint when a workflow changed | pull requests into and pushes to `develop`, `main`, `release/**`, `hotfix/**` |
| `e2e.yml` → `e2e` | the `@smoke` tier on a pull request; the whole suite sharded four ways on a push, with the shards' reports merged into one | the same branches; `workflow_call` with `scope: smoke \| full` |
| `ci.yml` → `secrets` (in `CI passed`) | gitleaks over the commits the pull request or push adds; the selftest first | the same events as `ci.yml` |
| `pr-policy.yml` → `PR title`, `PR target`, `Linked issue` | a Conventional Commit title; `main` only from `release/*` or `hotfix/*`; a pull request into develop closes a `status: ready` issue (the owner, bots and a PR labelled `no-issue` exempt) | every pull request event, including an edit or a label |
| `nightly.yml`, `release.yml`, `cut-release.yml` | see *Versions and releases* | a schedule, a tag, a button |
| `deploy.yml` → `backup and restore` | the api's deployment restored: a stack up, data through Caddy, `backup.sh`, a fresh stack, `restore.sh`, and the data read back | pull requests and pushes that touch `deploy/**` or `api/**`; a weekly cron (Monday 03:15 UTC); a button |
| `codeql.yml`, `dependency-review.yml` | static security analysis; new dependencies' advisories and licences | pull requests and develop; not required |

`CI passed` and `e2e` are summary jobs: a reusable workflow's jobs do not exist when the job that calls
them is skipped, and a workflow with `paths-ignore` never starts, and either leaves a required check
"expected" for ever. So the workflow always runs, decides what is owed, and the summary fails only when
something owed did not pass. `scripts/e2e-plan.mjs` decides what the browser can see (prose, CI config,
unit tests and the desktop shell are nothing to it; `boards/` is a fixture, not prose).

**The `@smoke` tag** (`test("…", { tag: "@smoke" }, …)`) is a promise about *breadth*: a new surface gets
one fast test in it. Tag a test that touches a surface nothing tagged touches; do not tag a second test
for a surface that has one — the tier is under a minute on purpose.

**`pre-push` runs only what the push can have changed.** Nothing new on the push (every sha is already on
a remote) → no tests, one line saying so. Otherwise `scripts/e2e-plan.mjs` reads the diff against
`origin/develop` (else `origin/main`, else the whole suite) and answers with a `--grep`: docs, CI config
and unit tests run nothing; application code the `@smoke` tier; what can move pixels (`boards/`,
`icons/`, the drawing layers of `src/`) also `reference.spec.ts`; `api/` and `server/sync/` also `sync.spec.ts`; and a
change under `e2e/` the specs Playwright's `--only-changed` traces it to. It runs in the image when
Docker answers, else on the host with no screenshots, and says which. The number of browsers comes from
the machine (`scripts/e2e-lib.sh`: cores − 2 and free memory at 600 MB a worker, clamped to 1..6) and the
run prints why; `ANYDAG_E2E_WORKERS` overrides.

**`playwright.config.ts` sets `retries: 1`.** A check that passes on its second try is reported as
`flaky` on Playwright's summary line; one that fails twice is a failure. Under `CI` it also sets
`forbidOnly` and `trace: "on-first-retry"`.

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
`docs/parity.json` does not name fails the commit that adds it** (see *Parity* in `cli.md`).

A stale HMR module can fail every check at once with a "does not provide an export named …" error,
or make the size assertion fire — restart the dev server before believing a mass failure.
