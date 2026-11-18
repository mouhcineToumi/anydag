---
name: visual-review
description: Review what an AnyDag pull request did to how the app looks — before and after screenshots of every surface it can change, judged against DESIGN.md — and post the verdict on the pull request; or audit the whole app's chrome before a release. Use when asked to "visually review #531", "check the UI of this PR", "does this PR look right", "run the visual review", "audit the app's design", or "visual audit before the release".
---

# The visual review

The pixel comparison in CI catches a change nobody meant. It cannot catch a change somebody *did*
mean that looks wrong: the baseline is regenerated, committed, and the check passes. This review is
for that. It runs here, on the maintainer's machine, never in CI; it is **advisory** and holds
nothing back. The whole account is *The visual review* in `docs/architecture/gate-and-releases.md`.

`scripts/visual-review.mjs` does everything that is not judgement — the path filter, rendering both
sides in the pinned Playwright image, pairing and comparing the pictures, pushing the images, the
comment. **You do the judgement**, and only on the pairs it hands you.

## A pull request

1. **Capture.** `node scripts/visual-review.mjs <pr>` — in the background; it logs a line a step on
   stderr and prints JSON on stdout. A first run on this machine installs dependencies in two Docker
   volumes (a few minutes); after that a capture is about five minutes.
   - `"skip": true` → the pull request changes nothing the chrome is drawn from. **Stop here**: say
     so in one line, run no review, post nothing. That is the whole cost of a non-chrome pull request.
   - `changed`, `new` and `removed` all empty → nothing looks different. Run
     `node scripts/visual-review.mjs post <pr>` with no `review.json`; it posts the one-line verdict.
   - `failed` not empty → a side's run failed and some pictures may be missing; read the log the
     manifest names before trusting the rest, and say so in the summary.
2. **Read what changed.** In the folder the JSON names (`dir`):
   - `DESIGN.md` at the repository root — read it whole the first time; it is the standard.
   - `diff.patch` — the code half of the change, to know what was *meant*.
   - For each name in `changed`: `before/<name>.png`, `after/<name>.png`, and `diff/<name>.png`
     (the after picture faded, with every moved pixel marked) — open all three. For each name in
     `new`: `after/<name>.png`, compared with its neighbours (the same surface in the other theme,
     sibling Settings panes) rather than with nothing.
   - Judge each with `references/critique.md`. If the `impeccable` skill is installed, use its
     critique and audit guidance as well; nothing here depends on it.
3. **Write `review.json`** in the same folder:

   ```json
   {
     "summary": "One short paragraph: what the pull request changed visually, and whether it follows DESIGN.md.",
     "findings": [
       {
         "severity": "regression",
         "surfaces": ["surfaces--settings-vault-general-paper", "surfaces--settings-vault-general-paper-dark"],
         "title": "Settings → General: the groups run together.",
         "detail": "The gap between Folder and Problems fell from 28 px to 6 px, so two groups read as one.",
         "rule": "DESIGN.md › Space, corners and elevation"
       }
     ]
   }
   ```

   - `severity` is `regression` (this pull request made it worse: alignment, spacing, contrast,
     states, dark mode, consistency) or `note` (worth saying, not worse). Something that was already
     wrong before this pull request is a `note` with `"preexisting": true` — not this pull request's
     fault, and a candidate for a follow-up issue.
   - `surfaces` are names from the manifest, exactly; the comment shows each one's before and after.
     Group the light and dark of one problem into one finding. When the same problem is on many
     pictures, show two or four in `surfaces` and list the rest in `"also": [...]` — named in the
     comment, not shown, and never listed as *looks right*.
   - Say what you see and where, in numbers when you can (px, a ratio), and name the rule it breaks.
     A change you looked at and found right needs no finding: the comment lists it as *looks right*.
   - Do not invent a problem to have one. "Every change follows `DESIGN.md`" is a good review.
4. **Check, then post.** `node scripts/visual-review.mjs post <pr> --dry-run` prints the comment;
   read it. Then `node scripts/visual-review.mjs post <pr>`. A `review.json` it cannot use exits 2
   with the fields that are wrong — fix them and post again. A second post edits the same comment.
5. **Pre-existing problems** (`preexisting: true`): offer to open a follow-up issue for each
   (`status: triage`, `type: bug` or `chore`, `area:` of the surface). Fixing them is never part of
   the review.

## The whole app, before a release

1. `node scripts/visual-review.mjs --all` (or `--all <ref>`; `origin/develop` by default). It renders
   every surface at that commit and prints JSON naming a folder and a `report` path.
2. Open every picture in `after/`, light and dark side by side, with `DESIGN.md` and
   `references/critique.md`. Look **across** surfaces as much as at each: the same control drawn
   two ways, two spacings for one kind of gap, a page that forgot dark mode.
3. Write `report.md` at that path: a short verdict, then one section per finding with its pictures
   (relative paths), what is wrong, the rule, and how much it matters. Sort the most visible first.
4. Show the person the report's path and the top findings, and offer to file each as an issue
   (`status: triage`). Do not fix anything as part of the audit.

## Never

- Never run it in CI, and never add a workflow or a secret for it: it is local on purpose.
- Never treat its verdict as a gate: it is advisory until the maintainer decides otherwise.
- Never regenerate a baseline, edit the code under review, or push to the pull request's branch.
- Never post a comment without reading the pictures it names.
