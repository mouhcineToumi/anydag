# Development health, per release

One Markdown report at each stable release, with every metric's value for that release, its rolling
7-day value, and its trend across the releases before it. The report is written by
`node scripts/release-report.mjs <version>`; the numbers come from the tags, the GitHub API and the
files in this folder, never from the clock. **It gates nothing** — it tells you whether development
is getting healthier or worse, and the answer is a diff.

The report is part of a stable release: `release.yml` runs the script after publishing and attaches
both files to the GitHub release, and the back-merge into `develop` commits them
([`docs/RELEASING.md`](../RELEASING.md), *A stable release*). Read the report on the release page, or
open the committed copy.

- [`0.8.0.md`](0.8.0.md) is the first report with the starter set backfilled to 0.1.0.
- `<version>.json` is the raw record, one file per release, **never edited by hand**.
- `<version>.md` is the report printed for that release, rendered from every JSON up to it.

## What is in the folder

```json
{
  "version": "0.8.0",
  "tag": "v0.8.0",
  "date": "2026-11-17T21:13:01.000Z",
  "previous": "0.7.0",
  "previous_date": "2026-11-16T22:21:01.000Z",
  "window": { "from": "2026-11-16T22:21:01.000Z", "to": "2026-11-17T21:13:01.000Z" },
  "rolling": { "from": "2026-11-10T21:13:01.000Z", "to": "2026-11-17T21:13:01.000Z" },
  "metrics": {
    "lead-time-for-changes": {
      "value": { "median_hours": 4.6, "p90_hours": 13.2, "n": 28 },
      "rolling": { "median_hours": 16.7, "p90_hours": 44.4, "n": 182 },
      "reason": null,
      "rollingReason": null
    }
  }
}
```

`date` is the tag's own date (the annotated tag's tagger date, or the commit date of a lightweight
tag), not when the release was published, and not when the report ran. `window.from` is the previous
stable tag's date; for 0.1.0, whose tag is the repository's first commit, it is seven days before.
`rolling` is always the seven days ending at the tag.

A metric with no value is `value: null` and says why in `reason`; a metric whose release value exists
but whose rolling value does not says why in `rollingReason`. **No data is n/a, never zero**, and the
reason is printed in the report next to the `n/a` — for example `n/a (depends on #526)`. A metric
whose source did not exist yet at that release says when the source began.

A report for an old release is a snapshot: the Markdown for 0.7.0 was rendered from the JSONs up to
0.7.0, and adding 0.8.0 does not rewrite it. The report for the newest release uses every JSON in the
folder, which is what makes the trend a diff rather than a paragraph.

## The window

**The window for `X.Y.Z` is `(the previous stable tag, vX.Y.Z]`, fixed by the tags.** It is not "the
last day" and not "since the script last ran". The tag dates are the release dates, so the window is
the same on the release machine, on a laptop a week later, and in a re-run a month later.

- The first release (0.1.0) has no earlier tag; its window is the seven days before it, by definition.
- **Rolling 7 days** is the same computation over `(the tag − 7 days, the tag]`. A release window is
  often under a day — about twenty-five pull requests a day — so the release number is noisy; the
  rolling number is the smoother one.
- A **point-in-time** metric (Dependabot alerts, the work in progress at the tag, the flaky issues
  open, the bench rows) has no event stream to roll. Its rolling value is the **median of the release
  values recorded in the reports whose tag falls in the seven days**, including this one. For the
  first report in a week it is the release value itself.
- **Restating a past release is not editing it.** The JSON for a release is written once, from the
  tags and the GitHub record as they stand at that tag; a re-run for the same version must produce
  the same bytes. The one live source is `npm audit`/`npm outdated` in *dependency health*, and a
  recorded audit is reused rather than re-queried — a backfilled release says it has none.

## How a number is counted

- **Sources.** Tags, commits and ancestry come from the checkout (`git tag --contains`,
  `git log`); pull requests, issues, their timelines, check runs and Actions runs come from the GitHub
  API through `gh`; the bench comes from [`docs/bench/`](../bench/); Dependabot alerts come from the
  repository's alerts API.
- **Rates** are a part over a whole in the window, printed as a percentage with one decimal.
- **Medians** are the middle value (the mean of the two middle values for an even count). **p90** is
  the 90th percentile by linear interpolation between the nearest ranks, so ten values do not make
  the ninth the p90.
- **Issues are counted by their labels now**: the backfilled `regression` and `escaped` labels apply
  to the bugs they describe, and reach the release whose window closed them. The type and size labels
  are read the same way. The timeline is used where the metric is about *when* something happened
  (`status: ready`, `status: in-progress`, reopened, closed).
- **Check runs are GitHub's record.** A re-run creates a new check run with the same name, so the
  earliest one on a commit is the first attempt. Actions runs and check runs are retained by GitHub
  for a limited time; the committed JSON is the permanent record, which is why it is never rewritten.
- **Security findings are counts only.** The report is public and the repository is public, so a
  known vulnerability is published as a count by severity and age — never its package, its file, its
  advisory or its reproduction. The security backlog metric says `n/a` until #112 lands, and it will
  keep that rule when it does. A secret is never read or printed ([`SECURITY.md`](../../SECURITY.md)).

## The labels: `escaped` and `regression`

Two issue labels feed the report. Both are applied **at triage**, from the bug form's *AnyDag
version* field and from what the report says; neither is a severity.

- **`escaped`** — the bug was present in a **stable release** (the version field names `X.Y.Z`, not a
  nightly, a beta or a branch). It is the numerator of the escaped defect rate and the population of
  time-to-restore.
- **`regression`** — the bug is in something that **used to work**: the report says it worked before,
  or a fix is described as a regression from a named change or release. A new feature's first bug is
  not a regression; a flaky test is not a regression unless it is a user-facing regression.

They were backfilled on the bugs already closed where the issue makes it clear, and applied to the
open bugs found in 0.7.0 by its QA pass; the pull request that added the report lists every issue it
labelled. A bug filed before the labels existed with no version and no "worked before" in it is not
labelled — an honest gap, not a guess. The definitions are in
[`.github/labels.yml`](../../.github/labels.yml).

## The metrics

A ★ marks the **starter set** the first report carried: release frequency, lead time for changes,
change failure rate, regression rate, CI first-pass rate and bug-to-feature ratio. Each has a
definition anchor (`<a id="…">`) so the report can link to it from `README.md#…`.

### Delivery

#### <a id="release-frequency"></a>Release frequency ★

Stable releases per week: the number of **stable** tags whose own date is in the window, divided by the
window's length in weeks. Nightlies per week sit beside it, from the tags whose version has the
`nightly.` pre-release word. A beta is neither a stable release nor a nightly and is not counted; it
is a pre-release of a version that will be counted when it ships. The first release is one stable
release in its seven-day window, so one a week by definition.

Rolling: the same counts over the seven days ending at the tag.

**Polarity: higher is better.** More releases is more delivered, provided the other rows do not get
worse.

#### <a id="lead-time-for-changes"></a>Lead time for changes ★

For each pull request **merged in the window**, the time from its **first commit** (the earliest
commit author date on the pull request; its creation date when it has no commits) to **the first
stable tag that contains it**. "Contains it" is git ancestry of the pull request's merge commit:
`git tag --contains <merge commit>`, restricted to tags at or before this release, so a report never
uses a release that did not exist yet. A pull request merged into `develop` after the release branch
was cut is not in this release; it is counted in `unreleased` and left out of the median until a
later stable tag contains it.

The **first nightly** that contains it is measured the same way and reported beside the median, with
its own count; a pull request merged after this release's last nightly has no nightly at or before
this release and is not counted there.

Median and p90 are reported in hours. Rolling: the same over pull requests merged in the seven days
ending at the tag. **Polarity: lower is better.**

#### <a id="pr-cycle-time"></a>PR cycle time

For each pull request **merged in the window**, the time from its opening to its merge; median and p90
in hours. Beside it, the **median pull request size** of the same pull requests, in lines changed
(additions + deletions from the pull request's own record), because cycle time usually rises with
size and a smaller median explains a shorter one.

Rolling: the same over merges in the seven days ending at the tag. **Polarity: lower is better** for
cycle time; the size is context, not a target.

*Every* merged pull request is counted, including the release, hotfix and back-merge pull requests:
they are pull requests in the window, and excluding them would be a different definition from one
release to the next.

#### <a id="merge-queue-wait"></a>Merge queue wait

For each pull request **merged in the window** that carried the `queue` label, the time from the
**last `labeled queue` event before its merge** to the merge; median and p90 in minutes. This is the
time the queue held it, not the time it spent being reviewed.

The same section counts the pull requests the queue **took out**, and why: each comment the queue
leaves on a pull request begins `Left the merge queue: <reason>.`, and a comment in the window is one
ejection with that reason. A pull request that was ejected and later relabelled and merged counts as
an ejection — the queue did take it out — and its wait is measured from the last label before the
merge. A draft, a policy failure, a failed check and a conflict are separate reasons.

Rolling: the same over the seven days ending at the tag. When no pull request in the window carried
the label, the row says n/a (no pull request carried the queue label in the window); the queue
began on 2026-11-18, so every backfilled release is n/a, not zero. **Polarity: lower is better.**

### Stability

#### <a id="change-failure-rate"></a>Change failure rate ★

A stable release **failed** when either:

- **the next stable release after it is a patch of the same `MAJOR.MINOR`** — a patch release, which
  includes a hotfix, because a hotfix ships as a patch; or
- **the release was the first stable tag containing a pull request that a `Revert "…"` commit at or
  before this release names** — the revert names the pull request by `(#N)` or by
  `This reverts commit <sha>`.

A release whose next stable is a **minor** (or a major) release got through to the next minor with no
patch, so it did not fail. A patch release is itself judged by *its* next stable: the patch that
fixed 0.7.0 survives if 0.7.2 is not needed before 0.8.0, and fails if it is.

The rate is `failed ÷ decided`, where **decided** is every stable release before the reported one
whose next stable release is at or before the reported one. The reported release is **pending** and
not in its own rate; the value says so. 0.1.0 has no earlier release, so its rate is `n/a`, not 0.

Rolling: the same rate over the decided releases whose **deciding release** (the next stable one) is
in the seven days ending at the tag. **Polarity: lower is better.**

#### <a id="time-to-restore"></a>Time to restore

For each **`escaped` bug** (`type: bug`) **closed in the window**, the time from the bug's creation to
**the stable release that first carries its fix**. The fix is the pull request whose body closes the
issue (`Closes`/`Fixes`/`Resolves #N`), or the pull request cross-referenced in the issue's timeline
within ten minutes of the issue closing; it must have merged after the bug was filed. The release is
the first stable tag at or before this report that contains the fix's merge commit. Median and p90 are
reported in days.

A bug whose fix is not in a stable release at or before this release is excluded — it is not restored
yet; an open `escaped` bug is not a slow restore, it is an open bug. Rolling: the same over bugs
closed in the seven days ending at the tag. **Polarity: lower is better.**

#### <a id="escaped-defect-rate"></a>Escaped defect rate

The share of bugs closed in the window that were **present in a stable release**: the number of
issues labelled `type: bug` **and** `escaped` whose `closed_at` is in the window, divided by all
issues labelled `type: bug` closed in the window. The label is what says the bug escaped; the bug
form's version field is what the maintainer reads to apply it at triage.

Rolling: the same over bugs closed in the seven days ending at the tag. No bug closed in the window
is `n/a`, not 0%. **Polarity: lower is better.**

#### <a id="regression-rate"></a>Regression rate ★

The share of bugs closed in the window that are **in something that used to work**: issues labelled
`type: bug` and `regression` closed in the window, divided by all `type: bug` issues closed in the
window. The `regression` label is what decides it, applied at triage and backfilled where the report
makes it clear; a new feature's first bug is not a regression.

Rolling: the same over bugs closed in the seven days ending at the tag. No bug closed in the window
is `n/a`, not 0%. **Polarity: lower is better.**

### Code and test quality

#### <a id="ci-first-pass-rate"></a>CI first-pass rate ★

For each pull request **merged in the window**, the **first** `CI passed` and `e2e` check runs on its
**first commit** (the earliest commit author date). A pull request is green when both of those first
attempts concluded `success`; a re-run is a later check run and does not rescue the first attempt.
The rate is green ÷ **measured**, where measured is the pull requests that have both check runs on the
first commit. A pull request missing either check — an early CI, a check that did not exist for it —
is `skipped`, not a failure, and is reported beside the rate.

Rolling: the same over pull requests merged in the seven days ending at the tag. **Polarity: higher is
better.**

#### <a id="flaky-tests"></a>Flaky tests

The **`flaky:` issues** — the stream the nightly's `flaky tests` job opens (#494) for each test that
passed only on retry, one issue per test, named `flaky: <spec> › <test>`. The row reports `new` (issues
created in the window) and `open` (issues open at the tag, from their close/reopen timeline). The
trend follows `new`.

Before the first `flaky:` issue the row is `n/a` with the date the convention began; the older
`Flaky e2e: …` issues were written before the stream existed and are not counted, because they are not
one issue per test and cannot be compared release to release. Rolling: `new` in the seven days ending
at the tag; `open` is the point-in-time value at the tag. **Polarity: lower is better.**

#### <a id="ci-duration"></a>CI duration

For each pull request **merged in the window**: from the first `ci.yml` or `e2e.yml` Actions run
created on the pull request's **final head commit** to the **last successful required run** on that
commit (`updated_at`) — how long the push took to become a green pull request, including the wait for
a runner and any failed attempt that was re-run. Median and p90 in minutes.

For a **push to `develop`**, a successful `ci.yml` run created in the window: its `updated_at` minus
its `created_at`. Median and p90 in minutes. The two are reported separately because a pull request
runs the selection and a push runs the whole suite.

Rolling: the same over the seven days ending at the tag. No successful run is `n/a`. **Polarity:
lower is better.**

#### <a id="diff-coverage"></a>Diff coverage

`n/a` today: vitest coverage is not collected on pull requests, so there is no changed-line coverage
to report. When `checks.yml` produces it, this row becomes the covered share of the lines a pull
request changed, with the same window and rolling values. It is not 0%; the source does not exist.

#### <a id="dependency-health"></a>Dependency health

Three counts, all **counts only** — no package, no advisory, no path:

- **Open Dependabot alerts at the tag**, by severity (`critical`, `high`, `moderate`, `low`) and total.
  An alert counts when it was created at or before the tag and was neither fixed nor dismissed at or
  before the tag. The alerts are the default branch's (`develop`), which is what Dependabot watches.
  Before the repository's first alert the row is `n/a` with that date.
- **`npm audit` by severity**, from `npm audit --package-lock-only --json`. This is a **snapshot of
  the tree the report ran on**: only the release whose `VERSION` is the report's version records it,
  and a recorded audit is reused on a re-run rather than queried again. A backfilled release says
  `npm audit n/a (no recorded audit)` — a live advisory database is not a historical record, and
  inventing one would be worse than the gap.
- **Dependencies a major version or more behind**, from `npm outdated --json`: the packages whose
  `current` (else `wanted`) major is below `latest`. The same recording rule applies, and a backfilled
  release says it has no recorded check.

Rolling: the median of the release snapshots in the seven days ending at the tag, per count. When the
token cannot read the alerts API, the row is `n/a` with that reason. **Polarity: lower is better.**

#### <a id="duplication-and-complexity"></a>Duplication and complexity

`n/a` until [#526](https://github.com/mouhcineToumi/anydag/issues/526) lands: the clone percentage
and the functions over the complexity threshold, measured on the release tree, with the same window
and rolling values. The row says `n/a (depends on #526)` rather than 0, because a release with no
measurement is not a release with no duplication.

#### <a id="security-backlog"></a>Security backlog

`n/a` until [#112](https://github.com/mouhcineToumi/anydag/issues/112) lands: open findings by
severity (counts only) and the median days to fix a high one. **The repository is public, so the
report publishes counts only** — never a finding, its package, its file or its reproduction. A finding
is reported privately under [`SECURITY.md`](../../SECURITY.md), not in an issue.

#### <a id="visual-review"></a>Visual review

`n/a` until [#528](https://github.com/mouhcineToumi/anydag/issues/528) lands: UI regressions flagged
per release and how many were fixed before the release.

### Performance — the release bench

#### <a id="performance-the-release-bench"></a>The release bench

The ten fixed rows of [`docs/bench/<version>.json`](../bench/README.md) — one row per bench metric, in
the order [`scripts/bench-release.mjs`](../../scripts/bench-release.mjs) fixes, with that row's unit.
The bench is run on the release machine and committed with the release
([`docs/RELEASING.md`](../RELEASING.md), *A stable release*, step 5); the report only reads it, so the
numbers are the release machine's, not a runner's. Lower is better in every row. A release without a
bench file (0.1.0 to 0.7.0) says `n/a` with the missing file name — the bench became a release record
at 0.8.0. Rolling: the median of the release values in the seven days ending at the tag.

#### <a id="interaction-latency"></a>Interaction latency, `edit.*`

`n/a` until [#527](https://github.com/mouhcineToumi/anydag/issues/527) lands: the `edit.*` rows
measured on the release tree, lower is better.

### Workflow (GitHub issues)

#### <a id="throughput"></a>Throughput

Issues closed per week: the number of **issues** (not pull requests) whose `closed_at` is in the
window, divided by the window's length in weeks. A pull request closing an issue is the close; the
pull request itself is not an issue here. Rolling: closes in the seven days ending at the tag, divided
by one week. **Polarity: higher is better.**

#### <a id="work-in-progress"></a>Work in progress

The `status: in-progress` label **while the issue is open**, from the issue's label, close and reopen
timeline. Two numbers:

- **at the release** — issues carrying it at the tag;
- **average** — the time-weighted count over the window: the sum of the time each issue spent in
  progress, divided by the window's length.

An issue closed in the window while in progress stops counting at its close; a reopened issue with
the label still on starts again. Rolling: the median of the `at the release` and `average` snapshots
in the seven days ending at the tag. No issue existed at the release is `n/a`. **Polarity: lower is
better** — a small queue of work in progress is the point.

#### <a id="issue-size"></a>Issue size

Two things about the issues closed in the window:

- **within a day** — of the closed issues that carried `status: ready` before they closed, the share
  closed within 24 hours of the **first** time they became ready. Issues with no `status: ready` event
  — the maintainer's own small changes, a bug closed straight from triage — are not measured; the row
  reports how many were.
- **the mix** — every closed issue by its `size: S|M|L` label, or `none`. Every issue is in exactly one
  bucket; the four counts sum to the issues closed.

Rolling: the same over the seven days ending at the tag. No measured issue is `n/a`. **Polarity:
higher is better** for the within-a-day share; the mix is context.

#### <a id="bug-to-feature-ratio"></a>Bug to feature ratio ★

Closed `type: bug` issues divided by closed `type: feature` issues, both closed in the window. It is a
ratio of work done, not of work opened. When no `type: feature` issue closed in the window the ratio
is undefined and the row says n/a (no `type: feature` issue was closed in the window); it is not 0
and not infinity. Rolling: the same over the seven days ending at the tag. **Polarity: lower is
better** — more bugs per feature shipped is a worse week.

#### <a id="reopen-rate"></a>Reopen rate

Issues with a `reopened` event in the window, divided by the issues closed in the window. An issue
that closes, reopens and closes again in the window is one reopened issue and one closed issue. Rolling:
the same over the seven days ending at the tag. No closed issue is `n/a`. **Polarity: lower is
better.**

### Agent output

Almost every pull request is an agent's, so the split is by the **linked issue's `agent:` tier**, not
by the pull request's author. The linked issue is the first issue a closing keyword in the pull
request's body names (`Closes`/`Fixes`/`Resolves #N`); when the body names none, the issue that
cross-references the pull request within ten minutes of its merge. A pull request with no linked issue
is `unlinked`; one whose linked issue has no `agent:` label is `untiered`. Both are shown, because
leaving them out would make the tiers look cleaner than the work is.

#### <a id="agent-acceptance"></a>Acceptance rate

Pull requests **closed in the window** (merged or closed unmerged), by tier: merged ÷ closed. The
overall row is all tiers together. A close without a merge is a rejected attempt; a pull request still
open is neither. Rolling: pull requests closed in the seven days ending at the tag. **Polarity: higher
is better.**

#### <a id="agent-rework"></a>Rework rate

A pull request was **reworked** when it has a non-merge commit committed after its **first review**
(`submitted_at`) or after its **first red** `CI passed`/`e2e` check run, whichever came first. Merge
commits are excluded — the queue's update-branch merge is not the author's work — and the first
commit of a pull request is not "after" anything. The rate is reworked ÷ pull requests closed in the
window.

Beside it, **merge-queue conflict resolutions**: queue-labelled pull requests with a merge commit
whose committer is not `GitHub`. GitHub's update-branch merge is committed by GitHub; a conflict
resolution the queue's skill pushes is committed by the person, and is a second kind of rework the
commit count would miss.

Rolling: the same over the seven days ending at the tag. **Polarity: lower is better.**

#### <a id="agent-revert"></a>Revert rate

Merged pull requests in the window that a **`Revert "…"`** commit at or before this release names, by
`(#N)` in the subject or by `This reverts commit <sha>` naming the merge commit (or a commit on the
branch), divided by merged pull requests in the window. The revert must exist at or before this
release; a revert after it belongs to the release whose report sees it. Rolling: the same over the
seven days ending at the tag. No merged pull request is `n/a`. **Polarity: lower is better.**

## Not measured: the app in use

The releases are built with `ANYDAG_CLOUD_BUILD` off, anonymous logs are opt-in, and the sync server
is not deployed. There is **no production error, crash, latency or uptime data**, so error rate, new
error signatures, crash-free sessions, sync failure rate and uptime are not in the report and must not
be invented. The local server's latency is covered by the bench rows; once logs exist, error
signatures per release come from the log digest and crash-free sessions from the desktop's own
opt-in crash reports. That is a separate issue, and this report will show them as `n/a` with this
reason until then.

## The Markdown

`docs/metrics/<version>.md` is printed to stdout by the script and committed with the JSON. One table
per section:

- **This release** — the value, formatted per the definition.
- **Rolling 7 days** — the same metric over the seven days ending at the tag, or the median of the
  point-in-time snapshots.
- **Previous** — the last three earlier releases that had a number, with the version, so the values
  are readable and not only a shape.
- **Trend** — a sparkline of the last eight releases that had a number, `▁` (low) to `█` (high); a
  flat run is `▄`. Fewer than two numbers is `—`.
- **Direction** — the arrow from the previous number to this one, and whether that is **better** or
  **worse** for this metric (higher-is-better and lower-is-better are in each definition above). A
  metric that is `n/a` at this release is `—`, not a stale direction.

Every metric name links here to its definition. A row with no source prints `n/a` and the reason in
the cell. The report links the security policy and says that it gates nothing.

## Adding or changing a metric

A metric is a **fixed row**. Adding one is a new `id` in `METRICS` in
[`scripts/lib/release-report.mjs`](../../scripts/lib/release-report.mjs), a matching `<a id="…">`
section here, a value builder in `scripts/release-report.mjs` and a test. Changing the **definition**
of an existing metric breaks the trend, so do not do it: add a new row and keep the old one, or make
the change with a note in this file and accept that the series starts again. A row that is missing
from the JSON is a bug in the script, not a report with a hole in it: the script refuses to write.
