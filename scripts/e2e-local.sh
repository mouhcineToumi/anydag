#!/usr/bin/env bash
#
# The Playwright suite on **this machine's own browser, comparing no screenshots**.
#
#     npm run e2e:local                                   everything, on the host
#     npm run e2e:local -- --grep @smoke e2e/notes.spec.ts
#
# It runs against `npm run dev`: Vite in front of `anydag serve` on the vault `boards/local/`
# (`scripts/dev.sh`) — which is the only place the **dev size assertion** fires (it is gated
# `if (!import.meta.env.DEV) return` and reports through `console.error`, which the suite fails on).
#
# **The screenshots are not compared here, ever.** They were taken in Playwright's Docker image
# (`scripts/e2e-docker.sh`, the pinned `mcr.microsoft.com/playwright:v<version>-noble`), and a host's
# Chromium build and system fonts draw the same page a few pixels differently — the `neutral` theme
# is `system-ui`, so its layout is a fact about the machine. A host run would fail on the browser
# rather than on the change, which is what taught people to reach for `--no-verify`. So this runner
# sets `ANYDAG_NO_SNAPSHOTS=1`: every other check — the board becomes ready, the console stays
# silent, every gesture writes what it should — still runs. `npm run e2e:docker` is the whole thing,
# pixels included, and what CI runs.
#
# **The suite runs at low CPU priority**, browsers and dev server included: it is CPU-bound on a
# laptop, and a run that makes the editor it was started from stutter is the complaint this file
# answers. `ANYDAG_E2E_NICE=0` runs at normal priority. The number of browsers comes from the
# machine's cores and free memory (`scripts/e2e-lib.sh`); `ANYDAG_E2E_WORKERS` or `--workers` wins.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/e2e-lib.sh
. scripts/e2e-lib.sh

DEV_PORT="${ANYDAG_PORT:-3500}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Which browser: Playwright's own build of this version, or one `ANYDAG_CHROMIUM` names (a CI image,
# a sandbox). Neither is the image's, and neither is compared against the baselines.
assert_browser() {
  [ -n "${ANYDAG_CHROMIUM:-}" ] && return 0
  local own
  own="$(node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())')"
  [ -x "$own" ] && return 0
  cat >&2 <<EOF
e2e: refusing to start — Playwright's Chromium is not installed:
       $own
     Install the build for this version of Playwright:
       npx playwright install chromium
     — or run the suite in its Docker image, which needs nothing installed:
       npm run e2e:docker
EOF
  return 1
}

assert_browser

export ANYDAG_NO_SNAPSHOTS=1

ARGS=("$@")
if ! e2e_args_have_workers "${ARGS[@]+"${ARGS[@]}"}"; then
  ARGS=(--workers="$(e2e_workers)" "${ARGS[@]+"${ARGS[@]}"}")
fi

printf '\n\033[1m— the suite on the host browser, against the dev server on %s — no screenshots compared\033[0m\n' "$DEV_PORT"
ANYDAG_PORT="$DEV_PORT" nice -n "${ANYDAG_E2E_NICE:-10}" npx playwright test --reporter=line "${ARGS[@]}"
echo
echo "e2e: green (host browser, no screenshots)"
