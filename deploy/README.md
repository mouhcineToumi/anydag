# Running the api: api.anydag.com

One small virtual machine, three containers, and the api behind Caddy. The api is **`api/`** in
this repository, unchanged: this folder holds only what runs on the machine — the compose stack,
its TLS, its Postgres tuning, and the backup and restore that keep it honest. #101 (provisioning
the machine: the provider, DNS, monitoring) is next after this; everything here runs on any VM
that has Docker,compose and the repository.

**What the stack is.** Caddy — the only published ports (80 and 443), certificates done
automatically — in front of the api (which trusts that one hop, `ANYDAG_API_TRUST_PROXY=1`,
so a rate limit is per client and not per attacker), and Postgres on the compose network with no
published port. About 1 GB of RAM: every service has a memory limit, capped logs, and a
healthcheck, and Postgres' tuning is small on purpose (`postgres.conf`).

## Bring it up

```sh
git clone git@github.com:mouhcineToumi/anydag.git && cd anydag
npm ci && npm run api:build          # the image builds from api/dist/ — see api/.dockerignore
cp deploy/.env.example deploy/.env   # then fill in the two secrets and the domain; chmod 0600
docker compose -f deploy/compose.yaml up -d --wait
```

`deploy/.env` is the machine's own file: `CADDY_DOMAIN` (the site Caddy requests certificates
for — a real domain over its published ports, or `localhost` for a test stack), the api's
`ANYDAG_API_ADMIN_TOKEN` (at least 32 characters; production refuses a shorter one at boot) and
Postgres' `POSTGRES_PASSWORD`. Generate both (`openssl rand -base64 32`); never invent them;
**never commit one** — `.gitignore` holds `deploy/.env`, and gitleaks scans the tree (#98).

The api listens for itself on 8790 inside the network only; a person reaches
`https://CADDY_DOMAIN/v1`, and the app tells what runs from `GET /v1`'s `features` — sync, logs
and feedback, each switchable off (`api/.env.example` explains every variable; deploy/compose.yaml
carries them through). A feature that is off answers 404, and `/v1` says so.

## Watch it

- **`/v1/ready`** — process up *and* the database answering. That is what the compose healthcheck
  reads, what to curl when the page says the api is down, and what a monitoring tool should watch.
- **Disk usage** — the blobs and logs sit on a named volume (`api_data`). `df -h` on the volume's
  host path; grow the block volume rather than pruning logs by hand (`ANYDAG_API_LOGS_DAYS` is
  the log's own retention; the api's collector handles the database's old rows).
- **`docker compose -f deploy/compose.yaml ps`** — three services, three `(healthy)`.
- **Memory** — `docker stats --no-stream` against the limits (128m Caddy, 384m api, 512m
  Postgres). A service at its limit restarts under `restart: unless-stopped`; it should not be
  normal that it does.

## Upgrade

```sh
git pull
npm run api:build
docker compose -f deploy/compose.yaml up -d --build --wait
node api/dist/anydag-api.mjs migrate        # the database is migrated by that one act
curl -fsSk "https://${CADDY_DOMAIN:-localhost}/v1/ready"
```

Migrations run on every start as well (`api/server/main.ts`), so the new version's schema is
applied by simply starting it — `migrate` is for doing it before the restart, when a rollout
wants the database first.

## Back up

```sh
apt-get install -y age rclone     # once
cp deploy/.env.example deploy/.env # AGE_PUBLIC_KEY and BACKUP_REMOTE go here too
deploy/backup.sh
```

What one backup holds: `pg_dump` of the whole database (format `custom`), a tar of the api's
volume (`blobs/` and `logs/`), both encrypted with `age` to a **public** key — the private key
never touches the machine, so a stolen disk cannot read its own backups. The upload goes to
`BACKUP_REMOTE` (rewrite: object storage at a provider **other than** the one this machine runs
on — the point of a backup is surviving the provider). Seven dailies and four weeklies are kept
on the remote; the rotate numbers are `BACKUP_KEEP_DAILY` and `BACKUP_KEEP_WEEKLY`. A backup is
taken from a healthy stack or not at all: the script checks `/v1/ready` first.

## Restore

```sh
deploy/restore.sh remote:bucket/anydag/daily-….tar.gz.age --age identity.key
```

Into an **empty** machine: the script refuses a database that already holds data
(`docker compose down -v` first, or `RESTORE_FORCE=1`); restores Postgres (`pg_restore`), unpacks
the blobs and the logs into their volume, brings the stack up, and prints what came back —
the account count, the blob bytes, the log day files. The restore is **tested in CI**
(`.github/workflows/deploy.yml`): a stack is started, data is written through Caddy, backed up,
restored into a fresh stack, and the same bytes are read back. Run the same locally with Docker:
the workflow is a small list of the same four commands.

## Rotate a secret

1. Set the new value in `deploy/.env` (a new token, a new Postgres password).
2. `docker compose -f deploy/compose.yaml up -d` — the api (and the database, for a password)
   restart with it. The api's boot line says what changed, and no secret anywhere.
3. The old one: remove it everywhere it hid — the machine's `.env`, the backup destination's
   copies (they are encrypted to the age key, not this one), and #50's GitHub token in
   repository settings, for the feedback token.
4. Take a backup (`deploy/backup.sh`): the next one is under the new age key, and the old key's
   copies keep on the remote until their rotation goes.

## What this folder is not

- **Not the app's docs**: the api's architecture is `docs/architecture/api.md`, its variables in
  `api/.env.example`.
- **Not a multi-machine story**: one instance, one Postgres, one volume. More instances start
  with an S3-compatible blob backend, which is a later step taken when the blobs outgrow a cheap
  volume (`docs/architecture/api.md` says so).
- **Not shared secrets**: nothing is committed here, and a build argument is never passed a
  secret — everything reaches the container as an environment value, at start.
