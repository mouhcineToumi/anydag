#!/usr/bin/env bash
# `npm run dev` — the Vite dev server, with `anydag serve` behind it.
#
# The routes are the local server's (`server/`): one Node process serving one vault,
# with no account. In development the vault is `boards/local/`, which is where this
# repository's own boards already are, and the app's home — the SQLite index, the app's settings,
# `server.json` — is `.dev-home/`, so a dev server never touches the real `~/.anydag`.
#
# Vite proxies `/__board` and `/api` to it and adds the token, so this script has to know it
# before the server has started: a fresh random one per run, unless `ANYDAG_TOKEN` says otherwise.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ANYDAG_API_PORT:-3601}"
export ANYDAG_HOME="${ANYDAG_HOME:-$PWD/.dev-home}"
# The build's feature switch (`server/features.ts`): dev carries the server-backed features — sync,
# the logs question, feedback. `ANYDAG_CLOUD=off` puts any of them back off for a session.
export ANYDAG_CLOUD="${ANYDAG_CLOUD:-on}"
VAULT="${ANYDAG_VAULT:-$PWD/boards/local}"
mkdir -p "$VAULT"

if [ -z "${ANYDAG_TOKEN:-}" ]; then
  ANYDAG_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  # A server left running from an earlier `npm run dev` has its own token in `server.json`. Reuse
  # that token rather than mint one the running API will not accept, so the second start still works.
  OLD_TOKEN="$(node -e '
    try {
      const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (Number(s.port) === Number(process.argv[2]) && typeof s.token === "string") process.stdout.write(s.token);
    } catch {}
  ' "$ANYDAG_HOME/server.json" "$PORT")"
  if [ -n "$OLD_TOKEN" ] && curl -fsS -H "x-anydag-token: $OLD_TOKEN" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ANYDAG_TOKEN="$OLD_TOKEN"
  fi
fi
export ANYDAG_TOKEN

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
