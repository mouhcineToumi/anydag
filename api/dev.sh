#!/usr/bin/env bash
# `npm run api:dev` — anydag-api from source against Postgres in Docker:
# `db` from api/compose.yaml, esbuild watching the sources, and Node restarting the
# bundle whenever it is rewritten.
#
# Load-bearing: the ports come from the environment or .env (ANYDAG_API_PORT, default 8790;
# ANYDAG_API_PG_PORT, default 55432) so a worktree runs its own pair beside another's, and never on
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

export ANYDAG_API_PORT="${ANYDAG_API_PORT:-8790}"
export ANYDAG_API_PG_PORT="${ANYDAG_API_PG_PORT:-55432}"
export ANYDAG_API_DATA="${ANYDAG_API_DATA:-$PWD/.dev-home/sync}"
export DATABASE_URL="${DATABASE_URL:-postgres://anydag:anydag@127.0.0.1:${ANYDAG_API_PG_PORT}/anydag_api}"

if [[ "$ANYDAG_API_PORT" == 3500 ]]; then
  echo "api/dev.sh: 3500 is the app's port; pick another ANYDAG_API_PORT" >&2
  exit 2
fi

docker compose -f api/compose.yaml up -d --wait db
node api/build.mjs

node api/build.mjs --watch &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT INT TERM

node --watch-path=api/dist api/dist/anydag-api.mjs serve
