#!/usr/bin/env bash
# Everything, in the order that fails fastest: the fast tier (also `.githooks/pre-commit` and the
# `checks` job in CI — one list, `scripts/checks.sh`), then the whole Playwright suite — in
# Playwright's Docker image when there is one (`scripts/e2e-docker.sh`: the only place the
# screenshots are valid, and what CI runs), else on the host's browser with no screenshots compared
# (`scripts/e2e-local.sh`), which says so.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/checks.sh
if [ -z "${ANYDAG_E2E_HOST:-}" ] && docker info >/dev/null 2>&1; then
  bash scripts/e2e-docker.sh
else
  [ -n "${ANYDAG_E2E_HOST:-}" ] || echo "gate: docker is not running — the browser suite runs on the host, comparing no screenshots" >&2
  bash scripts/e2e-local.sh
fi
echo "gate: green"
