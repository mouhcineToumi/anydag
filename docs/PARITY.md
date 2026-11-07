# Parity: REST · CLI · MCP

Generated from `docs/parity.json` by `npm run parity` — edit that file, never this one.

**137 features, 0 gaps.** Each row is one thing the backend can do, and what reaches it
through each of the three ways in: a route the page calls, an `anydag` command, an MCP tool. A name is
done; ↳ is covered by something more general in that interface; ✗ is refused on purpose. The reason for
every ↳ and ✗ is numbered under the tables.

## Account

| Feature | REST | CLI | MCP |
|---|---|---|---|
| The time zone times are read and written in (and the app's one local "account") | `GET /api/auth/me` | `event ls` `event new` `event set` | `whoami` |
| What is answering: its version, the vault it serves, and whether it is the app or this process | `GET /api/health` | `whoami` | `whoami` |
| The app's preferences — how the window is laid out | `GET /api/settings` `PUT /api/settings` | `settings` | `settings` |
| Whether this install sends anonymous logs, and where they go — off until the person says yes | `GET /api/telemetry` `PUT /api/telemetry` | `telemetry` | ✗ [1] |
| The page's own log events — errors, the features used, how fast a page drew | `POST /api/telemetry/events` | ✗ [2] | ✗ [3] |

## Vaults

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Which vaults there are — the recent list, and which are being served | `GET /api/vaults` | `vault ls` | `vault_list` |
| Serve a folder as a vault, making it the default | `POST /api/vaults/open` | `vault open` | `vault_open` |
| Make a folder and open it as a vault | `POST /api/vaults/create` | `vault create` | `vault_create` |
| Stop serving a vault, or forget it — never its folder | `POST /api/vaults/close` | `vault close` | `vault_close` |
| Run the MCP server over stdio for a vault — what Claude Code and Claude Desktop connect to | ✗ [4] | `mcp` | ✗ [5] |
| Serve a vault and the page to a browser on this machine, behind a token printed once | ✗ [6] | `serve` | ✗ [7] |
| A vault's preferences — the settings card, the theme, the favourites | `GET /api/vault/settings` `PUT /api/vault/settings` | `settings` | `settings` |
| Move a file, or a folder whole, to another open vault | `POST /__board/transfer` | `vault transfer` | `board_transfer` |

## Files

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every board, note, quiz, table, attachment and folder, with titles, ids, tasks and projects | `GET /__board/list` | `ls` | `board_list` `note_list` `quiz_list` `table_list` |
| Hear each change as it happens | `GET /__board/events` | `watch` | ✗ [8] |
| What a permanent id names | `GET /__board/resolve` | `resolve` `open` | `resolve` |
| What refers to what: references and backlinks | `GET /__board/index` `GET /__board/refs` | `index` `board refs` `note refs` `quiz refs` `table refs` `file refs` | `refs` |
| Every place some words appear, ranked | `GET /__board/search` `GET /__board/corpus` | `search` `corpus` | `search` |

## Boards

| Feature | REST | CLI | MCP |
|---|---|---|---|
| A board's text and its base | `GET /__board/get` | `board cat` | `board_read` |
| Make a board | `POST /__board/create` | `board new` | `board_create` |
| Replace a board's whole text | `POST /__board/put` | `board write` `board edit` | `board_write` |
| Change one item and leave the rest of the file alone | `POST /__board/patch` | `item set` `item body` `item rm` `item add` | `board_patch` |
| Rename or move a board | `POST /__board/rename` | `board mv` | `board_rename` |
| Copy a board | `POST /__board/duplicate` | `board cp` | `board_duplicate` |
| Move a board to the trash | `POST /__board/delete` | `board rm` | `board_delete` |
| Call a board something, and let its name follow | `POST /__board/retitle` | `board title` | `board_title` |
| What is wrong with a board's text — or a draft's — as codes | `GET /__board/diagnostics` `POST /__board/diagnostics` | `board diagnose` | `board_diagnose` |
| What items are on a board, without its whole text | `GET /__board/fences` | `item ls` | `board_fences` |
| Bring a `.board.md` file in as a new board | `POST /__board/create` `POST /__board/asset` | `board import` | ↳ `board_create` `image_add` [9] |

## Notes

| Feature | REST | CLI | MCP |
|---|---|---|---|
| A note's text and its base | `GET /__board/get` | `note cat` | `note_read` |
| Make a note | `POST /__board/create` | `note new` | `note_create` |
| Replace a note's whole text | `POST /__board/put` | `note write` `note edit` | `note_write` |
| Rename or move a note | `POST /__board/rename` | `note mv` | `note_rename` |
| Copy a note | `POST /__board/duplicate` | `note cp` | `note_duplicate` |
| Move a note to the trash | `POST /__board/delete` | `note rm` | `note_delete` |
| Call a note something, and let its name follow | `POST /__board/retitle` | `note title` | `note_title` |

## Tasks

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every task, with its status, due date and project | `GET /__board/list` | `task ls` | `task_list` |
| Make a task | `POST /__board/create` | `task new` | `task_create` |
| Change a task's status, due date or start date, or make a note a task and back | `POST /__board/task` | `task set` `task done` | `task_set` |

## Events

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every event, with when it starts and ends, soonest first | `GET /__board/list` | `event ls` | `event_list` |
| Make an event: a note with a start and an end | `POST /__board/create` | `event new` | `event_create` |
| Move an event, or make a note an event and back | `POST /__board/event` | `event set` | `event_set` |

## Projects

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every project, with its status, colour and task counts | `GET /__board/list` | `project ls` | `project_list` |
| Make a folder a project | `GET /__board/list` `POST /__board/create` | `project new` | `project_create` |
| Change a project's status or colour, or make it a plain folder | `POST /__board/project` | `project set` | `project_set` |

## Quizzes

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every quiz, with how many questions each asks | `GET /__board/list` | `quiz ls` | `quiz_list` |
| A quiz's text and its base | `GET /__board/get` | `quiz cat` | `quiz_read` |
| Make a quiz | `POST /__board/create` | `quiz new` | `quiz_create` |
| Replace a quiz's whole text | `POST /__board/put` | `quiz write` `quiz edit` | `quiz_write` |
| Write, remove or move one question by its id, and no other byte of the quiz | `POST /__board/quiz` | `quiz question set` `quiz question rm` `quiz question mv` | `quiz_question_set` `quiz_question_remove` `quiz_question_move` |
| Rename or move a quiz | `POST /__board/rename` | `quiz mv` | `quiz_rename` |
| Copy a quiz | `POST /__board/duplicate` | `quiz cp` | `quiz_duplicate` |
| Move a quiz to the trash | `POST /__board/delete` | `quiz rm` | `quiz_delete` |
| Call a quiz something, and let its name follow | `POST /__board/retitle` | `quiz title` | `quiz_title` |
| What is wrong with a quiz — or a draft — as codes | `GET /__board/diagnostics` `POST /__board/diagnostics` | `quiz check` | `quiz_check` |
| Run a quiz a question at a time, and record the answers | `GET /__board/get` `POST /api/practice` | `quiz practice` | `quiz_questions` `quiz_answer` |
| Every question still in Mistakes | `GET /api/practice` | `quiz mistakes` | `quiz_mistakes` |
| How many right in a row take a question out of Mistakes | `GET /api/practice` `PUT /api/practice` | `quiz threshold` | `quiz_threshold` |

## Tables

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Every table, with its title and id | `GET /__board/list` | `table ls` | `table_list` |
| A table's text and its base | `GET /__board/get` | `table cat` | `table_read` |
| Make a table | `POST /__board/create` | `table new` | `table_create` |
| Replace a table's whole text | `POST /__board/put` | `table write` `table edit` | `table_write` |
| Rename or move a table | `POST /__board/rename` | `table mv` | `table_rename` |
| Copy a table | `POST /__board/duplicate` | `table cp` | `table_duplicate` |
| Move a table to the trash | `POST /__board/delete` | `table rm` | `table_delete` |
| Call a table something, and let its name follow | `POST /__board/retitle` | `table title` | `table_title` |
| What is wrong with a table — or a draft — as codes | `GET /__board/diagnostics` `POST /__board/diagnostics` | `table check` | `table_check` |
| A table's tabs, columns and rows as data, each addressed by id | `GET /__board/table` | `table show` | `table_get` |
| Set cells; add, remove, move and size rows and columns; add, rename, sort, filter, remove and move tabs | `POST /__board/table` | `table set` `table row add` `table row rm` `table row mv` `table row height` `table col add` `table col set` `table col rm` `table col mv` `table tab add` `table tab set` `table tab rm` `table tab mv` | `table_edit` |
| A CSV as a new table, or as a new tab of one | `POST /__board/create` `POST /__board/table` | `table import` | ↳ `table_create` `table_edit` [10] |
| A tab as CSV | `GET /__board/get` | `table export` | ↳ `table_get` [11] |

## Folders

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Make a folder | `POST /__board/mkdir` | `folder new` | `board_mkdir` |
| Move a folder to the trash, emptied or with everything in it | `POST /__board/rmdir` | `folder rm` | `board_rmdir` |
| Rename or move a folder with everything in it | `POST /__board/mvdir` | `folder mv` | `board_mvdir` |

## Trash

| Feature | REST | CLI | MCP |
|---|---|---|---|
| What is in the trash, and how many days a thing stays before it is gone for good | `GET /__board/trash` | `trash ls` | `trash_list` |
| Put something back from the trash, with its id | `POST /__board/trash/restore` | `trash restore` | `trash_restore` |
| Delete one thing in the trash for good | `POST /__board/trash/delete` | `trash rm` | `trash_delete` |
| Empty the trash | `POST /__board/trash/empty` | `trash empty` | `trash_empty` |

## Sync

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Whether a vault syncs to a sync server, and how it is going | `GET /api/sync` | `sync status` | `sync_status` |
| Pair a vault with a sync server, with a one-time code | `POST /api/sync/pair` | `sync pair` | ✗ [12] |
| The remote vaults the paired account holds | `GET /api/sync/remotes` | `sync remotes` | ✗ [13] |
| Link a vault: upload it as a new remote, download a remote into an empty vault, or merge the two | `POST /api/sync/link` | `sync link` | ✗ [12] |
| Stop syncing a vault, keeping its files and the remote | `POST /api/sync/unlink` | `sync unlink` | ✗ [14] |
| Pull and push now | `POST /api/sync/now` | `sync now` | `sync_now` |
| The devices paired into the sync account | `GET /api/sync/devices` | `sync devices` | ✗ [15] |
| Sign a device out of the sync account | `POST /api/sync/devices/revoke` | `sync devices revoke` | ✗ [16] |

## Remote access

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Whether a paired phone can reach this desktop: the remote door on or off, its port, the address a phone opens | `GET /api/remote` `PUT /api/remote` | `remote status` `remote on` `remote off` | ✗ [17] |
| What Tailscale says about this machine — its tailnet address, whether `tailscale serve` passes it to the door — and asking it to | `GET /api/remote/tailscale` `POST /api/remote/tailscale/serve` | `remote status` `remote on` `remote serve` | ✗ [18] |
| A one-time code a phone pairs with | `POST /api/remote/pair` | `remote pair` | ✗ [19] |
| The devices paired with this desktop, and unpairing one | `GET /api/remote/devices` `POST /api/remote/devices/revoke` | `remote devices` `remote revoke` | ✗ [20] |
| A paired device's own routes on the remote door: spending a pairing code, which device it is, forgetting itself | `POST /api/device/pair` `GET /api/device` `POST /api/device/forget` | ✗ [21] | ✗ [22] |

## Inside a board

| Feature | REST | CLI | MCP |
|---|---|---|---|
| One item's fence line and body | `GET /__board/get` | `item show` | `board_read` |
| Duplicate, restack, group, rename, convert or re-lay-out items | `POST /__board/patch` `POST /__board/put` | `item dup` `item front` `item back` `item rename` `item group` `item ungroup` `item convert` `item relayout` | ↳ `board_patch` `board_write` [23] |
| A board's pages: list, add, rename, remove, reorder | `GET /__board/get` `POST /__board/patch` | `page ls` `page add` `page rename` `page rm` `page move` | ↳ `board_patch` [24] |
| Lines between items: list, add, change, remove | `GET /__board/get` `POST /__board/patch` | `link ls` `link add` `link set` `link rm` | ↳ `board_patch` [25] |
| The cards inside one diagram | `GET /__board/get` `POST /__board/patch` | `node ls` `node add` `node set` `node rm` `node rename` `node dup` `node move` | ↳ `board_patch` [23] |
| The edges inside one diagram | `POST /__board/patch` | `edge add` `edge set` `edge rm` | ↳ `board_patch` [23] |
| A card's rows: columns, members | `GET /__board/get` `POST /__board/patch` | `row ls` `row add` `row set` `row rm` | ↳ `board_patch` [23] |
| A chart's own statements: form, legend, scale, categories | `POST /__board/patch` | `chart set` | ↳ `board_patch` [23] |

## Images

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Keep a picture beside a board, a note or a quiz — its bytes, or over MCP an https URL the server fetches | `POST /__board/asset` `POST /__board/upload` | `image add` | `image_add` |
| A picture a document keeps | `GET /__board/assets/{path:path}` | `image get` | `image_get` |
| Pictures beside a board that no board names | `GET /__board/assets/unused` | `image unused` | `image_unused` |
| Remove those pictures | `POST /__board/assets/sweep` | `image sweep` | `image_sweep` |

## Attachments

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Keep any file as an attachment — a PDF, a picture, a sheet — within the deployment's limits: its bytes, or over MCP an https URL the server fetches | `POST /__board/file` | `file upload` | `file_upload` |
| Every attachment, its size, and what the deployment accepts | `GET /__board/files` | `file ls` | `file_list` |
| An attachment's bytes, by name or id — drawn, or saved | `GET /__board/file` | `file get` | `file_get` |
| Rename or move an attachment; its extension stays its own | `POST /__board/rename` | `file mv` | `file_rename` |
| Copy an attachment | `POST /__board/duplicate` | `file cp` | `file_duplicate` |
| Call an attachment something, and let its name follow | `POST /__board/retitle` | `file title` | `file_title` |
| Move an attachment to the trash, saying what uses it | `GET /__board/refs` `POST /__board/delete` | `file rm` | `file_delete` |

## Components

| Feature | REST | CLI | MCP |
|---|---|---|---|
| The person's saved components | `GET /__board/components` | `component ls` | `library` |
| Keep items as a component | `POST /__board/create` | `component keep` | ↳ `board_create` [26] |
| Put a saved component on a board | `GET /__board/components` `POST /__board/patch` | `component place` | ↳ `library` `board_patch` [27] |
| Delete a saved component | `POST /__board/components/delete` | `component rm` | `component_delete` |

## Grammar

| Feature | REST | CLI | MCP |
|---|---|---|---|
| The cheat sheets | `GET /__board/dsl` | `dsl` | `dsl_reference` |
| Ready-made pieces, rendered | `GET /__board/library` | `library` | `library` |
| What `icon=` may say | `GET /__board/icons` | `icons` | `icons` |

## Models

| Feature | REST | CLI | MCP |
|---|---|---|---|
| Which model providers could answer | `GET /__board/llm` | `llm` | `llm` |
| Ask a model to draw a diagram | `POST /__board/generate` | `generate` | `generate` |
| Run a prompt card on a board | `POST /__board/generate` `POST /__board/patch` | `prompt run` | ↳ `generate` `board_patch` [28] |
| Ask a model to rewrite one diagram | `POST /__board/generate` `POST /__board/patch` | `rewrite` | ↳ `generate` `board_patch` [29] |

## Pictures

| Feature | REST | CLI | MCP |
|---|---|---|---|
| A picture of a board, with what is wrong with the drawing | ✗ [30] | `snapshot` | ✗ [31] |
| Tidy a board's layout | ✗ [30] | `tidy` | ✗ [31] |
| A board as SVG or PNG, a note as PDF | ✗ [30] | `board export` `note export` | ✗ [31] |

## Assistant

| Feature | REST | CLI | MCP |
|---|---|---|---|
| The chats in a vault, newest first | `GET /__board/chats` | `chat ls` | ✗ [32] |
| The providers, models and effort levels a chat can run on | `GET /__board/chat/models` | `chat models` | ✗ [32] |
| Start a chat | `POST /__board/chat` | `chat new` | ✗ [32] |
| A chat read whole: its turns, steps, changes and undo history | `GET /__board/chat` | `chat cat` | ✗ [32] |
| Send a turn and follow the answer as it is written | `POST /__board/chat/turn` `GET /__board/chat/events` | `chat say` | ✗ [32] |
| Stop the turn that is answering | `POST /__board/chat/stop` | `chat stop` | ✗ [32] |
| Answer a write or a vault request the assistant is waiting on | `POST /__board/chat/approve` | `chat approve` | ✗ [32] |
| Let a chat reach another vault, or take the grant back | `POST /__board/chat/grant` | `chat grant` | ✗ [32] |
| Take back, or put back, one block of changes a turn made | `POST /__board/chat/undo` `POST /__board/chat/redo` | `chat undo` `chat redo` | ✗ [32] |
| Give a chat a title | `POST /__board/chat/rename` | `chat rename` | ✗ [32] |
| Delete a chat and its turns | `POST /__board/chat/delete` | `chat rm` | ✗ [32] |
| The chat's own recorder: group the writes that follow into one undoable block | `POST /__board/chat/block` | ✗ [33] | ✗ [34] |
| The chat's own request to reach another vault, put to the person | `POST /__board/chat/access` | ✗ [35] | ✗ [36] |

## Why

1. Consent is the person's to give: an agent turning the logs on would be answering a question that was asked of somebody else.
2. Events are what the page observes about itself; a command that posted them would be logs nobody's use made.
3. Events are what the page observes about itself; an agent posting them would be inventing usage.
4. A process that speaks MCP on its own stdin and stdout; it calls the routes, it is not one.
5. It is the MCP server itself.
6. It is the server the routes are answered by.
7. An agent is already connected to a server; starting another is the person's.
8. A change feed is a stream a page holds open, and a stateless tool call answers once. The `base` every read returns is how an agent knows a document moved.
9. Importing is reading a file off the disk the CLI runs on; an agent hands the text to `board_create` and each picture to `image_add`.
10. Importing is reading a file off the disk the CLI runs on; an agent hands the CSV's text to `table_edit`'s `importCsv` op, on a table `table_create` made or one that exists.
11. CSV is a file for a spreadsheet on somebody's disk; `table_get` answers every row and cell as data, which is what an agent reads and writes out in whatever shape it needs.
12. A passphrase is the person's: pairing and linking take a one-time code and a passphrase they type, in Settings → Sync or a terminal, and an agent is never handed either.
13. It is the list a link chooses from, and linking is the person's: a passphrase is the person's.
14. Undoing a link is the person's, as making one is: a passphrase is the person's, and so is the decision to stop using it.
15. The account's devices are the person's to manage, beside the passphrase that is theirs.
16. Signing a device out is the person's, beside the passphrase that is theirs.
17. Who can reach this machine is the person's to decide; an agent opening a door onto the desktop is the thing remote access must never be.
18. Putting the desktop on a network is the person's to decide, as the door it leads to is.
19. A pairing code admits a device to the desktop; it is the person's to hand over, never an agent's.
20. Which devices reach the desktop is the person's to manage, beside the codes that admit them.
21. These are the phone's, answered only on the remote door; from the desktop's terminal it is `anydag remote revoke`.
22. These are the phone's, answered only on the remote door; an agent is never a paired device.
23. An agent writes the DSL itself: `board_patch` changes one item's fence line or body, `board_write` the whole file. The CLI's version computes the same edit with the page's TypeScript for a person at a terminal.
24. Pages are the frontmatter's `pages:` and each item's `page=`: `board_patch`'s `{meta}` op and `{id, attrs}` op write them.
25. A link is a line of a page's `edges` fence: `board_patch` rewrites that fence's body, or inserts one.
26. A component is a board under `components/`: `board_create` with that name keeps one, with the text of the items to keep.
27. `library` answers every saved component's text, and `board_patch`'s `{insert}` places it.
28. `generate` answers the draft and `board_patch` puts it where the card was: `{insert}` after it, `{remove}` on it.
29. `generate` with `source` answers the rewritten body, and `board_patch`'s `{id, body}` lands it on the item.
30. Drawn by the page: the layout runs in a browser against the real webfonts, and ELK reaches it through a specifier only Vite resolves, so there is no server route to call. The CLI drives the page in Playwright.
31. A picture, a tidy and an SVG, PNG or PDF are made by the page laid out in a browser, in the real webfonts, and this server has none. Every tool that names a document returns the `url` a person opens instead.
32. An MCP client is itself an agent. A chat is a person's conversation, driven from the page or the CLI; an agent driving another model's chat through the person's own subscription is not something to offer.
33. Only a chat's own MCP server calls this: it answers a request carrying `X-AnyDag-Chat` for a turn that is running, and 403s anything else. It is not a command: nothing outside a running turn has a block to start.
34. Only a chat's own MCP server calls this: it answers a request carrying `X-AnyDag-Chat` for a turn that is running, and 403s anything else. A chat's own MCP server offers it as `change_block` (server/mcp/chat.ts), which is not one of this server's tools.
35. Only a chat's own MCP server calls this: it answers a request carrying `X-AnyDag-Chat` for a turn that is running, and 403s anything else. It is not a command: the person answers it with `chat approve`, and grants a vault up front with `chat grant`.
36. Only a chat's own MCP server calls this: it answers a request carrying `X-AnyDag-Chat` for a turn that is running, and 403s anything else. A chat's own MCP server offers it as `vault_request` (server/mcp/chat.ts), which is not one of this server's tools.
