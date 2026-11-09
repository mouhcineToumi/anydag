#!/usr/bin/env bash
#
# deploy/restore.sh — an api's stack restored into an empty machine, the way the machine was
# before the disk went: Postgres from the backup's dump, the blobs and the logs unpacked into
# their named volumes, the stack up and answering.
#
#   ./restore.sh <backup.tar.gz.age> --age <identity.key>
#
# The backup may be a local file or an rclone remote (`remote:bucket/daily-….tar.gz.age`) — the
# object storage the backups live at. The age identity is a file *on this machine* given by
# `--age`: the private key never lived next to the backups, only where a restore is done.
#
# Refuses to run on a machine whose database already holds data, unless RESTORE_FORCE=1: a
# restore over live data is the one thing this file must never do by accident. `docker compose
# down -v` first, if the machine is to become the empty one to restore into.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] || export "$key=$value"
  done < .env
fi

usage() { echo "usage: $0 <backup.tar.gz.age> --age <identity.key>" >&2; [[ $# -gt 0 ]] && echo "$1" >&2; exit 2; }

backup=""
agekey=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --age) [[ -n "${2:-}" ]] || usage "--age needs a file"; agekey="$2"; shift 2 ;;
    -*) usage "unknown flag $1" ;;
    *) [[ -z "$backup" ]] || usage "one backup at a time"; backup="$1"; shift ;;
  esac
done
[[ -n "$backup" && -n "$agekey" ]] || usage

step() { printf '\n\033[1m— %s\033[0m\n' "$1"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/anydag-restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp "$agekey" "$work/identity.key"
chmod 0600 "$work/identity.key"

step "the database, and the refusal that keeps a live stack alive"
docker compose -f compose.yaml up -d --wait db
populated="$(docker compose -f compose.yaml exec -T db psql -U anydag -d anydag -tAc \
  "select coalesce(count(*), 0) from information_schema.tables where table_name = 'accounts'")"
if [[ "${populated:-0}" != "0" ]]; then
  [[ "${RESTORE_FORCE:-}" == 1 ]] \
    || usage "the database already holds data — restore into an empty machine (docker compose down -v), or RESTORE_FORCE=1"
fi

step "the backup, decrypted where its identity is"
rclone copyto "$backup" "$work/backup.tar.gz.age"
age -d -i "$work/identity.key" -o "$work/payload.tar.gz" "$work/backup.tar.gz.age"
tar -xzf "$work/payload.tar.gz" -C "$work"

step "postgres: pg_restore"
docker compose -f compose.yaml cp "$work/db.dump" db:/tmp/db.restore
docker compose -f compose.yaml exec -T db pg_restore --clean --if-exists --no-owner --username=anydag --dbname=anydag /tmp/db.restore
docker compose -f compose.yaml exec -T db rm -f /tmp/db.restore

step "the api's volume: blobs and logs, where they were"
docker run --rm -v anydag_api_data:/data:rw -v "$work:/restore" alpine \
  sh -c 'cd /data && tar -xzf /restore/blobs-logs.tar.gz'

step "the stack, and what came back"
docker compose -f compose.yaml up -d --wait
echo "accounts: $(docker compose -f compose.yaml exec -T db psql -U anydag -d anydag -tAc 'select count(*) from accounts')"
echo "blob bytes: $(docker run --rm -v anydag_api_data:/data:ro alpine sh -c 'cat /data/blobs/*/* 2>/dev/null | wc -c')"
echo "log day files: $(docker run --rm -v anydag_api_data:/data:ro alpine sh -c 'ls /data/logs/*.jsonl 2>/dev/null | wc -l')"
