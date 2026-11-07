# Contributing to AnyDag

Thank you for wanting to help. AnyDag is a local-first desktop app — an infinite canvas that draws
technical diagrams from a DSL, plus notes, tables, quizzes and tasks, all plain files in a folder. It
is maintained by [@mouhcineToumi](https://github.com/mouhcineToumi). Contributions from people and
from AI agents are both welcome, and they follow the same rules.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security problem? Do **not** open an
issue; follow [SECURITY.md](SECURITY.md).

**In short:** open an issue → wait for `status: ready` → branch from `develop` → `npm run checks` →
open a PR into `develop` that says `Closes #<issue>`.

- [Set up](#set-up)
- [Where to start](#where-to-start)
- [How an issue becomes work](#how-an-issue-becomes-work)
- [Definition of Ready](#definition-of-ready-for-an-issue)
- [Branches](#branches)
- [Making the change](#making-the-change)
- [Definition of Done](#definition-of-done-for-a-pull-request)
- [Pull requests and review](#pull-requests-and-review)
- [Releases](#releases)

## Set up

You need **Node 24.7 or later** and git. Playwright's browsers are only needed if you run the browser
suite, and Docker only for `npm run e2e:docker`.

```bash
git clone https://github.com/mouhcineToumi/anydag.git
cd anydag
git switch develop
npm ci          # installs dependencies and the git hooks
npm run dev     # Vite + the local server on boards/local/ → http://localhost:3500/?board=demo
```

| Command | What it does |
|---|---|
| `npm run dev` | the app in a browser, with hot reload, on the development vault `boards/local/` |
| `npm run desktop:dev` | the Electron app on the same code |
| `npm run checks` | the **fast tier**: typechecks, lint, the contract checks, parity, the unit tests. No browser, about fifteen seconds. It is also the pre-commit hook |
| `npm test` | the unit tests alone (`npm run test:watch` while you work) |
| `npm run e2e:docker` | the browser suite in the same Playwright Docker image CI uses |
| `npm run parity` | redraws `docs/PARITY.md` from `docs/parity.json` |

The server is a bundle (`server/dist/`). If you change `server/`, `src/board/`, `src/dsl/`,
`src/note/`, `src/quiz/` or `src/table/`, rebuild it and restart the server before you trust a test of
server behaviour; `npm run dev` only builds when nothing is listening on its port.

To understand the code before changing it, read [`CLAUDE.md`](CLAUDE.md) (a short map: the layers, the
rules, which file covers which area) and then the matching file in
[`docs/architecture/`](docs/architecture/README.md). It records the traps people have already fallen
into, and it saves you from most of them.

## Where to start

- Issues labelled [`good first issue`](https://github.com/mouhcineToumi/anydag/labels/good%20first%20issue)
  are small and well defined; [`help wanted`](https://github.com/mouhcineToumi/anydag/labels/help%20wanted)
  are open to anyone. Both labels go on issues that are already `status: ready`.
- Questions and half-formed ideas belong in
  [Discussions](https://github.com/mouhcineToumi/anydag/discussions), not in issues.
- The grammar for every diagram type is in [`docs/dsl/`](docs/dsl/); the boards in
  `boards/local/reference/` show each one drawn.

## How an issue becomes work

AnyDag accepts work **before** it is done, not after. A pull request that arrives without an accepted
issue is likely to be closed, however good it is, because the cost of that is a contributor's time and
nobody wants to spend it.

1. **Open an issue** from one of the forms (bug, feature or docs). It gets `status: triage`.
2. **The maintainer reads it** and sets one of:
   - `status: ready` — it meets the Definition of Ready below. Anyone may pick it up.
   - `status: needs-info` — something in the Definition of Ready is missing; the issue says what.
     Answer it and the issue goes back to triage.
   - or closes it, with a reason, if it is out of scope. Several things are refused on purpose; the
     architecture files say which, under *Deliberately out* and at the end of each feature.
3. **Pick up a `status: ready` issue** and comment that you are on it. The maintainer moves it to
   `status: in-progress`. If it is already in progress, ask first.
4. **Open a PR** that closes it. If you get stuck or the plan changes, say so on the issue instead of
   going quiet; `status: blocked` is a normal state.

**CI enforces this.** A PR into `develop` must say `Closes #N` for a `status: ready` issue. The only
exceptions are PRs by the maintainer, by bots, and PRs the maintainer has labelled `no-issue`. Small
things that need no discussion — a typo, a broken link — are still issues; they are quick to triage,
or the maintainer may label the PR `no-issue` instead.

Labels, in case you want to filter: `status: …`, `type: bug|feature|docs|chore`, `area: …` (canvas,
dsl, notes, tables, quizzes, tasks-calendar, sync, desktop, cli-mcp, assistant, ci) and
`size: S|M|L`. The definitions are in [`.github/labels.yml`](.github/labels.yml).

## Definition of Ready (for an issue)

An issue is ready when somebody who has never seen the conversation could pick it up and know when
they are finished. It has:

- [ ] **A clear problem or user need** — what is wrong or missing, and for whom. Not only a solution.
- [ ] **The expected behaviour**, in a sentence or two.
- [ ] **For a bug:** steps to reproduce, what happened instead, the AnyDag **version** (Settings →
      About), and your **OS** — plus whether it is the desktop app or `anydag serve`, and a board,
      note or screenshot if that shows it.
- [ ] **For a feature:** the **scope**, and explicitly **what is out of scope**, so a PR knows where
      to stop.
- [ ] **Acceptance criteria** — a short checklist a reviewer can tick.
- [ ] **An `area:` label** (the maintainer sets it if you do not know).
- [ ] **No open design question.** If the issue still needs a decision — which of two approaches, whether
      the feature should exist — it is not ready; that discussion happens first, in the issue or in
      Discussions.

The issue forms ask for exactly these.

## Branches

AnyDag uses Git Flow.

| Branch | Is | Rule |
|---|---|---|
| `develop` | the default branch; the next release in progress | every PR targets it |
| `main` | released code only | changes only through a PR from `release/X.Y.Z` or `hotfix/X.Y.Z` |
| `release/X.Y.Z` | a stable release being cut | cut from `develop`; kept for history |
| `hotfix/X.Y.Z` | a fix to a released version | cut from `main`; merged to `main` and back to `develop` |
| `nightly/<version>` | a nightly build, made automatically from `develop` | you never touch these |
| your branch | one issue | `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `docs/…`, `chore/…`, `refactor/…`, `test/…`, `ci/…` |

Examples: `feat/231-table-csv-export`, `fix/142-note-title-focus`, `docs/contributing`.

- **Branch from `develop`**, and keep your branch up to date by merging or rebasing `develop` into it
  before you ask for review.
- **Branches are not deleted after a merge**; they are history. Do not delete yours.
- **Do not commit to `main` or `develop`**, and do not rewrite history on a shared branch.
- Merges into `develop` are **squash** merges, so your PR title becomes the commit. A long-lived branch
  that develops an independent component may be merged with a merge commit; the maintainer decides.
- Work from a fork if you do not have write access; the same names apply.

## Making the change

1. Keep the PR to **one issue and one concern.** If you find another bug on the way, open an issue.
2. **Follow the layers.** Each directory owns something and must not know about others
   ([`docs/architecture/layers.md`](docs/architecture/layers.md)). The two rules that matter most:
   - **No colour in `src/`**, and no length or SVG style value on the diagram surface. A colour comes
     from `var(--dag-color-…)` or `theme.color.…`; a size from `theme.metric.…`. `check:theme` and
     `check:literals` enforce it. Do not edit the colours in `themes/*/theme.json`.
   - **`src/board/`, `src/dsl/`, `src/note/`, `src/quiz/` and `src/table/` are plain Node**: no browser
     APIs and no `@/` aliases, because the server and the CLI bundle them.
3. **Write the test first or with the change.** Unit tests are in `test/`, browser checks in `e2e/`. A
   bug fix includes a test that fails without it.
4. **Commit as you go** with [Conventional Commits](https://www.conventionalcommits.org/) messages.
   The pre-commit hook runs `npm run checks`; if it fails, fix the cause rather than skipping it.
5. **Screenshots.** The visual baselines are compared against one pinned Chromium in Docker. They are
   updated only deliberately, with `--update-snapshots=all` inside the Docker runner, and every
   changed image is looked at and defended in the PR. A baseline that moves when you did not mean to
   move pixels is a regression, not something to regenerate.
6. **Touching a new route, `anydag` command or MCP tool?** Add its line to
   [`docs/parity.json`](docs/parity.json) in the same commit and run `npm run parity`. The checks fail
   without it. `anydag` itself is an admin tool (vault, serve, mcp, sync, trash, telemetry, snapshot and
   export, diagnostics, basic document commands); new capabilities for agents go in the MCP server
   (`anydag mcp`).
7. **Using an AI agent?** That is fine, and nothing needs to be disclosed. You are still the author of
   what you submit: you have read the diff, run the checks, and the PR follows this page. The agents'
   own instructions are in [`AGENTS.md`](AGENTS.md).

## Definition of Done (for a pull request)

- [ ] It **closes a `status: ready` issue** (`Closes #N` in the description).
- [ ] The **title is a Conventional Commit** (see below).
- [ ] **`npm run checks` is green**, and CI is green.
- [ ] **Tests are added or updated**, including a regression test for a bug.
- [ ] **Docs are updated:** the matching file in `docs/architecture/`, `docs/dsl/` for grammar, and
      `skills/anydag/` for anything an agent drawing on the canvas must know (`check:skill` holds the
      skill to the code). User-visible changes are described in the PR so they reach the release notes.
- [ ] **`docs/parity.json` is updated** for any new or renamed route, command or MCP tool, and
      `docs/PARITY.md` redrawn.
- [ ] **Screenshots changed only on purpose**, regenerated in Docker, and reviewed.
- [ ] No colour literals, no secrets, no unrelated changes, no new dependency without a reason in the PR.
- [ ] You tried it: the change works in the running app, not only in the tests.

## Pull requests and review

**Title format** — [Conventional Commits](https://www.conventionalcommits.org/), checked by CI:

```text
<type>(<scope>): <what changed, in the imperative, lower case>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. The scope is optional and
follows the `area:` labels: `canvas`, `dsl`, `notes`, `tables`, `quizzes`, `tasks-calendar`, `sync`,
`desktop`, `cli-mcp`, `assistant`. Examples: `feat(notes): add a table of contents block`,
`fix(canvas): keep the pick when a card is resized`, `docs: describe the nightly channel`. A breaking
change adds `!` (`feat(dsl)!: …`) and says what breaks. The title becomes the squash commit and the
release note, so write it for someone reading a changelog.

**The description** uses the template: `Closes #N`, what changed, and how you checked it.

**Review**

- **Every PR from someone other than the maintainer needs the maintainer's approval** (it is the
  code owner of everything, see [`.github/CODEOWNERS`](.github/CODEOWNERS)); the maintainer can also
  merge their own PRs without one.
- The maintainer reviews in their own time. If you have heard nothing for a while, a polite nudge on the
  PR is welcome.
- Review is about the code, never the person. Feedback is concrete and may ask for a smaller PR, a
  test, or a different approach; ask if it is not clear.
- Answer comments with **new commits** on the same branch, so the history of the review stays readable.
  Do not force-push over a review in progress. Mark conversations resolved when you have addressed them.

## Releases

Releases are cut by the maintainer, from branches, with a changelog generated from the merged PR
titles. **Nightly** builds are made automatically from `develop` and published as pre-releases named
`X.Y.Z-nightly.YYYYMMDDHHmm`, each on its own `nightly/<version>` branch; they are for trying what is
coming and may be broken. **Stable** releases are cut on a `release/X.Y.Z` branch, merged to `main`
by PR and tagged `vX.Y.Z`; a fix to a stable release goes on `hotfix/X.Y.Z`. The full procedure,
including how the version is bumped, is in [`docs/RELEASING.md`](docs/RELEASING.md).

## Licence

By contributing you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
