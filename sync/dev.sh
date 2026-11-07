#!/usr/bin/env bash
# `npm run sync:dev` — anydag-sync from source against Postgres in Docker:
# `db` from sync/compose.yaml, esbuild watching the sources, and Node restarting the
# bundle whenever it is rewritten.
#
# Load-bearing: the ports come from the environment or .env (ANYDAG_SYNC_PORT, default 8790;
# ANYDAG_SYNC_PG_PORT, default 55432) so a worktree runs its own pair beside another's, and never on
# 3500; DATABASE_URL set beforehand wins, so the same script serves a Postgres of your own. The watcher
# is this script's child and goes when it does.
set -euo pipefail
cd "$(dirname "$0")/.."

# .env fills in what the environment does not already say: a port given on the command line wins.
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] || export "$key=$value"
  done < .env
fi

export ANYDAG_SYNC_PORT="${ANYDAG_SYNC_PORT:-8790}"
export ANYDAG_SYNC_PG_PORT="${ANYDAG_SYNC_PG_PORT:-55432}"
export ANYDAG_SYNC_DATA="${ANYDAG_SYNC_DATA:-$PWD/.dev-home/sync}"
export DATABASE_URL="${DATABASE_URL:-postgres://anydag:anydag@127.0.0.1:${ANYDAG_SYNC_PG_PORT}/anydag_sync}"

if [[ "$ANYDAG_SYNC_PORT" == 3500 ]]; then
  echo "sync/dev.sh: 3500 is the app's port; pick another ANYDAG_SYNC_PORT" >&2
  exit 2
fi

docker compose -f sync/compose.yaml up -d --wait db
node sync/build.mjs

node sync/build.mjs --watch &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT INT TERM

node --watch-path=sync/dist sync/dist/anydag-sync.mjs serve
