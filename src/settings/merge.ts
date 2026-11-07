/**
 * A three-way merge of two versions of a settings file (`.anydag/settings.json`), key by key, for
 * the sync client when the same file changed on two devices. Browser-free and import-free: the
 * server and the page may both read it.
 *
 * Load-bearing: a key changed on one side only is that side's (removal included); changed on both,
 * the remote's wins — it committed first; the keys named in `sets` are lists that merge as sets, so
 * two devices each favouriting a file keep both.
 */

/** Keys whose arrays are sets: the favourites follow the vault, and each device adds to them. */
export const SETTINGS_SETS = ["dag:favourites"] as const;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function mergeSet(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
  const inBase = (x: unknown): boolean => base.some((b) => same(b, x));
  const inOurs = (x: unknown): boolean => ours.some((b) => same(b, x));
  const inTheirs = (x: unknown): boolean => theirs.some((b) => same(b, x));
  // Kept: present on both sides, or added by either side since the base.
  const keep = (x: unknown): boolean => (inOurs(x) && inTheirs(x)) || (!inBase(x) && (inOurs(x) || inTheirs(x)));
  const out: unknown[] = [];
  for (const x of [...ours, ...theirs]) if (keep(x) && !out.some((o) => same(o, x))) out.push(x);
  return out;
}

export function mergeKeys(
  base: Record<string, unknown> | null,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  opts: { sets?: readonly string[] } = {},
): Record<string, unknown> {
  const b = base ?? {};
  const out: Record<string, unknown> = {};
  const keys = [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !has(ours, k))];
  for (const k of keys) {
    const o = has(ours, k) ? ours[k] : undefined;
    const t = has(theirs, k) ? theirs[k] : undefined;
    const bv = has(b, k) ? b[k] : undefined;
    let v: unknown;
    if (opts.sets?.includes(k) && Array.isArray(o ?? []) && Array.isArray(t ?? []) && (o !== undefined || t !== undefined)) {
      v = mergeSet(Array.isArray(bv) ? bv : [], (o as unknown[]) ?? [], (t as unknown[]) ?? []);
    } else if (same(o, t)) v = o;
    else if (same(o, bv)) v = t;
    else if (same(t, bv)) v = o;
    else v = t;
    if (v !== undefined) out[k] = v;
  }
  return out;
}
