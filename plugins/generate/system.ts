import fs from "node:fs";
import path from "node:path";

import { LIBRARY } from "../../src/board/library";
import { libraryList } from "../../src/board/library/serve";
import { DIAGRAM_TYPES, type DiagramType } from "../../src/board/types";

/**
 * What a model is told before it is asked for a diagram — assembled from files in this repository.
 *
 * Three parts, in the order an author would read them: the guide (`docs/generate/guide.md` — the
 * answer's shape, which type answers which question, the house rules), the grammar (`docs/dsl/`, the
 * same cheat sheets `/__board/dsl` serves and the skill symlinks), and the library, rendered. None of
 * it is a string in this file, which is the point: the grammar is changed in the commit that changes
 * the parser, and a system prompt that restated it would be the one copy nobody updates.
 *
 * With `as` set, only that type's sheet and library entries go in — a smaller, sharper prompt for a
 * person who already knows what they want. Left to the model, all fourteen go in; together they are
 * about 36 KB, well inside either model's window, and a two-step "choose, then draw" would cost a
 * second round trip to save tokens nobody is short of.
 */

export interface SystemOptions {
  /** `docs/` — holds `dsl/` and `generate/guide.md`. */
  docsRoot: string;
  as?: DiagramType;
  /** `rewrite` when the run changes an existing diagram rather than drawing a new one. */
  mode?: "draw" | "rewrite";
}

const read = (file: string): string => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "");

/**
 * The pictures a `sketch` can hold, as names rather than as entries.
 *
 * Seventeen hundred library entries of one statement shape would be the largest thing in the prompt
 * by far and say one thing seventeen hundred times. What the model needs is the shape — the cheat
 * sheet has it — and the names worth reaching for, which are the two shelves somebody picked by hand;
 * every other Unicode short name works the same way and the sheet says so.
 */
function objectsLine(): string {
  const picked = LIBRARY.filter((b) => b.shelf === "Drawn" || b.shelf === "Essentials").map((b) => b.picture ?? "");
  return (
    "#### Objects — pictures with a caption under them (fragments)\n" +
    'Each is one `figure <id> "<caption>" icon=<name>` — no icon is a stick figure. The names people reach for ' +
    "most: " +
    picked
      .filter(Boolean)
      .map((n) => `\`${n}\``)
      .join(" ") +
    ". Any Unicode emoji short name works as `emoji:<name>`, and `mono:emoji:<name>` draws it in the node's hue."
  );
}

/** One library entry, as the model sees it: what it is, then the exact text it writes. */
function libraryFor(type: DiagramType): string {
  const entries = libraryList(type);
  if (entries.length === 0) return "";
  const shown = entries
    .map((b) => {
      const attrs = b.attrs && Object.keys(b.attrs).length ? ` · fence attrs: ${JSON.stringify(b.attrs)}` : "";
      const kind = b.layer >= 3 ? "whole diagram" : "fragment";
      return `#### ${b.name} (${kind}${attrs})\n${b.description}\n\n\`\`\`${type}\n${b.source}\n\`\`\``;
    })
    .join("\n\n");
  return `### Library: \`${type}\`\n\n${shown}${type === "sketch" ? `\n\n${objectsLine()}` : ""}`;
}

/* The one block here that is a string rather than a file. It is about the *request mode* — you are
   changing a diagram, not drawing one — and not about the grammar; the grammar is what must never
   be restated in code, and it lives in docs/ where it changes with the parser. */
const REWRITE = `## Rewriting an existing diagram

You are **changing a diagram the person already has**, not drawing a new one. Their message holds
the diagram's current DSL first, then the change they want.

- Keep every id you were not explicitly asked to change. Edges and links elsewhere on the board
  name these ids, and one that disappears takes its lines with it.
- Answer with the **whole** new body in one fence — not a fragment, not a diff, not only the lines
  that changed.
- Keep the fence's type unless the person asks for a different kind of diagram ("as a sequence",
  "use another diagram type", "show this as a flowchart"). Then answer in the type from *Which
  type* that fits what the diagram is about — never the one it already is — and carry over
  everything the old one said: every thing, every relation, every label. Keep an id wherever the
  new type has a place for it.`;

export function systemPrompt({ docsRoot, as, mode }: SystemOptions): string {
  const types: readonly DiagramType[] = as ? [as] : DIAGRAM_TYPES;
  const dsl = path.join(docsRoot, "dsl");
  const sheets = types.map((t) => {
    const text = read(path.join(dsl, `${t}.md`));
    return text ? `## Grammar: \`${t}\`\n\n${text.replace(/^# .*\n/, "")}` : "";
  });
  const library = types.map(libraryFor).filter(Boolean);

  return [
    read(path.join(docsRoot, "generate", "guide.md")),
    as ? `**The person asked for a \`${as}\` diagram.** Answer with a \`${as}\` fence and no other type.` : "",
    mode === "rewrite" ? REWRITE : "",
    "# The grammar",
    `## Shared by the graph types\n\n${read(path.join(dsl, "common.md")).replace(/^# .*\n/, "")}`,
    ...sheets,
    "# The library",
    ...library,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What a model is told before it is asked for flashcards (#140): `docs/generate/flashcards.md` and
 * nothing else. The quiz format a card is written in is said there in the few lines a card needs — a
 * card is a heading and a quote — and `cards.ts` reads the answer with the real parser, so a sheet
 * that drifted from the format would be caught on the first reply rather than believed.
 */
export const cardsSystemPrompt = ({ docsRoot }: Pick<SystemOptions, "docsRoot">): string =>
  read(path.join(docsRoot, "generate", "flashcards.md"));
