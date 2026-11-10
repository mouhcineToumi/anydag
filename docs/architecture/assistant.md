# The Assistant

> The chat about the vault, run on the person's own Claude Code or OpenCode.

## The Assistant

A chat about the vault, run on the person's **own** Claude Code or
OpenCode — their subscription, signed in on this machine — that answers with `dag:` citations and
makes and reorganises documents. There is no Ask/Edit switch: the chat's own vault is always read and
change, every change can be undone, and the scope menu grants another vault Read or Read and change
(#75). A panel down the right of any page (`space A`, the top
bar's sparkle) and a full page at `?chat=<id>|new|1` with the vault's chats down the side and the
chat's change blocks in a Changes column.

| Where | Owns |
|---|---|
| `server/chat/store.ts` | `<vault>/.anydag/chats/<id>/`: `chat.json`, one write-once file per turn, one per undo |
| `server/chat/record.ts` | a write's before-image, and undoing a block back to it |
| `server/chat/live.ts` | the `Assistant`: turns, the guard every chat request passes, approvals, grants, blocks, undo |
| `server/chat/claude.ts` · `opencode.ts` · `fake.ts` | one harness each: argv, environment, its event stream parsed into steps, resume, stop |
| `server/chat/models.ts` | what the picker offers, per provider, and why one is unavailable — `claudeReady` and `opencodeReady`'s own sentence |
| `plugins/generate/cli.ts` | what a prompt card's run and a chat's turn both do around a CLI child: its lines, ending it, and deleting a standalone OpenCode session |
| `server/mcp/chat.ts` | chat mode for `anydag-server mcp --chat <id>`: the tool list, `change_block`, `vault_request` |
| `server/routes/chat.ts` | the routes, the guard's registration, the SSE stream |
| `src/assistant/` | the panel, the page, the composer and its picker, the steps, the approval, access and block cards |

Ten things are load-bearing:

- **The app owns the conversation; the harness owns one turn.** A turn is one process (or, for
  OpenCode, one request to a `serve` the chat keeps), parsed into steps and written to disk when it
  ends. The provider's session id is this machine's and lives in SQLite, never in a turn file; the
  next turn resumes it only on the same provider and machine, and otherwise starts fresh **seeded
  with the transcript**. That one rule is what makes a mid-chat switch of provider work, and a chat
  continued on another device after sync.
- **The agent's only tools are ours.** Claude Code runs with its built-in tools off and a strict MCP
  config naming one server; OpenCode with every permission denied but `anydag_*`. That server reaches
  this one over loopback with the launch token and `x-anydag-chat: <id>` on every call, so every
  write goes through the route the page uses — the base sha1, the 409 and `merge3` included.
- **The MCP child is this process as Node, and in the desktop app that means keeping
  `ELECTRON_RUN_AS_NODE`.** `Live.mcpFor` starts it as `process.execPath` + `process.argv[1]` +
  `mcp --chat`, with the port, token and home in its environment, and the switch too when the parent
  has it. The desktop app runs the server as Electron-as-Node, so `process.execPath` is Electron;
  without the switch the child starts as an Electron app, cannot open a window (its env has no
  display) and dies before it answers MCP — which Claude Code records as `CONNECTION_CLOSED` and
  OpenCode as a server that never attached.
- **A turn that cannot use its tools fails, and nothing it guessed survives.** Claude Code's
  `system/init` is read for the `anydag` server's status and the `mcp__anydag__*` tools; OpenCode's
  `GET /api/mcp` is waited on for the same. Missing, failed or toolless fails the turn with one clear
  error. A reply holding `<invoke name=` or `<parameter name=` while no tool ran is logged (raw text
  only) and shown as that error, never stored as the answer. A failed turn keeps the person's
  message and the chat; one that ran no tool is not seeded as an assistant answer and drops its
  session so the next turn starts fresh, while one that failed after a tool ran (an overloaded API, a
  dropped connection) is seeded whole and resumed, because it did change the vault. Claude Code runs
  with `MCP_CONNECTION_NONBLOCKING=0`, so its init line is not sent while `anydag` is still
  `pending`.
- **The guard is the server's, never the prompt's.** Every request carrying `x-anydag-chat` passes
  `Assistant.guard` **before** the vault scoping: no running turn is 409 `no-turn`; a write route not
  on its list is 403 `chat-refused`; a vault the chat was not granted, 403 `not-granted`; a write to a
  vault granted to read, 403 `read-only` (the model is told to ask with `vault_request`, mode `edit`,
  which shows the access card that upgrades the grant). A delete, a folder move or trash, a
  transfer, an image sweep and a trash delete wait for the person on an approval card, and are
  403 `declined` on No or after five minutes.
- **The approval card is ours, not the harness's**: OpenCode reports a tool call only once it has
  finished, so a call blocked on the person is invisible in its stream. Each harness's own tool
  timeout is set above the approval's expiry.
- **Chat mode lists only the tools a chat may use**, rather than listing everything and refusing at
  call time: a listed schema is ~300 input tokens a request, and a tool the model can see is a tool it
  tries. `NEVER_IN_CHAT` leaves out opening, making or closing a vault, settings, sync, a second model,
  the quiz record, emptying the trash and uploads. **A document's eight everyday tools are one each
  with a `kind`** — `doc_list`, `doc_read`, `doc_create`, `doc_write`, `doc_rename`, `doc_duplicate`,
  `doc_delete`, `doc_title` stand for the per-kind tools in `FOLDED`, and a call is held to the named
  tool's own schema before it runs it — and a description loses the `vault` sentence the system prompt
  says once. The list went from 81 tools and about 15k tokens a request to 52 and 9.3k. The page and
  the CLI name a `doc_*` step by the tool its kind stands for
  (`verbOf`). Outside agents get **no** `chat_*` tools, and the per-kind names stay theirs;
  `docs/parity.json` says why.
- **Every file but `chat.json` is written once.** A running turn lives in memory and the SSE stream;
  undoing a block writes a new file under `undo/`, and a block's state is its last undo file by time.
  So sync never merges a turn, and `chat.json` merges by key — a grant is its own top-level
  `grant:<vaultId>` key and a revoke sets it to `null`, so neither side's grant is lost.
- **A block undoes to its before-images if each file is still what the block left**; a file changed
  since is listed as a conflict and left alone, the rest undone. A deleted file comes back from the
  trash, and undo is itself recorded, so it redoes. **A block is read back from the vault, so nothing
  in it is trusted**: every path it names — an image, a folder's entries, where a folder moved to — is
  confined again by the rule the recorder used (`planOf` in `server/chat/record.ts`, links resolved),
  its vault must be the chat's own or one it was granted, and one path that fails leaves the whole op
  alone as a `refused` conflict. A turn or undo file without the shape is not read at all.
- **OpenCode's `serve` is keyed per system prompt and MCP command**, because `{file:system.md}` is
  read once when it starts: a chat whose prompt changed (a new grant) needs another. The prompt goes
  in on stdin, and a turn is cancelled with `POST /api/session/<id>/interrupt`.
- **`ANYDAG_CHAT_FAKE=1` is a scripted harness** (`server/chat/fake.ts`) that reaches the vault the
  way a real one does — over HTTP, with the header, through the guard and the recorder — so a test of
  it is a test of everything but the model. `GET /__board/chat/models` answers `fake: true` under
  it, and `e2e/assistant.spec.ts` refuses to run against a server that would reach a real model:
  Playwright reuses a dev server it finds on its port.

Nothing here draws under `?snapshot=1`, and the canvas never learns a chat exists: a turn's writes
reach an open board through the change feed like any other writer's. Deleting a chat emits a `gone`
event on the chat stream, so every open history drops the row at once and a page on that chat goes to
New chat; the panel's open state is not remembered across a reload, and Settings → AI and agents
holds the default engine and model.

Names claimed, grepped first: `dag-assistant*`, `dag-chat*`, `data-dag-assistant*`, `data-dag-chat*`,
the setting `assistant`, the leader binding `space A`, and the query key `chat`.
`src/assistant/panelState.ts` is not `panel.ts`, which `check:case` refuses beside `Panel.tsx`.

**Out, and why:** `chat_*` tools for an outside agent (an agent driving another agent's chat is a
loop nobody asked for); attaching a file or a picture to a message; a chat written on two machines at
once (both turns land and interleave by id, with no lock, which the file model cannot give); and
running a turn while the app is closed.
