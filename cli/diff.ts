/**
 * Two texts as the lines that differ, with a little context — what a rewrite shows before it asks.
 *
 * The page previews a rewrite by drawing it; a terminal can only show the text, and the text a person
 * needs is what changed, not the whole body twice. A plain longest-common-subsequence over lines is
 * enough for a diagram body, which is tens of lines rather than thousands.
 */
export function lineDiff(before: string, after: string, context = 2): string[] {
  const a = before.replace(/\n+$/, "").split("\n");
  const b = after.replace(/\n+$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);

  const ops: { sign: " " | "-" | "+"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ sign: " ", text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) ops.push({ sign: "+", text: b[j++]! });
    else ops.push({ sign: "-", text: a[i++]! });
  }

  const keep = ops.map((op, k) => op.sign !== " " || ops.slice(Math.max(0, k - context), k + context + 1).some((x) => x.sign !== " "));
  const out: string[] = [];
  let skipped = false;
  ops.forEach((op, k) => {
    if (!keep[k]) {
      skipped = true;
      return;
    }
    if (skipped && out.length) out.push("  …");
    skipped = false;
    out.push(`${op.sign} ${op.text}`);
  });
  return out;
}
