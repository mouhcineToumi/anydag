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
| `api/server/routes/service.ts` | `GET /v1` (what runs), `GET /v1/ready` (the database answers) and `GET /v1/openapi.json` (the document) |
| `api/protocol/schema.ts` · `api/server/openapi.ts` | every `/v1` body and answer as a zod schema, held to `wire.ts` · the route table the OpenAPI document is made from (*The OpenAPI document*) |
| `api/openapi/` | the builder and the Markdown renderer every spec goes through, shared with the local server's (#531) |
| `api/server/routes/{pair,vaults,blobs,commit,changes}.ts` | sync's surface under `/v1`, gated by a device token |
| `api/server/routes/logs.ts` | `POST /v1/logs`, the per-address and whole-server rates, and the day file's cap (`ANYDAG_API_LOGS_DAY_MB`, 64 by default) |
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

**The open logs route is bounded in bytes, not only in requests** (#10). A rate is per address,
and addresses are cheap — one sender at its thirty a minute writes about 8 MB a minute — so a day's
file stops at `ANYDAG_API_LOGS_DAY_MB` and a batch past it is answered `{accepted: 0}`: the logs
never hold more than that times `ANYDAG_API_LOGS_DAYS`. A body with no `Content-Length` is cut
off at the batch cap as it arrives (`bodyLimit`), never read whole before it is measured.

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

## The OpenAPI document

The server describes itself in **OpenAPI 3.1, generated from the code and never written by hand**
(#530): `GET /v1/openapi.json` answers it, with no token and no protocol header, and
[`docs/api/sync.openapi.json`](../api/sync.openapi.json) is the committed copy, with its reference
beside it ([`docs/api/sync.md`](../api/sync.md)) — what an agent or a self-hoster reads instead of the
handlers.

| Where | Owns |
|---|---|
| `api/protocol/schema.ts` | every `/v1` request and answer as a zod schema; the handlers read their bodies through these (`read`, `parse` in `routes/http.ts`) |
| `api/server/openapi.ts` | the route table: method, path, who may ask, the switch it is behind, parameters, body, every answer with its status and `ES_*` codes; `syncDocument(features)` |
| `api/openapi/document.ts` · `markdown.ts` | the builder (route table + zod → OpenAPI, through zod's own `z.toJSONSchema`) and the reference renderer, both generic |
| `scripts/openapi.mjs` | `npm run openapi` writes every spec in its `SPECS` list; `npm run check:openapi`, in `npm run checks`, fails on a committed copy the code no longer makes |

**Why no `@hono/zod-openapi`.** It works with zod 4, but it registers a route through its own
`app.openapi(createRoute(…))` and reads the body through its own validator: a body that is not JSON,
or not sent as JSON, would be refused with its answer instead of ours, and every message a route says
today would change. Here routes stay plain Hono, the body is read through the same zod schema the
document is made from, and zod 4 writes the JSON Schema itself — so no dependency was added for it,
and the local server's 170 routes (#531) get a table of their own rather than a rewrite.

Load-bearing:

- **`wire.ts` stays the contract, and the schemas cannot disagree with it.** `wire.ts` is plain
  TypeScript the app's sync client takes verbatim; `schema.ts` ends with a list holding each
  schema's parsed type identical to its `wire.ts` type, which `npm run checks`' typecheck compiles —
  a field added, dropped, made optional or retyped on one side does not build. *Frozen* still holds:
  a shape an older peer would misread moves `PROTOCOL`.
- **A schema refuses with the old sentence, in the old order.** Each check carries the message the
  hand-written one said, fields are declared in the order they were checked, and `parse` answers the
  first fault in that order (an earlier list element's first; an element's own fault, a key changed
  twice, before its fields'). `api/test/schema.test.ts` keeps the hand-written checks verbatim and
  reads thousands of bodies both ways. Where a route looked something up between two checks
  (`…/accounts/{id}/plan`), or wrote between them (`PUT /v1/admin/plan`), it still does: `body`,
  then `parse` in halves.
- **A request is described as it is accepted**, sometimes wider than `wire.ts` (an optional field may
  be `null`; `report`'s counts may be left out): the document shows the input form, the handler gets
  the wire's. The log batch is described from `EVENTS`, the table `cleanBatch` reads — it keeps what it
  can and refuses nothing — and the feedback form's caps are `feedbackProblem`'s.
- **The table is held to the app both ways** (`api/test/openapi.test.ts`): every route `createApp`
  registers is a row and every row a route (a `HEAD` row is Hono's `GET`); the document is a valid
  OpenAPI 3.1 document by the OpenAPI Initiative's own schema; and the routes of a switched-off
  feature are absent from `/v1/openapi.json` and answer 404.
- **Every answer the api suites record is held to the document.** The test harness hands each
  answer back through `api/test/spec.ts`: a status the row does not list, a missing protocol header,
  a body its schema refuses — with every object closed, so an unnamed field fails too — fails the
  test that met it. A route answered on a path the document lacks fails unless it is the app's 404.
- **`info.version` is the protocol**, not the build: the committed copy changes when the API does,
  not on every release. `GET /v1` says the build.

Adding a route: a row in `api/server/openapi.ts`, its body and answer in `schema.ts` (and in
`wire.ts` when a client reads it), `npm run openapi`, and commit the two files in `docs/api/`.
`docs/parity.json` does not list the api server's routes: it is the local app's surface through the
page, the CLI and MCP, and none of the three calls `anydag-api` (the app's own server does); the
api server's two-way rule is the table above.

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
| `npm run openapi` · `check:openapi` | write `docs/api/sync.openapi.json` and `docs/api/sync.md` from the code · fail when they are stale |
| `docker build api/` · `npm run api:up` | the image (from `api/dist/`; non-root, `.env*` never in the context) · the dev stack up |
| `deploy/` | the production machine: `deploy/compose.yaml` (Caddy, api, Postgres) and its tunnel override, `backup.sh`, `restore.sh`, `check-disk.sh`, `provision.sh` and the systemd timers, `deploy/README.md` |

`deploy/` is the whole deployment story: the machine (`provision.sh`, then the maintainer's own
steps, in order, in `deploy/README.md`), bring up — directly on a public address, or behind a tunnel
with `ANYDAG_API_TRUST_PROXY=2` (`compose.tunnel.yaml`) — upgrade, watch (`/v1/ready`, the disk
and the nightly backup, each an alert), back up, restore — and the restore is **tested in CI** (`.github/workflows/deploy.yml`), every time
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
and the parts of the machine only the maintainer can do — the provider account, DNS, the secrets,
the monitoring service's checks (`deploy/README.md`, *The machine*, lists them in order).
