import type { Node } from "@/dsl/ir";

/**
 * A title's emphasis, as one attribute on the span that draws it.
 *
 * `bold` and `italic` are bare flags on a node statement (see `FLAGS` in `dsl/common.ts`), and
 * every title span already carries `data-dag-title` — one attribute keyed on that span rather than
 * on a class means one CSS pair covers all eleven title elements, whatever kind drew them. `~=`
 * is the whitespace-list match, so both flags read as `"bold italic"` in one attribute.
 *
 * The hue rule applies to this too, from the other side: when there is nothing, render the
 * attribute *nowhere*. Writing it as an empty string would not trigger any fallback — an attribute
 * set to `""` is a value, not an absence — and every title would then carry a data hook no rule
 * matches, which is the same situation `hueVars()` was written out of.
 */
export function emOf(node: Node): { "data-dag-em"?: string } {
  if (!node.bold && !node.italic) return {};
  const value = [node.bold === true ? "bold" : "", node.italic === true ? "italic" : ""].filter(Boolean).join(" ");
  return { "data-dag-em": value };
}
