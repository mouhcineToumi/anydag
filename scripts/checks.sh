#!/usr/bin/env bash
#
# The fast tier: everything that needs no browser and no network.
#
# **Its length is what decided its shape.** It is small enough to sit in a commit hook, which is the
# only thing that makes a hook worth having — a gate people learn to reach past with `--no-verify` is
# worse than no gate, because it looks like coverage. Were this ninety seconds it would belong on
# `pre-push` instead. Nine seconds on a twelve-core machine; 36 s and 130 s of CPU has been its
# share on an eight-core one, and it is 14 s and 31 s of CPU there now —
# `tsc` incremental (its build info under `node_modules/.cache/tsc/`, so the second run checks what
# changed), one expression that was half of `tsc`'s time rewritten, and the unit suite sharing
# modules between files on two workers (`vitest.config.ts` says why both are safe).
#
# One list, three readers: `scripts/gate.sh` runs it and then the slow half, `.githooks/pre-commit`
# runs it and stops, and the `checks` job in `.github/workflows/ci.yml` runs it as one step. That
# is deliberate. The three had the same seven commands written out three times, and this file
# already has a page on what a list in two places costs — `check-theme.mjs` mirrors `UNITLESS` by
# hand and `CLAUDE.md` names the mirror as a copy that can drift.
#
# The order is the one that fails fastest, which is why the unit suite is last despite being four
# seconds: a type error is a shorter thing to read than a test failure caused by one.
set -euo pipefail
cd "$(dirname "$0")/.."

# Named steps rather than `set -x`, because the CI job that used to list these as seven separate
# steps could say which one went red from the step name alone, and running them as one script must
# not cost that.
step() { printf '\n\033[1m— %s\033[0m\n' "$1"; }

# Biome's linter: half a second over the whole tree, so it goes first. The type-aware promise checks
# are `npm run lint:promises` (typescript-eslint, ~40 s) and run in CI as their own job; they are too
# slow for a commit hook.
step "lint"
npx biome lint .

# Biome's formatter, checking only: a file it would change is a failure, and `npm run format` is the
# fix. A whole-tree reformat is its own commit, listed in `.git-blame-ignore-revs`.
step "format"
npx biome format .

# Unused exports, files and dependencies, and imports of packages `package.json` does not list: the
# count is zero and stays zero, so any finding is a regression. Its exceptions, each with its
# reason, are in `knip.jsonc`. About two seconds over the whole tree.
step "knip"
npx knip

step "typecheck"
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.worker.json

step "check:version"
node scripts/check-version.mjs

step "check:case"
node scripts/check-case.mjs

step "check:theme"
node scripts/check-theme.mjs

step "check:literals"
node scripts/check-literals.mjs

step "check:icons"
node scripts/check-icons.mjs

step "check:skill"
node scripts/check-skill.mjs

step "unit"
npx vitest run
