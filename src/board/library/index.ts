import { isDiagramType } from "../types";
import { ATOMS } from "./atoms";
import { BRANDS } from "./brands";
import { CHART_ATOMS, CHART_DIAGRAMS, CHART_TEMPLATE_IDS } from "./chart";
import { DIAGRAMS, TEMPLATE_IDS } from "./diagrams";
import { instantiate, partsOf, usesOf, type Find } from "./instantiate";
import { MOLECULES } from "./molecules";
import { OBJECTS } from "./objects";
import { PATTERNS } from "./patterns";
import { SKETCH_ATOMS, SKETCH_DIAGRAMS, SKETCH_MOLECULES, SKETCH_TEMPLATE_IDS } from "./sketch";
import type { Blueprint } from "./types";

/**
 * Ready-made things to put on a board, and what each is made of.
 *
 * One list, five layers. An **atom** is a single statement of one dialect; a **molecule** is a
 * container with something in it; a **pattern** is several of those wired together; a **diagram**
 * is a whole board item; a **stack** is several items. Everything above layer 0 names the
 * blueprints it is built from rather than repeating their text, so editing the `service` atom is
 * an edit to every architecture starter at once.
 *
 * A blueprint at layer 2 or below is a **fragment**: it can be dropped onto a diagram of its own
 * type and appended to that diagram's source, which is how a person adds a service without writing
 * the line. Layer 3 and up are whole items and are placed rather than appended.
 *
 * Kept in `src/board/` because it is data about the format. A test renders every entry and proves
 * it parses without a diagnostic — a component that lands as an error card is worse than none —
 * and a golden file holds the rendered text of all of them, so changing an atom shows up as a diff
 * across everything above it rather than as a surprise.
 */

export const LIBRARY: Blueprint[] = [
  ...SKETCH_DIAGRAMS,
  ...CHART_DIAGRAMS,
  ...DIAGRAMS,
  ...PATTERNS,
  ...SKETCH_MOLECULES,
  ...MOLECULES,
  ...SKETCH_ATOMS,
  ...CHART_ATOMS,
  ...ATOMS,
  ...BRANDS,
  ...OBJECTS,
];

const BY_ID = new Map(LIBRARY.map((b) => [b.id, b]));
export const find: Find = (id) => BY_ID.get(id);

export type { Blueprint };
/** The old name for a blueprint, kept because it is what the panel and the editor call it. */
export type Component = Blueprint;

/**
 * The sections the panel shows, and which one a blueprint belongs in.
 *
 * A layer is a claim about structure; a section is where a person looks for the thing. They mostly
 * agree, and the two places they do not are prose — a note is a whole item like a diagram is, and
 * nobody goes looking for it under "Diagrams" — and the brand marks: a node that already wears
 * Postgres is reached for by the technology, not by a layer of composition, and the same logic that
 * keeps a whole dialect in one section keeps the technologies together.
 */
export type Category =
  | "Generate"
  | "Shapes"
  | "Objects"
  | "Charts"
  | "Yours"
  | "Your notes"
  | "Notes"
  | "Technologies"
  | "Diagrams"
  | "Patterns"
  | "Parts"
  | "Atoms";

export const CATEGORIES: Category[] = [
  "Generate",
  "Shapes",
  "Objects",
  "Charts",
  "Yours",
  "Your notes",
  "Notes",
  "Technologies",
  "Diagrams",
  "Patterns",
  "Parts",
  "Atoms",
];

export { SHELVES } from "./objects";

/** The id prefix of a library entry that places one of the account's notes as a card. */
export const NOTE_CARD = "note-card:";

/** How wide a placed card lands: one width for a note, a task, a board and a quiz. */
const PLACED_CARD_W = 360;
/**
 * And a table's, which is a live view of its rows rather than
 * a name: wide enough for three or four columns, and a wider card shows more.
 */
const TABLE_CARD_W = 560;

/**
 * One of the account's notes, as something to place on a board: an `md` card whose whole body is
 * `![Title](dag:<id>)`, which draws a card of one fixed size naming the note, with a button that
 * opens it — never the note's text. The reference is by id and the title is only the
 * fallback, so the card is right however the note is later renamed or moved. Browser-free:
 * `src/refs/` hands it the note, this says what landing it is.
 */
export function noteCard(note: { id: string; name: string; title?: string; task?: unknown; kind?: string }): Blueprint {
  const title = note.title ?? note.name.slice(note.name.lastIndexOf("/") + 1);
  /* A quiz lands the same way: a card with its count and Practice, the width of a task's. */
  const quiz = note.kind === "quiz";
  /* And a table, as the rows of its first tab. */
  const table = note.kind === "table";
  return {
    id: `${NOTE_CARD}${note.id}`,
    name: title,
    /* A task is a note too, and lands the same way, as the same card with its status on it;
       a quiz lands as its own card, with a way into its run. All three are one width. */
    description: quiz
      ? `a quiz — ${note.name}`
      : table
        ? `a table — ${note.name}`
        : note.task
          ? `a task — ${note.name}`
          : note.name,
    icon: quiz ? "GraduationCap" : table ? "Table2" : note.task ? "SquareCheckBig" : "FileText",
    layer: 3,
    type: "md",
    source: `![${title.replace(/[[\]]/g, "")}](dag:${note.id})`,
    attrs: { w: table ? TABLE_CARD_W : PLACED_CARD_W },
  };
}

/** The extensions a board draws as a picture rather than as a card — `previewOf`'s images, restated
    here because this layer may not import the page's (`src/files/types.ts` is `@/`-aliased). */
const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/**
 * An attachment, as something to place on a board: **a picture is an `image` fence**
 * drawn from it — `src="dag:<id>"`, so it keeps every handle an image has and survives the file
 * being renamed — and **anything else is the placed card** a note is, `![Title](dag:<id>)`, which
 * draws its type, its size, a download and a way to its page. `w` is a picture's width on the board,
 * when whoever places it has measured one.
 */
export function fileCard(file: { id: string; name: string; title?: string | null }, w?: number): Blueprint {
  const title = file.title ?? file.name.slice(file.name.lastIndexOf("/") + 1);
  if (PICTURE.test(file.name))
    return {
      id: `${NOTE_CARD}${file.id}`,
      name: title,
      description: file.name,
      icon: "Image",
      layer: 3,
      type: "image",
      source: "",
      attrs: { src: `dag:${file.id}`, ...(w ? { w } : {}) },
    };
  return {
    id: `${NOTE_CARD}${file.id}`,
    name: title,
    description: file.name,
    icon: "FileText",
    layer: 3,
    type: "md",
    source: `![${title.replace(/[[\]]/g, "")}](dag:${file.id})`,
    attrs: { w: PLACED_CARD_W },
  };
}

export function categoryOf(b: Blueprint): Category {
  /* What a person saved comes first, and stays together whatever layer it landed at: they know
     what it is, and they are looking for it by name rather than by structure. */
  if (b.saved) return "Yours";
  /* A note of this account's, placed on a board as a card that names it. Named apart from
     "Notes", which is the sticky-note fence — the same word for two things, which this file already
     warns about. */
  if (b.id.startsWith(NOTE_CARD)) return "Your notes";
  /* A brand node — a store that already says postgres — is reached for by what it wears. Its own
     section, ahead of the composition ladder, for the reason the shapes and the charts have one:
     nobody reaching for Postgres is thinking about layers. */
  if (b.brand) return "Technologies";
  /* The prompt card, first: it is the one entry that is not a thing to place but a way to get any
     of the others without knowing which one you want. */
  if (b.type === "prompt") return "Generate";
  /* A picture to illustrate with. A `sketch` atom structurally — one `figure` — and ahead
     of the shapes' own test for that reason: a person reaching for a house is not reaching for a
     shape, and fifteen hundred of them folded into *Shapes* would bury the circle. */
  if (b.shelf) return "Objects";
  /* The whole `sketch` dialect in one section, ahead of everything: a box, a button and the
     wireframe made of them are what somebody opening this panel to *draw* is looking for, and
     splitting them across Atoms, Parts and Diagrams by layer would answer a question about
     structure that nobody reaching for a rectangle is asking. */
  if (b.type === "sketch") return "Shapes";
  /* And the whole `chart` dialect in the next one, for the same argument and one more: a chart has
     no container and no wiring, so its blueprints are only ever a statement or a whole chart, and
     splitting two atoms from five diagrams across the sections below would put one row under
     "Atoms" at the bottom of the panel and call it a section. */
  if (b.type === "chart") return "Charts";
  if (!isDiagramType(b.type)) return "Notes";
  if (b.layer >= 3) return "Diagrams";
  if (b.layer === 2) return "Patterns";
  return b.layer === 1 ? "Parts" : "Atoms";
}

/** A fragment joins a diagram of its own type; a whole item is placed on the board. */
export const isFragment = (b: Blueprint): boolean => b.layer <= 2 && isDiagramType(b.type) && !b.inner;

export { toBlueprint } from "./saved";

/** What the panel lists. An inner atom is reachable only by expanding what it is part of. */
export const BROWSABLE: Blueprint[] = LIBRARY.filter((b) => !b.inner);

/**
 * The text this blueprint writes into a board, given what the diagram it is joining already says.
 *
 * `existing` is what an allocated id has to stay clear of — the body a fragment is being appended
 * to, or `""` for anything standing on its own.
 */
export const render = (b: Blueprint, existing = ""): string => instantiate(b, find, existing);

/** What a fragment appended to a diagram's source looks like: one blank line, then the fragment. */
export function appendPart(b: Blueprint, body: string): string {
  const fragment = render(b, body);
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${fragment}` : fragment;
}

/** The blueprints an instance of this one pulls in, for the panel's disclosure. */
export const madeOf = (b: Blueprint): Blueprint[] => partsOf(b, find);

/** Every `use` id this blueprint names, for the checker. */
export { usesOf };

/**
 * Search: every word has to appear in what the blueprint *says* — its name, description, type and
 * section, and **the human text it writes**.
 *
 * That last part is the whole of why "postgres" used to find nothing: the `arch-web-app` starter
 * renders a store whose text literally reads `store db "Database" "postgres"`, and a haystack built
 * from name, description, type and section never sees it. What is indexed is the part of the
 * rendered source a person could say — what it quotes (`"postgres"`, `"Web"`, a sequence message's
 * backticked label) and what it names an icon (`icon=gcp:bigquery`). The grammar stays out: the
 * kind word `service` occurs in every `arch` statement, `hue=teal` in half the molecules, and an
 * arrow or a `group {` is not something anybody types into a search box to mean. Indexing them
 * would make "service" match nearly everything and the search say nothing.
 *
 * The haystack is built once per blueprint and kept: `matches()` runs for every entry on every
 * keystroke, and `render()` walks the composition tree and allocates ids, so calling it there
 * would pay for a whole render pass per letter typed. The library is static, so the cache is keyed
 * by the blueprint's identity — a `WeakMap`, so a saved component (rebuilt from the wire each time
 * the panel loads) is cached for exactly as long as the object answering for it lives and can
 * never answer with a stale name. One `render()` per entry, the first time a query is typed, and
 * never again.
 */

/** What a blueprint *says*, as opposed to the grammar around it: a quoted string, and an icon's value. */
const HUMAN_TEXT = /"([^"\n]*)"|`([^`\n]*)`|\bicon=([\w:-]+)/g;

const haystacks = new WeakMap<Blueprint, string>();

function haystackOf(b: Blueprint): string {
  let hay = haystacks.get(b);
  if (hay === undefined) {
    /* A picture says exactly its caption, which is its name, and its `icon=`, which is on
       the blueprint — so it is read off the blueprint rather than rendered. Seventeen hundred renders
       were a quarter of a second on the first letter anybody typed into the panel. */
    const said = b.shelf
      ? `${b.name} ${b.picture ?? ""}`
      : [...render(b).matchAll(HUMAN_TEXT)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").join(" ");
    hay = `${b.name} ${b.description} ${b.type} ${categoryOf(b)} ${said}`.toLowerCase();
    haystacks.set(b, hay);
  }
  return hay;
}

export function matches(b: Blueprint, query: string): boolean {
  const hay = haystackOf(b);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** The fourteen starting diagrams, by the type they draw — the source `TEMPLATES` is built from. */
export const TEMPLATE_BY_TYPE = new Map(
  [...TEMPLATE_IDS, ...SKETCH_TEMPLATE_IDS, ...CHART_TEMPLATE_IDS].map((id) => BY_ID.get(id)!).map((b) => [b.type, b] as const),
);
