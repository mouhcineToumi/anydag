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
empty, `3` it stopped on a conflict (the description is JSON on stdout), anything else an error —
read it, do not retry blindly.

Never merge a queued pull request yourself, never `gh pr merge --admin`, never push to `develop`, and
never update a queued branch by hand: the queue does that, in order.

## When it stops on a conflict

The JSON names the pull request, its branch, the linked issue's `agent:` tier, the conflicted files,
and a worktree (under the git directory) where `develop` is already merged in, half done, with the
conflict markers in place.

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
2. `npm ci`, then `npm run checks`. Fix what the merge broke, nothing else.
3. `git add` the files and `git commit --no-edit` (the pre-commit hook runs the checks again).
4. Push with the command in the JSON's `push` field. It is a new commit on the branch, not a
   force-push.
5. Comment on the pull request with what conflicted and how you resolved it, one line a file — this
   is a change nobody reviewed, so it has to be visible.
6. Run the queue again. The pull request is still at the front; it re-runs CI on the merge and lands
   when green. Remove the worktree when it has landed: `git worktree remove <worktree>`.

## Putting a pull request in

A pull request is ready for the queue when its checks are green and its review threads resolved. Do
not turn on auto-merge for it: the queue turns it off on everything but the front, to keep the order.
A pull request into `main`, `release/*` or `hotfix/*` is not for the queue; it takes it out.
