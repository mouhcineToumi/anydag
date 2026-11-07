/**
 * The CLI's half of `scripts/parity.mjs`: which routes it refuses, read out of `docs/parity.json`.
 * Restated in TypeScript rather than imported, because the bundle takes nothing from `scripts/` —
 * and `test/parity.test.ts` holds this answer to the script's, so the two cannot disagree.
 */

interface Feature {
  rest: unknown;
  cli: unknown;
}

const refusal = (v: unknown): string | null =>
  v && typeof v === "object" && !Array.isArray(v) && typeof (v as { refused?: unknown }).refused === "string" ? (v as { refused: string }).refused : null;

/** `{route: reason}` for every route a feature refuses the CLI. */
export function cliRefused(manifest: { features: Feature[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of manifest.features) {
    const why = refusal(f.cli);
    if (why === null || !Array.isArray(f.rest)) continue;
    for (const route of f.rest) out[String(route)] = why;
  }
  return out;
}
