# Bench numbers per release

One file per release, `<version>.json`, is the record the release table is compared against. It is
written by `node scripts/bench.mjs --release --save` on the release machine and committed with the
release ([`docs/RELEASING.md`](../RELEASING.md), *A stable release*). `--release` reads the greatest
version below the one being released, so the comparison needs no network, and a number that moved is
a diff in a pull request rather than a paragraph in the previous release's notes.

The file holds the table's fixed rows only:

```json
{
  "version": "0.7.0",
  "date": "2026-11-15T09:00:00.000Z",
  "machine": "… · 12 cores · 23 GB · … · Node v26.12.0 · Chromium 158.0.8127.18",
  "results": [
    { "metric": "vault.1000.list.cold", "value": 168, "unit": "ms" }
  ]
}
```

The rows and what each one means are in `scripts/bench-release.mjs`; the bench's own names are in
[`docs/architecture/limits.md`](../architecture/limits.md). Do not edit a file by hand: a number that
did not come from a run is worse than no number. A release whose machine could not measure a row has
`n/a` in its table, and `--save` refuses to write a file with a hole in it, so a baseline is always
complete.
