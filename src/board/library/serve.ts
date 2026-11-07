import type { AttrValue } from "../attrs";
import type { ItemType } from "../types";
import { BROWSABLE, find, matches, render } from "./index";
import { SHELVES } from "./objects";
import type { Blueprint, Layer } from "./types";

/**
 * The library, off the wire: `GET /__board/library`.
 *
 * `SKILL.md` used to name the panel and stop there — an agent could read what the *categories*
 * were but not what any of them actually drew, the way `/dsl` lets it read the grammar rather than
 * remember it. This is the same move one layer up: every blueprint's *rendered* text, not its
 * template with `${holes}` in it, because the point is something an agent can paste into a diagram
 * without knowing the composition mechanism underneath it.
 *
 * Kept in `src/board/library/` rather than in `plugins/board.ts` so the same function backs the
 * route and the unit test — `test/library-serve.test.ts` calls `libraryList()` directly, the way
 * the plugin does, rather than proving the wiring through an HTTP round trip. Browser-free like the
 * rest of `src/board/`: the Vite plugin imports this from plain Node, before `@/` aliases exist.
 */

/** One blueprint, rendered. */
export interface ServedBlueprint {
  id: string;
  layer: Layer;
  /** The dialect it speaks — for a fragment, the diagram type it can join. */
  type: ItemType;
  name: string;
  description: string;
  /** `render()` against an empty body: the text this blueprint writes standing on its own. */
  source: string;
  attrs?: Record<string, AttrValue>;
  /** An *Objects* entry's shelf — a picture to illustrate with. */
  shelf?: string;
}

const serveOne = (b: Blueprint): ServedBlueprint => ({
  id: b.id,
  layer: b.layer,
  type: b.type,
  name: b.name,
  description: b.description,
  source: render(b),
  attrs: b.attrs,
  ...(b.shelf ? { shelf: b.shelf } : null),
});

/**
 * The pictures, which are not listed unless asked for by name.
 *
 * The *Objects* section is seventeen hundred entries of one statement shape — `figure <id>
 * "<caption>" icon=emoji:<name>` — and an agent asking "what is there to reach for" wants to know
 * that they exist and how to find one, not to read all seventeen hundred: that is a third of a
 * context window spent on a list whose every line says the same thing. So a listing leaves them out
 * and says how many it left out, shelf by shelf; `q=` searches them the way the panel's search
 * does — every word in the name, the shelf or what the entry writes — and lists what it finds, up
 * to `OBJECT_LIMIT`.
 */
export const OBJECT_LIMIT = 60;

interface ServedObjects {
  /** How many pictures there are, or — with `q` — how many matched. */
  total: number;
  /** How many of those are in `blueprints`. */
  listed: number;
  /** Where they are, shelf by shelf, in the panel's order. */
  shelves: { shelf: string; count: number }[];
  /** How to ask for them. */
  how: string;
}

export interface ServedLibrary {
  blueprints: ServedBlueprint[];
  objects: ServedObjects;
}

/** What `GET /library` answers without an `id`: the blueprints, narrowed, and the pictures accounted for. */
export function libraryServed(opts: { type?: string; q?: string } = {}): ServedLibrary {
  const q = opts.q?.trim();
  const inType = BROWSABLE.filter((b) => !opts.type || b.type === opts.type);
  const hit = (b: Blueprint) => !q || matches(b, q);
  const objects = inType.filter((b) => b.shelf && hit(b));
  const listed = q ? objects.slice(0, OBJECT_LIMIT) : [];
  const shown = new Set(listed);
  return {
    blueprints: inType.filter((b) => (b.shelf ? shown.has(b) : hit(b))).map(serveOne),
    objects: {
      total: objects.length,
      listed: listed.length,
      shelves: SHELVES.map((shelf) => ({ shelf, count: objects.filter((b) => b.shelf === shelf).length })).filter(
        (x) => x.count > 0,
      ),
      how:
        "Each object is one sketch `figure` — a picture with its caption under it. Search them with q= " +
        "(`q=truck`), or write one yourself: `figure <id> \"<caption>\" icon=emoji:<name>`, " +
        "where /__board/icons?q= finds the name.",
    },
  };
}

/**
 * Every browsable blueprint, optionally narrowed to one dialect — the same set and the same order
 * the library panel shows, minus the inner atoms nobody can drop by themselves (a row, a class
 * member): reachable only through `?id=`, the way the panel only reaches them by expanding a
 * parent — and minus the pictures, which `libraryServed` accounts for rather than lists.
 */
export function libraryList(type?: string): ServedBlueprint[] {
  return libraryServed({ type }).blueprints;
}

/** One blueprint by id — `find()` reaches an inner atom too, for a caller that already knows it wants one. */
export function libraryOne(id: string): ServedBlueprint | undefined {
  const b = find(id);
  return b ? serveOne(b) : undefined;
}
