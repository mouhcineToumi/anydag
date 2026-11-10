# Sync

> The app's end-to-end-encrypted sync client, its server half in `api/`, and the convergence
> harness.

## Sync

A vault syncs to an **api server** somebody runs — `api/` in this repository, one Node
process over Postgres (or PGlite when `DATABASE_URL` is unset); its own file is
[`api.md`](api.md) — **end to end encrypted**: the server holds opaque keys, sealed blobs and
sealed metadata, and never a path or a byte of a file. This file is the *client*: what the app
does about it.

| Where | Owns |
|---|---|
| `api/protocol/wire.ts` · `crypto.ts` · `meta.ts` | every route body, `ES_*` code and `PROTOCOL` · the vault key, its three HKDF subkeys, AES-256-GCM seals bound to what they seal, Argon2id, the recovery code · a path's sealed metadata, bound to its key, blob and parent |
| `api/protocol/logs.ts` | what an anonymous log may hold: `EVENTS`, `scrub`, `cleanEvent` and `cleanBatch` (see [`logs.md`](logs.md)) |
| `api/server/` | the server: `anydag-api serve`, the routes under `/v1`, `Meta` (`meta/pg.ts`) and `DiskBlobs`, pairing, quotas and the history allowance, the usage ledger, `/metrics`, the collector (`gc.ts`), the admin CLI (`cli.ts`), the feature switches |
| `server/sync/engine.ts` | one pull, push or resync at a time: decisions per key, merges, conflict copies, renames recognised |
| `server/sync/loop.ts` · `link.ts` | one loop per linked vault (catch-up, poke or a 30 s poll, a 2 s/10 s debounce on raw watcher events that are not sync's own writes) · pair, link, unlink, devices |
| `server/sync/echo.ts` | what the engine last wrote at each path, so the watcher's report of it wakes nothing |
| `server/routes/sync.ts` | `GET /api/sync`, `POST /api/sync/{pair,link,unlink,now}`, `GET /api/sync/{remotes,devices}`, `POST /api/sync/devices/revoke` — the contract is `server/sync/types.ts` |
| `src/sync/` · `src/settings/panes/Sync.tsx` | the status hook and the calls · Settings → Sync |

| Run | Does |
|---|---|
| `npm run api:serve` · `api:dev` · `api:db` | the api server (old names `sync:*` still answer for one release) · it against Postgres · Postgres alone |
| `node api/dist/anydag-api.mjs account add <name>` · `pair <account>` | an account · a one-time code a device pairs with |
| `anydag sync pair <server> <code>` · `link --upload\|--download <remote>\|--merge <remote>` · `status` · `now` · `devices` · `unlink` | the app's side; a passphrase is typed or `--passphrase-file` |
| `npm run api:test` · `api:test:pg` · `api:converge` | the protocol, config and route suites over PGlite · meta, routes and gc on the compose Postgres · a hundred convergence seeds |

Seventeen things are load-bearing:

- **The model is a file, not an operation.** Per vault the server keeps a head per key and a gapless
  log; a commit is all or nothing and is accepted only if every change's `parent` is its key's head
  `seq` — a tombstone's too; `null` means the key never had one. A rename is a delete and a create in
  one commit, recognised by the client.
- **Every write sync makes is a compare-and-set on the sha1 it decided against** (`writeRawIf`,
  `removeRawIf`), so the page or an agent writing in between wins and sync decides again. It writes
  raw: `write`/`create` parse and stamp, and sync puts back exactly the bytes another device committed.

- **No echo.** After applying a version, its bytes are the key's base, so the watcher's event for
  that write finds the disk equal to the base and pushes nothing. **Nor does it wake the loop**
  (#36): the watcher starts with the loop, so the files a pull, a download or a merge wrote come back
  as events, often after the run that wrote them, and each batch used to raise `pending` and arm the
  debounce for a run that pushed nothing — the feed went `idle` → `syncing` → `idle` a couple of
  seconds after every pull. The engine now wraps its `SyncFs` (`echo.ts`) and notes what every
  write, removal and folder it made left at the path: the sha1, nothing, or a folder.
  `engine.heard`, which the loop calls instead of `touch`, drops a path whose disk is still exactly
  that, and the loop arms the debounce only for what is left. It is safe because every write sync
  makes is a compare-and-set: a write in between either failed sync's (no note) or was what sync
  decided on, and whatever that left to push — a merge, a conflict copy — the engine marked itself.
  A write after it changes the bytes and is pushed as before. Each event spends its path's note, a
  note nothing spent lapses after 30 s, and a folder (which `SyncFs` cannot read) the state holds as
  an empty-folder marker is always touched. `touch` and `scan` are unchanged: the harness calls
  `touch` directly, and a scan decides against the base whatever a note says.
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
- **A link is bound to its folder.** `pair.json` records the root it was made for; a vault whose id
  another folder claims pauses with a sentence instead of starting that link's loop.
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
  device) and a quota are `paused` with a reason; a version refused as not belonging where it
  arrived (*What the server cannot forge*) and a server of another protocol (`ES_PROTOCOL`) are
  `error` with the sentence that says why; the loop never unlinks on its own. The app answers
  an api server's `ES_AUTH` as **403**, not 401, which the page would read as its own token gone.
- **The feed's event is `dag:vault-sync`**, carrying a `SyncStatus`. `dag:sync` is the preference
  sync's key and stays it.
- **The convergence harness is the instrument** (`api/test/converge.test.ts`): one server, two or
  three devices on real vaults, seeded schedules of edits, renames, case renames, deletes, binaries,
  outside writes, stale page saves, offline spells and dropped answers; every seed must end with the
  same bytes everywhere, no token anybody wrote lost, and no dangling or duplicated id. It found
  every defect in the client the unit tests missed. A printed seed replays with `ANYDAG_API_SEED`.
  **It runs on its own clock, not the machine's.** A file's birth is a second-resolution instant and
  decides which duplicate keeps an id, so a seed read from the disk was a function of how fast the
  machine ran it: seed 2 held with every birth in one second and failed once a slow run spread them.
  `World` now advances one seeded clock (up to 900 ms a step, a separate stream so the schedule is
  unchanged) that every vault reads as a birth, so a seed makes the same births every run, idle or
  loaded. A scripted case that pins `Dev.clock` keeps it.

**A test of the loop reads a status only once the loop is quiet.** The watcher reports a write
*after* the call that made it returned, later still on a busy machine. Sync's own writes no longer
make a run (above), but a test's write can still be heard after `now` has pushed it.
`test/server/sync-loop.test.ts` takes the status through `settled()` (idle, nothing pending, one
observation) and sees a push on the server (`heads().seq`), never on the feed's `pending` and `idle`
alone. To assert that something did **not** run, it first waits until the watcher has caught up
(`heardAll()`: a temp-named file, which never syncs, written last and heard — the watcher reports in
order), then for longer than the debounce, and only then counts the feed's `syncing`. A download's
feed is read on `Vault.prototype.emit`, since the link re-keys the vault into a new `Vault`.

The unit suite loads `node:sqlite` through an alias in `vitest.config.ts` (`test/node-sqlite.ts`):
Vite strips the `node:` prefix from a built-in it does not know, and the sync client's tests failed
with *Failed to load url sqlite* whenever they shared a worker with another file.

Names claimed, grepped first: `dag-sync-row`, `dag-sync__*`, `dag-sync-spin`, `data-dag-sync-*`, the
Settings tab `sync`, and the event `dag:vault-sync` (in `test/prefs.test.ts`'s list).

**Out, and why:** hosting it (the api server's own file is [`api.md`](api.md), and whoever wants it
runs it); billing (the usage ledger and `/metrics` are in place for when it is decided); chunking a
large file; sharing a vault between accounts; history a person can browse; and real-time co-editing,
which the file model cannot be.

## What the server cannot forge

The server, and anybody holding a device token on the account, holds every sealed `meta` and every
sealed blob a vault ever had, and can commit any of them again. Sealed to its key alone (protocol 1),
a `meta` could be committed over another file's blob (a **re-pointed** file), or again after newer
versions (a **replayed version**, or a **replayed delete**), and every linked device would open it,
so a file could be swapped, rolled back or deleted everywhere. Protocol 2 closes each:

- **A `meta` is sealed with the log entry it belongs to** — `{v: 2, key, blob, parent, …}` inside
  the seal, under the associated data `meta/v2:<key>` (`api/protocol/meta.ts`). `openMeta` takes the
  entry's `key`, `blob` and `parent` and throws `MetaRefused` unless all three are the sealed ones.
  The server's commit rule makes a device token's replay land over the *current* head, so its parent
  is never the sealed one. A head carries its `parent` too (`heads.parent`), so a device reading
  heads after an `ES_HORIZON`, or on its first link, checks a head as it checks a log row.
- **An entry for a key this device holds must be over that version or a later one** (`opened` in
  `engine.ts`). The operator can write the parent the seal names into its own log; it cannot make that
  parent newer than the version this device already has, because a key's heads are a chain and every
  version this device knows is a link in it. `null` over a key held here is a replayed create.
- **The path is the key's, and the bytes are the size the `meta` says.** Neither can be forged without
  the vault key, which is why they are checks beyond the seal: they catch a writer that has the key
  and a bug.
- **A refusal stops the pull before it writes or moves the cursor.** The next pull meets it again: a
  forged entry is the vault's `error` until somebody looks, never a file silently replaced. A device
  that has never synced cannot tell a version the operator withheld from one that never existed; no
  log can, without a party the devices trust beyond the server.
- **A push seals in the round that commits**, over the parent that round read, so an `ES_STALE` that
  pulls, merges and pushes again seals again.

## Quotas and history

What a plan's `storage_bytes` counts is **live** bytes (blobs a head names) **plus pending** bytes
(uploaded, never named by a commit). Superseded **history** has an allowance of its own.

- **A blob PUT is refused `ES_QUOTA`** when live + pending + this upload would pass `storage_bytes`:
  once at the headers, before a byte is read, and again as the row is written, under an advisory lock
  per account (`Meta.addBlob` with a quota), so two uploads cannot both take the last room. Bytes
  refused at the second check are an orphan file for the collector, not deleted on the spot: another
  upload of the same id may have written the same file. An id already held is answered as before and
  counts nothing. The commit's own check (live after the commit) stays, for a commit that names a
  blob back out of history.
- **A blob is pending until a commit names it** (`blobs.committed`), and the collector forgets a
  pending blob after `PENDING_MS` (an hour, the orphan window). A commit that names one after that is
  `ES_NO_BLOB`, which the client already answers by uploading it again.
- **History is bounded in bytes.** `Plan.history_bytes`, and when it is null, as much as
  `storage_bytes` (so a plan with a quota has a bounded history without saying so; a plan with neither
  is unlimited, as `free` is). After every commit, `Meta.trimHistory` drops the committing vault's
  oldest history until the account is back under it — first blobs no log row names any more, then the
  oldest superseded log rows (never a key's newest), with the blobs they leave unnamed — and raises the
  horizon. A commit only adds history to its own vault, so trimming that vault holds the bound. The
  collector runs the same trim on every vault, for an allowance lowered between commits. **The bytes
  win over the window**: past the allowance, history inside `history_days` goes too, and a device
  offline that long reads `ES_HORIZON` and resyncs.
- `GET /v1/account` says `storage_pending` beside `storage_live` and `storage_history`;
  `anydag-api plan set … --history-bytes N` sets the allowance.

## Protocol 2, and an older peer

The seal binding and the head's `parent` change what a peer must understand, so `PROTOCOL` is 2,
and a peer of protocol 1 (AnyDag 0.2.0) **fails with a sentence, never by accepting or corrupting
data**. There is no production sync server yet and every sync feature is behind the `cloud` switch,
so nothing is migrated in place:

- **Every `/v1` request says `anydag-sync-protocol: 2`, and every answer says it back**
  (`PROTOCOL_HEADER`). The server refuses a request that says another number, or none (a 0.2.0
  client), with `ES_PROTOCOL` (426) before auth: such a client cannot pair, pull or commit, and so
  can neither read a `meta` it would misread nor write one protocol-2 devices would refuse. The client
  refuses an answer that says another number, or none (a 0.2.0 server, which would not keep `parent`
  on a head or count pending bytes), with `ES_PROTOCOL` and a message naming which side to update.
  `/v1` and `/v1/health` (whose bodies say the protocol), `/v1/ready` (a probe that sends none),
  `/v1/logs`, `/v1/feedback`, the poke stream and `/v1/admin/*` are not checked: nothing they carry
  changed.
- **A protocol-1 `meta` is refused by name.** A 0.2.0 server's database migrates (`002-quota-and-binding.sql`:
  `blobs.committed` backfilled from the log and heads, `heads.parent` from each head's own log row,
  `plans.history_bytes`), but the `meta`s in it are sealed to the key alone: `openMeta` tries the old
  associated data only to say *sealed by an older AnyDag*, and the pull stops there. Such a vault is
  uploaded again from a device that has it. A 0.2.0 client that met a protocol-2 `meta` could not
  open it (`Unsealed`, nothing written) — and is refused before it gets one.
- **The sync server's URL is `https://`**, or `http://` only for `localhost`, `127.0.0.0/8` or `::1`
  (`serverUrl` in `link.ts`): the device token is in every request, and in the clear anybody on the
  path could sync as the device.
