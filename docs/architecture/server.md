# The local server and vaults

> The one Node process, the token and `Host` gate, the store, and several vaults in one server.

## The local server

`server/`. One Node process, Hono, answering every route the page, the CLI
and MCP call, from one or more vaults on this machine, and the grammar is a function call in it
rather than a service on another port (`server/grammar.ts`, `server/handle.ts`).

| Where | Owns |
|---|---|
| `server/main.ts` | `anydag serve <folder>`: bind `127.0.0.1`, mint the token, write `server.json`, print the URL, and remove it on `SIGINT`, `SIGTERM` or `SIGHUP` |
| `server/app.ts` | the gate — the `Host`, then the token — which vault a request means, the routes, and the built page |
| `server/context.ts` | the `Session`: the open vaults, `?vault=<id>` through `AsyncLocalStorage`, so no route learned there is more than one |
| `server/vault.ts` | the store over a folder: every kind listed and foldered, names that are titles, ids in frontmatter, attachments, the watcher |
| `server/listing.ts` · `list-worker.ts` | the listing as the disk gives it — the walk, every stat and frontmatter read — and the worker it runs on |
| `server/home.ts` | the app's home — `ANYDAG_HOME`, else the platform's data folder — and its `node:sqlite` index |
| `server/grammar.ts` · `grammar-worker.ts` | the grammar as function calls, its parse caches, and the worker the whole-vault parses run on |
| `server/routes/` | one module per family: documents, folders, files, meta, events, vaults, preferences |
| `server/mcp/` | the MCP server: `TOOLS`, each calling its route |
| `server/connect.ts` | how the CLI and MCP reach a server: `server.json`, or one in-process |

Eight things are load-bearing:

- **Nothing the app needs to be correct lives only outside the vault.** A document's id is `id:` in
  its frontmatter; an attachment's is `<vault>/.anydag/files/<id>.json`; a vault's own id and
  settings are in `<vault>/.anydag/`. The SQLite file in the app's home maps id → path, created,
  title and kind so the app, the CLI and MCP agree without walking the vault, and it is an index:
  delete it and the next open rebuilds it, losing practice records and nothing else. **SQLite is
  never in the vault**, because a sync tool copies a database while it is written.
- **Frontmatter wins.** Two files with one id — a copy made in a file manager — keep it for the
  older by created date, and the copy is given a new id, written into it. A file moved outside the
  app keeps its id and the index learns the new path from the watcher.
- **The token and the `Host` are the whole security model**, and both are checked on every request —
  see *Things that will bite*. `server.json` is written mode `0600`.
- **One server, several vaults.** Each vault has its own change feed, and `/__board/transfer` moves
  a document or a folder between two open vaults with its id and created date.
- **Nothing the store may do may block sync**: no single shared index file in
  the vault, `.git/ .stversions/ *.sync-conflict-* *.icloud .trash/` ignored, the sha1 base, the 409 and
  `merge3` kept, and opening never writes.
- **No request waits behind the listing** (#283). `Vault.tree()` — what `/__board/list`, `/index`,
  `/corpus` and every other whole-vault read start from — walks the folder and reads every text's
  frontmatter on a worker (`server/list-worker.ts`, which keeps each text's frontmatter against its
  stat, so a second listing reads only what changed), sends it back in parts asked for one at a time,
  and brings the index into line in slices of 8 ms, each its own transaction, handing the thread back
  between them; `/__board/list` writes its 9 MB of JSON a key at a time the same way. On 50,000 files
  the first listing held every request for 5 s, the board the person opened included, and a warm one
  for 1.1 s; now none waits more than about 40 ms for either. Two things keep it correct now
  that it is no longer one step: **a listing asked for while one runs waits for it and runs once more
  for everyone who asked meanwhile**, so an answer is never older than its question; and **a move made
  here while one walks or reconciles makes it start again** (`moves`, see *Things that will bite*),
  three times and then on this thread. Where no worker is built beside the bundle (the unit suite) or
  `ANYDAG_LIST_INLINE=1`, the same code lists inline, still reconciling in slices.
- **`/api/auth/me` answers the one local user, always.** The page's account context is a constant;
  there is no sign-in, no session and no share link. Logs are sent only once the person says yes —
  see *Logs*. Feedback leaves only when the person presses Send, through a relay that alone holds a
  GitHub token — see *Feedback*.
- **Generation is the person's key** (`plugins/generate/`): the prompt card's providers
  read it from the environment or `.env.local` in development and, in the desktop app, from the OS
  keychain through `safeStorage`.

`test/server/` is the store contract and the routes in vitest over a real folder and a real index.

## The development server

`npm run dev` is not this server: Vite serves the page and proxies `/__board` and `/api` to
`anydag serve` on `ANYDAG_API_PORT`, adding the run's token in the proxy (`vite.config.ts`). The
development vault and `.dev-home/` sit inside Vite's root, so the dev and preview servers bind
`127.0.0.1` — `ANYDAG_DEV_HOST` is the explicit opt-in for a listener beyond loopback — and
`server.fs.deny` refuses `.dev-home`, `.anydag`, `.git`, `.claude` and the other credential
dot-folders in every form (`?raw`, `%2E` and `/@fs`). The proxy still accepts only a loopback
`Host`, and refuses a request whose `Origin` is not the page's own or whose `Sec-Fetch-Site` is
`cross-site` or `same-site`, before it attaches the token. `scripts/dev.sh` mints a token per run; `server.json` is
where `scripts/session.mjs`, the CLI and the e2e suite read it.

## Feature switches

The features that talk to an AnyDag server somebody else runs — **sync, the anonymous logs, Send
feedback, and any later thing that needs one (accounts, say)** — are behind one
switch, `cloud`. The server decides it, and everything else asks the server: it is not a preference,
there is no second copy of the answer in the page bundle, in `localStorage`, or anywhere else.

| Where | Owns |
|---|---|
| `server/features.ts` | the read: the build default, the run-time override, the answer |
| `src/features.ts` | the page's half: one `GET /api/health` at boot, `useFeatures()` for everything gated |
| `server/routes/meta.ts` | `GET /api/health` now answers `features: { cloud }`, beside the version |

The switch is read as follows, from one function (`cloudOn`):

- **The build bakes it.** `server/build.mjs` and `cli/build.mjs` define `__ANYDAG_CLOUD__` from
  `ANYDAG_CLOUD_BUILD=on|off`. **Off unless a build says on.** The release workflow never says on, so
  no release carries the server-backed features; a checkout's own build (`npm run dev` via
  `scripts/dev.sh`) runs on without baking anything, because the override says on.
- **The run time overrides it.** `ANYDAG_CLOUD=on` (or `off`) beats the build in everything that
  reads the environment in this process: the server's routes, the CLI's own answer and help table,
  the test suite (which defaults to on — see `vitest.config.ts` and `scripts/checks.sh`).
- **The page asks.** `/api/health` answers it; `/api/sync/*`, `/api/telemetry*`, `/api/feedback` and each
  later route behind the switch are registered only when it is on, so off they are a plain 404. The sync
  links start no loop; `Telemetry` (`server/telemetry.ts`) records nothing and never reads an
  address baked in for logs; the MCP server — and a chat's tool list — leaves out `sync_status`, `sync_now` and `feedback` by asking the same `GET /api/health`
  (`listTools` in `server/mcp/tools.ts`); the CLI's `sync` group and `telemetry` command answer with
  one line — *Sync is not available in this build.* — and are out of `anydag --help` when the CLI's
  own build says off.

Nothing is deleted when the switch is off. A vault that was linked keeps its `key` and `pair.json`
in the app's home, a consent answer keeps its place in `kv`, and turning the switch on
(`ANYDAG_CLOUD=on` on any build) resumes them: the loop starts at the next vault open, the next
page asks the question only if it was never answered. The gates live at the edges — route
registration, the loop start, the tool list, the component mount — and are guards around code that
stays built and tested.

`docs/parity.json` marks the gated rows `{"flag": "cloud"}`; `docs/PARITY.md` draws them with a
dagger. `skills/anydag/SKILL.md` says its sync and telemetry entries exist only when the switch is
on, and `scripts/check-skill.mjs` tolerates those names in a table that is drawn without them.

## Vaults

A **vault** is a folder — Obsidian's word and Obsidian's model. The sidebar's first row
names the open one and opens the switcher: the recent vaults, *Open folder…*, *Create vault* and
*Close vault*. Settings → This vault → General says where it is and closes it; its attachments
folder is on Files and images. The switcher draws each vault as a two-letter monogram on a tint of a
hue hashed from its id, with its name above the shortened path — so *vault* and *vault-two* are not
the same V, and a screen reader hears the name rather than the home directory first. *Close vault*
says which one it closes.

The first screen before there is a vault at all is `src/ui/Welcome.tsx`'s `NoVault`:
the recent list, *Open folder…* and *Create vault*, each opening a form that names itself —
**Open a vault** or **Create a vault** — with its labels above their fields and one filled primary
action. A refusal from the server is drawn under the form without moving its buttons.

| Route | Does |
|---|---|
| `GET /api/vaults` | the recent vaults, the open ones first |
| `POST /api/vaults/open` `{path}` · `/create` `{path}` · `/close` `{id}` | open a folder, make one and open it, close one — **never deleting it** |
| `POST /__board/transfer` `{name, kind, to}` · `{folder, to}` | a file, or a folder whole, to another open vault |

Eight things are load-bearing:

- **Closing never deletes, and nothing in the app removes a vault's folder.** A vault is a folder
  the person already owns; the file manager is where it is renamed or thrown away.
- **A vault's id belongs to its folder.** A folder whose `.anydag/vault.json` claims an id the home
  already maps to another folder that still exists and still claims it is a copy: it is given a
  fresh id, and the original's recent row and sync link are left alone.
- **Every path the store resolves stays in the vault's real path.** `Vault.abs` follows the root
  once and refuses an existing component that links out of it; a write checks again immediately
  before it lands.
- **A vault inside another is refused**, both ways: one file would be two documents with two
  owners, and the watchers would report every change twice.
- **An existing `.obsidian/` is never touched**, and every dot-folder is neither listed nor walked.
- **The page names its vault in its address**, `?vault=<id>`, pinned once at startup by
  `src/vault/current.ts` and carried on every request by a `fetch` wrapper, the `EventSource` and
  `<img src>`; a bare `/` resumes the vault opened last. **Switching is a page load**, so no
  subscription, cache or preference is left behind, and it happens once per page.
- **A vault's own preferences are `<vault>/.anydag/settings.json`** — the favourites, the
  attachments folder, the links switch and the settings card's vault half — so a vault opened on
  another machine works the same; the person's own are the app's home's, the theme and the AI choices
  among them since #191 (`settings.md`). `WORKSPACE_PREF_KEYS` is still the name of the split in `src/settings/`.
- **A file keeps its id across a transfer**, and a reference from a file left behind stops resolving
  there: an id resolves within its vault.

**Out, and why:** collaborators and permissions (a vault is a folder; a person shares it the way they
share any folder); references across vaults; and sync, which is the folder's — Syncthing, iCloud,
git — and which nothing here may break.
