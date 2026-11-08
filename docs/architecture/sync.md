# Sync

> The end-to-end-encrypted sync server and the app's client; the convergence harness.

## Sync

A vault syncs to a **sync server** somebody runs — `sync/`, in this repository, one Node
process over Postgres (or PGlite when `DATABASE_URL` is unset) — **end to end encrypted**: the server
holds opaque keys, sealed blobs and sealed metadata, and never a path or a byte of a file.

| Where | Owns |
|---|---|
| `sync/protocol/wire.ts` · `crypto.ts` | every route body and `ES_*` code · the vault key, its three HKDF subkeys, AES-256-GCM seals bound to what they seal, Argon2id, the recovery code |
| `sync/server/` | `anydag-sync serve`, the routes under `/v1`, `Meta` (`meta/pg.ts`) and `DiskBlobs`, pairing, quotas, the usage ledger, `/metrics`, the collector (`gc.ts`), and the admin CLI (`cli.ts`) |
| `server/sync/engine.ts` | one pull, push or resync at a time: decisions per key, merges, conflict copies, renames recognised |
| `server/sync/loop.ts` · `link.ts` | one loop per linked vault (catch-up, poke or a 30 s poll, a 2 s/10 s debounce on raw watcher events) · pair, link, unlink, devices |
| `server/routes/sync.ts` | `GET /api/sync`, `POST /api/sync/{pair,link,unlink,now}`, `GET /api/sync/{remotes,devices}`, `POST /api/sync/devices/revoke` — the contract is `server/sync/types.ts` |
| `src/sync/` · `src/settings/panes/Sync.tsx` | the status hook and the calls · Settings → Sync |

| Run | Does |
|---|---|
| `npm run sync:serve` | build `sync/dist/` and serve on `ANYDAG_SYNC_PORT` (8790), PGlite in `ANYDAG_SYNC_DATA` |
| `npm run sync:up` · `sync:db` | the server and Postgres in compose · Postgres alone, on `ANYDAG_SYNC_PG_PORT` |
| `node sync/dist/anydag-sync.mjs account add <name>` · `pair <account>` | an account · a one-time code a device pairs with |
| `anydag sync pair <server> <code>` · `link --upload\|--download <remote>\|--merge <remote>` · `status` · `now` · `devices` · `unlink` | the app's side; a passphrase is typed or `--passphrase-file` |
| `npm run sync:test:pg` · `sync:converge` | the meta, routes and gc suites on the compose Postgres · a hundred convergence seeds |

Eleven things are load-bearing:

- **The model is a file, not an operation.** Per vault the server keeps a head per key and a gapless
  log; a commit is all or nothing and is accepted only if every change's `parent` is its key's head
  `seq` — a tombstone's too; `null` means the key never had one. A rename is a delete and a create in
  one commit, recognised by the client.
- **Every write sync makes is a compare-and-set on the sha1 it decided against** (`writeRawIf`,
  `removeRawIf`), so the page or an agent writing in between wins and sync decides again. It writes
  raw: `write`/`create` parse and stamp, and sync puts back exactly the bytes another device committed.
- **No echo.** After applying a version, its bytes are the key's base, so the watcher's event for
  that write finds the disk equal to the base and pushes nothing.
- **A conflict is visible**: ours stays at the path and theirs is written beside it as
  `<stem> (conflict <device> <YYYY-MM-DD HH.mm>)<suffix>`, keeping its id unless ours has the same
  one. Text merges with `merge3` first; a merged board, quiz or table that would not parse is not a
  merge; `.anydag/settings.json` merges by key (`src/settings/merge.ts`).
- **Two devices settle a duplicate id the same way**: the known path only in a vault that has never
  synced (`syncs:<vault>` in the index), else the earlier `created`, else the path in code-point
  order, so a file-manager copy made in its original's second is decided by path: a rule reading
  anything one device alone knows was tried and broke the agreement under load. That holds only
  because one document has one created on every device: it travels in the sealed metadata, every pull
  that ends on the committed bytes adopts it (`adoptCreated`), a conflict copy included, a birth
  `createdOf` reports is remembered until the index walks the file, and a document renamed before the
  walk keeps its id's created rather than its new file's birth (`movedCreated` for a push,
  `createdOfId` for the tie-break **and for the index row the walk writes** — the row was the one
  place that read the birth, and a device whose first walk met a renamed copy alone dated it by the
  rename and then kept the other device's copy: seed 2, only when a second boundary fell between the
  two births). The first download
  holds id fixes (`holdFixes`) until it has every file. **Run the harness loaded** — four batches at
  once — before believing a change to any of this: its timing defects do not show on an idle machine.
- **One name is one document.** `ideas.md` from one device and `ideas.board.md` from another are two
  keys and both land; the engine's `settleKinds` moves every one but the oldest (created, then path)
  to a numbered name, so every device makes the same move.
- **A key arrives at the spelling the disk already has.** A remote change for a key this device has
  no record of, with a file of another case on disk, is decided there (`SyncFs.spelled`), or a rename
  on one device and a case rename on the other leave two spellings that trade places every round.
- **A folder that held only what another device removed goes too** (`pruneUp`), up to the first
  folder that is an entry of its own; one the other device kept arrives as an empty-folder entry.
- **Known limit**: under concurrent renames and copies two devices can each settle one duplicate id
  from a different set of files, and both fixes commit — the id dangles, nothing is lost (four seeds
  in twelve hundred).
- **Only a process that stays up runs a loop.** The app and `anydag mcp` do; the CLI's in-process
  server (`connect`, `SyncLinks.auto` off) does not, says the vault is resting, and syncs on
  `anydag sync now`.
- **Linking adopts the remote's id.** Upload creates the remote under the vault's own id; download
  (into an empty vault) and merge call `Session.rekeyVault`, which moves the home's rows and the
  sync folder, and the page reloads onto `?vault=<new id>`.
- **Nothing about sync is in the vault.** `<home>/sync/<vault>/` holds `pair.json` (the device token,
  mode 0600), `key` (the vault key sealed under the home secret — `ANYDAG_HOME_SECRET`, which the
  desktop app keeps in `safeStorage`, else `<home>/home.secret`), `state.sqlite` and `bases/`. A vault
  is linked when `key` and `pair.json` both exist, so an unlinked vault costs one `existsSync`. **Once
  the app keeps the secret, nothing else makes one**: the CLI with the app closed refuses
  (`SecretElsewhere`) rather than seal a vault key under a second secret.
- **A failed upload is taken up again.** `createVault` under the id of an unkeyed, empty remote of the
  same account answers that remote, so a retry makes no second one.
- **The passphrase and the recovery code never leave the call that uses them.** The recovery code is
  answered once by an upload and kept nowhere; an agent cannot link — MCP has `sync_status` and
  `sync_now` only, and `docs/parity.json` says why.
- **A failure is the vault's.** `ES_NETWORK` is `offline` with a backoff; `ES_AUTH` (a revoked
  device) and a quota are `paused` with a reason; the loop never unlinks on its own. The app answers
  a sync server's `ES_AUTH` as **403**, not 401, which the page would read as its own token gone.
- **The feed's event is `dag:vault-sync`**, carrying a `SyncStatus`. `dag:sync` is the preference
  sync's key and stays it.
- **The convergence harness is the instrument** (`sync/test/converge.test.ts`): one server, two or
  three devices on real vaults, seeded schedules of edits, renames, case renames, deletes, binaries,
  outside writes, stale page saves, offline spells and dropped answers; every seed must end with the
  same bytes everywhere, no token anybody wrote lost, and no dangling or duplicated id. It found
  every defect in the client the unit tests missed. A printed seed replays with `ANYDAG_SYNC_SEED`.
  **It runs on its own clock, not the machine's.** A file's birth is a second-resolution instant and
  decides which duplicate keeps an id, so a seed read from the disk was a function of how fast the
  machine ran it: seed 2 held with every birth in one second and failed once a slow run spread them.
  `World` now advances one seeded clock (up to 900 ms a step, a separate stream so the schedule is
  unchanged) that every vault reads as a birth, so a seed makes the same births every run, idle or
  loaded. A scripted case that pins `Dev.clock` keeps it.

**A test of the loop reads a status only once the loop is quiet.** The watcher starts with the loop and
reports what a link or a pull wrote *after* the call returned; each batch is debounced into a run that
finds nothing to push, and reads `syncing` while it goes. `test/server/sync-loop.test.ts` takes the
status through `settled()` (idle, nothing pending, one observation) and sees a push on the server
(`heads().seq`), never on the feed's `pending` and `idle` alone, which a stale echo satisfies.

The unit suite loads `node:sqlite` through an alias in `vitest.config.ts` (`test/node-sqlite.ts`):
Vite strips the `node:` prefix from a built-in it does not know, and the sync client's tests failed
with *Failed to load url sqlite* whenever they shared a worker with another file.

Names claimed, grepped first: `dag-sync-row`, `dag-sync__*`, `dag-sync-spin`, `data-dag-sync-*`, the
Settings tab `sync`, and the event `dag:vault-sync` (in `test/prefs.test.ts`'s list).

**Out, and why:** hosting it (running it is up to whoever wants it); billing (the usage ledger and
`/metrics` are in place for when it is decided); chunking a large file; sharing a vault between
accounts; history a person can browse; and real-time co-editing, which the file model cannot be.
