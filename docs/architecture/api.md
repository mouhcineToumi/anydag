# The api server

> `api/`: the one hosted service — sync, anonymous logs and the feedback relay — its config, what
> it stores and what it never stores, and running it here or on one machine.

## The api server

`api/`. One Node process over Postgres (or PGlite when `DATABASE_URL` is unset), a self-hoster's
server and the one api.anydag.com runs for what the app needs from us: end-to-end-encrypted
**sync**, opt-in anonymous **logs**, and the **feedback relay** (#96). Later it also holds
**accounts** for people who link their local app to an account they own — that is a separate
issue, and nothing here rules it out: accounts stay a table in `Meta`, and auth stays the one
middleware in `auth.ts`.

The server is **open source in this repository, on purpose**: what it does with what the app
sends is readable, byte for byte, in `api/server/`, and secret scanning (#98) is what makes it
impossible to commit a key or token to it. Every secret arrives as an environment variable at
start, never a build argument, and never a value in output.

| Where | Owns |
|---|---|
| `api/server/config.ts` | every variable, read once; old `ANYDAG_SYNC_*` names read for one release with a deprecation warning; `describe`, what boot prints; the production checks |
| `api/server/app.ts` | the Hono app: which path may ask, which feature is off, error mapping, per-route metrics |
| `api/server/routes/service.ts` | `GET /v1` (what runs) and `GET /v1/ready` (the database answers) |
| `api/server/routes/{pair,vaults,blobs,commit,changes}.ts` | sync's surface under `/v1`, gated by a device token |
| `api/server/routes/logs.ts` | `POST /v1/logs`, the per-address and whole-server rates |
| `api/server/routes/feedback.ts` (#96) | `POST /v1/feedback`, stateless: no file, no row, no payload in logs |
| `api/server/client.ts` → `routes/http.ts` | `clientAddress`: the client address, the proxy's word only when `ANYDAG_API_TRUST_PROXY` says so |
| `api/server/meta/pg.ts`, `blobs/disk.ts` | the database (`Meta`) and the blob store (`DiskBlobs`) |
| `api/{Dockerfile,.dockerignore}` | the image: non-root, nothing in the context but `dist/` |
| `deploy/` | the one machine it runs on: compose with Caddy and Postgres, `backup.sh`, `restore.sh`, and the README |

**Every feature has a switch, and an `off` feature does not exist.** `ANYDAG_API_SYNC`,
`ANYDAG_API_LOGS` and `ANYDAG_API_FEEDBACK` are `on|off`; an off feature's routes answer 404 —
`ES_NOT_FOUND`, before any token is read — and `GET /v1` says so, which is how the app can tell
that feedback is not available on a given server without trying it. A self-hoster runs it for
sync alone with logs and feedback off; nothing else in the server needs to know.

**`GET /v1`** answers `{name, version, features}`; `features.feedback` there is the relay's
*availability*, not its switch — on without its GitHub token and repo is reported `false`,
matching the `503 ES_UNAVAILABLE` the route would answer (#50). `GET /v1/health` stays the
liveness check. **`GET /v1/ready`** asks the database with one `SELECT`: it is the healthcheck
the deploy stack watches, and 503 with nothing of the database's own words in the body.

**The client address is trusted only from a configured proxy.** `ANYDAG_API_TRUST_PROXY` is
`off` by default — the socket's own address, so a forged `X-Forwarded-For` cannot move a rate
limit's bucket — or a hop count, and then the address the *last trusted proxy added* is who
asked: read backwards from the right, the entries a proxy appended are the header's rightmost
ones. Every rate-limited route reads its address through the one helper, `clientAddress` in
`routes/http.ts`; a route that does not is a defect, and the unit test that pins it
(`api/test/service.test.ts`) shows the off case and the one-hop one.

**A secret never prints.** `config.ts` holds the closed list (`SECRET_VARS`); from error to boot
line, a secret's value is `<redacted>`. `NODE_ENV=production` refuses to start with an admin
token under 32 characters, and that is the whole production check: a feature missing *its* own
secret is not a crash — feedback without its token answers 503 at request time, which is one
feature down instead of the server down (#50's contract, kept).

## What it stores, and what it never stores

| It keeps | It never keeps |
|---|---|
| sealed (ciphertext) blobs in `<data>/blobs/`, named by the id of the vault that sealed them | any path, any name, any byte of a vault's files |
| the sealed metadata and the gapless log of a vault's commits in Postgres | any account of *whose* vault it is beyond a 10-character id |
| anonymous logs as one JSONL file a day in `<data>/logs/`, cleaned again at write time (`protocol/logs.ts`) | anything about a log request — no address, no header |
| pairing codes by sha256, devices by token sha256 | a device token, a passphrase, a recovery code: each is shown once and kept nowhere |
| a usage ledger per account per day (counts, bytes, active devices) | who used what beyond the counts |
| the feedback relay's nothing at all (stateless #96) | a file, a database row, a payload in a log |

**Release builds point at `https://api.anydag.com`.** `server/build.mjs` bakes the logs URL and
the feedback URL into a build the release or nightly workflow makes (`desktop-build.yml`'s
`logs_url` and `feedback_url` — a checkout's build bakes in none). Logs are still sent only
after the person said yes, and only through the local server; sync is still linked only on
purpose; **no default sync server**. Nothing reads a baked address until #103's `cloud` switch
is on, and a release publishes no `anydag-api` binary or image — the server runs from a checkout
(here, or `deploy/`).

## Running it

| Run | Does |
|---|---|
| `npm run api:serve` | build `api/dist/` and serve on `ANYDAG_API_PORT` (8790), PGlite in `ANYDAG_API_DATA` |
| `npm run api:dev` · `api:db` | the server and Postgres in api/compose.yaml · Postgres alone, on `ANYDAG_API_PG_PORT` |
| `node api/dist/anydag-api.mjs account add <name>` · `pair <account>` | an account · a one-time code a device pairs with |
| `npm run api:test` · `api:test:pg` · `api:converge` | the suites: the routes over PGlite, the suites on the compose Postgres, a hundred convergence seeds |
| `docker build api/` · `npm run api:up` | the image (from `api/dist/`; non-root, `.env*` never in the context) · the dev stack up |
| `deploy/` | the production machine: `deploy/compose.yaml` (Caddy, api, Postgres), `backup.sh`, `restore.sh`, `deploy/README.md` |

`deploy/` is the whole deployment story: bring up, upgrade, watch (`/v1/ready` and disk), back
up, restore — and the restore is **tested in CI** (`.github/workflows/deploy.yml`), every time
`deploy/` or `api/` changes: a stack with data is backed up, restored into a fresh one, and read
back. An S3-compatible blob backend is a later step, taken only when the blobs outgrow a cheap
volume or more than one api instance needs them; `Blobs` stays the only way into file storage,
and no object store runs beside this server.

Things that bite in this directory: the **convergence harness is the instrument**
(`api/test/converge.test.ts`) — run it loaded before believing any change to the sync rules, and
read [`sync.md`](sync.md) for the model it holds; **PGlite is one process's** — the CLI refuses a
database another live process holds; **the rate limits are per address only because
`clientAddress` says who that is** — through one helper, or a header an attacker chooses to send
is the identity.

Names claimed, grepped first: the env names, which are all one family (`ANYDAG_API_*`) and
documented in `api/.env.example`; the paths in `deploy/`; and nothing in `tasks/calendar/`
spaces, the page's CSS, or `data-dag-*`.

**Out, and why:** multi-instance scaling (one Postgres, one volume — an S3-compatible backend is
the precondition, a later step); accounts and sign-in (a follow-up issue; nothing here rules it
out); a managed cloud database or object store as the default (one cheap machine is the shape);
and the machine's provisioning itself (#101 — provider, DNS, monitoring).
