# shellcheck shell=bash
#
# Shared by `scripts/e2e-local.sh`, `scripts/e2e-docker.sh` and `.githooks/pre-push`. Sourced, never run.

# The Playwright version the suite is pinned to — `package.json`'s exact pin, which is also the tag
# of the browser image (`mcr.microsoft.com/playwright:v<version>-noble`). One number, read here, so
# the image the screenshots are taken in cannot drift from the library that drives it; the unit test
# `test/e2e-image.test.ts` holds the workflow's copy of it to the same number.
e2e_playwright_version() {
  node -e '
    const v = require("./package.json").devDependencies["@playwright/test"];
    if (!/^\d+\.\d+\.\d+$/.test(v)) { console.error("@playwright/test must be an exact version, got " + v); process.exit(1); }
    process.stdout.write(v);'
}

e2e_image() {
  printf 'mcr.microsoft.com/playwright:v%s-noble' "$(e2e_playwright_version)"
}

# How many browsers to run at once, from what the machine has *now*.
#
#   cores    — `nproc`; the suite is CPU-bound, so more workers than cores buys nothing, and two
#              cores are left for the dev server, the grammar worker and whatever else is open
#   memory   — MemAvailable; the whole container (every Chromium, Vite, the server and its grammar
#              worker) peaked at 3.7 GB with six workers, measured over a full run from the cgroup:
#              about 0.9 GB for the servers and 0.47 GB a worker. 600 MB a worker is budgeted, with
#              1.5 GB kept back for the editor the push was made from and the system — a 23 GB laptop
#              pushed into swap by six unbudgeted browsers is what the old fixed 3 was written for
#
#   workers = clamp(min(cores - 2, (MemAvailable - 1.5 GB) / 600 MB), 1, 6)
#
# 12 cores and 8 GB free → 6; 4 cores → 2; 3 GB free → 2. `ANYDAG_E2E_WORKERS` overrides it. Prints
# the number on stdout and the reasoning on stderr.
e2e_workers() {
  if [ -n "${ANYDAG_E2E_WORKERS:-}" ]; then
    echo "e2e: $ANYDAG_E2E_WORKERS workers (ANYDAG_E2E_WORKERS)" >&2
    printf '%s' "$ANYDAG_E2E_WORKERS"
    return 0
  fi
  local cores mem_mb by_cpu by_mem n
  cores="$(nproc 2>/dev/null || echo 2)"
  mem_mb="$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || true)"
  [ -n "$mem_mb" ] || mem_mb=4096
  by_cpu=$((cores - 2))
  by_mem=$(((mem_mb - 1536) / 600))
  n=$((by_cpu < by_mem ? by_cpu : by_mem))
  [ "$n" -lt 1 ] && n=1
  [ "$n" -gt 6 ] && n=6
  echo "e2e: $n workers — $cores cores (2 kept free) allow $by_cpu, ${mem_mb} MB available (600 MB each, 1.5 GB kept back) allow $by_mem, clamped to 1..6" >&2
  printf '%s' "$n"
}

# True when the argument list already names a worker count, which then wins over ours.
e2e_args_have_workers() {
  local a
  for a in "$@"; do
    case "$a" in --workers | --workers=* | -j | -j*) return 0 ;; esac
  done
  return 1
}
