#!/usr/bin/env bash
#
# Refuse a secret before it is public: gitleaks over what is about to be committed or pushed, with
# the rules and the allowances in `.gitleaks.toml`.
#
#   scripts/secrets.sh staged          what `git commit` is about to record (the pre-commit hook)
#   scripts/secrets.sh range A B       the commits in A..B (CI: a pull request's, or a push's)
#   scripts/secrets.sh all             the whole history (the nightly)
#   scripts/secrets.sh selftest        a throwaway repository with a planted token must be refused
#
# **The repository is public, so a pushed secret is a published one.** Rewriting the history does
# not take it back: forks, clones and GitHub's own caches keep it. That is why the hook runs this
# before anything else and CI runs it again — and why the answer to a hit that got through is to
# revoke the secret first (`SECURITY.md`), and only then remove it.
#
# **`staged` reads the index, which the fast tier does not.** The hook checks the working tree for
# everything else (it never stashes — `.githooks/pre-commit` says why), but the question here is
# exactly "what will this commit hold", and gitleaks answers it from `git diff --staged` without
# touching the stash.
#
# **No gitleaks is a warning on a laptop and a failure in CI.** A hook that refuses every commit on a
# machine without the binary is a hook people turn off; CI installs the pinned version
# (`.github/workflows/ci.yml`) and sets `CI`, so there the missing binary is an error.
#
# `--redact` everywhere: the output of this script ends up in CI logs, which are public too.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-staged}"

if ! command -v gitleaks >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "secrets: gitleaks is not installed, and CI must have it" >&2
    exit 1
  fi
  echo "secrets: gitleaks is not installed, so this commit was not scanned for secrets (CI will scan it)."
  echo "         Install it: https://github.com/gitleaks/gitleaks#installing (pacman -S gitleaks, brew install gitleaks)"
  exit 0
fi

config="$PWD/.gitleaks.toml"
scan() { gitleaks --config "$config" --no-banner --redact --exit-code 1 "$@"; }

explain() {
  cat >&2 <<'EOF'

secrets: gitleaks found what looks like a secret (above).
  - If it is real: take it out of the change, keep it in an env var or a git-ignored `*.local` file,
    and if it was ever pushed anywhere, revoke it now — removing it is not enough.
  - If it is a fixture: make it obviously fake, or add an allowance to `.gitleaks.toml` naming the
    file and the string, with the reason.
EOF
}

case "$mode" in
  staged)
    scan git --pre-commit --staged . || { explain; exit 1; }
    ;;
  range)
    from="${2:?range needs a base commit}"
    to="${3:?range needs a head commit}"
    scan git --log-opts="$from..$to" . || { explain; exit 1; }
    ;;
  all)
    scan git . || { explain; exit 1; }
    ;;
  selftest)
    # The config must still catch a real-shaped token: an allowance written too wide would make
    # every scan above pass, and nothing else would notice.
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    git -C "$tmp" init -q
    # Assembled at run time, so this file is not itself a hit.
    token="ghp_$(printf 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')"
    printf 'export const TOKEN = "%s";\n' "$token" > "$tmp/leak.ts"
    git -C "$tmp" add leak.ts
    if (cd "$tmp" && gitleaks --config "$config" --no-banner --redact --exit-code 1 git --pre-commit --staged . >/dev/null 2>&1); then
      echo "secrets: selftest FAILED — a planted GitHub token was not refused" >&2
      exit 1
    fi
    echo "secrets: selftest passed — a planted GitHub token is refused"
    ;;
  *)
    echo "usage: scripts/secrets.sh [staged | range <base> <head> | all | selftest]" >&2
    exit 2
    ;;
esac
