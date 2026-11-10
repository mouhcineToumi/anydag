# AnyDag

A **local desktop app** that replaces Obsidian: open a folder — a **vault** — and its notes, boards,
quizzes, tables, tasks and attachments are listed, edited, linked and searched, with no account and no
cloud. Everything is a plain file in that folder; the app keeps only rebuildable indexes outside it.
This file is the short map for anyone working on the code, person or agent. The long account — what
each layer owns, the rules the gate holds, the traps — is in [`docs/architecture/`](docs/architecture/README.md),
split by area. **Read the file for the area you are changing before you change it.** Contributor
workflow (issues, branches, PRs) is in [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What it is

- **An infinite canvas that renders technical diagrams from a DSL** — fourteen types: twelve grammars
  for a kind of system (`erd flow arch state activity class usecase sequence c4 mindmap timeline gitgraph`),
  `sketch` (the author places everything) and `chart` (data) — plus markdown, tables and images.
  **An agent drives it by writing a file**, `<vault>/<name>.board.md`; the server watches the vault and
  the page re-renders. In this checkout the development vault is `boards/local/`.
- **A person edits the same file with the pointer** — select, move, retype a card where it is drawn,
  grow the next card with its edge attached, drag into a group. Every gesture is a write to the board
  file, so the file has **two writers and neither can take a lock** (a sha1 `base` on every write, a
  409 on a stale one, `merge3` for text).
- **Notes** (any `.md`, BlockNote editor that rewrites only the block it touched, `[[wikilinks]]`,
  `$equations$`), **quizzes** (`.quiz.md`), **tables** (`.table.md`), **tasks** / **projects** /
  **events** (a note with `status:`, `project:` or `start:`), **attachments**, a **calendar**, a
  **trash** (nothing is deleted at once), several **vaults** in one server, an end-to-end-encrypted
  **sync** server, a read-only **lock**, **opt-in anonymous logs**.
- **Prompt cards** and the **Assistant** run a model through the person's own Claude Code, OpenCode
  login or API key; the real parser checks what comes back before it lands.
- **Everything the page can do, an agent can do through the MCP server** (`anydag mcp`), held in step
  by `docs/parity.json`. The `anydag` CLI is an admin tool — vaults, whole files, sync, trash,
  snapshots and exports — not a second copy of the app (`docs/architecture/cli.md`).

**Three ways to run it:** the desktop app (`desktop/`, Electron, spawns the server and loads the page
through `anydag://`); `anydag serve <folder>` (a browser on this machine); and `npm run dev` →
<http://localhost:3500/?board=demo> (Vite in front of the server on `boards/local/`, `.dev-home/` as
the app's home).

## Commands

- `npm ci` — install (Node ≥ 24.7); it also installs the git hooks.
- `npm run dev` — Vite + the local server. `npm run desktop:dev` — the Electron app.
- `npm run checks` — the fast tier: Biome lint and format check, knip, typechecks, the `check:*` contracts, parity, the
  unit suite. No browser, about half a minute. **Run it before every push**; it is also the pre-commit hook.
- `ANYDAG_CLOUD_BUILD=on|off` and `ANYDAG_CLOUD=on|off` — the build's feature switch (`server/features.ts`,
  see *Feature switches* in `docs/architecture/server.md`): whether the app carries the features that talk to
  an AnyDag server (sync, anonymous logs, feedback). Off unless a build says on — no release does — and the
  run-time override wins. Dev and the test suites run on.
- `npm run e2e:smoke` / `npm run e2e:docker` — the Playwright suite's smoke tier / all of it, in the
  pinned Playwright Docker image, screenshots compared. `npm run e2e:local` is the host browser and
  compares none (see *Gate* below).
- `npm run parity` — redraw `docs/PARITY.md` after touching `docs/parity.json`.
- `node scripts/snapshot.mjs <board>` — render a board and print its diagnostics.

## The layers, and what each may not know

| Layer | Owns | Must not know |
|---|---|---|
| `src/board/` | the `.board.md` format, fences, attrs, edit ops, item ids, links | diagrams, the browser |
| `src/edit/` | selection, the pick inside a diagram, gestures, clipboard, undo, the panel | the format (it emits ops), the grammar (it calls `src/dsl/` span writers) |
| `src/dsl/` | tokenizer, a parser per type → IR, span writers, diagnostics with line:col | pixels, colours, the pointer |
| `src/layout/` | sizing, ELK config, routing, the six layouts that are not ELK's | React, CSS |
| `src/render/` | a component per node kind, markers, groups, the frame | how it was laid out |
| `src/theme/` | `theme.json` → `--dag-*` vars | everything else |
| `src/export/` | one item as a standalone SVG | anything about boards |
| `src/quality/` | measuring a finished layout | how it got there |
| `src/settings/` | app preferences, their sync, and the rule a snapshot reads none | diagrams, the board format |
| `src/auth/` | the one local user (`/api/auth/me`), the gate | boards; there is no sign-in |
| `src/note/` | `.note.md`: frontmatter, Markdown ↔ blocks through remark, span map, `merge3`, `math.ts` | browser, React, the board format |
| `src/quiz/` · `src/table/` | `.quiz.md` / `.table.md`: parser, codes, one-span writers | browser, React (server and CLI import them verbatim) |
| `src/files/` · `src/ui/table/` | attachments on the page · a table's grid and editors | what a file is (the server decides) · the format |
| `src/blocks/` | BlockNote configured once, loaded lazily | which file it writes |
| `src/view/` | drawing read-only: `?view=1`, snapshots, embeds | `src/edit/`, BlockNote (`test/view-graph.test.ts` holds it) |
| `src/refs/` · `src/calendar/` · `src/vault/` | what a reference is · what the calendar shows · which vault this tab is in | names (a reference is an id) · the DOM · the disk |
| `src/search/` · `src/telemetry/` · `src/assistant/` · `src/sync/` | the page's half of search, logs, the Assistant, sync status | what a log may hold (`api/protocol/logs.ts` decides) · the harness · the server's storage |
| `icons/` | the brand vocabulary and its provenance | anything about diagrams |
| `cli/` | `anydag`: arguments, finding the server, commands as op lists | the disk: every read and write is a route |
| `server/` | the local server: token and `Host` gate, vault store, home and SQLite index, routes, MCP tools, `chat/`, `sync/` | React, the DOM |
| `desktop/` | the Electron shell: server child, `anydag://`, windows, dialogs, updates | the vault's format |
| `api/` | the api server: the self-hostable sync server and the wire/crypto protocol shared with the client, plus logs and the feedback relay | a path, a byte of plaintext |


`src/edit/` splits along one line: **the gesture is in `useEditor.ts`, the meaning is in a file with
no pointer in it** (`pick.ts`, `build.ts`, `drag.ts`, `connect.ts`, `snap.ts`, `history.ts`), which
is what makes a drop testable without a browser. Full tables: [`layers.md`](docs/architecture/layers.md).

**`src/board/`, `src/dsl/`, `src/note/`, `src/quiz/` and `src/table/` are bundled into the server and
the CLI** (plain Node, outside Vite): keep them free of browser APIs **and of `@/` aliases**. The
server is a bundle too (`server/dist/`): a change to any of them is not served until it is rebuilt.

## The rule that matters most

**No colour anywhere in `src/`, and no length or SVG style value on the diagram surface.** A colour is
`var(--dag-color-…)` or `theme.color.…`; a size is `theme.metric.…`. That is what makes a theme a
folder rather than a refactor. `scripts/check-theme.mjs` (every `--dag-*` read exists in every theme)
and `scripts/check-literals.mjs` hold it in the gate. The app chrome is exempt and lives in
`src/styles/chrome.css`. Do not edit the colours in `themes/*/theme.json` to make a check pass.

## The bites to know before you start

One line each; the full account with the defect that found it is in
[`things-that-will-bite.md`](docs/architecture/things-that-will-bite.md) unless a link says otherwise.

- **Chrome and diagram share one class and `data-dag-*` namespace, and the diagram wins.** `grep`
  `src/styles/` and the attribute before inventing a name; it has bitten five times and nothing fails.
- **Sizing must never read the DOM** (`layout/size.ts` is arithmetic plus canvas `measureText`), and
  **fonts change every width**: layout keys include `measurer.generation`; `data-dag-ready` means finished.
- **`elk.bundled.js` is the wrong import** — use `elk-api.js` + `elk-worker.min.js?worker`.
- **A snapshot reads no preference** (`?snapshot=1`), and `main.tsx` loads every font face by name first.
- **Opening a vault never writes a byte of it**; an id is minted only when something links the file.
- **Every write carries a sha1 `base`**; a stale one is a 409 with the text that replaced it.
- **Undo is a version of the file**, not an inverse op. Gestures paint, then commit once.
- **The board is one round trip stale after a write** — e2e specs wait on the DOM, not only the file.
- **BlockNote never parses or writes a byte of a note** — `src/note/markdown.ts` (remark) does. See
  [`notes.md`](docs/architecture/notes.md).
- **ProseMirror redraws any attribute it did not set**: marks inside the editor are CSS highlights.
- **A choice between document kinds is a `switch` ending in `assertNever`**, never `kind === "note" ? … : board`.
- **A stub is a claim about another module**; copy it from a route's recorded answer, never invent it.
- **The token and the `Host` are the whole security model** — both checked on every request; a script
  that `fetch`es the server needs `authed()` from `scripts/session.mjs`.
- **The repository is public, so a committed secret is a published one.** Secrets live in the
  environment or a git-ignored `*.local`/`.env.*`; `scripts/secrets.sh` (gitleaks) refuses them in the
  hook and CI. If one is pushed, revoke it first ([`SECURITY.md`](SECURITY.md)).
- **A cleanup that matches by prefix must refuse an empty one** — a spec once emptied `boards/local/`.
- **A screenshot baseline is valid only in the Playwright Docker image.** Regenerate with
  `npm run e2e:docker -- --update-snapshots=all`, read a sample, and commit the images on their own.
- **Measure flakes at no more workers than the machine has cores.**
- **The unit suite shares modules between files** (`isolate: false`): put back any global you stub.
- **A new route, command or MCP tool is a line in `docs/parity.json` in the same commit.**
- **`check:skill` holds `skills/anydag/SKILL.md` to the code**; in its *Through MCP* section any
  backticked word with an underscore is read as a tool name.

## Which file to read for which area

| You are changing… | Read |
|---|---|
| anything, first | [`overview.md`](docs/architecture/overview.md), [`layers.md`](docs/architecture/layers.md), [`things-that-will-bite.md`](docs/architecture/things-that-will-bite.md) |
| the grammar, layouts, themes, `data-dag-ready` | [`design-and-layout.md`](docs/architecture/design-and-layout.md), [`diagnostics.md`](docs/architecture/diagnostics.md) |
| `chart` · `sketch`, shapes, pen, pictures · links between items | [`charts.md`](docs/architecture/charts.md) · [`free-canvas.md`](docs/architecture/free-canvas.md) · [`links.md`](docs/architecture/links.md) |
| a gesture, the pick, the panel, the leader key | [`editing.md`](docs/architecture/editing.md), [`editing-drag.md`](docs/architecture/editing-drag.md), [`groups-guides-tidy.md`](docs/architecture/groups-guides-tidy.md) |
| the component library · export and import · icons | [`library.md`](docs/architecture/library.md) · [`import-export.md`](docs/architecture/import-export.md) · [`icons.md`](docs/architecture/icons.md) |
| pan and zoom · the sidebar, file tree, tabs | [`getting-around.md`](docs/architecture/getting-around.md) · [`sidebar.md`](docs/architecture/sidebar.md) |
| notes, equations | [`notes.md`](docs/architecture/notes.md) |
| tasks, projects, the calendar, time zones | [`tasks-projects-calendar.md`](docs/architecture/tasks-projects-calendar.md) |
| quizzes · tables · attachments | [`quizzes.md`](docs/architecture/quizzes.md) · [`tables.md`](docs/architecture/tables.md) · [`attachments.md`](docs/architecture/attachments.md) |
| ids, `dag:` references, embeds, backlinks, wikilinks, `?view=1` | [`references.md`](docs/architecture/references.md) |
| search · the trash · the lock | [`search.md`](docs/architecture/search.md) · [`trash.md`](docs/architecture/trash.md) · [`lock.md`](docs/architecture/lock.md) |
| settings and preferences | [`settings.md`](docs/architecture/settings.md) |
| prompt cards, rewriting a diagram with a model | [`prompt-cards.md`](docs/architecture/prompt-cards.md) |
| the `anydag` CLI, the MCP server, `docs/parity.json` | [`cli.md`](docs/architecture/cli.md) |
| the local server, vaults, the token gate | [`server.md`](docs/architecture/server.md) |
| the Electron shell, packaging, signing | [`desktop.md`](docs/architecture/desktop.md) |
| the api server, its features, config and deployment | [`api.md`](docs/architecture/api.md), [`sync.md`](docs/architecture/sync.md) (the client half) |
| sync (client) | [`sync.md`](docs/architecture/sync.md) |
| the Assistant (chat) | [`assistant.md`](docs/architecture/assistant.md) |
| anonymous logs | [`logs.md`](docs/architecture/logs.md) |
| Send feedback, the feedback relay | [`feedback.md`](docs/architecture/feedback.md) |
| the gate, CI, releases | [`gate-and-releases.md`](docs/architecture/gate-and-releases.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), `docs/RELEASING.md` |

Section names in italics inside those files (*Picking a node*, *The time zone*) are listed with their
file in the index at the foot of [`docs/architecture/README.md`](docs/architecture/README.md).
Other reference material: `docs/dsl/` (the grammar, one sheet per type), `docs/generate/` (the prompt
card's system prompt), `docs/parity.json` and `docs/PARITY.md`, `skills/anydag/` (the agent skill),
`icons/README.md`, `desktop/README.md`, `site/README.md` (the landing page at anydag.com).

## Gate

The pre-commit hook first runs `scripts/secrets.sh` (gitleaks over the staged change; CI's `secrets`
job and the nightly run it too). `npm run checks` is the fast tier (Biome lint and format check, knip, typecheck of all three tsconfigs, `check:version`,
`check:case`, `check:theme`, `check:literals`, `check:icons`, `check:skill`, `test/parity.test.ts`,
vitest). It needs no browser and is the pre-commit hook; CI also runs `npm run lint:promises`. The
Playwright suite is the slow tier and runs in the pinned Docker image, locally (`npm run e2e:docker`)
and in CI (`e2e.yml`: `@smoke` on a pull request, everything on a push); pre-push runs only what the
push can have changed. Update baselines only deliberately, and read them. The required checks are
`CI passed`, `e2e`, `PR title`, `PR target` and `Linked issue`. Hooks never stash; do not `--no-verify` past a failure, fix the cause. Details: [`gate-and-releases.md`](docs/architecture/gate-and-releases.md).

## Working on a change

Only pick up an issue labelled `status: ready`; branch from `develop` as `feat/<issue>-<slug>`,
`fix/…`, `docs/…` and so on; open the PR against `develop` with a Conventional Commits title and
`Closes #<issue>`. Never commit to `main` or `develop` directly. The full rules are in
[`AGENTS.md`](AGENTS.md) (short) and [`CONTRIBUTING.md`](CONTRIBUTING.md) (complete).
