#!/usr/bin/env bash
#
# `npm run api:demo` — sync working end to end on this machine, with no browser.
#
# Builds the api server, runs it on PGlite in a temp folder, makes an account and two pairing codes,
# then drives two vaults — each its own folder and its own app home, as two devices would be —
# through the CLI in-process: A pairs and uploads (and prints the recovery code), B pairs and
# downloads, an edit on A reaches B, and the same line edited on both becomes a conflict copy.
# Everything is under one temp folder and the server is stopped by pid on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ANYDAG_API_DEMO_PORT:-8795}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/anydag-api-demo.XXXXXX")"
SYNC="node api/dist/anydag-api.mjs"
export ANYDAG_API_DATA="$ROOT/server" ANYDAG_API_PORT="$PORT" ANYDAG_API_HOST=127.0.0.1
export ANYDAG_API_PUBLIC_URL="http://127.0.0.1:$PORT"
URL="$ANYDAG_API_PUBLIC_URL"
PASS="correct horse battery"
SERVER_PID=""
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

# a <command...> / b <command...>: the CLI as device A or B (own home, own vault).
mkdir -p "$ROOT/a/vault" "$ROOT/b/vault" "$ROOT/a/home" "$ROOT/b/home"
A() { ANYDAG_HOME="$ROOT/a/home" node cli/anydag.mjs --vault "$ROOT/a/vault" "$@"; }
B() { ANYDAG_HOME="$ROOT/b/home" node cli/anydag.mjs --vault "$ROOT/b/vault" "$@"; }
code_of() { awk '/^code:/ { print $2 }'; }

step "build the api server"
node api/build.mjs >/dev/null

step "make an account and two pairing codes (the database is opened by one process at a time)"
$SYNC account add demo
CODE_A="$($SYNC pair demo | tee /dev/stderr | code_of)"
CODE_B="$($SYNC pair demo | code_of)"

step "start the api server on $URL"
$SYNC serve >"$ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 80); do curl -fsS "$URL/v1/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -fsS "$URL/v1/health"; echo

step "A: a vault with one note"
printf -- '---\ntitle: Plan\n---\n\nline one\nline two\nline three\n' >"$ROOT/a/vault/Plan.md"
ls "$ROOT/a/vault"

step "A: pair, then upload (the recovery code is shown once)"
A sync pair "$URL" "$CODE_A" --device laptop
printf '%s\n' "$PASS" >"$ROOT/pass"
A sync link --upload --passphrase-file "$ROOT/pass"
REMOTE="$(A sync status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).remote))')"
echo "remote vault: $REMOTE"

step "B: pair, then download $REMOTE"
B sync pair "$URL" "$CODE_B" --device phone
B sync link --download "$REMOTE" --passphrase-file "$ROOT/pass"
echo "B now holds:"; ls "$ROOT/b/vault"
grep -q 'line two' "$ROOT/b/vault/Plan.md" && echo "Plan.md arrived intact"

step "an edit on A reaches B"
sed -i 's/line one/line one, edited on A/' "$ROOT/a/vault/Plan.md"
A sync now
B sync now
grep -q 'edited on A' "$ROOT/b/vault/Plan.md" && echo "B received: $(sed -n 5p "$ROOT/b/vault/Plan.md")"

step "the same line edited on both: nothing is lost, one becomes a conflict copy"
sed -i 's/^line three$/line three, A says this/' "$ROOT/a/vault/Plan.md"
sed -i 's/^line three$/line three, B says that/' "$ROOT/b/vault/Plan.md"
A sync now
B sync now || true
A sync now || true
B sync now || true
echo "--- A's vault"; ls "$ROOT/a/vault"
echo "--- B's vault"; ls "$ROOT/b/vault"
echo "--- B status"; B sync status || true
n="$(ls "$ROOT/b/vault" | grep -ci conflict || true)"
[ "$n" -ge 1 ] && echo "conflict copy kept on B" || { echo "expected a conflict copy on B" >&2; exit 1; }

step "devices on the account"
A sync devices
printf '\n\033[1mdemo done\033[0m\n'
