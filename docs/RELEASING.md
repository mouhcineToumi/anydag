# Releasing AnyDag

How a change travels from a pull request to an installer, and the exact steps for each kind of
release. The workflows are in `.github/workflows/`; this page is what to type.

## The model

| Branch | Holds | Changes by |
|---|---|---|
| `develop` | the next release. **Its `VERSION` is always the next version to be released.** The default branch. | pull requests (squash merge by default; a merge commit for a long-lived component branch) |
| `main` | released code only | a pull request from `release/X.Y.Z` or `hotfix/X.Y.Z`, **merge commit**, and the merge is tagged `vX.Y.Z` |
| `release/X.Y.Z` | one version being stabilised; betas are tagged here. Kept after the release, for history | fixes as pull requests into it |
| `hotfix/X.Y.Z` | an urgent fix to what is on `main` | cut from `main`, merged into `main`, then back into `develop` |
| `nightly/<version>` | one commit that stamps a nightly's version. Made by `nightly.yml`, **never deleted** | nobody |

Versions are semver, said in two files that must agree — `VERSION` and `package.json`'s `version` —
and in `package-lock.json`'s root entry. **`node scripts/set-version.mjs <version>` writes all three**;
`npm run checks` (`check:version`) refuses a tree where they differ.

| Version | Is | Tag on | Published as | Update channel |
|---|---|---|---|---|
| `0.2.0` | stable | `main` | the *latest* release | `latest` |
| `0.2.0-beta.3` | beta | `release/0.2.0` (or `hotfix/0.2.0`) | a pre-release | `beta` |
| `0.2.0-nightly.202611070230` | nightly | `nightly/0.2.0-nightly.202611070230` | a pre-release | `nightly` |

The nightly's stamp is `YYYYMMDDHHmm` in UTC, one number: semver forbids a leading zero in a numeric
identifier, so `HHmm` after a dot would be invalid before 10:00, and one number orders by the clock.
No other pre-release word (`rc`, `alpha`) is a release: `release.yml` refuses the tag.

## What runs when

| Event | Runs |
|---|---|
| a pull request into `develop` | fast tier (typecheck, lint, contracts, unit); the desktop app on **Linux**, if something it is made of changed; `e2e.yml`'s smoke tier; the policy checks (title, target, linked issue); CodeQL; dependency review |
| a push to `develop` | fast tier; e2e |
| a push to `release/**` or `hotfix/**`, a pull request into one, a pull request into `main` | the fast tier and the desktop app on **Linux, Windows and macOS**; e2e |
| `nightly.yml`, every night at 02:00 UTC | everything: fast tier, the api server's convergence harness and Postgres suites, full e2e, desktop on all three — then publishes |
| a release tag | the same everything, then publishes |

Docs-only changes (`**/*.md`, `docs/**`) skip the heavy jobs; the fast tier always runs, so a required
check always reports. **`CI passed`** (in `ci.yml`) is the one check that stands for the tier — a skipped
heavy job counts as passed only when it was not owed.

Pull requests into `develop` must have a Conventional Commit title and close an issue labelled
`status: ready` (the maintainer and bots are exempt); a pull request into `main` must come from
`release/*` or `hotfix/*`. `pr-policy.yml` says which rule failed and what to do.

## A stable release

1. **Check `develop`.** `CI passed` is green on its head and the last nightly published. `VERSION` is the
   version you are about to release — say `0.2.0`.
2. **Cut the branch.** Actions → *cut-release* → Run workflow (it makes `release/<VERSION>` from
   `develop`'s head and refuses if the branch or the tag exists). By hand:
   ```sh
   git fetch origin && git push origin origin/develop:refs/heads/release/0.2.0
   ```
3. **Stabilise.** Fixes are pull requests *into `release/0.2.0`*, and `develop` goes on. A fix made on
   the release branch is back in `develop` through step 8.
4. **Betas, if you want them.** On the release branch (through a pull request into it if the branch is
   protected):
   ```sh
   git switch release/0.2.0 && git pull
   node scripts/set-version.mjs 0.2.0-beta.1
   git commit -am "chore(release): 0.2.0-beta.1"
   git push origin release/0.2.0
   git tag -a v0.2.0-beta.1 -m "AnyDag 0.2.0-beta.1" && git push origin v0.2.0-beta.1
   ```
   `release.yml` verifies the tag is on `release/0.2.0`, runs everything and publishes a **pre-release**.
   Anyone on the `beta` channel is offered it. Another beta is the same with `beta.2`.
   **Before the final release, put the version back:** `node scripts/set-version.mjs 0.2.0` and commit
   it on the branch, or the pull request into `main` would carry a beta's version.
5. **Open the pull request** `release/0.2.0` → `main`, titled `chore(release): 0.2.0`, with the
   required checks green — the desktop app was built on all three systems for it. **Merge it with a
   merge commit** (never squash: `main` keeps the release branch's history).
6. **Tag the merge commit** on `main`:
   ```sh
   git fetch origin
   git tag -a v0.2.0 -m "AnyDag 0.2.0" origin/main
   git push origin v0.2.0
   ```
   `release.yml` refuses a stable tag that is not on `main`, or that disagrees with `VERSION`. It runs
   everything, signs where it has the secrets, and publishes the *latest* release with the installers
   and `latest.yml`, `latest-linux.yml`, `latest-mac.yml` — and nothing at all unless all of them are
   there. Stable builds are offered it within the day.
7. **The notes** are generated from the merged pull requests by their labels
   (`.github/release.yml`: `type: feature`, `type: bug`, `type: docs`, `type: chore`, `dependencies`;
   `skip-changelog` leaves one out). Read them on the release page and edit.
8. **Back-merge into `develop`, and bump it — in one pull request:**
   ```sh
   git fetch origin
   git switch -c chore/back-merge-0.2.0 origin/main
   node scripts/set-version.mjs 0.3.0          # the next version
   git commit -am "chore: begin 0.3.0"
   git push -u origin chore/back-merge-0.2.0
   ```
   Open it into `develop`, titled `chore: merge 0.2.0 into develop and begin 0.3.0`, and merge it with
   a **merge commit**. Do it the same day: until `develop` says `0.3.0`, the nightly would be stamped
   `0.2.0-nightly.…`, a version that sorts *before* the release that has already shipped.

## A hotfix

For something urgent that cannot wait for the next release, on top of what is on `main`.

```sh
git fetch origin
git switch -c hotfix/0.2.1 origin/main
# …the fix, as commits (or pull requests into hotfix/0.2.1)…
node scripts/set-version.mjs 0.2.1
git commit -am "chore(release): 0.2.1"
git push -u origin hotfix/0.2.1
```

Then it is a stable release from step 5: a pull request `hotfix/0.2.1` → `main` (merge commit, titled
`chore(release): 0.2.1`), the tag `v0.2.1` on the merge commit, and the back-merge into `develop`.
A beta of a hotfix is tagged `v0.2.1-beta.1` on the hotfix branch like any other.

**The back-merge conflicts on the version files**, because `develop` is already on the next version.
Keep `develop`'s:

```sh
git switch -c chore/back-merge-0.2.1 origin/main
git merge origin/develop            # conflicts in VERSION, package.json, package-lock.json
git checkout origin/develop -- VERSION package.json package-lock.json
git commit -am "chore: merge 0.2.1 into develop"
```

and open that into `develop`. No further bump: `develop` is still on the version it was.

## The nightly

`nightly.yml` — 02:00 UTC every day, or Actions → *nightly* → Run workflow — builds `develop`.

1. **Nothing new, nothing built.** It looks at the newest `nightly/*` branch (by its stamp). If that
   commit's parent is `develop`'s head, it stops with a notice. *Force* in the manual run builds anyway.
2. It stamps `X.Y.Z-nightly.YYYYMMDDHHmm` — `X.Y.Z` is `develop`'s `VERSION` — into `VERSION`,
   `package.json` and the lockfile in **one commit on a new branch** `nightly/<version>`, and pushes the
   branch and the tag `v<version>` at that commit. `develop` is never written to. Branches are never
   deleted.
3. It runs everything against the tag — fast tier, `api:converge` and `api:test:pg`, full e2e, the
   desktop app on all three systems, signed when the secrets exist.
4. If every installer and the three `nightly*.yml` update files are there, it publishes a **pre-release**
   (never marked *latest*) named `AnyDag nightly <stamp>`, with the notes of what was merged since the
   previous nightly, and deletes the releases (not the tags, not the branches) of all but the newest seven
   nightlies.

If a step fails after step 2, the branch and the tag stay and nothing is published; the next night
builds again only if `develop` has moved (or run it with *Force*). A pushed tag from the workflow's own
token starts no other workflow, which is why the nightly publishes itself and why `release.yml` — which
refuses a nightly anyway — never runs for one.

## Update channels

The channel is **the version's own pre-release word**, and nothing is configured for it.
electron-builder names the update files after it and electron-updater reads the same word off the
running version:

| The installed build | Is | Reads | Is offered |
|---|---|---|---|
| `0.2.0` | stable | `latest.yml` / `latest-linux.yml` / `latest-mac.yml` of GitHub's *latest* release | only stable releases (a pre-release is never *latest*) |
| `0.3.0-beta.2` | beta | `beta*.yml` | the next beta, and stable releases |
| `0.3.0-nightly.202611070230` | nightly | `nightly.yml` / `nightly-linux.yml` / `nightly-mac.yml` | only nightlies |

`desktop/package.mjs` fails a package whose update files are not its version's channel's, and
`scripts/check-release-assets.mjs` fails a release that lacks any installer or update file, or whose
pre-release carries a `latest*.yml` (the file a stable build asks for). An unsigned macOS build —
ad hoc, as every build is without the Apple secrets — does not update itself on any channel.

Keep the number of nightly releases kept (`NIGHTLY_KEEP` in `nightly.yml`) under ten: the updater reads
GitHub's releases feed, which lists the ten newest releases, and a beta build looks there for the next beta.

## One-time repository setup

- **Default branch** `develop`. Rulesets: `develop` and `main` require pull requests and the checks below,
  and block force pushes and deletion; `main` allows merge commits only; `develop` allows squash and merge
  commits. Leave `nightly/*` branches and `v*-nightly.*` tags creatable by `github-actions[bot]`, and
  `release/*` creatable by it too if you use *cut-release*.
- **Settings → Actions → General:** workflow permissions *read and write* (the nightly pushes), and the
  repository's Code scanning *default setup* off (`codeql.yml` is the advanced setup).
- **Required checks.** `develop`: `CI passed`, `PR title`, `PR target`, `Linked issue`, and the e2e check
  `e2e.yml` names. `main`: the same.
- **Secrets, all optional** — a release or a nightly is built without them, unsigned on Windows and ad hoc
  on macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
  (macOS signing and notarisation); `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Windows). See `release.yml`.
- **Labels:** `status: ready`, `type: feature`, `type: bug`, `type: docs`, `type: chore`, `dependencies`,
  `skip-changelog`.
