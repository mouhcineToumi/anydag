import { parseBoard } from "../parseBoard";
import { isDiagramType, type BoardItem } from "../types";
import type { Blueprint } from "./types";

/**
 * A component a person saved off their own board.
 *
 * **It is a board.** Same format, same watcher, same editor — `boards/components/<name>.board.md`
 * — so a saved component can be opened and reworked with everything the tool already has, lives in
 * git beside the boards it came from, and Claude can write one with a text editor. The board list
 * hides that one directory; nothing else about it is special.
 *
 * **Its source is stored literally, not parameterised.** A body full of `${slots}` would not parse,
 * and a component that cannot be opened is not a board at all — so the ids are the real ones the
 * person wrote, and the collisions are dealt with when it is dropped, by `src/dsl/rebind.ts`. That
 * is the one place the two kinds of component differ: an authored blueprint fills holes,
 * a saved one renames what would clash.
 *
 * One diagram item becomes a **fragment** at layer 2, so it can be dropped onto a diagram of its
 * type as well as placed on its own. Anything else becomes a **stack** at layer 4: several items
 * that go down together, keeping their arrangement and any groups inside them.
 */

export interface SavedComponent {
  /** The board name under `boards/components/`. */
  name: string;
  text: string;
  meta: unknown;
}

/** What the frontmatter of a component board says about itself. */
interface Meta {
  title?: string;
  component?: { description?: string; icon?: string };
}

/** The frontmatter a saved component carries, so the panel has something to show. */
export function componentFrontmatter(title: string, description: string, icon: string): string {
  const quote = (s: string) => JSON.stringify(s);
  return ["---", `title: ${quote(title)}`, "component:", `  description: ${quote(description)}`, `  icon: ${icon}`, "---", ""].join("\n");
}

export function toBlueprint(saved: SavedComponent): Blueprint {
  const board = parseBoard(saved.name, saved.text);
  const items: BoardItem[] = board.items.filter((it) => !it.hidden);
  const meta = (saved.meta ?? {}) as Meta;
  const one = items.length === 1 ? items[0]! : null;
  const fragment = one && isDiagramType(one.type);

  return {
    id: `saved:${saved.name}`,
    layer: fragment ? 2 : 4,
    type: fragment ? one.type : "md",
    name: meta.title || saved.name.split("/").pop() || saved.name,
    description: meta.component?.description || `${items.length} item${items.length === 1 ? "" : "s"}, saved from a board`,
    icon: meta.component?.icon || (fragment ? "Boxes" : "Layers"),
    source: one ? one.body : "",
    attrs: one ? attrsFor(one) : {},
    saved: { board: saved.name, text: saved.text, items: items.length },
  };
}

/** The fence attributes worth carrying over — not the id, and not where it happened to sit. */
function attrsFor(it: BoardItem): Blueprint["attrs"] {
  const out = { ...it.attrs.map };
  delete out.id;
  delete out.x;
  delete out.y;
  delete out.page;
  delete out.group;
  return out;
}
