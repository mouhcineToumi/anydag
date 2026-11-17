/**
 * What `GET /__board/graph` answers: the vault as a graph, columnar — every document, every link
 * between two of them, and the **fields** a person colours, filters and groups by (#457, #262).
 *
 * **A field is generic.** Kind, folder, tag, project and status are five fields, each a key, its
 * values and which value or values each document has; nothing that reads this knows one by name. A
 * new field is a change to the server's builder (`server/graph.ts`) and to nothing here or on the
 * page. See `docs/architecture/graph.md`.
 *
 * Types only, imported by the server and the page: no browser API and no `@/` alias.
 */
import type { Hue } from "../dsl/ir";

/** The version of the answer; a page that does not know it asks the person to reload. */
export const GRAPH_WIRE_VERSION = 1;

export interface GraphWire {
  v: typeof GRAPH_WIRE_VERSION;
  /** One entry per document, in name order, so a folder's files are neighbours. */
  ids: string[];
  names: string[];
  /** A document's title, or `null` when it is the last part of its name. */
  titles: (string | null)[];
  /**
   * Flat index pairs `[from, to, from, to, …]`. Each pair once whichever way it points, never a
   * document to itself, and only to a document that is in `ids`: a wikilink and a `dag:` reference
   * to the same target are one link.
   */
  links: number[];
  fields: GraphField[];
}

/** One value a field can take. `key` is what a rule names, so a remembered view survives a refresh. */
export interface GraphValue {
  key: string;
  label: string;
  /** The value's own colour (a tag's, a project's), or absent for none: the palette hands one out. */
  hue?: Hue | null;
}

export interface GraphField {
  /** `"kind"`, `"folder"`, `"tag"`, `"project"`, `"status"`, … — what a view names. */
  key: string;
  /** What the field is called where a person picks it: *Kind*, *Folder*, *Tag*. */
  label: string;
  /** What a document with no value is said to have: *No tag*, *At the top*. */
  none: string;
  /** `one` value or none per document, or `many`. Room for `date` or `number` later. */
  type: "one" | "many";
  /** The values are `/` paths, and a rule on `Projects` covers `Projects/Alpha`. */
  tree?: true;
  values: GraphValue[];
  /** Type `one`: an index into `values` per document, `-1` for none. */
  of?: number[];
  /** Type `many`, as CSR: document `i`'s values are `items[start[i]] … items[start[i + 1] - 1]`; `start` has n + 1 entries. */
  start?: number[];
  items?: number[];
}
