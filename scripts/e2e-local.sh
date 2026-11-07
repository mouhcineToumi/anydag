#!/usr/bin/env bash
#
# The Playwright suite, on this machine — CI does not run it (its header says why).
#
# It runs against `npm run dev`: Vite in front of `anydag serve` on the vault `boards/local/`
# (`scripts/dev.sh`). The only place the **dev size assertion** fires — it is gated
# `if (!import.meta.env.DEV) return` and reports through `console.error`, which the suite fails
# on — and the only place the **45 visual baselines** are compared at all.
#
# **The suite runs at low CPU priority**, browsers and dev server included: it is CPU-bound on a
# laptop, and a push that makes the editor it was pushed from stutter for the length of the run
# is the complaint this file exists to answer. `ANYDAG_E2E_NICE=0` runs at normal priority.
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_PORT="${ANYDAG_PORT:-3500}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# **The baselines are Playwright's own Chromium's, and no other browser's**. Every image
# under `e2e/*-snapshots/` — the 45 reference screenshots and `export.spec.ts`'s item — was taken
# with the pinned build, and another build lays text out a few pixels differently: the system
# Chromium draws the architecture item 28px narrower, so with `ANYDAG_CHROMIUM=/usr/bin/chromium`
# in a worktree's `.env` the hook refused every push on `export.spec.ts:16`, on a size, before one
# pixel was compared. It read as a regression, `CLAUDE.md` called it "the browser, not the change",
# and the answer every time was `ANYDAG_NO_HOOK=1` — the gate turned off by a setting that never
# said what it did. So the dev run asks which browser it has before anything starts: Playwright's
# own; another one *with* `ANYDAG_NO_SNAPSHOTS=1`, which says the screenshots are not compared while
# the rest of every check still runs; or nothing, saying why. Read after `.env` is, so an override
# kept there counts.
assert_browser() {
  if [ -n "${ANYDAG_CHROMIUM:-}" ]; then
    if [ -n "${ANYDAG_NO_SNAPSHOTS:-}" ]; then
      echo "e2e: ANYDAG_CHROMIUM=$ANYDAG_CHROMIUM — comparing no screenshots (ANYDAG_NO_SNAPSHOTS)"
      return 0
    fi
    cat >&2 <<EOF
e2e: refusing to start — nothing has been touched.

     ANYDAG_CHROMIUM=$ANYDAG_CHROMIUM is set (in the shell or in .env), so the suite would run in
     that browser. The committed screenshots were made with Playwright's own Chromium, and another
     build draws text a few pixels wider or narrower: the checks would fail on the browser rather
     than on the change. Either

       unset it, and take it out of .env, so Playwright uses its own build —
         npx playwright install chromium     # if that build is not installed yet

       or keep it and compare no screenshots, saying so:
         ANYDAG_NO_SNAPSHOTS=1
EOF
    return 1
  fi
  local own
  own="$(node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())')"
  [ -x "$own" ] && return 0
  cat >&2 <<EOF
e2e: refusing to start — Playwright's Chromium is not installed:
       $own
     Install the build the screenshots were made with:
       npx playwright install chromium
EOF
  return 1
}

assert_browser

# Three browsers at a time, not Playwright's half-the-cores. The suite is CPU-bound and every worker
# is a Chromium beside the dev server, so on a laptop that is also running everything else a wider
# run buys little time and costs the machine: six at once pushed a 23 GB machine into swap and made
# it unusable for the length of the push. `nice` lowers the CPU priority and does nothing for memory.
# ANYDAG_E2E_WORKERS widens it again on a machine with room; an explicit `--workers` wins over both.
WORKERS="${ANYDAG_E2E_WORKERS:-3}"

printf '\n\033[1m— the suite, against the dev server on %s, %s at a time — baselines compared\033[0m\n' "$DEV_PORT" "$WORKERS"
ANYDAG_PORT="$DEV_PORT" nice -n "${ANYDAG_E2E_NICE:-10}" npx playwright test --reporter=line --workers="$WORKERS" "$@"
echo
echo "e2e: green"
