#!/usr/bin/env bash
#
# deploy/backup.sh — the api's backup: Postgres, the blobs, and the logs, one encrypted file,
# uploaded to object storage at a provider other than the one this machine runs on.
#
#   ./backup.sh
#
# Reads the machine's deploy/.env (or the environment) for:
#   AGE_PUBLIC_KEY       an age PUBLIC key — the private key never touches this machine, so a
#                        backup can be read only where that key is;
#   BACKUP_REMOTE        where uploads go, as rclone names a remote: `remote:bucket/prefix`;
#   BACKUP_KEEP_DAILY    (7) — how many dailies to keep on the remote;
#   BACKUP_KEEP_WEEKLY   (4) — how many weeklies to keep on the remote.
#
# What it does: `pg_dump` (format `custom`, so a restore is parallel and selective), a tar of the
# api's named volume (`blobs/` and `logs/`), the two into one file, encrypted with age to the
# public key. A Sunday's backup is written as a weekly one; every run is also a daily. The
# rotation is on the remote: when a new backup is in, the dailies and weeklies beyond their
# numbers are deleted by their names' stamps.
#
# What it refuses: to run without the two variables (a backup without a place to go or a key to
# age to is a file on a machine that is itself the risk), and to run when the stack is not
# answering — a backup taken from a stack whose /v1/ready doubts itself copies the doubt.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] || export "$key=$value"
  done < .env
fi

: "${AGE_PUBLIC_KEY:?set AGE_PUBLIC_KEY to an age public key — the private key never touches this machine}"
: "${BACKUP_REMOTE:?set BACKUP_REMOTE to an rclone remote, e.g. remote:bucket/anydag}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"

step() { printf '\n\033[1m— %s\033[0m\n' "$1"; }

step "the stack is answering"
for service in caddy api db; do
  running="$(docker compose -f compose.yaml ps --format '{{.Service}} {{.State}}' | grep -x "$service running" || true)"
  [[ -n "$running" ]] || { echo "the $service service is not up — start it first" >&2; exit 1; }
done
curl -fsS --insecure "https://${CADDY_DOMAIN:-localhost}/v1/ready" >/dev/null

STAMP="$(date -u +%Y%m%d-%H%M)"
NAME="daily-${STAMP}.tar.gz.age"
[[ "$(date -u +%u)" == 7 ]] && NAME="weekly-${STAMP}.tar.gz.age"

work="$(mktemp -d "${TMPDIR:-/tmp}/anydag-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT

step "postgres: pg_dump"
docker compose -f compose.yaml exec -T db pg_dump -U anydag --format=custom --file=/tmp/db.dump anydag
docker compose -f compose.yaml cp db:/tmp/db.dump "$work/db.dump"
docker compose -f compose.yaml exec -T db rm -f /tmp/db.dump

step "the api's volume: blobs and logs"
docker run --rm -v anydag_api_data:/data:ro -v "$work:/out" alpine \
  tar -czf /out/blobs-logs.tar.gz -C /data blobs logs

step "age: both into one file, encrypted to the public key"
tar -czf "$work/payload.tar.gz" -C "$work" db.dump blobs-logs.tar.gz
age -r "$AGE_PUBLIC_KEY" -o "$NAME" "$work/payload.tar.gz"

step "rclone: upload and rotate"
rclone copyto "$NAME" "${BACKUP_REMOTE%/}/$NAME"
for prefix in daily weekly; do
  keep="$KEEP_DAILY"
  [[ "$prefix" == weekly ]] && keep="$KEEP_WEEKLY"
  # `|| true`: a prefix with no backups yet (no weekly one before the first Monday) is not a failure.
  rclone lsf "$BACKUP_REMOTE" --files-only | { grep "^${prefix}-" || true; } | sort -r | tail -n +"$((keep + 1))" \
    | while IFS= read -r file; do
        rclone deletefile "${BACKUP_REMOTE%/}/$file"
      done
done

rm -f "$NAME" # the encrypted file does not stay on the machine it backs up
printf '\nbackup: %s%s (%s)\n' "$BACKUP_REMOTE" "/${NAME}" "$(rclone lsl "${BACKUP_REMOTE%/}/$NAME" | awk '{print $2, $3}')"
