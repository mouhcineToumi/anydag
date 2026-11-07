import type { Dialect } from "../common";
import { modifiers, strings } from "../common";
import type { Row } from "../ir";
import type { Cursor } from "../tokenizer";

/**
 * `arch` — what runs, what stores, and what talks to what.
 *
 *     group gcp "Google Cloud" "larkspur-prod · europe-west1" hue=indigo {
 *       group run "Cloud Run" hue=teal {
 *         service api "larkspur-api" "fastapi · uvicorn" {
 *           identity "verify the id token"
 *           content  "tracks · branches · nodes"
 *         }
 *       }
 *     }
 *     client browser "Learner's browser" "react 19"
 *     browser --> web "https"
 *     api.content --> db
 *
 * The rows are **ports**, not fields: each one names something the component depends on, and the
 * edge for that dependency leaves from its row rather than from the card. That is what stops an
 * architecture diagram becoming a bundle of lines leaving one anonymous box.
 */
function portRow(cur: Cursor): Row | null {
  const id = cur.eat("word");
  if (!id) return null;
  const texts = strings(cur, 1);
  return {
    id: id.value,
    name: id.value,
    detail: texts[0]?.value,
    tags: [],
    kind: "port",
  };
}

export const arch: Dialect = {
  type: "arch",
  dir: "LR",
  kinds: {
    service: "service",
    store: "store",
    db: "db",
    client: "client",
    person: "person",
    queue: "queue",
    external: "external",
    container: "container",
  },
  row: (cur, ctx) => {
    const row = portRow(cur);
    /* Ports take no flags of their own; consuming anything trailing keeps the row loop from
       spinning on a token it cannot use. */
    if (row) modifiers(cur, ctx);
    return row;
  },
};
