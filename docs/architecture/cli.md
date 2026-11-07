# The command line, MCP and parity

> `anydag`, the MCP server, and the manifest that holds routes, commands and tools in step.

## The command line

`cli/`. `npm link` in the repository puts `anydag` on the PATH, or `npm run anydag -- <command>`
runs it; `anydag help` is the table and `anydag help --json` the same as data.

| Where | Owns |
|---|---|
| `cli/anydag.mjs` · `cli/build.mjs` | the launcher, and the bundle it rebuilds when `dist/meta.json` lists a source newer than it |
| `cli/main.ts` · `cli/args.ts` | which command the words name, and a parser that reads `-40` as a number |
| `cli/api.ts` · `server/connect.ts` | the one door to the server — a failure becomes an exit code — and finding it: the running app's `server.json`, or the server in-process on `--vault` |
| `cli/board.ts` | load, parse, and `mutate`: read, compute, write under the base, recompute once on a 409 |
| `cli/ops.ts` · `cli/inside.ts` | the gestures as text arithmetic — items, pages and links; the cards, edges, rows and a chart inside one diagram |
| `cli/commands/` | one file per group, each command declaring the routes it reaches |

Six things are load-bearing:

- **It is a client of the routes, never of the disk.** With the app running it reads
  `server.json` in the app's home and sends the token as a header; with none, `--vault <folder>`
  (or `ANYDAG_VAULT`, or the vault opened last) starts the same server in this process, on the same
  home and its SQLite index, so an id the CLI mints is the one the app will read. Either way a
  write goes through the store, its sha1 base and its watcher — which is why it never writes a
  vault's file with `fs` even though it could.
- **It runs the page's code, not a copy.** `src/board/` and `src/dsl/` come in verbatim, as the
  server takes them, and the pointer-free half of `src/edit/` through the `@/` alias esbuild reads
  from `tsconfig.json`. Where the page's logic is private to `useEditor` — `insert`, `freshId`, the
  page list, `anchorAt` — it is restated in `cli/ops.ts` and says so. **The bundle is the grammar of
  the checkout it was built from**, which is why the launcher checks `meta.json`'s inputs on every
  run; a CLI carrying last week's `restate.ts` would write lines this week's parser disagrees with.
- **A 409 recomputes, never re-sends.** Every gesture is a function of the board's text, so `mutate`
  runs it again over the text the conflict carried. The page retries the *same* ops, which re-sends a
  body written from the old text over the other writer's change to that item; here it cannot.
  `board write` is the one whole-text write and wants `--base` or `--force`; `board edit` merges with
  `merge3` and keeps your text aside when both of you changed a line.
- **Parity is a closed set.** Every route `server/routes/` declares is reached by some command's
  `routes` or is in `REFUSED` with a reason, and every route a command claims exists. `REFUSED` is
  read out of `docs/parity.json`, which holds the same set across the MCP tools too (*Parity*).
  `check-skill.mjs`'s eighth set holds the skill's `anydag …` lines to `anydag help --json`, and
  every command group to being named at least once.
- **The picture is the page's.** `snapshot`, `tidy`, `board export --format svg|png` and `note
  export --format pdf` open the page in Playwright with the token as its cookie under
  `?snapshot=1`, the way `scripts/snapshot.mjs` does. Export goes through `dag:export`, a document
  event whose `detail.reply` gets the SVG's text or the PNG as a data URL — a callback rather than a
  data attribute, because an SVG with its fonts is megabytes — so the file is the Export menu's to
  the byte. A note's PDF replies with a title rather than the file: the page sets the sheet out and
  Chromium's `page.pdf()` prints it. Playwright is `external` in the bundle and imported only there.
- **What reads the laid-out page is refused, with its headless spelling beside it.** Detach, the
  structural drag, a `+` in a fixed fence, a lone shape's handles and the pen read `data-dag-layout`
  or a pointer; `node move` is `moveStatement` without the drop, `node add --at` writes the
  coordinate, `node set w= h=` sizes a shape. A position written on a page with unpositioned items
  says those will re-flow, because the page's answer — pin them where they are drawn — needs sizes
  only a browser has measured.

Exit codes are the snapshot script's, and every command's `--json` is the route's own answer: `0`
done · `1` refused · `2` usage · `3` a conflict, or untidy under `--check` · `4` errors · `5` not
ready · `6` no server · `7` no vault. Names claimed, grepped first: the `dag:export` event, and
nothing in the DOM.

**A route's new body field is a parity gap no route list can see.** `/rmdir`'s `recursive: true`
arrived after the CLI was written: the route was already reached, so the closed set was satisfied
while `folder rm` went on saying *never recursive* about a thing the app did. It is `folder rm -r`,
which counts what is inside from `/list` and asks, and wants `--yes` without a terminal. Read the
diff of `server/routes/` when rebasing over a change to it.

**`anydag mcp --vault <folder>`** is the MCP server (`server/mcp/`) over stdio, on the same door:
the running app's server through `server.json`, or one in this process. It is a command because it
is the same connection, and it speaks on stdout, so it takes no `--json`. See *Parity*.

**Out, and why:** undo (the page's history is the tab's memory, and `board write --base` with an
earlier text is the same act). `login` and `logout`, because there is no account to sign into, and
`share` and `feedback`, because there is no share link or feedback card for them to reach.

## Parity

`docs/parity.json`. The local server is reached three ways — the routes
the page calls, the `anydag` CLI and the MCP server — and the manifest is one line per feature: the
routes, the commands and the tools that reach it, or for any of the three `{"via": […], "why"}`
(covered by something more general) or `{"refused": "…"}`. `docs/PARITY.md` is the matrix drawn
from it by `npm run parity`. **A feature with nothing for one interface is a gap, and a gap is a red
test.**

| Where | Holds |
|---|---|
| `test/parity.test.ts` | the manifest against the routes (regex over `server/routes/`), the commands (`COMMANDS`, with each one's `routes`) and the tools (`TOOLS` from `server/mcp/tools.ts`), both ways; a feature's commands between them declare its routes; `PARITY.md` is current; `REFUSED` is the manifest's |
| `check-skill.mjs` | the skill's *Through MCP* section names every tool, read off `TOOLS` through esbuild |

Five things are load-bearing:

- **A tool calls its route** (`server/mcp/`): every tool runs the route with the body the page would
  send — in-process, or over loopback with the token — and turns the answer, or the refusal, into a
  tool's. So a rule changed in a route changes for the tool too, and the manifest is only ever a
  map. A tool's URL is an `anydag://open?…` deep link the desktop app opens.
- **A gesture inside a diagram is text on MCP.** The CLI's ~45 commands that pick a card, an edge, a
  row, a page or a link compute a patch with the page's TypeScript; an agent writes the DSL itself
  through `board_patch` and `board_write`. The manifest marks each `via`.
- **Notes and quizzes have tools of their own** — `note_*`, `quiz_*` — over a `kind` on the board
  tools. Renaming a tool breaks every client connected, so names stay.
- **What stays refused is what cannot work or must not be an agent's**: a snapshot, a tidy and an
  export need a browser; a change feed is a stream. Everything else is a tool, with a `confirm`
  naming the thing wherever the page would have asked in a modal — emptying a folder, closing a vault.
- **The grammar's answers are recorded, not written.** `test/fixtures/dsl-answers.json` is the
  grammar's own answers to the routes the tools reach, held to the live handler by
  `test/dsl-service.test.ts` — the rule *Things that will bite* states about stubs, made mechanical.

**Definition of done:** a new route, command or tool is a line in `docs/parity.json` in the same
commit, and `npm run parity` redraws the matrix — the checks fail otherwise, on every commit.
