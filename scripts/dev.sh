#!/usr/bin/env bash
# `npm run dev` — the Vite dev server, with `anydag serve` behind it.
#
# The routes are the local server's (`server/`): one Node process serving one vault,
# with no account. In development the vault is `boards/local/`, which is where this
# repository's own boards already are, and the app's home — the SQLite index, the app's settings,
# `server.json` — is `.dev-home/`, so a dev server never touches the real `~/.anydag`.
#
# Vite proxies `/__board` and `/api` to it and adds the token, which is fixed here
# (`ANYDAG_TOKEN`) because the proxy has to know it before the server has started.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ANYDAG_API_PORT:-3601}"
export ANYDAG_TOKEN="${ANYDAG_TOKEN:-dev-token}"
export ANYDAG_HOME="${ANYDAG_HOME:-$PWD/.dev-home}"
VAULT="${ANYDAG_VAULT:-$PWD/boards/local}"
mkdir -p "$VAULT"

if ! curl -fsS -H "x-anydag-token: $ANYDAG_TOKEN" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  node server/build.mjs
  node server/dist/anydag-server.mjs "$VAULT" --port "$PORT" --no-page --token "$ANYDAG_TOKEN" &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT INT TERM
  for _ in $(seq 1 60); do
    curl -fsS -H "x-anydag-token: $ANYDAG_TOKEN" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

npx vite "$@"
