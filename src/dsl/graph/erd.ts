import { CODES } from "../codes";
import type { Ctx, Dialect } from "../common";
import { err } from "../common";
import type { Row } from "../ir";
import type { Cursor } from "../tokenizer";

/**
 * `erd` — entities, their columns, and the references between them.
 *
 *     group tenancy "Tenancy" hue=indigo {
 *       entity workspace { id uuid pk; slug text; credit_balance bigint; +4 }
 *     }
 *     workspace.id ||--o{ app_user.workspace_id
 *     workspace.id ||--o{ intake "workspace_id" quiet     %% one line per group, not per table
 *
 * Two departures from Mermaid, both from rule 4. `+4` renders as a muted "4 more columns" row, so a
 * table with twenty-six columns can show the five that matter and still be honest about the rest.
 * And an edge may target a **group**: multi-tenancy touches every table, and drawing that as six
 * lines buries the model it is supposed to sit under.
 */
function erdRow(cur: Cursor, ctx: Ctx): Row | null {
  const first = cur.eat("word");
  if (!first) return null;

  /* `+18` — the elision row. It is a count, not a column, and it is muted so the eye skips it. */
  if (/^\+\d+$/.test(first.value)) {
    const n = Number(first.value.slice(1));
    return { id: `more-${n}`, name: `${n} more column${n === 1 ? "" : "s"}`, tags: [], kind: "more" };
  }

  const row: Row = { id: first.value, name: first.value, tags: [], kind: "field" };

  /* The type is the next bare word, unless that word is already a key marker. */
  const next = cur.peek();
  if (next.kind === "word" && next.value !== "pk" && next.value !== "fk") {
    cur.next();
    row.detail = next.value;
  }

  for (;;) {
    const t = cur.peek();
    if (t.kind !== "word") break;
    if (t.value === "pk") {
      cur.next();
      row.tags.push("pk");
      continue;
    }
    if (t.value === "fk") {
      cur.next();
      row.tags.push("fk");
      /* `fk=tenancy` colours the pill with that domain's hue, so a glance at a column says which
         part of the model it reaches into. */
      if (cur.eat("punct", "=")) {
        const hue = cur.eat("word");
        if (hue) row.fkHue = hue.value;
        else err(ctx, t, CODES.E_BAD_FK, "expected a group or hue after `fk=`");
      }
      continue;
    }
    break;
  }

  return row;
}

export const erd: Dialect = {
  type: "erd",
  dir: "LR",
  kinds: { entity: "entity" },
  row: erdRow,
  finish(graph) {
    /* `fk=<group id>` is written against a group; turn it into that group's hue now that every
       group is known, so the renderer only ever deals in hue names. */
    const hueOfGroup = new Map(graph.groups.map((g) => [g.id, g.hue]));
    for (const n of graph.nodes) {
      for (const r of n.rows) {
        if (r.fkHue && hueOfGroup.has(r.fkHue)) r.fkHue = hueOfGroup.get(r.fkHue);
      }
    }
  },
};
