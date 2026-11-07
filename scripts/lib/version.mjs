/**
 * What a version of AnyDag may look like, in one place: `check-version.mjs` holds a tree to it,
 * `set-version.mjs` refuses to write anything else, and the release workflows ask it which kind of
 * release a tag is.
 *
 *   0.2.0                        stable      — only ever a tag on `main`
 *   0.2.0-beta.3                 beta        — a tag on `release/0.2.0`
 *   0.2.0-nightly.202611070230   nightly     — `.github/workflows/nightly.yml`, from `develop`
 *
 * The nightly's one identifier is `YYYYMMDDHHmm` in UTC, a single number, because semver forbids a
 * leading zero in a numeric identifier — `HHmm` after a dot would be invalid before 10:00 — and one
 * number keeps nightlies ordered by the clock, so an updater compares them correctly.
 *
 * Anything else that is semver (`0.2.0-rc.1`) parses and is reported as `other`: the tree may say it,
 * the release workflow refuses to publish it.
 */
export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NIGHTLY = /^nightly\.(\d{12})$/;
const BETA = /^beta\.(\d+)$/;

/** `{core, pre, kind, channel}` for a version, or `null` when it is not semver (or a malformed nightly). */
export function parseVersion(version) {
  const m = SEMVER.exec(version);
  if (!m) return null;
  for (const n of m.slice(1, 4)) if (n.length > 1 && n.startsWith("0")) return null;
  const core = `${m[1]}.${m[2]}.${m[3]}`;
  const pre = m[4] ?? null;
  if (pre === null) return { core, pre, kind: "stable", channel: "latest" };
  if (BETA.test(pre)) {
    if (/^beta\.0\d/.test(pre)) return null;
    return { core, pre, kind: "beta", channel: "beta" };
  }
  const n = NIGHTLY.exec(pre);
  if (n) return validStamp(n[1]) ? { core, pre, kind: "nightly", channel: "nightly" } : null;
  if (pre.split(".")[0] === "nightly") return null; // `nightly` is ours: only the stamped form
  return { core, pre, kind: "other", channel: pre.split(".")[0] };
}

/** `202611070230` is a real minute in UTC. */
function validStamp(s) {
  const [y, mo, d, h, mi] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12)].map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi;
}

/** The nightly's stamp for a moment: `YYYYMMDDHHmm`, UTC. */
export function nightlyStamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}
