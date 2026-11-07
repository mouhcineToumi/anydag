import { render, TEMPLATE_BY_TYPE } from "./library";
import { DIAGRAM_TYPES, type ItemType } from "./types";

/**
 * What a new item says before anyone has said anything.
 *
 * Every diagram type has a grammar, and an empty fence is the one thing that grammar cannot help
 * with: a person adding a `sequence` from the toolbar gets nothing to edit and no example of what
 * to type. So each type starts as the smallest diagram that draws — two or three nodes and an edge,
 * in the dialect's own idiom — small enough to replace in one selection, real enough to show the
 * shape of the language.
 *
 * These used to be written out here and again, in pieces, in the library. Now they *are* the
 * library's layer-3 diagrams, rendered: one `arch` template composed of the client, service and
 * store atoms, so the template cannot drift from the parts a person drops onto it. Kept in
 * `src/board/` because the plugin and the tests may want them too.
 */
export const TEMPLATES: Record<ItemType, string> = {
  md: "New note",
  note: "New note",
  image: "",

  /* The links between items. Empty rather than an example: the ids it would name are this board's,
     and a template that draws two `EB_LINK_UNKNOWN_ITEM` on arrival is worse than a blank one, and
     `DIAGRAM_TYPES` below does not hold it — an `edges` fence is a board family, not a diagram. */
  edges: "",

  /* A prompt card opens empty: its placeholder says what to write, and a sample description would be
     one more thing to select and delete before typing the one somebody actually wants. */
  prompt: "",

  ...(Object.fromEntries(DIAGRAM_TYPES.map((t) => [t, render(TEMPLATE_BY_TYPE.get(t)!)])) as Record<
    (typeof DIAGRAM_TYPES)[number],
    string
  >),
};
