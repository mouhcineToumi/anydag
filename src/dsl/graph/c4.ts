import type { Dialect } from "../common";

/**
 * `c4` — level 2, the containers: every separately deployable thing and what it is built with.
 *
 *     person learner "Learner" "Studies for a cloud certification."
 *     system larkspur "Larkspur" "software system" hue=indigo {
 *       container api "API" "FastAPI · Python 3.12" "Serves content, profiles and progress."
 *       db firestore "Database" "Firestore" "Holds tracks, nodes, profiles and progress."
 *     }
 *     extsystem auth "Firebase Auth" "Signs learners in and issues the id tokens."
 *     web --> api "Reads content and progress" "JSON/HTTPS"
 *
 * C4's shape is three tiers of text per box — name, `[Type: technology]`, a sentence — and that
 * sentence is the only text in the whole system that wraps. It is what makes a C4 diagram readable
 * by someone who was not in the room, and it is why C4 boards are tall rather than wide.
 */
export const c4: Dialect = {
  type: "c4",
  dir: "TB",
  kinds: {
    person: "person",
    container: "container",
    db: "db",
    store: "db",
    extsystem: "extsystem",
    external: "extsystem",
  },
  groupWords: ["group", "system"],
  finish(graph) {
    for (const n of graph.nodes) {
      /* A person and an external system take two strings (name, description); a container takes
         three (name, technology, description). The common parser fills them positionally, so the
         two-string kinds need their second string moved from `meta` to `desc`. */
      if ((n.kind === "person" || n.kind === "extsystem") && n.desc === undefined) {
        n.desc = n.meta;
        n.meta = undefined;
      }
    }
  },
};
