#!/usr/bin/env bash
#
# The Playwright suite inside Playwright's own image — **the one place the screenshots are made
# and compared**, here and in CI (`.github/workflows/e2e.yml` runs the same image).
#
#     npm run e2e:docker                                   the whole suite
#     npm run e2e:docker -- --grep @smoke                  the smoke tier
#     npm run e2e:docker -- e2e/chart.spec.ts              one spec
#     npm run e2e:docker -- --update-snapshots=all         regenerate every baseline
#
# Everything after the script's name goes to `playwright test` untouched.
#
# **Why a container.** A baseline is a rasterisation, and the same page rasterises differently in
# another Chromium build, with other system fonts, on another libfreetype. Pinning the image
# (`mcr.microsoft.com/playwright:v<version>-noble`, the version `package.json` pins) pins all three,
# so a screenshot taken on a laptop, in CI and on a contributor's machine is one screenshot.
#
# **What runs where.** The repository is mounted at `/work`, so specs, fixtures in `boards/local/`
# and baselines are the host's files; and the container runs as the host user, so everything it
# writes back (`e2e/*-snapshots/`, `test-results/`, `playwright-report/`) is owned by the person
# who ran it. `node_modules` is **not** the host's: a named volume holds a `npm ci` made inside the
# container, because the host's tree was built against the host's glibc and Node, and a native
# module (`@parcel/watcher`, esbuild, rollup) that was resolved for one is not guaranteed for the
# other. The volume is per checkout and stamped with the lockfile's hash, so it is reinstalled only
# when `package-lock.json` changes. The dev server (`npm run dev`) is started by
# `playwright.config.ts`'s `webServer` *inside* the container, on its own network, with a throwaway
# app home — so it never meets a dev server of yours on port 3500 or the host's `.dev-home/`.
#
# `ANYDAG_E2E_WORKERS` sets the number of browsers (else `scripts/e2e-lib.sh` picks from the
# machine); an explicit `--workers` wins. `ANYDAG_E2E_NICE=0` gives the container normal CPU
# priority instead of a low one. `ANYDAG_E2E_IMAGE` runs another image, for trying a new version.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/e2e-lib.sh
. scripts/e2e-lib.sh

command -v docker >/dev/null 2>&1 || {
  echo "e2e:docker: docker is not installed — the screenshots are only valid inside Playwright's image" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "e2e:docker: the docker daemon is not answering (is it running, and are you in the docker group?)" >&2
  exit 1
}

ROOT="$PWD"
IMAGE="${ANYDAG_E2E_IMAGE:-$(e2e_image)}"
UIDGID="$(id -u):$(id -g)"
KEY="$(printf '%s' "$ROOT" | sha1sum | cut -c1-8)"
MODULES="anydag-e2e-modules-$KEY"
CACHE="anydag-e2e-npm-cache"
NAME="anydag-e2e-$$"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "e2e:docker: pulling $IMAGE" >&2
  docker pull "$IMAGE" >&2
fi

# A named volume is created root-owned, and the container is not root.
for v in "$MODULES" "$CACHE"; do
  if ! docker volume inspect "$v" >/dev/null 2>&1; then
    docker volume create "$v" >/dev/null
    docker run --rm --user 0 -v "$v:/v" --entrypoint chown "$IMAGE" "$UIDGID" /v >&2
  fi
done
# The mount point inside the bind mount: made by us so it is the host user's, not docker's (root's).
mkdir -p node_modules

ARGS=("$@")
if ! e2e_args_have_workers "${ARGS[@]+"${ARGS[@]}"}"; then
  ARGS=(--workers="$(e2e_workers)" "${ARGS[@]+"${ARGS[@]}"}")
fi

TTY=()
[ -t 0 ] && [ -t 1 ] && TTY=(-t)
SHARES=()
[ "${ANYDAG_E2E_NICE:-10}" != "0" ] && SHARES=(--cpu-shares=256)

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

# Everything this script says goes to stderr, so `--reporter=json` (or `--list`) stays parseable.
printf '\n\033[1m— the suite in %s, as %s — baselines compared\033[0m\n' "$IMAGE" "$UIDGID" >&2

# `--ipc=host`: Chromium's shared memory, as Playwright's own docs ask for. `--init`: a process
# that reaps the browsers a failed test leaves behind. `CI=1` makes `playwright.config.ts` behave as in
# CI (`forbidOnly`, a trace kept for a test that had to be retried), so a run here is the run there.
set +e
docker run --rm --init --ipc=host --name "$NAME" ${TTY[@]+"${TTY[@]}"} -i \
  --user "$UIDGID" ${SHARES[@]+"${SHARES[@]}"} \
  -v "$ROOT:/work" -v "$MODULES:/work/node_modules" -v "$CACHE:/npm-cache" \
  -w /work \
  -e HOME=/tmp/e2e-home \
  -e npm_config_cache=/npm-cache \
  -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  -e ANYDAG_HOME=/tmp/e2e-home/anydag \
  -e CI=1 \
  -e FORCE_COLOR \
  "$IMAGE" bash -euo pipefail -c '
    mkdir -p "$HOME" "$ANYDAG_HOME"
    want="$(sha1sum package-lock.json | cut -d" " -f1)-$(node -v)"
    if [ "$(cat node_modules/.e2e-lock 2>/dev/null || true)" != "$want" ]; then
      echo "e2e:docker: installing dependencies in the container (node $(node -v))" >&2
      # Scripts are skipped: `prepare` is the git-hook installer, which has no repository to find in
      # here, and the native modules arrive prebuilt as optional packages.
      npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
      echo "$want" > node_modules/.e2e-lock
    fi
    exec npx playwright test "$@"
  ' _ "${ARGS[@]}"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf '\ne2e:docker: green\n' >&2
fi
exit "$status"
