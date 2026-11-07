#!/usr/bin/env bash
# Everything, in the order that fails fastest: the fast tier (also `.githooks/pre-commit` and the
# `checks` job in CI — one list, `scripts/checks.sh`), then the Playwright suite.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/checks.sh
bash scripts/e2e-local.sh
echo "gate: green"
