# The command line, MCP and parity

> `anydag`, the admin CLI; the MCP server; and the manifest that holds routes, commands and tools in step.

## The command line

`cli/`. `npm link` in the repository puts `anydag` on the PATH, or `npm run anydag -- <command>` runs
it; `anydag help` is the table and `anydag help --json` the same as data.

**It is the admin CLI**, for a person or an agent that administers a vault. It does not mirror the
app: everything finer than a whole file — an item, a card, an edge, a quiz question, a table cell, a
task's status, search, the library, the Assistant — is the page's and MCP's, and MCP (`anydag mcp`,
`server/mcp/`) is the interface in full parity with the app. What stays: `mcp`, `serve`, `whoami`;
`vault ls|open|create|close|transfer`; `ls`; for `board`, `note`, `quiz` and `table` `new|cat|write|mv|rm`;
`board diagnose`, `quiz check`, `table check`; `folder new|mv|rm`; `file upload|ls|get|mv|rm`; `trash`;
`sync`; `snapshot`, `tidy`, `board export`, `note export` (the things only a laid-out page can answer,
which MCP cannot); `telemetry`; `settings`. The `sync` group and `telemetry` are behind the build's
`cloud` switch (`server/features.ts` — see *Feature switches* in [`server.md`](server.md)): a build
without them leaves them out of every help table and answers both with one line, because the server
they reach says the switch is off.

| Where | Owns |
|---|---|
| `cli/anydag.mjs` · `cli/build.mjs` | the launcher, and the bundle it rebuilds when `dist/meta.json` lists a source newer than it |
| `cli/main.ts` · `cli/args.ts` | which command the words name, and a parser that reads `-40` as a number |
| `cli/api.ts` · `server/connect.ts` | the one door to the server — a failure becomes an exit code — and finding it: the running app's `server.json`, or the server in-process on `--vault` |
| `cli/board.ts` | the four kinds, how a kind goes on the wire, and a board's diagnostics printed one per line |
| `cli/commands/` | one file per group (`docs`, `files`, `trash`, `sync`, `vault`, `picture`, `app`), each command declaring the routes it reaches |

Six things are load-bearing:

- **It is a client of the routes, never of the disk.** With the app running it reads `server.json` in the
  app's home and sends the token as a header; with none, `--vault <folder>` (or `ANYDAG_VAULT`, or the
  vault opened last) starts the same server in this process, on the same home and its SQLite index, so
  an id the CLI mints is the one the app will read. A write goes through the store, its sha1 base and
  its watcher, which is why it never writes a vault's file with `fs` even though it could.
- **The bundle is the grammar of the checkout it was built from**, which is why the launcher checks
  `meta.json`'s inputs on every run. `src/board/`, `src/note/`, `src/quiz/` and `src/table/` come in
  through the server's own modules.
- **A whole-text write carries its base and is never re-sent.** `<kind> write` wants `--base` (what
  `cat --json` printed) or `--force`; a 409 is exit 3 naming the base it lost to. There is no
  read-modify-write any more, so nothing recomputes an edit.
- **The accounting is a closed set.** Every route `server/routes/` declares is reached by some
  command's `routes`, refused (`REFUSED`), or held only by features marked `{"admin": false}`
  (`OUTSIDE`), all read out of `docs/parity.json` (see *Parity*). `check-skill.mjs`'s eighth set holds
  the skill's `anydag …` lines to `anydag help --json` and every command group to being named, so the
  skill cannot keep teaching a command that was removed.
- **The picture is the page's.** `snapshot`, `tidy`, `board export --format svg|png` and `note export
  --format pdf` open the page in Playwright with the token as its cookie under `?snapshot=1`, the way
  `scripts/snapshot.mjs` does. Export goes through `dag:export`, a document event whose
  `detail.reply` gets the SVG's text or the PNG as a data URL. A note's PDF replies with a title and
  Chromium's `page.pdf()` prints it. Playwright is `external` in the bundle and imported only there.
- **Stdin is read when it is named, never because it is not a terminal.** The usual shortcut hangs for
  ever under a parent that starts a command with a pipe it never closes. Every command that takes text
  takes `--file`, and `--file -` is stdin.

Exit codes are the snapshot script's, and every command's `--json` is the route's own answer: `0` done ·
`1` refused · `2` usage · `3` a conflict, or untidy under `--check` · `4` errors · `5` not ready · `6`
no server · `7` no vault. Names claimed, grepped first: the `dag:export` event, and nothing in the DOM.

**A route's new body field is a parity gap no route list can see.** `/rmdir`'s `recursive: true` arrived
after the CLI was written: the route was already reached, so the closed set was satisfied while `folder
rm` went on saying *never recursive* about a thing the app did. It is `folder rm -r`. Read the diff of
`server/routes/` when rebasing over a change to it.

**`anydag mcp --vault <folder>`** is the MCP server (`server/mcp/`) over stdio, on the same door: the
running app's server through `server.json`, or one in this process. It speaks on stdout, so it takes no
`--json`. See *Parity*.

**Out, and why:** every gesture inside a document and every feature of the app beyond administering a
vault (MCP has them); undo; `login`/`logout` (no account); `share` (nothing to reach); `feedback`
(the MCP `feedback` tool sends it when the person asks; sending feedback is not administering a vault).

## Parity

`docs/parity.json`. The local server is reached three ways — the routes the page calls, the `anydag`
CLI and the MCP server — and the manifest is one line per feature: the routes, the commands and the
tools that reach it, or for any of the three `{"via": […], "why"}` (covered by something more general)
or `{"refused": "…"}`. `docs/PARITY.md` is the matrix drawn from it by `npm run parity`.

**The columns are not symmetric.** REST and MCP are complete: a feature with nothing for either is a
gap, and a gap is a red test. The CLI is an admin tool, so a feature it does not carry says
`{"admin": false}` in its CLI column (a `·` in the matrix) — valid there alone; on a route or a tool it
is an error. Adding a feature no longer means adding a command.

| Where | Holds |
|---|---|
| `test/parity.test.ts` | the manifest against the routes (regex over `server/routes/`), the commands (`COMMANDS`, with each one's `routes`) and the tools (`TOOLS` from `server/mcp/tools.ts`), both ways; a feature's commands between them declare its routes; `{"admin": false}` only in the CLI column; `PARITY.md` is current; `REFUSED` and `OUTSIDE` are the manifest's |
| `test/cli-routes.test.ts` | every route is reached by a command, refused, or outside the admin CLI; no command declares a route the API lacks |
| `check-skill.mjs` | the skill's *Through MCP* section names every tool, read off `TOOLS` through esbuild; its *Through the CLI* section names only commands that exist, and every group |

Five things are load-bearing:

- **A tool calls its route** (`server/mcp/`): every tool runs the route with the body the page would
  send — in-process, or over loopback with the token — and turns the answer, or the refusal, into a
  tool's. So a rule changed in a route changes for the tool too, and the manifest is only ever a map.
  A tool's URL is an `anydag://open?…` deep link the desktop app opens.
- **A gesture inside a diagram is an MCP tool, and not a CLI command.** An agent writes the DSL itself
  through `board_patch` and `board_write`; the CLI has neither. The manifest marks the CLI column
  `{"admin": false}`.
- **Notes and quizzes have tools of their own** — `note_*`, `quiz_*` — over a `kind` on the board tools.
  Renaming a tool breaks every client connected, so names stay.
- **What stays refused is what cannot work or must not be an agent's**: a snapshot, a tidy and an export
  need a browser (the CLI has them); a change feed is a stream. Everything else is a tool, with a
  `confirm` naming the thing wherever the page would have asked in a modal.
- **The grammar's answers are recorded, not written.** `test/fixtures/dsl-answers.json` is the grammar's
  own answers to the routes the tools reach, held to the live handler by `test/dsl-service.test.ts`.

**Definition of done:** a new route or tool is a line in `docs/parity.json` in the same commit; a new
CLI command is one only if it is admin work, and its routes are declared. `npm run parity` redraws the
matrix — the checks fail otherwise, on every commit.
