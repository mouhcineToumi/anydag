---
name: merge-queue
description: Land AnyDag pull requests into develop through the local merge queue, one at a time and each tested on the develop it lands on, and resolve the merge conflicts the queue stops on. Use when asked to "run the merge queue", "merge the queued PRs", "land these PRs", "work the queue", "what's in the queue", or when scripts/merge-queue.mjs exits 3 with a conflict. Also use to put a pull request in the queue ("queue #512") or take one out.
---

# The merge queue

Pull requests into `develop` are not merged by the agent that wrote them. A green pull request is
labelled `queue`, and `scripts/merge-queue.mjs` lands the queue in order: it brings the front pull
request up to date with `develop` (GitHub's *update branch*, no force-push), turns on auto-merge pinned
to that commit, re-runs a failed check once, and takes a pull request out with a comment when it fails
twice or a policy check fails. The ruleset on `develop` requires a branch to be up to date, so nothing
merges untested on the current `develop`. The whole account is *The merge queue* in
`docs/architecture/gate-and-releases.md`.

Three things it does that a person once had to (#560):

- **A pull request that changes the gate lands last.** One touching `scripts/checks.sh` or a
  `*-baseline.json` is held while anything else is queued (the log says `held`); one carrying a
  baseline stops the queue when it is up to date, exit 4 — see below. A pull request that adds a
  **required job** to a workflow is not detected: label it `queue` only when the queue is empty.
- **A stacked branch is rebased.** When the branch still carries a pull request that landed as a
  squash, the queue rebases the branch's own commits onto `develop`, force-pushes with a lease and
  comments. A conflict there stops it like a merge conflict, with `"kind": "rebase"`.
- **What lands ran the whole browser suite.** `e2e.yml` runs everything for a pull request labelled
  `queue`; the queue keeps auto-merge off until the latest `e2e` run is the whole suite, starting one
  itself if the front pull request's last run was the selection.

## Commands

```sh
node scripts/merge-queue.mjs status                 # the queue in order; changes nothing
node scripts/merge-queue.mjs                        # work it until it is empty (or a conflict)
node scripts/merge-queue.mjs --watch                # …and keep waiting for more
node scripts/merge-queue.mjs eject <n> <reason>     # take one out, with a comment
gh pr edit <n> --add-label queue                    # put one in (at the back)
```

Run the queue in the background and wait for it to exit; it logs one line per step on stderr. It
holds a lock in the git directory, so a second runner exits at once. Exit codes: `0` the queue is
empty, `3` it stopped on a conflict (a merge or a rebase, the description JSON on stdout), `4` it
stopped for a baseline to be retaken (JSON on stdout), anything else an error — read it, do not retry
blindly.

Never merge a queued pull request yourself, never `gh pr merge --admin`, never push to `develop`, and
never update a queued branch by hand: the queue does that, in order.

## When it stops on a conflict

The JSON's `kind` is `merge` or `rebase`. It names the pull request, its branch, the linked issue's
`agent:` tier, the conflicted files, and a worktree (under the git directory) where the work is half
done with the conflict markers in place: for `merge`, `develop` merged into the branch; for `rebase`,
the branch's own commits being replayed onto `develop` after `onto` (the squash-merged pull request
below it, `{ number, head }`) — a stacked branch.

**Hand it back instead of resolving it** — `node scripts/merge-queue.mjs eject <n> "<why>"`, then run
the queue again — when any of these hold:

- the tier is `agent: deep`;
- `crossRepository` is true (the branch is on a fork; the queue cannot push to it);
- a conflicted file is in the write path or a trap: `src/board/` (the format, `patch.ts`, `rebase.ts`,
  `eol.ts`), `src/note/merge.ts`, `src/edit/history.ts` (undo), `server/sync/`, `src/sync/`, `api/`,
  the token and `Host` gate (`server/http.ts`, `server/app.ts`, `src/auth/`), `server/vault.ts`,
  `src/layout/`;
- the two sides change the same behaviour in different ways and the right answer is a decision, not
  a merge. Say in the reason what each side wants.

**Otherwise resolve it in the worktree:**

1. `cd` into the worktree. Read both sides of every conflict and what each pull request was for
   (`gh pr view <n>`, and the commits on `develop` that touched the file since the branch point).
   Keep both intentions. In an append-only list (`things-that-will-bite.md`, an index, a changelog)
   keep both entries, in the order the file uses.
2. `npm ci` (the worktree has no `node_modules`).
3. `merge`: `git add` the files and `git commit --no-edit`. The pre-commit hook runs `npm run checks`;
   if it fails, fix what the merge broke, nothing else, and commit again.
   `rebase`: `git add` the files and `GIT_EDITOR=true git rebase --continue`, again for each commit
   that stops, then `npm run checks` on the result and fix what the rebase broke in a commit of its own.
4. Push with the command in the JSON's `push` field: for `merge` a new commit on the branch, for
   `rebase` a force-push with a lease on the head the queue read (it is refused if someone pushed
   meanwhile — then eject and hand it back).
5. Comment on the pull request with what conflicted and how you resolved it, one line a file — this
   is a change nobody reviewed, so it has to be visible.
6. Run the queue again. The pull request is still at the front; it re-runs CI on the merge and lands
   when green. Remove the worktree when it has landed: `git worktree remove <worktree>`.

## When it stops for a baseline (exit 4)

The front pull request changes a `*-baseline.json` and is now up to date with `develop`; the baseline
was taken on an older `develop` and has to be retaken on this one, or the functions that landed since
read as new to every later pull request. The JSON names the worktree (the branch's head, `develop`
already in it), each baseline with the command that retakes it (`retake`; `null` means find it in the
check's header), the commit message to use (`commit`) and the `push` command.

1. `cd` into the worktree and `npm ci`.
2. Run each `retake` command. Read the diff: it should only add or drop the entries of functions that
   landed on `develop` since the baseline was taken. Anything else is a decision — eject and say why.
3. `git commit -am "<commit>"` — the message must stay `chore: retake … baseline`, which is how the
   queue knows the branch's last commit is the retake (use `--allow-empty` when nothing changed). The
   pre-commit hook runs `npm run checks`.
4. Push with the `push` command, comment on the pull request with what the retake changed, and run
   the queue again. Remove the worktree when it has landed.

## Putting a pull request in

A pull request is ready for the queue when its checks are green and its review threads resolved. Do
not turn on auto-merge for it: the queue turns it off on everything but the front, to keep the order.
A pull request into `main`, `release/*` or `hotfix/*` is not for the queue; it takes it out.
Labelling a pull request `queue` makes its next `e2e` run the whole suite, so push fixes before
labelling, not after.
