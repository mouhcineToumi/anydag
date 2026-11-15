/**
 * How well a document answers a query, lower being better, or `null` when it does not.
 *
 * Every token of the query has to be somewhere in the title or the path — `plan q3` finds
 * `work/q3-plan` — and the title starting with the query beats a word in it starting with it,
 * which beats the query turning up anywhere else. Without the ranking `@arch` offered three
 * boards whose *paths* happened to contain the letters before the one called Architecture.
 *
 * It lives here rather than in the note editor's picker because the Assistant's `@` list (#324)
 * ranks the same way: the two are one ranking, not two that could drift. The note picker
 * (`src/blocks/refs.tsx`) re-exports it, and `test/ref-picker.test.ts` still holds the order it
 * promises.
 */
import { titleOf, type IndexDoc } from "./useIndex";

export function rank(doc: IndexDoc, query: string): number | null {
  const title = titleOf(doc).toLowerCase();
  const hay = `${title} ${doc.name.toLowerCase()}`;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return null;
  const q = tokens.join(" ");
  if (!q) return 3;
  if (title.startsWith(q)) return 0;
  if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(tokens[0]!))) return 1;
  if (title.includes(q)) return 2;
  return 3;
}
