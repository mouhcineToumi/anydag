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
`hotfix/**`, no force-push or deletion, and `v*` tags and `nightly/**` branches that cannot be moved
once made. No branch's pull request needs an approval: `develop` since 2026-11-17, `main`, `release/**`
and `hotfix/**` since 2026-11-18 (#562). Only the owner has write access, so only the owner can merge:
an outside pull request is merged after the owner has read it, and every one into `develop` lands
through the merge queue (below). A required approval could only be met by bypassing it, since the owner
cannot approve their own pull request, which meant every merge was an `--admin` merge somebody had to
sit and wait for; 0.9.0's bench commit (#561) stopped there. **Giving anyone else write access reopens
this**: put a required approval back on `main` and `develop` first.

**The merge queue** (#503). `develop` merges about twenty-five pull requests a day, nearly all
written by agents, and its ruleset used not to require a branch to be up to date: two pull requests
each green on an old `develop` merged and broke it together (one push run in eight went red in the
week before), and agents caught up by merging `develop` in by hand, restarting CI each time. GitHub's
own merge queue is offered only to repositories an organization owns, so the queue is
`scripts/merge-queue.mjs`, run from the maintainer's machine, with the `merge-queue` skill
(`.claude/skills/merge-queue/`) as its driver. Three parts:

- **The ruleset requires a branch to be up to date with `develop`** (`strict_required_status_checks_policy`).
  GitHub refuses a merge that was not tested on the current `develop`, whoever asks — the queue is
  what makes that cheap, not what enforces it.
- **The queue does the updating, in order.** A pull request joins it by the `queue` label; the oldest
  label goes first. The front one is brought up to date with GitHub's *update branch* (a merge commit
  from `develop`, never a force-push; the squash into `develop` hides it), auto-merge is turned on
  pinned to that commit, and GitHub merges it when the required checks pass. Auto-merge is turned off
  on every other queued pull request, so none lands out of turn. A failed check is re-run once
  (`playwright.config.ts` already retries a test once inside a run; this is for a runner that died);
  a second failure, a policy check (`PR title`, `PR target`, `Linked issue` — at once, before the
  branch is updated, since no update can fix one), a draft, another base,
  an hour at the front, or green-but-blocked (an unresolved thread) takes it out with a comment
  saying why. A pull request labelled again goes to the back.
- **A conflict stops the queue** (exit 3): the merge of `develop` is left half done in a worktree
  under the git directory, and the skill resolves it there, runs the checks, pushes the resolution to
  the branch as a new commit, says on the pull request what it did, and starts the queue again. It
  hands the pull request back instead when its issue is `agent: deep`, the branch is on a fork, or the
  conflict is in the write path, sync, undo, the gate or layout — the list is in the skill.

The queue works one pull request at a time, so a burst lands in sequence, one CI run on the updated
branch apart (about two minutes at the median, fourteen at worst); it buys a green `develop`, not
speed. One runner at a time: a lock in the git directory.

**The visual review** (#528) is the merge queue's pattern applied to how the app looks: a script
on the maintainer's machine, `scripts/visual-review.mjs`, driven by the `visual-review` skill
(`.claude/skills/visual-review/`) in the maintainer's own Claude Code or OpenCode. **Nothing of it
runs in CI and it needs no secret**; the pixel comparison above stays the gate. The comparison catches
a change nobody meant; it cannot catch one somebody meant that looks wrong — the baseline is
regenerated and committed, and the check passes — nor drift from `DESIGN.md` that looks plausible on
its own. `node scripts/visual-review.mjs <pr>`:

- **Skips at once** a pull request that touches nothing the chrome is drawn from (`src/styles/`,
  `src/ui/`, `src/settings/`, `src/blocks/`, `src/feedback/`, `src/telemetry/`, `themes/`,
  `DESIGN.md`, `e2e/surfaces.spec.ts`, or a baseline but the diagram's `reference` and `export`
  ones): it prints `{"skip": true}` after one `gh` call, and the skill stops there — no Docker, no
  agent, no cost.
- **Renders both sides**: two worktrees under the git directory (`.git/visual-review/base`, `…/head`),
  at the merge base and at `refs/pull/<n>/head`, each running the chrome's screenshot specs (every
  spec with a `toHaveScreenshot` but `reference` and `export`; `e2e/surfaces.spec.ts` holds every
  top-level surface in light and dark) through `scripts/e2e-docker.sh` with its snapshot folders
  emptied, so every picture is a fresh render in the pinned image. The worktrees and their Docker
  `node_modules` volumes are kept between runs, and a capture of the same two commits is reused.
- **Pairs the pictures** into `.git/visual-review/pr-<n>/{before,after,diff}/`, compared pixel by
  pixel (`scripts/lib/png.mjs`, no dependency): a pair whose moved pixels are under a ten-thousandth
  of it is `same`, the rest `changed`, `new` or `removed`, in `manifest.json` beside the code's
  `diff.patch`. The agent reads the changed pairs, `DESIGN.md` and the skill's critique checklist
  (`references/critique.md`, written for this repository from the *impeccable* skill's critique and
  audit dimensions; impeccable itself is used when installed, and nothing depends on it), and writes
  `review.json`.
- **Posts one comment**, edited in place on a re-run (a hidden marker finds it): the regressions with
  their before and after, the notes, what changed and looks right. The pictures are pushed as one
  commit to `refs/visual-review/pr-<n>` — outside `refs/heads`, so no clone fetches it and no
  workflow starts — and linked by that commit's sha; each review's commit is chained on the last, so
  an older comment's pictures stay reachable.

**`--all`** renders every surface at `origin/develop` (or a ref) for an audit of the whole app's
chrome, a step before a release (`docs/RELEASING.md`): the agent writes `report.md` beside the
pictures and offers its findings as issues. **It is advisory.** Whether a regression it reports
should hold a pull request — the queue could run it on a queued one that changes chrome — is decided
after a few weeks of seeing how often it is right.

**A release is a tag, and the workflow checks where it stands.** `release.yml` runs on `v*` tags that
are not nightlies: a stable tag must be on `main` and a beta on `release/<core>` or `hotfix/<core>`.
It runs the whole tier — `checks.yml` with the api's harness and its Postgres suites, `e2e.yml` with
`scope: full`, the desktop app packaged and opened on Linux, Windows and macOS (signing where the
secrets allow — see *The desktop app*) — and publishes only when `scripts/check-release-assets.mjs`
finds every installer and the update feeds for the version's channel.

**A stable release carries its development health report** (#529). After publishing, `release.yml`
runs `node scripts/release-report.mjs <version>` and attaches the JSON and the Markdown to the release.
The script gathers the window **since the previous stable tag** — fixed by the tags, not by the clock —
from the tags, the GitHub API and `docs/bench/`, and writes `docs/metrics/<version>.json`, the raw
record, plus the report rendered from every JSON in that folder. Each metric has a value, a rolling
7-day value and a trend across the releases before it; a metric whose source does not exist yet (or
depends on #526, #527, #112 or #528) says `n/a` and why. The back-merge commits the files
([`docs/RELEASING.md`](../RELEASING.md), steps 9–10), so the next release renders the trend offline and
a moved number is a diff. The report informs; it gates nothing. Definitions, the window and the
security-counts-only rule: [`docs/metrics/README.md`](../metrics/README.md).

**A nightly is built from develop by itself.** `nightly.yml` runs at 02:00 UTC (and by hand): if
develop has moved since the last one, it makes a `nightly/<version>` branch holding one commit that
stamps the version, tags it `v<version>`, runs the whole tier against it, and publishes a
pre-release. It keeps the GitHub *releases* of the newest seven nightlies and never deletes a tag or a
branch — electron-updater reads the ten newest releases, and ten nightlies in a row would hide a
beta's next version from it. Beside the build it runs the two resource guards,
`node scripts/bench.mjs --guard` (idle CPU on a 1k-file vault, a 200-node layout), which go red on a
2x regression and hold nothing back, and the whole bench at every vault size (`bench, full`), whose
JSON is kept ninety days as the run's `bench-<version>` artifact so the numbers can be plotted night
over night — see *The bench* in [`limits.md`](limits.md). And it keeps
**an issue per test that passed only on retry** (#494): the suite retries a failed test once, so a
flake leaves the run green; the `flaky tests` job merges the full suite's shards into Playwright's
JSON, lists the flaky tests with `scripts/flaky.mjs`, and opens an issue for each
(`flaky: <spec> › <test>`, `status: triage`, `type: bug`, `area: ci`) or comments on the open one with
that title. The night's list is also in the run's summary, as are the whole tree's duplication and
complexity totals (#526, *Duplication and cognitive complexity* below), from the `waste` job that
runs whether or not there is a build.

**The update channel is the version's own word.** `0.2.0` is `latest`, `0.2.0-beta.1` is `beta`,
`0.2.0-nightly.…` is `nightly`. The update files are named after it (`latest*.yml`, `beta*.yml`,
`nightly*.yml`) and electron-updater reads the same word off the running version, so a
stable build never sees a pre-release and a nightly build follows nightlies. `desktop/main.ts` sets
`allowPrerelease` from it and never sets `autoUpdater.channel`, whose setter turns on
`allowDowngrade`. **electron-builder does not read the channel off the version for the `github`
provider** (its `detectUpdateChannel` is for `generic` and S3-like ones), so `desktop/package.mjs`
passes `-c.publish.channel=<word>` for a pre-release, and fails a build whose update files do not match
its channel. Without it every nightly wrote `latest*.yml` and none published (#116). The word is the
*default*: Settings → About lets a person follow another channel on their machine (#525), handed to
the updater as a feed (`desktop/feed.ts`), still without `autoUpdater.channel`, and going back to a
steadier channel installs an older version only after the person confirms it (*Updates* in
[`desktop.md`](desktop.md)). Nothing about how a release or a nightly publishes changed with it.

**The file names are the updater's URLs**, so none has a space: `AnyDag-<v>.AppImage`,
`AnyDag-Setup-<v>.exe`, `AnyDag-<v>-<arm64|x64>.dmg` and `.zip`. electron-builder's default
Windows name has spaces, which GitHub turns into dots on upload, and `latest.yml` would then name a
file the release does not have.

## Gate

**`npm run checks` is the fast tier** (`scripts/checks.sh`): `biome lint` → `biome format` (check only) → knip → typecheck →
`check:version` → `check:case` → `check:theme` → `check:literals` → `check:icons` → `check:skill` →
`check:design` → `check:openapi` → `check:duplication` → `check:complexity` → vitest (parity included). It has three readers — the pre-commit hook, CI's `checks.yml`, and
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
that includes `e2e/` and `desktop/`, which no `tsc` step checks — about 27 s, so it is CI's `promises`
job and the pre-push hook's, not the commit hook's. Biome's own promise rules are not used: they infer types without `tsc`, and
missed an unawaited `fs.readFile()` while flagging correct code. **knip** (`knip.jsonc`) holds the count
of unused files, exports and dependencies at zero; each exception in it says why.

**Duplication and cognitive complexity are held still, not cleaned up (#526).** Most of the code is
written by agents, and agent-written code piles up two kinds of waste: the same block in a second and
third place, and functions whose branching has stopped fitting in a reader's head. Both are now
measured, and only a **change that adds to them** fails — the tree's existing total is a number to
bring down, not a red gate on work that did not touch it.

- **Duplication is jscpd**, pinned at 5.4.3, in `.jscpd.json`. It scans TypeScript, TSX, JavaScript
  and JSX at five lines and fifty tokens — below that a match is a coincidence more often than a
  copy. A pull request (or a commit, through the hook) is compared with the commit its branch forked
  from by clone **fingerprint**, `--baseline-from-ref`: content, not line numbers, so an untouched
  old clone in a file a change edits stays quiet, while a block pasted a second time is new and
  fails with both locations named. Its exceptions: `**/test/**` and `**/e2e/**` (a test restates a
  fixture on purpose, so the copy is the point), `**/fixtures/**` and `**/__golden__/**` (fixtures
  and goldens), `boards/**` (vault fixtures, the user's data shape rather than code), `themes/**`
  (theme JSON is data), `icons/data/**`, `src/dsl/icon-names.ts`, `src/dsl/emoji-names.ts` and
  `src/render/icon-index.ts` (generated, one from another, so their duplication is by construction),
  and `**/dist/**`, `release/**`, `test-results/**`, `.dev-home/**`, `**/node_modules/**` (built,
  installed or written by a run). jscpd's parser is strict JSON and refuses a comment, so the reasons
  are here rather than beside the patterns.
- **Complexity is Biome's `noExcessiveCognitiveComplexity` at 20.** The rule is in `biome.jsonc`
  with `level: "off"`: 306 functions were already over 20 when the check landed, and printing them
  in every lint run would bury the one line the lint is about. `scripts/check-complexity.mjs` runs it
  with `--only`, over the whole tree, and keeps the findings in the files a change touches.
  `scripts/complexity-baseline.json` holds each function's name and score per file at the landing,
  and a finding that is not in it — or whose score rose — is what fails. Names and scores rather
  than line numbers, so a block that moves within its file is not reported as new. 20
  is measured, not guessed: on 2026-11-18, 473 functions were over Biome's default 15, 306 over 20,
  201 over 25 and 141 over 30, and the worst (a chart layout) 255 — 15 is a parser's first switch
  plus two branches, which this codebase has everywhere. Suppressing 306 functions in place was the
  alternative and lost: it puts a comment in the middle of the code for a fact about a number. After
  a deliberate refactor, `npm run complexity:baseline` rewrites the file — in a commit of its own,
  and never to make a red change green.

Both run as steps of the fast tier (`check:duplication`, `check:complexity`), so the commit hook
catches them, CI's `fast tier` job is the authority, and `gate.sh` runs them too; `.githooks/pre-push`
runs them again beside its two slower checks, because a commit made with `ANYDAG_NO_HOOK=1` never saw
the hook. They compare with `--base`, else `ANYDAG_BASE` (CI sets it to the pull request's base commit
and fetches that commit, since a checkout is one commit deep), else the merge base of
`origin/develop` and `HEAD`, else `origin/main`; a nightly or a release checkout at a tag has no
change to measure and says so instead of failing. Together they cost about 0.7 s: the static half of
the fast tier measured 4.5 s before the change and 5.2 s after on a twelve-core machine, and
`npm run checks` 33 s warm before and 33–34 s after — the unit suite dominates it, and the run-to-run
spread is larger than the addition, so the tier stays where a commit hook can hold it.

The whole tree is measured **every night** by `nightly.yml`'s `waste` job (`npm run
report:duplication`, `npm run report:complexity`), which runs whether or not there is a build, holds
nothing back, and writes the totals and the largest clones and most complex functions to the run
summary — the list follow-up issues are opened from. Refactoring the existing clones and functions is
out of scope here (#526): the baseline and the nightly's list are how it gets smaller, one issue at a
time. The optional agent-assisted suggestion — where a clone's shared helper should live in terms of
the layer table in `CLAUDE.md` — is not part of it.

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

`.githooks/pre-commit` runs the secret scan and then the fast tier, `.githooks/pre-push` the two cheap checks CI used to be first to run (see *What runs where* below), and `npm run prepare` installs the hooks with
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

**Every spec imports `test` from `e2e/fixture.ts`**, which pins every page it opens, and every
request it makes itself, to the suite's vault (`test/e2e-fixture.test.ts` refuses the package's own `test`). One server serves the whole run, and `vaults.spec.ts` and `sync.spec.ts` move its default as the
point of their checks; a page that names no vault would pin whichever vault was opened last. A check
that is *about* the default — a bare `/`, a link to a vault that is not open — passes `onServerDefault`
beside its title and gets no pin. See *A page that names no vault lands in the server's default* in
[`things-that-will-bite.md`](things-that-will-bite.md).

**CI is a handful of workflows, and each required check always reports.**

| Workflow | Runs | On |
|---|---|---|
| `ci.yml` → `CI passed` | the fast tier (`checks.yml`: `fast tier` — `checks.sh static` —, `unit` and the watched store contracts, as three jobs side by side) and `promises`; the desktop app (`desktop-build.yml`) on Linux when something it is built from changed, on all three systems for `main`, `release/**` and `hotfix/**`; actionlint when a workflow changed | pull requests into and pushes to `develop`, `main`, `release/**`, `hotfix/**` |
| `e2e.yml` → `e2e` | on a pull request, what the change can reach (`scope: changed`: the `@smoke` tier plus the specs `scripts/e2e-plan.mjs` names), sharded three ways; the whole suite sharded four ways on a push, one run at a time per branch with only the newest push waiting; the shards' reports merged into one, off the path to `e2e` | the same branches; `workflow_call` with `scope: smoke \| full` |
| `ci.yml` → `secrets` (in `CI passed`) | gitleaks over the commits the pull request or push adds; the selftest first | the same events as `ci.yml` |
| `pr-policy.yml` → `PR title`, `PR target`, `Linked issue` | a Conventional Commit title; `main` only from `release/*` or `hotfix/*`; a pull request into develop closes a `status: ready` issue (the owner, bots and a PR labelled `no-issue` exempt) | every pull request event, including an edit or a label |
| `nightly.yml`, `release.yml`, `cut-release.yml` | see *Versions and releases* | a schedule, a tag, a button |
| `deploy.yml` → `backup and restore` | the api's deployment restored: a stack up, data through Caddy, `backup.sh`, a fresh stack, `restore.sh`, and the data read back | pull requests and pushes that touch `deploy/**` or `api/**`; a weekly cron (Monday 03:15 UTC); a button |
| `bench.yml` → `base against head` | when the change can reach the built page or server (`scripts/bench-plan.mjs`), the edit timings of the pull request's head and its merge base, built and measured in turn on one runner (`scripts/bench-compare.mjs`); the table in the summary and in one comment on the pull request; red only on a large regression of a stable metric — *The bench* in [`limits.md`](limits.md) | pull requests into `develop`; advisory, not required |
| `codeql.yml`, `dependency-review.yml` | static security analysis; new dependencies' advisories and licences | pull requests and develop; not required |

`CI passed` and `e2e` are summary jobs: a reusable workflow's jobs do not exist when the job that calls
them is skipped, and a workflow with `paths-ignore` never starts, and either leaves a required check
"expected" for ever. So the workflow always runs, decides what is owed, and the summary fails only when
something owed did not pass. `scripts/e2e-plan.mjs` decides what the browser can see (prose, CI config,
unit tests and the desktop shell are nothing to it; `boards/` is a fixture, not prose).

**The path from a push to a green pull request is the `e2e` chain, and it was cut to its fixed cost**
(#258, which has the numbers). A shard pays about 47 s before its first test — pulling the image,
`npm ci`, starting the dev server — so the pull request's selection is split three ways rather than
run on one job, and `e2e` does not wait for the merged report. A pull request's shards each ask
`e2e-plan.mjs` for the selection after `npm ci`, because only there can it ask Playwright's
`--only-changed` which specs a change under `e2e/` reaches; the `plan` job, which has no
`node_modules`, only decides whether anything runs. **A push to `develop` runs the whole suite once
for the tip, not once a merge**: the push runs share one concurrency group per branch, which lets one
run finish and keeps only the newest waiting. Ten merges in ninety seconds had started forty
four-minute shards and queued every open pull request for up to four and a half minutes. A red push
run is bisected among the merges since the last green one; the nightly runs the whole suite again.

**The `@smoke` tag** (`test("…", { tag: "@smoke" }, …)`) is a promise about *breadth*: a new surface gets
one fast test in it. Tag a test that touches a surface nothing tagged touches; do not tag a second test
for a surface that has one — the tier is under a minute on purpose.

**What runs where** (#258 measured it; the numbers are on the issue):

| Where | Runs | About |
|---|---|---|
| pre-commit | the secret scan, then `npm run checks` (`checks.sh`: static half, then the unit suite) | 28 s on twelve cores |
| pre-push | `npm run lint:promises`, the store's contracts over a watched vault and the two waste checks, side by side; the browser selection only with `ANYDAG_PREPUSH_E2E=1` | 30 s |
| pull request | all of the above again (CI is the authority: hooks can be skipped and machines are dirty), the desktop app on Linux, and the browser selection below, sharded three ways | the required checks green in about a minute and a half |
| push to `develop` | the fast tier and the whole browser suite, once for the newest push of a burst | |
| nightly, release | everything, with the api's Postgres suites and the desktop app on three systems | |

**`pre-push` runs the two cheap checks that only CI used to run, the two waste checks, and the
browser suite only when asked.** Those two were what went red on pull requests; together they are
about half a minute, so they belong before the push. The duplication and complexity checks (#526) join
them at about a second, because the fast tier's copy is skipped by a commit made with
`ANYDAG_NO_HOOK=1`. The browser suite was the same `@smoke` grep in the same image that the pull
request runs a minute later, a minute of every push spent repeating CI, so it moved to the pull request
(`scope: changed`) and is opt-in here. Nothing new on the push (every sha is already on a remote) → no
checks, one line saying so; only prose changed (a `.md` outside `boards/`, or `docs/`) → no checks.

**The browser selection** is `scripts/e2e-plan.mjs`'s answer for the diff against `origin/develop` (else
`origin/main`, else the whole suite), one `--grep`: docs, CI config and unit tests run nothing;
application code the `@smoke` tier; what can move pixels (`boards/`, `icons/`, `themes/`, the drawing
layers of `src/`) also `reference.spec.ts` and `surfaces.spec.ts`; the chrome (`src/ui/`, `src/settings/`)
also `surfaces.spec.ts`, every top-level surface in light and dark (#528); `api/` and `server/sync/` also `sync.spec.ts`; and a change under
`e2e/` the specs Playwright's `--only-changed` traces it to. A pull request's shards run it; so does
`ANYDAG_PREPUSH_E2E=1 git push`, in the image when Docker answers, else on the host with no screenshots,
and it says which. The number of browsers comes from the machine (`scripts/e2e-lib.sh`: cores − 2 and
free memory at 600 MB a worker, clamped to 1..6) and the run prints why; `ANYDAG_E2E_WORKERS` overrides.

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

`check:openapi` regenerates the OpenAPI documents in memory (`scripts/openapi.mjs`, the `SPECS` list)
and fails when a committed copy in `docs/api/` is not those bytes: an API change is a diff in review,
and a spec nobody regenerated cannot land. *The OpenAPI document* in [`api.md`](api.md) has the rest.

`check:design` holds `DESIGN.md`, the chrome's design system, to the code in the same way. Every
`--dag-*` variable it names exists in every theme. Every theme path it puts in backticks
(`ui.layer.toast`) resolves in every theme. Every class or `data-dag-*` attribute it puts in
backticks occurs under `src/` as a whole name, and every repository path exists. A trailing `*` or
`…`, or a `<placeholder>`, makes a name a prefix. The names `DESIGN.md` gives as open decisions
(`color.scrim`) are listed in the script and must stay missing; when one lands, the check fails
until the file catches up.

`test/parity.test.ts` runs in `npm run checks` too, so **a route, a command or a tool that
`docs/parity.json` does not name fails the commit that adds it** (see *Parity* in `cli.md`).

A stale HMR module can fail every check at once with a "does not provide an export named …" error,
or make the size assertion fire — restart the dev server before believing a mass failure.
