/**
 * The document routes: listing, reading and writing a text, making, renaming, copying and deleting
 * any kind, a title, a task, a project, an event, a table's cells, and what reads the whole vault —
 * the index, the corpus, the search. `main.py`'s, ported, with three local differences:
 *
 * - **A name is the title** (decision 14). A text made with a `title:` is filed under that title,
 *   verbatim, and the line is dropped when the file's name says it exactly; `/retitle` with
 *   `follow` renames the file to the title and keeps the line only where the name cannot say it.
 * - **Nothing is shared.** `shared` is always empty; the routes that shared are gone.
 * - **Ids are in the files** (decision 5); `vault.ident` mints one lazily when somebody asks.
 */

import { setImmediate as yieldNow } from "node:timers/promises";

import type { Context, Hono } from "hono";

import { HUE_ORDER } from "../../src/dsl/ir";
import { isDay, eventOf, withEvent } from "../../src/note/event";
import { cleanTitle } from "../../src/note/format";
import { PROJECT_STATUSES, hueOf, projectOf, projectStatusOf, withProject } from "../../src/note/project";
import { tagKey, tagOf } from "../../src/note/tags";
import { PRIORITIES, STATUSES, dueOf, indexedTask, priorityOf, statusOf, taskOf, withTask } from "../../src/note/task";
import { inTemplates } from "../../src/note/template";
import { resolveWikiRefs, titleOf, type Ref } from "../../src/refs/extract";
import { type WikiCandidate, type WikiIndex, wikiIndexer } from "../../src/refs/wikilinks";
import type { Session } from "../context";
import { endsBeforeItStarts, placed, withTitle, withoutTitle, zoneIn } from "../frontmatter";
import { OPS_SHAPE } from "../handle";
import { type Doc, grammar, type Over, type Parsed } from "../grammar";
import type { Entry } from "../parsing";
import { anyKind, bodyOf, err, mustExist, mustRead, outsideComponents, recompute, textKind } from "../http";
import { extOf, folderOf, leafOf, titleName, type Kind, type TextKind } from "../names";
import { paced } from "../pace";
import { mimeOf } from "../uploads";
import { Conflict, NotFound, Refused, byKind, textKey, type Tree } from "../vault";
import { trashAnswer, trashDays } from "../trash";
import { readPrefs } from "./prefs";
import { relinking } from "../relink";

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One attachment as every file route describes it. */
export const fileAnswer = (name: string, id: string | null | undefined, title: string | null | undefined, bytes: number) => {
  const ext = extOf(name);
  return { name, id: id ?? null, title: title ?? null, ext, mime: mimeOf(ext), bytes };
};

interface Listed {
  key: string;
  name: string;
  kind: TextKind;
  id: string;
}

/* Per tree, which a kept listing hands out again while nothing moved: sorting 50,000 names is not free. */
const listedOf = new WeakMap<Tree, Listed[]>();

/** Every listed text with an id, keyed the way `Vault.texts` keys them. Components are not listed. */
function listed(tree: Tree): Listed[] {
  let had = listedOf.get(tree);
  if (!had) {
    const docs: Listed[] = [];
    for (const kind of ["board", "note", "quiz", "table"] as const) {
      for (const name of byKind(tree)[kind]) {
        const id = tree.ids[name];
        if (id) docs.push({ key: textKey(name, kind), name, kind, id });
      }
    }
    docs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    listedOf.set(tree, (had = docs));
  }
  return had;
}

/* The texts an answer holds, per answer: `Parsed` hands the same one back while nothing moved. */
const presentOf = new WeakMap<ReadonlyMap<string, Doc | null>, { all: Listed[]; docs: Listed[] }>();

/**
 * What `parsed` made of every listed text that could be read, and those texts — read where the
 * grammar runs, so no text is read on this thread (#287), and not read at all while the kept listing
 * says it has not moved (#280). The stamps are read now, not with the tree: a text written in place
 * whose frontmatter did not move leaves the tree as it was, and only its stamp says so.
 */
async function parsedOf(
  s: Session,
  parsed: Parsed,
  tree: Tree,
): Promise<{ docs: Listed[]; found: ReadonlyMap<string, Doc | null> }> {
  const all = listed(tree);
  const stamps = s.vault.textStamps(tree);
  const entries: Entry[] = [];
  await paced(all, (d) => {
    const stamp = stamps?.get(d.key);
    entries.push(stamp === undefined ? [d.key, d.name, d.kind] : [d.key, d.name, d.kind, stamp]);
  });
  const found = await parsed.of(entries);
  // A text gone between the listing and its reading is not in the answer.
  const had = presentOf.get(found);
  if (had?.all === all) return { docs: had.docs, found };
  const docs: Listed[] = [];
  await paced(all, (d) => {
    if (found.has(d.key)) docs.push(d);
  });
  presentOf.set(found, { all, docs });
  return { docs, found };
}

function fileDocs(tree: Tree) {
  return tree.files
    .filter((n) => tree.ids[n])
    .map((n) => ({
      id: tree.ids[n]!,
      name: n,
      kind: "file",
      title: tree.titles[n] ?? null,
      bytes: tree.sizes[n] ?? 0,
      refs: [],
    }));
}

interface IndexDoc {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  refs: Ref[];
  [more: string]: unknown;
}

/* The last index each vault answered, the listing and parse it was made from, and its JSON once
   asked for: the same answer while neither moved, which is most of the time a page asks (#280). */
const indexes = new WeakMap<
  Parsed,
  { tree: Tree; found: ReadonlyMap<string, Doc | null>; docs: IndexDoc[]; json: Promise<string> | null }
>();

/** Every document with what it says about itself and its references, each `[[wikilink]]` resolved. */
async function indexDocs(s: Session): Promise<IndexDoc[]> {
  return (await indexOf(s)).docs;
}

async function indexOf(s: Session): Promise<{ docs: IndexDoc[]; json: Promise<string> | null }> {
  const tree = await s.vault.tree();
  const parsed = s.index;
  const { docs, found } = await parsedOf(s, parsed, tree);
  const had = indexes.get(parsed);
  if (had && had.tree === tree && had.found === found) return had;
  const now = { tree, found, docs: await indexAnswer(parsed, tree, docs, found, s.vault.templatesFolder()), json: null };
  indexes.set(parsed, now);
  return now;
}

/** The index's answer as the JSON it is sent as, made once per answer. */
async function indexJson(s: Session): Promise<string> {
  const at = await indexOf(s);
  return (at.json ??= jsonListPaced(at.docs).then((list) => `{"docs":${list}}`));
}

/* What each vault's index last answered for each text, with the parse and the names it resolved its
   links against: a document whose parse did not move, in a vault whose names did not, answers as it
   did — so a burst of saves resolves the links of what was saved, not of all 50,000 (#280). */
const answered = new WeakMap<
  Parsed,
  {
    named: WikiCandidate[];
    ix: WikiIndex<WikiCandidate>;
    docs: Map<string, { f: Doc | null | undefined; own: boolean; out: IndexDoc }>;
  }
>();

const sameCandidates = (a: readonly WikiCandidate[], b: readonly WikiCandidate[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i]!;
    return x.id === y.id && x.name === y.name && x.kind === y.kind && x.title === y.title;
  });

async function indexAnswer(
  parsed: Parsed,
  tree: Tree,
  docs: Listed[],
  found: ReadonlyMap<string, Doc | null>,
  templates: string | null,
): Promise<IndexDoc[]> {
  const files = fileDocs(tree);
  // A `[[wikilink]]` names a document by name (decision 7): which one is the vault's answer now.
  // Every document, then every attachment: built in slices, as is everything below (#287).
  const fresh: WikiCandidate[] = [];
  await paced(docs, (d) =>
    fresh.push({
      id: d.id,
      name: d.name,
      kind: d.kind,
      title: (found.get(d.key)?.title as string | undefined) ?? tree.titles[d.name] ?? null,
    }),
  );
  for (const f of files) fresh.push(f);
  const prev = answered.get(parsed);
  // The names did not move: the index built over them last time, and every answer it resolved.
  const unmoved = !!prev && sameCandidates(prev.named, fresh);
  let ix: WikiIndex<WikiCandidate>;
  if (unmoved) ix = prev.ix;
  else {
    const building = wikiIndexer<WikiCandidate>();
    await paced(fresh, (c) => building.add(c));
    ix = building;
  }
  const now = new Map<string, { f: Doc | null | undefined; own: boolean; out: IndexDoc }>();
  const out: IndexDoc[] = [];
  await paced(docs, (d) => {
    const f = found.get(d.key);
    const title = (f?.title as string | undefined) ?? tree.titles[d.name] ?? leafOf(d.name);
    /* A template is no task, project or event, here as in the list. */
    const own = !inTemplates(d.name, templates);
    const had = unmoved ? prev.docs.get(d.key) : undefined;
    if (had && had.f === f && had.own === own && had.out.id === d.id && had.out.name === d.name && had.out.title === title) {
      now.set(d.key, had);
      out.push(had.out);
      return;
    }
    const doc: IndexDoc = {
      id: d.id,
      name: d.name,
      kind: d.kind,
      title,
      task: (own && f?.task) || null,
      project: (own && f?.project) || null,
      event: (own && f?.event) || null,
      tags: (own && (f?.tags as string[] | undefined)) || null,
      questions: f?.questions ?? null,
      refs: resolveWikiRefs((f?.refs as Ref[] | undefined) ?? [], ix),
    };
    now.set(d.key, { f, own, out: doc });
    out.push(doc);
  });
  answered.set(parsed, { named: unmoved ? prev.named : fresh, ix, docs: now });
  for (const f of files) out.push(f);
  return out;
}

/**
 * What a corpus and a search are asked over: every listed text with an id — named, with its stamp
 * from the kept listing, its id and the title its listing gives it — and every attachment with an id.
 * Nothing here reads a text: the worker reads, parses and answers (`server/searching.ts`), and the
 * units and the engine stay there (#279).
 */
async function overOf(s: Session): Promise<Over> {
  const tree = await s.vault.tree();
  const all = listed(tree);
  const stamps = s.vault.textStamps(tree);
  const over: Over = { entries: [], meta: [], files: [] };
  await paced(all, (d) => {
    const stamp = stamps?.get(d.key);
    over.entries.push(stamp === undefined ? [d.key, d.name, d.kind] : [d.key, d.name, d.kind, stamp]);
    over.meta.push([d.id, tree.titles[d.name] ?? null]);
  });
  for (const n of tree.files) if (tree.ids[n]) over.files.push([tree.ids[n], n, tree.titles[n] ?? null]);
  return over;
}

/**
 * `/__board/corpus`, streamed as the worker cuts it: its parts are the JSON of their docs already,
 * handed on as they come and asked for one at a time as the answer is read (#279) — the corpus of
 * 50,000 files is 140 MB, and nothing of it is held here.
 */
async function corpusAnswer(c: Context, s: Session): Promise<Response> {
  const parts = s.corpus.corpus(await overOf(s));
  const enc = new TextEncoder();
  let opened = false;
  let any = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const head = opened ? "" : '{"docs":[';
      opened = true;
      const got = await parts.next();
      if (got.done) {
        ctl.enqueue(enc.encode(`${head}]}`));
        ctl.close();
        return;
      }
      ctl.enqueue(enc.encode(head + (any ? "," : "") + got.value));
      any = true;
    },
    async cancel() {
      await parts.return(undefined);
    },
  });
  return c.body(stream, 200, { "content-type": "application/json" });
}

/** The zone a time with no offset is read in: the vault's settings, else the app's, else this machine's. */
export function zoneOf(s: Session): string {
  return (
    zoneIn(readPrefs(s, "vault")) ?? zoneIn(readPrefs(s, "app")) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
  );
}

/**
 * The name a text made with a title is filed under, and the text it is written with (decision 14):
 * the title verbatim in the asked folder, and the `title:` line dropped when the name says it exactly.
 */
export function titled(asked: string, text: string): { name: string; text: string } {
  const title = titleOf(text);
  if (!title || asked.startsWith("components/")) return { name: asked, text };
  const name = titleName(title, folderOf(asked));
  return { name, text: leafOf(name) === title ? withoutTitle(text) : text };
}

/**
 * `c.json`, written a key at a time with the thread handed back between: the listing of 50,000 files
 * is 9 MB of JSON, and in one `JSON.stringify` that is 50 ms every other request waits (#283). The
 * text is the same.
 */
async function jsonPaced(body: Record<string, unknown>): Promise<string> {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
    await yieldNow();
  }
  return `{${parts.join(",")}}`;
}

/** About how much text an answer is written in at a time. */
const CHUNK = 256 * 1024;

/**
 * A JSON text made already, streamed a slice at a time with the thread handed back between: one
 * encoding of the index's 12 MB on 50,000 files is a pause every other request waits through (#287).
 */
function jsonText(c: Context, text: string): Response {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      await yieldNow();
      ctl.enqueue(enc.encode(text.slice(i, (i += CHUNK))));
      if (i >= text.length) ctl.close();
    },
  });
  return c.body(stream, 200, { "content-type": "application/json" });
}

/* Each object's JSON once: an index answer keeps the object of every document that did not move. */
const itemJson = new WeakMap<object, string>();

/** A long array of objects as JSON, a few hundred at a time with the thread handed back between. */
async function jsonListPaced(items: readonly object[]): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i += 500) {
    parts.push(
      items
        .slice(i, i + 500)
        .map((x) => {
          let json = itemJson.get(x);
          if (json === undefined) itemJson.set(x, (json = JSON.stringify(x)));
          return json;
        })
        .join(","),
    );
    await yieldNow();
  }
  return `[${parts.join(",")}]`;
}

/* The listing's JSON, made once per tree: a kept listing answers the same tree while nothing moved,
   and its 9 MB of JSON was most of what a warm `/__board/list` on 50,000 files cost (#280). */
const listJson = new WeakMap<Tree, { templates: string | null; json: Promise<string> }>();

function listOf(t: Tree, templates: string | null): Promise<string> {
  const had = listJson.get(t);
  if (had && had.templates === templates) return had.json;
  const json = jsonPaced({
    boards: t.boards,
    folders: t.folders,
    notes: t.notes,
    ids: t.ids,
    shared: [],
    titles: t.titles,
    tasks: t.tasks,
    projects: t.projects,
    events: t.events,
    tags: t.tags,
    templates,
    created: t.created,
    quizzes: t.quizzes,
    questions: Object.fromEntries(Object.entries(t.questions).map(([n, q]) => [n, q.length])),
    tables: t.tables,
    files: t.files,
    sizes: t.sizes,
  });
  listJson.set(t, { templates, json });
  return json;
}

/** The largest draft `POST /__board/diagnostics` will read. */
const DRAFT_MAX = 4 * 1024 * 1024;

export function docRoutes(app: Hono, s: Session): void {
  app.get("/__board/list", async (c) =>
    c.body(await listOf(await s.vault.tree(), s.vault.templatesFolder()), 200, { "content-type": "application/json" }),
  );

  app.get("/__board/get", async (c) => {
    const kind = textKind(c.req.query("kind"));
    const name = c.req.query("name") ?? "";
    const v = await mustRead(s.vault, name, kind);
    return c.json({ name, id: await s.vault.peekId(name, kind), text: v.text, base: v.base });
  });

  app.get("/__board/index", async (c) => jsonText(c, await indexJson(s)));

  /* One document's references out, each with what it names, and its backlinks — the index read for
     one name, so a client asking about one document is not sent every document's. */
  app.get("/__board/refs", async (c) => {
    const kind = anyKind(c.req.query("kind") ?? "board");
    const name = c.req.query("name") ?? "";
    const docs = await indexDocs(s);
    const me = docs.find((d) => d.name === name && d.kind === kind);
    if (!me) throw err(404, `no ${kind} \`${name}\``);
    const byId = new Map(docs.map((d) => [d.id, d]));
    const brief = (d: IndexDoc) => ({ id: d.id, name: d.name, kind: d.kind, title: d.title ?? null });
    return c.json({
      ...brief(me),
      refs: me.refs.map((r) => ({ ...r, target: byId.has(r.id) ? brief(byId.get(r.id)!) : null })),
      backlinks: docs.flatMap((d) => {
        const r = d === me ? undefined : d.refs.find((x) => x.id === me.id);
        return r ? [{ ...brief(d), type: r.type }] : [];
      }),
    });
  });

  app.get("/__board/corpus", async (c) => corpusAnswer(c, s));

  /* `tag=` keeps the hits in documents carrying that tag (#327), from the listing's tags — so a
     template is left out, as it is from every filter — and with no words lists those documents, by
     title. It narrows what is ranked, before `limit` counts. */
  app.get("/__board/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const asked = c.req.query("tag");
    const tag = asked ? tagOf(asked) : undefined;
    if (asked && !tag) throw err(400, `\`${asked}\` is not a tag: letters, digits, \`_\`, \`-\` and \`/\`, with a letter`);
    const raw = c.req.query("limit");
    const limit = raw === undefined ? undefined : Number(raw);
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw err(400, "`limit` is a whole number above zero");
    if (!tag) {
      if (!q.trim()) return c.json({ query: q, hits: [] });
      return c.json(await s.corpus.search(await overOf(s), q, limit));
    }
    const tree = await s.vault.tree();
    const names = Object.keys(tree.tags).filter((n) => tree.tags[n]!.some((t) => tagKey(t) === tagKey(tag)));
    if (q.trim()) return c.json({ ...(await s.corpus.search(await overOf(s), q, limit, names)), tag });
    const carrying = new Set(names);
    const docs: { id: string | null; name: string; kind: TextKind; title: string | null }[] = [];
    for (const kind of ["board", "note", "quiz", "table"] as const)
      for (const name of byKind(tree)[kind])
        if (carrying.has(name)) docs.push({ id: tree.ids[name] ?? null, name, kind, title: tree.titles[name] ?? null });
    const label = (d: (typeof docs)[number]) => d.title ?? leafOf(d.name);
    docs.sort(
      (a, b) =>
        label(a).localeCompare(label(b), undefined, { numeric: true, sensitivity: "base" }) || a.name.localeCompare(b.name),
    );
    return c.json({ query: q, tag, hits: [], docs: limit ? docs.slice(0, limit) : docs, count: docs.length });
  });

  app.get("/__board/resolve", async (c) => {
    const id = c.req.query("id") ?? "";
    const found = await s.vault.resolve(id);
    if (!found) throw err(404, `nothing has the id \`${id}\``);
    return c.json({ id, name: found.name, kind: found.kind });
  });

  /* -- writing a text ---------------------------------------------------------------------- */

  app.post("/__board/patch", async (c) => {
    const name = c.req.query("name") ?? "";
    const current = await mustRead(s.vault, name, "board");
    const body = await bodyOf(c);
    const ops = body.ops ?? [];
    if (!Array.isArray(ops)) throw err(400, OPS_SHAPE);
    if (body.base !== undefined && body.base !== null && body.base !== current.base) {
      return c.json({ error: "the board changed underneath this edit", base: current.base, text: current.text }, 409);
    }
    const { text } = await grammar.patch(current.text, ops);
    try {
      const after = await s.vault.write(name, "board", text, current.base);
      return c.json({ base: after.base, text: after.text });
    } catch (e) {
      if (e instanceof Conflict)
        return c.json({ error: "the board changed underneath this edit", base: e.base, text: e.text }, 409);
      throw e;
    }
  });

  app.post("/__board/put", async (c) => {
    const kind = textKind(c.req.query("kind"));
    const name = c.req.query("name") ?? "";
    await mustRead(s.vault, name, kind);
    const body = await bodyOf(c);
    if (typeof body.text !== "string") throw err(400, "expected `text`");
    const after = await s.vault.write(name, kind, body.text, typeof body.base === "string" ? body.base : null);
    return c.json({ base: after.base, text: after.text });
  });

  app.post("/__board/create", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.text !== "string") throw err(400, "expected `text`");
    const kind = textKind(body.kind);
    outsideComponents(kind, body.name);
    let text = body.text;
    if (kind === "board") text = await grammar.stamp(text);
    else if (kind === "table") text = (await grammar.table(text, { stamp: true })).text;
    const asked = titled(str(body.name) || kind, text);
    let settled: string;
    try {
      settled = await s.vault.create(asked.name, kind, asked.text, typeof body.id === "string" ? { id: body.id } : {});
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
    const v = await mustRead(s.vault, settled, kind);
    return c.json({ name: settled, id: await s.vault.peekId(settled, kind), base: v.base, text: v.text });
  });

  const rename = (copy: boolean) => async (c: Context) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const kind = anyKind(body.kind);
    await mustExist(s.vault, name, kind);
    const to = body.to === undefined || body.to === null ? name : str(body.to);
    outsideComponents(kind, to);
    try {
      if (copy) {
        const settled = await s.vault.rename(name, kind, to, { copy });
        return c.json({ name: settled, id: await s.vault.peekId(settled, kind) });
      }
      // A rename keeps the vault's `[[wikilinks]]` to it naming it (`server/relink.ts`).
      const { result: settled, relinked } = await relinking(s, () => s.vault.rename(name, kind, to));
      return c.json({ name: settled, id: await s.vault.peekId(settled, kind), relinked });
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
  };
  app.post("/__board/rename", rename(false));
  app.post("/__board/duplicate", rename(true));

  app.post("/__board/delete", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const kind = anyKind(body.kind);
    await mustExist(s.vault, name, kind);
    // Not a delete for good: the file, its images and its id go into the trash entry
    // `trash` names, and `/__board/trash/restore` puts them back. Only the trash deletes for good.
    const entry = await s.vault.trash(name, kind);
    return c.json({ name: body.name, kind, trash: trashAnswer(entry, trashDays()) });
  });

  /* -- a title ----------------------------------------------------------------------------- */

  app.post("/__board/retitle", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const kind = anyKind(body.kind);
    const title = typeof body.title === "string" ? cleanTitle(body.title) : null;
    if (!title) throw err(400, "expected a non-empty `title`");
    const follow = body.follow === true;
    // A new title is a new name to every `[[wikilink]]` that names it by title, and with `follow` a
    // new file name too: either way the links that named it are kept naming it (`server/relink.ts`).
    const { result, relinked } = await relinking(s, () =>
      kind === "file" ? retitleFile(s, name, title, follow) : retitleText(s, name, kind, title, follow),
    );
    return c.json({ ...result, relinked });
  });

  /* -- a task, a project, an event -------------------------------------------------------------- */

  app.post("/__board/task", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const change: Record<string, string | null> = {};
    if ("status" in body) {
      const raw = body.status;
      const status = raw === null ? null : (statusOf(raw) ?? undefined);
      if (status === undefined) throw err(400, `\`${str(raw)}\` is not a status: ${STATUSES.join(", ")}`);
      change.status = status;
    }
    for (const key of ["due", "start"] as const) {
      if (!(key in body)) continue;
      const raw = body[key];
      const day = raw === null ? null : (dueOf(raw) ?? undefined);
      if (day === undefined) throw err(400, `\`${str(raw)}\` is not a date: write it YYYY-MM-DD`);
      change[key] = day;
    }
    if ("priority" in body) {
      const raw = body.priority;
      const priority = raw === null ? null : (priorityOf(raw) ?? undefined);
      if (priority === undefined) throw err(400, `\`${str(raw)}\` is not a priority: ${PRIORITIES.join(", ")}`);
      change.priority = priority;
    }
    if (!Object.keys(change).length) throw err(400, "expected `status`, `due`, `start` or `priority`");
    const text = await recompute(
      s.vault,
      name,
      "note",
      (t) => {
        const next = withTask(t, change);
        if ((change.due || change.start || change.priority) && !taskOf(next))
          throw err(400, `\`${name}\` is not a task: give it a status as well as a date or a priority`);
        return next;
      },
      "the status",
    );
    return c.json({ name, task: indexedTask(text, Date.now()) ?? null });
  });

  app.post("/__board/project", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const change: Record<string, string | null> = {};
    if ("status" in body) {
      const raw = body.status;
      const status = raw === null ? null : (projectStatusOf(raw) ?? undefined);
      if (status === undefined) throw err(400, `\`${str(raw)}\` is not a project status: ${PROJECT_STATUSES.join(", ")}`);
      change.project = status;
    }
    if ("hue" in body) {
      const raw = body.hue;
      const hue = raw === null ? null : (hueOf(raw) ?? undefined);
      if (hue === undefined) throw err(400, `\`${str(raw)}\` is not a hue: ${HUE_ORDER.join(", ")}`);
      change.hue = hue;
    }
    if (!Object.keys(change).length) throw err(400, "expected `status` or `hue`");
    const text = await recompute(
      s.vault,
      name,
      "note",
      (t) => {
        const next = withProject(t, change);
        if (change.hue && !projectOf(next)) throw err(400, `\`${name}\` is not a project: give it a status as well as a colour`);
        return next;
      },
      "the project",
    );
    return c.json({ name, project: projectOf(text) ?? null });
  });

  app.post("/__board/event", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const change: Record<string, string | null> = {};
    const zone = zoneOf(s);
    for (const key of ["start", "end"] as const) {
      if (!(key in body)) continue;
      const raw = body[key];
      if (raw === null) change[key] = null;
      else {
        try {
          change[key] = placed(key, raw, zone);
        } catch (e) {
          throw err(400, (e as Error).message);
        }
      }
    }
    if (!Object.keys(change).length) throw err(400, "expected `start` or `end`");
    const text = await recompute(
      s.vault,
      name,
      "note",
      (t) => {
        if (taskOf(t) && Object.values(change).some((v) => v !== null)) {
          throw err(400, `\`${name}\` is a task: its dates are its \`start\` and \`due\`, set through /__board/task`);
        }
        const asked = { ...change };
        const was = eventOf(t);
        if (asked.start && !("end" in asked) && was?.end !== undefined && isDay(was.end) !== isDay(asked.start)) asked.end = null;
        const next = withEvent(t, asked);
        const event = eventOf(next);
        if (Object.values(asked).some((v) => v !== null) && !event)
          throw err(400, `\`${name}\` is not an event: give it a start as well as an end`);
        if (event && asked.end && event.end !== asked.end) {
          throw err(400, "an all-day event ends on a date, and a timed one at a time: send `end` in `start`'s form");
        }
        if (event && (asked.start || asked.end) && endsBeforeItStarts(event)) {
          throw err(400, `\`${event.end}\` is before \`${event.start}\`: an event ends after it starts — send \`end\` too`);
        }
        return next;
      },
      "the event",
    );
    return c.json({ name, event: eventOf(text) ?? null });
  });

  /* -- a table ----------------------------------------------------------------------------- */

  app.get("/__board/table", async (c) => {
    const name = c.req.query("name") ?? "";
    const tab = c.req.query("tab") || undefined;
    const view = ["1", "true", "yes"].includes(c.req.query("view") ?? "");
    const stamp = ["1", "true", "yes"].includes(c.req.query("stamp") ?? "");
    let current = await mustRead(s.vault, name, "table");
    let got: Awaited<ReturnType<typeof grammar.table>> | null = null;
    if (stamp) {
      for (let i = 0; ; i++) {
        if (i === 4) throw err(409, `\`${name}\` kept changing; try again`);
        current = await mustRead(s.vault, name, "table");
        got = await grammar.table(current.text, { stamp: true });
        if (!got.changed) break;
        try {
          current = await s.vault.write(name, "table", got.text, current.base);
          break;
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
        }
      }
    }
    if (!got || tab || view) got = await grammar.table(current.text, { view, ...(tab ? { tab } : {}) });
    if (tab && !got.table.tabs.length) throw err(404, `no tab \`${tab}\` in \`${name}\``);
    return c.json({
      name,
      id: await s.vault.peekId(name, "table"),
      base: current.base,
      ...got.table,
      title: (got.table.title as string | null | undefined) ?? leafOf(name),
    });
  });

  app.post("/__board/table", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const ops = body.ops;
    if (!Array.isArray(ops)) throw err(400, "expected `ops: [{op, …}]`");
    const base = typeof body.base === "string" ? body.base : null;
    for (let i = 0; i < 4; i++) {
      const current = await mustRead(s.vault, name, "table");
      if (base !== null && base !== current.base) {
        return c.json({ error: "the table changed underneath this edit", base: current.base, text: current.text }, 409);
      }
      const got = await grammar.table(current.text, { ops });
      const answer = {
        name,
        changed: got.changed,
        minted: got.minted ?? { tabs: [], columns: [], rows: [] },
        diagnostics: got.table.diagnostics,
      };
      if (!got.changed) return c.json({ ...answer, base: current.base, text: current.text });
      try {
        const after = await s.vault.write(name, "table", got.text, current.base);
        return c.json({ ...answer, base: after.base, text: after.text });
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        if (base !== null) return c.json({ error: "the table changed underneath this edit", base: e.base, text: e.text }, 409);
      }
    }
    throw err(409, `\`${name}\` kept changing underneath the edit; try again`);
  });

  /*
   * `{name, base?, ops}`: a quiz edited one question at a time, by its `{#id}` —
   * `src/quiz/ops.ts` through the grammar, and every other byte of the quiz left alone. The table's
   * loop: with no `base` a write that meets a moved text is recomputed from the text that beat it.
   */
  app.post("/__board/quiz", async (c) => {
    const body = await bodyOf(c);
    const name = str(body.name);
    const ops = body.ops;
    if (!Array.isArray(ops) || ops.length === 0) throw err(400, "expected `ops: [{op, …}]`");
    const base = typeof body.base === "string" ? body.base : null;
    for (let i = 0; i < 4; i++) {
      const current = await mustRead(s.vault, name, "quiz");
      if (base !== null && base !== current.base) {
        return c.json({ error: "the quiz changed underneath this edit", base: current.base, text: current.text }, 409);
      }
      const got = await grammar.quiz(current.text, false, ops);
      const answer = { name, changed: got.changed, ids: got.ids ?? [], diagnostics: got.diagnostics ?? [] };
      if (!got.changed) return c.json({ ...answer, base: current.base, text: current.text });
      try {
        const after = await s.vault.write(name, "quiz", got.text, current.base);
        return c.json({ ...answer, base: after.base, text: after.text });
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        if (base !== null) return c.json({ error: "the quiz changed underneath this edit", base: e.base, text: e.text }, 409);
      }
    }
    throw err(409, `\`${name}\` kept changing underneath the edit; try again`);
  });

  /* -- what the grammar says about one text ---------------------------------------------------- */

  app.get("/__board/diagnostics", async (c) => {
    const kind = textKind(c.req.query("kind"));
    if (kind === "note") throw err(400, "a note has no diagnostics: it is Markdown, and any Markdown is a note");
    const name = c.req.query("name") ?? "";
    const v = await mustRead(s.vault, name, kind);
    return c.json(await grammar.diagnose(name, v.text, kind));
  });

  /*
   * What is wrong with a text that is not a file yet: `{text, kind?, name?}`, answered
   * exactly as `GET` answers for a file of that kind, and nothing read or written — so an agent
   * drafting documents that name each other can check each before any is written. `name` only
   * labels the answer.
   */
  app.post("/__board/diagnostics", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.text !== "string") throw err(400, "say what to check: `text`, the draft itself");
    if (body.text.length > DRAFT_MAX) throw err(413, `a draft is at most ${DRAFT_MAX / (1024 * 1024)} MiB`);
    const kind = textKind(typeof body.kind === "string" ? body.kind : undefined);
    if (kind === "note") throw err(400, "a note has no diagnostics: it is Markdown, and any Markdown is a note");
    const name = typeof body.name === "string" && body.name ? body.name : "draft";
    return c.json(await grammar.diagnose(name, body.text, kind));
  });

  app.get("/__board/fences", async (c) => {
    const v = await mustRead(s.vault, c.req.query("name") ?? "", "board");
    return c.json(await grammar.fences(v.text));
  });
}

/** `/retitle` for a text: the `title:` line, and with `follow` the file renamed to the title. */
async function retitleText(s: Session, name: string, kind: TextKind, title: string, follow: boolean) {
  await mustRead(s.vault, name, kind);
  let settled = name;
  if (follow) {
    const want = titleName(title, folderOf(name));
    // A name already in the title's family — `Plan 2` titled `Plan` — is left alone, or titling a
    // document twice would walk it along the numbers.
    const family = new RegExp(`^${esc(want)} \\d+$`, "i").test(name);
    if (want !== name && !family) {
      // The line is rewritten where there is one, in the step that moves the file; whether one is
      // needed at all is known once the name is settled.
      const edit = (t: string) => (titleOf(t) !== undefined ? withTitle(t, title, kind) : t);
      try {
        settled = await s.vault.rename(name, kind, want, { edit });
      } catch (e) {
        if (e instanceof Refused) throw err(400, e.message);
        throw e;
      }
    }
  }
  const says = follow && leafOf(settled) === title;
  await recompute(s.vault, settled, kind, (t) => (says && titleOf(t) === undefined ? t : withTitle(t, title, kind)), "the title");
  return { name: settled, id: await s.vault.peekId(settled, kind), title };
}

/** `/retitle` for an attachment: its title is the vault's record, and `follow` renames its file. */
async function retitleFile(s: Session, name: string, title: string, follow: boolean) {
  await mustExist(s.vault, name, "file" as Kind);
  let settled = name;
  const ext = extOf(name);
  const said = title.toLowerCase().endsWith(`.${ext}`) ? title.slice(0, -ext.length - 1) : title;
  if (follow) {
    const want = `${titleName(said, folderOf(name))}.${ext}`;
    const family = new RegExp(`^${esc(want.slice(0, -ext.length - 1))} \\d+\\.${esc(ext)}$`, "i").test(name);
    if (!(want === name || family)) {
      try {
        settled = await s.vault.rename(name, "file", want);
      } catch (e) {
        if (e instanceof NotFound) throw err(404, `no file \`${name}\``);
        if (e instanceof Refused) throw err(400, e.message);
        throw e;
      }
    }
  }
  await s.vault.titleFile(settled, title);
  return { name: settled, id: await s.vault.peekId(settled, "file"), title };
}
