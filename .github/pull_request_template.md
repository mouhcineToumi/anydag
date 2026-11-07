<!--
Read CONTRIBUTING.md first. A pull request into `develop` must close an issue labelled
`status: ready`. The title must be a Conventional Commit, e.g. `fix(notes): keep the caret on save`.
-->

Closes #

## What changed

<!-- What does this do, and why? Describe what a user will notice. Keep it to one issue. -->

## How it was checked

<!-- What you ran and what you tried by hand. For a UI change, a screenshot or recording. -->

## Checklist

- [ ] `npm run checks` is green.
- [ ] Tests are added or updated (a bug fix has a test that fails without it).
- [ ] Docs are updated: `docs/architecture/`, `docs/dsl/` or `skills/anydag/` where what I changed is described there — or none describe it.
- [ ] Screenshots changed only on purpose (`--update-snapshots=all` in the Docker runner, every changed image reviewed) — or I changed none.
- [ ] No colour literals in `src/`, no edits to `themes/*/theme.json`, no secrets.

## Parity

- [ ] Every route, `anydag` command or MCP tool this adds or renames is in `docs/parity.json`, and
      `npm run parity` redrew `docs/PARITY.md` — or it adds none. `test/parity.test.ts` fails
      otherwise.
