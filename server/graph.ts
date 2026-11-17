/**
 * `GET /__board/graph`'s answer, built from the references index the server already keeps
 * (`indexDocs`, #280): no file is read and nothing is parsed again. See `src/graph/wire.ts` for the
 * shape and `docs/architecture/graph.md` for why it is columnar.
 *
 * **This is the one place a field is known by name.** Each is a `FieldBuilder` below: a key, a
 * label, and what one document's value or values are. A field added later is a builder added to
 * `FIELDS`, and nothing on the page changes.
 *
 * Every loop is paced (`server/pace.ts`), and so is the JSON: on 50,000 documents neither may hold
 * the server's only thread (#287).
 */

import { setImmediate as yieldNow } from "node:timers/promises";

import { GRAPH_WIRE_VERSION, type GraphField, type GraphValue, type GraphWire } from "../src/graph/wire";
import { collation } from "../src/locale";
import { type Project, projectFolders, projectFor } from "../src/note/project";
import { defaultHue, tagKey } from "../src/note/tags";
import { STATUS_LABEL, STATUSES, type TaskStatus } from "../src/note/task";
import { folderOf, type Kind, leafOf } from "./names";
import { paced } from "./pace";
import type { Registry } from "./tags";

/** One document of the references index, as far as the graph reads it. */
export interface GraphDoc {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  refs: readonly { id: string }[];
  [more: string]: unknown;
}

/* What the index says of a note. A template's are `null` already (`indexAnswer`). */
const taskOf = (d: GraphDoc) => d.task as { status: TaskStatus } | null | undefined;
const projectOf = (d: GraphDoc) => d.project as Project | null | undefined;
const tagsOf = (d: GraphDoc) => d.tags as string[] | null | undefined;

/** What the vault is beside its documents: what a builder may read once for all of them. */
interface Context {
  docs: readonly GraphDoc[];
  registry: Registry;
}

/** A field's values as they are found, then sorted and numbered. */
interface Found {
  values: GraphValue[];
  /** Type `one`: the value key per document, `null` for none. Type `many`: the keys, possibly none. */
  per: (string | null)[] | string[][];
}

interface FieldBuilder {
  key: string;
  label: string;
  none: string;
  type: "one" | "many";
  tree?: true;
  build(c: Context): Promise<Found>;
}

const order = () => collation({ numeric: true });
const byLabel = (values: GraphValue[]): GraphValue[] => {
  const o = order();
  return values.sort((a, b) => o.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
};

/* -------------------------------------------------------------------------------------------- kind */

/** What the graph calls a document's kind: the sidebar's mark (`shownKind` in `src/ui/filter.ts`). */
type GraphKind = "note" | "task" | "project" | "event" | "board" | "quiz" | "table" | "attachment";

/**
 * In the order the sidebar's *Show in Files* lists them, each with the hue the graph draws it in: a
 * note is `plain` — slate, the ground most of a vault is — so the kinds that are not a plain note
 * stand out on it (the design session's picture, #262).
 */
const KINDS: readonly (GraphValue & { key: GraphKind })[] = [
  { key: "note", label: "Notes", plain: true },
  { key: "task", label: "Tasks", hue: "spruce" },
  { key: "project", label: "Projects", hue: "coral" },
  { key: "event", label: "Events", hue: "ochre" },
  { key: "board", label: "Boards", hue: "indigo" },
  { key: "quiz", label: "Quizzes", hue: "violet" },
  { key: "table", label: "Tables", hue: "teal" },
  { key: "attachment", label: "Attachments", hue: "bronze" },
];

/** A note wears the mark of the first of project, task and event it is, as in the sidebar. */
function kindOf(d: GraphDoc): GraphKind {
  const kind = d.kind as Kind;
  switch (kind) {
    case "board":
    case "quiz":
    case "table":
      return kind;
    case "file":
      return "attachment";
    case "note":
      if (projectOf(d)) return "project";
      if (taskOf(d)) return "task";
      if (d.event) return "event";
      return "note";
    default:
      return assertNever(kind);
  }
}

function assertNever(x: never): never {
  throw new Error(`a kind the graph does not know: ${String(x)}`);
}

const kindField: FieldBuilder = {
  key: "kind",
  label: "Kind",
  none: "No kind",
  type: "one",
  async build({ docs }) {
    const per: string[] = [];
    await paced(docs, (d) => per.push(kindOf(d)));
    const seen = new Set(per);
    return { values: KINDS.filter((k) => seen.has(k.key)).map((k) => ({ ...k })), per };
  },
};

/* ------------------------------------------------------------------------------------------ folder */

const folderField: FieldBuilder = {
  key: "folder",
  label: "Folder",
  none: "At the top",
  type: "one",
  tree: true,
  async build({ docs }) {
    const per: (string | null)[] = [];
    const seen = new Set<string>();
    await paced(docs, (d) => {
      const f = folderOf(d.name);
      if (f) seen.add(f);
      per.push(f || null);
    });
    return { values: [...seen].sort().map((f) => ({ key: f, label: f })), per };
  },
};

/* --------------------------------------------------------------------------------------------- tag */

const tagField: FieldBuilder = {
  key: "tag",
  label: "Tag",
  none: "No tag",
  type: "many",
  async build({ docs, registry }) {
    const per: string[][] = [];
    /* Each tag's spellings, so one nobody registered is labelled as most documents write it — `tagList`'s rule. */
    const spellings = new Map<string, Map<string, number>>();
    await paced(docs, (d) => {
      const keys: string[] = [];
      for (const tag of tagsOf(d) ?? []) {
        const key = tagKey(tag);
        if (keys.includes(key)) continue;
        keys.push(key);
        let s = spellings.get(key);
        if (!s) spellings.set(key, (s = new Map()));
        s.set(tag, (s.get(tag) ?? 0) + 1);
      }
      per.push(keys);
    });
    const values: GraphValue[] = [];
    for (const [key, s] of spellings) {
      const r = registry.get(key);
      const label = r?.name ?? [...s].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
      values.push({ key, label, hue: r?.hue ?? defaultHue(label) });
    }
    return { values: byLabel(values), per };
  },
};

/* ----------------------------------------------------------------------------------------- project */

const projectField: FieldBuilder = {
  key: "project",
  label: "Project",
  none: "No project",
  type: "one",
  async build({ docs }) {
    /* Membership is a path (`src/note/project.ts`): every document under the project note's folder. */
    const projects: Record<string, Project> = {};
    const byName = new Map<string, GraphDoc>();
    await paced(docs, (d) => {
      const p = d.kind === "note" ? projectOf(d) : null;
      if (!p) return;
      projects[d.name] = p;
      byName.set(d.name, d);
    });
    const folders = projectFolders(projects);
    const per: (string | null)[] = [];
    const values = new Map<string, GraphValue>();
    await paced(docs, (d) => {
      const note = folders.size ? projectFor(d.name, folders) : undefined;
      const p = note === undefined ? undefined : byName.get(note);
      if (!p) {
        per.push(null);
        return;
      }
      per.push(p.id);
      if (!values.has(p.id))
        values.set(p.id, { key: p.id, label: p.title ?? leafOf(p.name), hue: projects[p.name]!.hue ?? null });
    });
    return { values: byLabel([...values.values()]), per };
  },
};

/* ------------------------------------------------------------------------------------------ status */

const statusField: FieldBuilder = {
  key: "status",
  label: "Status",
  none: "Not a task",
  type: "one",
  async build({ docs }) {
    const per: (string | null)[] = [];
    const seen = new Set<string>();
    await paced(docs, (d) => {
      const s = taskOf(d)?.status ?? null;
      if (s) seen.add(s);
      per.push(s);
    });
    return { values: STATUSES.filter((s) => seen.has(s)).map((s) => ({ key: s, label: STATUS_LABEL[s] })), per };
  },
};

/** Every field the graph carries, in the order a person is offered them. */
const FIELDS: readonly FieldBuilder[] = [kindField, folderField, tagField, projectField, statusField];

/* ------------------------------------------------------------------------------------------- build */

async function fieldOf(b: FieldBuilder, c: Context): Promise<GraphField> {
  const { values, per } = await b.build(c);
  const index = new Map(values.map((v, i) => [v.key, i]));
  const head = { key: b.key, label: b.label, none: b.none, type: b.type, ...(b.tree ? { tree: true as const } : {}), values };
  if (b.type === "one") {
    const of: number[] = [];
    await paced(per as (string | null)[], (k) => of.push(k === null ? -1 : (index.get(k) ?? -1)));
    return { ...head, of };
  }
  const start: number[] = [0];
  const items: number[] = [];
  await paced(per as string[][], (keys) => {
    for (const k of keys) {
      const v = index.get(k);
      if (v !== undefined) items.push(v);
    }
    start.push(items.length);
  });
  return { ...head, start, items };
}

/**
 * The graph of every document the references index holds: texts and attachments in name order, each
 * link once, and every field. `hue` values come from `registry` (the tag list); everything else is
 * what the index already says.
 */
export async function graphOf(indexed: readonly GraphDoc[], registry: Registry): Promise<GraphWire> {
  const docs = [...indexed].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
  await yieldNow();
  const n = docs.length;
  const ids: string[] = [];
  const names: string[] = [];
  const titles: (string | null)[] = [];
  const at = new Map<string, number>();
  await paced(docs, (d) => {
    at.set(d.id, ids.length);
    ids.push(d.id);
    names.push(d.name);
    titles.push(d.title === null || d.title === leafOf(d.name) ? null : d.title);
  });
  /* An unordered pair is one number, `low * n + high`: exact in a double up to 94 million documents. */
  const links: number[] = [];
  const seen = new Set<number>();
  let from = 0;
  await paced(docs, (d) => {
    for (const r of d.refs) {
      const to = r.id ? at.get(r.id) : undefined;
      if (to === undefined || to === from) continue;
      const pair = from < to ? from * n + to : to * n + from;
      if (seen.has(pair)) continue;
      seen.add(pair);
      links.push(from, to);
    }
    from++;
  });
  const c: Context = { docs, registry };
  const fields: GraphField[] = [];
  for (const b of FIELDS) fields.push(await fieldOf(b, c));
  return { v: GRAPH_WIRE_VERSION, ids, names, titles, links, fields };
}

/** About how many entries of an array are written to JSON at a time. */
const SLICE = 20_000;

/** A long array as JSON, a slice at a time with the thread handed back between. */
async function arrayJson(a: readonly unknown[]): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < a.length; i += SLICE) {
    parts.push(JSON.stringify(a.slice(i, i + SLICE)).slice(1, -1));
    await yieldNow();
  }
  return `[${parts.join(",")}]`;
}

/** The answer as JSON, its long arrays written in slices (#287). The text is `JSON.stringify`'s. */
export async function graphJson(g: GraphWire): Promise<string> {
  const fields: string[] = [];
  for (const f of g.fields) {
    const { values, of, start, items, ...head } = f;
    const parts = [JSON.stringify(head).slice(1, -1), `"values":${await arrayJson(values)}`];
    if (of) parts.push(`"of":${await arrayJson(of)}`);
    if (start) parts.push(`"start":${await arrayJson(start)}`);
    if (items) parts.push(`"items":${await arrayJson(items)}`);
    fields.push(`{${parts.join(",")}}`);
  }
  return `{"v":${g.v},"ids":${await arrayJson(g.ids)},"names":${await arrayJson(g.names)},"titles":${await arrayJson(
    g.titles,
  )},"links":${await arrayJson(g.links)},"fields":[${fields.join(",")}]}`;
}
