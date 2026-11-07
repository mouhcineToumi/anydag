import type { Ctx, Dialect } from "../common";
import type { Row } from "../ir";
import type { Cursor } from "../tokenizer";

/**
 * `class` — types, what they hold, what they do, and how they relate.
 *
 *     class IngestService { -store: DocumentStore; +ingest(upload) Candidate }
 *     interface TextExtractor { +extract(doc) list[Page] }
 *     MistralExtractor ..|> TextExtractor
 *     Candidate *-- Profile "1"
 *
 * A member is an attribute or a method depending on whether it has parentheses, and the two land in
 * separate compartments automatically. That is the visual tell that separates a class box from an
 * ER entity, which is otherwise the same rectangle full of rows — so it is worth getting from the
 * syntax rather than asking the author to draw a divider.
 */
const VIS: Record<string, Row["vis"]> = { "+": "+", "-": "-", "#": "#", "~": "~" };

function classRow(cur: Cursor, _ctx: Ctx): Row | null {
  const first = cur.eat("word");
  if (!first) return null;

  let text = first.value;
  let vis: Row["vis"];
  if (VIS[text[0]!]) {
    vis = VIS[text[0]!];
    text = text.slice(1);
  }

  /* A method: consume the argument list verbatim, then whatever follows is the return type. The
     arguments are display text — nothing downstream parses them, and pretending otherwise would
     mean a type grammar. */
  if (cur.peek().kind === "punct" && cur.peek().value === "(") {
    cur.next();
    const parts: string[] = [];
    while (!cur.done && !(cur.peek().kind === "punct" && cur.peek().value === ")")) {
      const t = cur.next();
      parts.push(t.kind === "string" ? `"${t.value}"` : t.value);
    }
    cur.eat("punct", ")");
    /* Space-separated, then pull the commas back onto the word before them: `key, data`. */
    const args = parts.join(" ").replace(/ ,/g, ",");

    const ret: string[] = [];
    while (cur.peek().kind === "word" || (cur.peek().kind === "punct" && "[]|".includes(cur.peek().value))) {
      ret.push(cur.next().value);
    }
    return {
      id: text,
      name: `${text}(${args})`,
      detail: ret.join(" ") || undefined,
      tags: [],
      vis,
      kind: "method",
    };
  }

  // An attribute: `name: Type`
  let detail: string | undefined;
  if (cur.eat("punct", ":")) {
    const parts: string[] = [];
    while (cur.peek().kind === "word" || (cur.peek().kind === "punct" && "[]|".includes(cur.peek().value))) {
      parts.push(cur.next().value);
    }
    detail = parts.join(" ") || undefined;
  }

  return { id: text, name: text, detail, tags: [], vis, kind: "attr" };
}

export const klass: Dialect = {
  type: "class",
  dir: "LR",
  kinds: { class: "class", interface: "interface", abstract: "abstract", enum: "enum" },
  row: classRow,
  finish(graph) {
    for (const n of graph.nodes) {
      if (n.kind === "interface") n.stereotype = "«interface»";
      if (n.kind === "abstract") n.stereotype = "«abstract»";
      if (n.kind === "enum") n.stereotype = "«enum»";

      const attrs = n.rows.filter((r) => r.kind === "attr");
      const methods = n.rows.filter((r) => r.kind === "method");
      /* Only the compartments that have something in them: an interface with no fields should not
         show an empty band, which is what UML tools do and what makes them look like forms. */
      n.compartments = [attrs, methods].filter((c) => c.length > 0);
    }
  },
};
