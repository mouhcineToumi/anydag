# Running the api: api.anydag.com

One small machine, three containers, and the api behind Caddy. The api is **`api/`** in this
repository, unchanged: this folder holds only what runs on the machine — the compose stack, its
TLS, its Postgres tuning, the backup and restore that keep it honest, the alerts, and the script
that makes a fresh machine ready for all of it. Nothing here depends on a provider: a VPS, a home
server, anything with Docker.

## The machine

What it needs: **1 GB of RAM** (2 GB is comfortable), 1 vCPU, a disk with room to grow — an
attached block volume if the provider has one, so the data survives rebuilding the VM — and
**outbound traffic that is not billed per GB** (every sync download is outbound; it is the cost
that grows). A public address for 80 and 443, or a tunnel (*Behind a tunnel*). Moving to another
machine later is a restore and a DNS change, so the first choice is not final.

In order — the steps marked **you** are the maintainer's, because they need an account, a key or
a decision; the rest is `provision.sh`:

1. **You:** the machine, on a current Debian or Ubuntu LTS. A login user with your SSH key in
   `~/.ssh/authorized_keys` (`ssh-copy-id`), and `sudo`.
2. The repository on it, owned by the login: `sudo apt-get install -y git`, then
   `sudo git clone https://github.com/mouhcineToumi/anydag.git /opt/anydag` and
   `sudo chown -R <login>: /opt/anydag`. Then
   `sudo deploy/provision.sh --user <login>` — add `--ssh-from <range>` to keep SSH to your VPN or
   Tailscale, and `--tunnel` behind a tunnel. It installs security updates that apply themselves,
   turns off password and root logins (and refuses to while that would lock you out), opens 22
   and 80/443 in `ufw` and nothing else, installs Docker, `age` and `rclone`, and enables the
   backup and disk timers. Log in again in a second terminal before closing the first.
3. **You:** DNS — an `A` (and `AAAA`) record for `api.anydag.com` to the machine. Behind a tunnel,
   the tunnel's own hostname instead.
4. **You:** the secrets, in `deploy/.env` (from `.env.example`, `chmod 600`). The admin token
   and the Postgres password (`openssl rand -base64 32`), the feedback relay's GitHub token, the
   tunnel's token if there is one, and `AGE_PUBLIC_KEY`. The age **private** key goes into the
   password manager and never onto this machine. **None of these is ever in the repository, an
   issue, a PR or a CI log.**
5. **You:** `sudo rclone config` — the backup destination, at a **different provider** from the
   machine's (as root: the timer runs as root). Its credentials stay in rclone's config there.
6. **You:** the three alerts (*Alerts*) — an uptime check on `/v1/ready`, and the two ping URLs in
   `deploy/.env`.
7. *Bring it up*, below; then `sudo systemctl start anydag-backup` once and check the backup
   reached the remote and the check went green.
8. **You:** the restore drill (*Restore*) onto a second, throwaway machine — once, before the
   launch is called done — and its line in the record there.
9. **You:** from a release build with `ANYDAG_CLOUD=on`, say yes to logs and send feedback: the
   feedback is an issue in the repository, and the logs are a line in today's day file.

**What the stack is.** Caddy — the only published ports (80 and 443), certificates done
automatically — in front of the api (which trusts that one hop, `ANYDAG_API_TRUST_PROXY=1`,
so a rate limit is per client and not per attacker), and Postgres on the compose network with no
published port. About 1 GB of RAM: every service has a memory limit, capped logs, and a
healthcheck, and Postgres' tuning is small on purpose (`postgres.conf`).

## Bring it up

```sh
cd /opt/anydag                       # the checkout provision.sh ran from
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -v "$PWD:/w" -w /w node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund && npm run api:build'   # api/dist/, which the image builds from
cp deploy/.env.example deploy/.env   # then fill it in (*The machine*, step 4); chmod 0600
docker compose -f deploy/compose.yaml up -d --wait
```

The bundle is built in a throwaway Node container, so the machine needs Docker and nothing else
(`api/.dockerignore` keeps everything but `api/dist/` out of the image). Behind a tunnel, every
`docker compose` here takes `-f deploy/compose.tunnel.yaml` as well.

`deploy/.env` is the machine's own file: `CADDY_DOMAIN` (the site Caddy requests certificates
for — a real domain over its published ports, or `localhost` for a test stack), the api's
`ANYDAG_API_ADMIN_TOKEN` (at least 32 characters; production refuses a shorter one at boot) and
Postgres' `POSTGRES_PASSWORD`. Generate both (`openssl rand -base64 32`); never invent them;
**never commit one** — `.gitignore` holds `deploy/.env`, and gitleaks scans the tree (#98).

The api listens for itself on 8790 inside the network only; a person reaches
`https://CADDY_DOMAIN/v1`, and the app tells what runs from `GET /v1`'s `features` — sync, logs
and feedback, each switchable off (`api/.env.example` explains every variable; deploy/compose.yaml
carries them through). A feature that is off answers 404, and `/v1` says so.

## Behind a tunnel

For a machine with no public address it can serve on — a home server behind CGNAT, an ISP that
blocks 80 and 443. The tunnel dials out, so nothing on the internet reaches the machine at all:

```sh
docker compose -f deploy/compose.yaml -f deploy/compose.tunnel.yaml up -d --wait
```

`compose.tunnel.yaml` (Cloudflare Tunnel, written out; another tunnel is the same shape) publishes
no port, serves Caddy as plain `http://` to the tunnel's connector on the compose network — TLS
ends at the tunnel's edge — and runs the connector with `TUNNEL_TOKEN`. In the tunnel's dashboard
the public hostname points at `http://caddy:80`.

**The hop count is the part to get right.** The edge writes the client's address into
`X-Forwarded-For`, and Caddy appends the connector's, so the api must trust **two** hops
(`ANYDAG_API_TRUST_PROXY=2`, which the override sets). One too few and every client is the
connector — one person's rate limit is everyone's; one too many and a client picks its own
address. Any other tunnel is checked the same way before it serves anyone: send a request from two
different networks and see two addresses in the api's rate-limit buckets.

On a home server, also: **upload bandwidth** is everyone's download speed — check a few vault
downloads at once fit; **power** — a UPS, or accept outages and let the uptime alert say when;
and the **ISP's terms**, which may not allow a public server. Backups at another provider matter
most here: one dead disk is otherwise everything.

## Alerts

Three, each of which must have fired once, in a test, before the launch is done:

| Alert | How | Test it |
|---|---|---|
| **Down** | an external uptime check (any HTTP monitor) on `https://api.anydag.com/v1/ready`, emailing on failure | `docker compose -f deploy/compose.yaml stop api`, wait for the mail, `start api` |
| **Disk over 70%** | `check-disk.sh`, hourly from `anydag-disk.timer`, pings `DISK_PING_URL` — `/fail` with the numbers when over | `sudo DISK_ALERT_PERCENT=1 deploy/check-disk.sh` |
| **No backup** | `backup.sh`, nightly from `anydag-backup.timer`, pings `BACKUP_PING_URL` — `/start`, then success or `/fail` | set the check's period to a day; a `/fail`: `sudo BACKUP_REMOTE=nowhere: deploy/backup.sh` |

The two pings follow healthchecks.io's convention (the URL, `/start`, `/fail`); a service that
alerts on silence as well as on failure is the point — a timer that stopped running sends nothing.
The checks never decide anything themselves: a monitoring service that is down costs an alert,
never a backup.

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
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -v "$PWD:/w" -w /w node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund && npm run api:build'   # api/dist/, which the image builds from
docker compose -f deploy/compose.yaml up -d --build --wait
docker compose -f deploy/compose.yaml exec -T api wget -qO- http://127.0.0.1:8790/v1/ready
```

Migrations run on every start (`api/server/main.ts`), so the new version's schema is applied by
starting it; `docker compose -f deploy/compose.yaml exec -T api node /app/anydag-api.mjs migrate`
does it again by hand.

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

**The drill.** CI restores into a fresh stack on the same runner; the drill restores into a
**second machine**, by hand, from the remote, with the private key from the password manager —
the path a dead machine would take. Once before launch, and after any change to `deploy/`'s
backup or restore. Afterwards, add a line here:

| Date | From | Onto | Took | What came back |
|---|---|---|---|---|
| — | — | — | — | not done yet |

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
