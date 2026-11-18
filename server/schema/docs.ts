/**
 * The document routes' schemas and rows (`server/routes/docs.ts`): listing, reading and writing a
 * text, making, renaming, copying and deleting any kind, a title, a task, a project, an event, a
 * table's cells, a quiz's questions, and what reads the whole vault — the index, the graph, the
 * corpus, the search.
 *
 * **The sha1 `base` and the 409 are the whole of a write's safety, and nothing here moves them.**
 * `base` is read by `baseFrom` (`server/http.ts`) exactly as the handlers read it before — absent or `null` is "I have not seen
 * it", any other string is compared as it is (`""` too: a stale base, never a missing one, #400) —
 * and every write that compares it answers `Conflict`, the text that won and its sha1, on a 409.
 */

import { z } from "zod";

import { HUE_ORDER } from "../../src/dsl/ir";
import { cleanTitle } from "../../src/note/format";
import { hueOf, PROJECT_STATUSES, projectStatusOf } from "../../src/note/project";
import { dueOf, PRIORITIES, priorityOf, STATUSES, statusOf } from "../../src/note/task";
import { OPS_SHAPE } from "../handle";
import { anyKind, baseFrom, err, textKind } from "../http";
import { about, body, field, json, kept, named, param } from "./fields";
import { route } from "./row";
import { AnyKind, Diagnostic, NoteEvent, Project, Relinked, Sha1, Task, TextKind, TrashEntry, Version } from "./shapes";

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** The largest draft `POST /__board/diagnostics` will read. */
const DRAFT_MAX = 4 * 1024 * 1024;

// -- the fields a body names, read as the routes read them ------------------------------------

const Base = () =>
  field(
    z.string().nullable(),
    'The sha1 the text was read at (`base` of the read). Left out or `null`, the write is made over whatever is there; any other string that is not the file\'s sha1 now — `""` included — is a 409 with the text that won.',
    baseFrom,
    "read",
  );

const name = (what = "The document's name: its path in the vault without the suffix.") => kept(z.string(), what);
const kindOf = (what: string) => field(AnyKind, what, anyKind, "read");

// -- the bodies --------------------------------------------------------------------------------

export const PatchBody = body("PatchBody", "Edits to a board's items, applied to the text the board has now.", {
  ops: field(
    z.array(z.looseObject({})),
    `The edits, each an object: ${OPS_SHAPE.replace(/^expected /, "")}. Left out, none.`,
    (raw) => {
      const ops = raw ?? [];
      if (!Array.isArray(ops)) throw err(400, OPS_SHAPE);
      return ops as unknown[];
    },
    "read",
  ),
  base: Base(),
});

export const PutBody = body(
  "PutBody",
  "A whole text, written over the document.",
  {
    text: field(
      z.string(),
      "The whole text.",
      (raw) => {
        if (typeof raw !== "string") throw err(400, "expected `text`");
        return raw;
      },
      "read",
    ),
    base: Base(),
  },
  ["text"],
);

export const CreateBody = body(
  "CreateBody",
  "A new document. A text with a `title:` is filed under that title in `name`'s folder (decision 14); a name that is taken is numbered.",
  {
    text: field(
      z.string(),
      "The whole text. A board's items and a table's tabs, columns and rows are given ids.",
      (raw) => {
        if (typeof raw !== "string") throw err(400, "expected `text`");
        return raw;
      },
      "read",
    ),
    kind: field(TextKind, "Which kind; left out, a board.", textKind, "read"),
    name: name("Where to file it; left out, the kind's name. Only a board lives under `components/`."),
    id: kept(z.string(), "The id to give it, when it is free."),
  },
  ["text"],
);

export const RenameBody = body(
  "RenameBody",
  "A document and the name it is to have.",
  {
    name: name(),
    kind: kindOf("Which kind; left out, a board."),
    to: kept(
      z.string(),
      "The new name; left out or `null`, the same name (a copy is numbered). Only a board lives under `components/`.",
    ),
  },
  ["name"],
);

export const DeleteBody = body(
  "DeleteBody",
  "A document to move to the trash.",
  { name: name(), kind: kindOf("Which kind; left out, a board.") },
  ["name"],
);

export const RetitleBody = body(
  "RetitleBody",
  "A document's new title.",
  {
    name: name(),
    kind: kindOf("Which kind; left out, a board."),
    title: field(
      z.string(),
      "The title; blanks are folded, and it must keep a character.",
      (raw) => {
        const title = typeof raw === "string" ? cleanTitle(raw) : null;
        if (!title) throw err(400, "expected a non-empty `title`");
        return title;
      },
      "read",
    ),
    follow: kept(z.boolean(), "`true` renames the file to the title too, when no other file has it."),
  },
  ["name", "title"],
);

/** A dated or listed value of a task or a project: `null` takes its line out, anything else is refused or read. */
function either<T>(raw: unknown, read: (raw: unknown) => T | undefined, refusal: string): T | null {
  if (raw === null) return null;
  const v = read(raw);
  if (v === undefined) throw err(400, refusal);
  return v;
}

const day = (key: string) =>
  field(
    z.string().nullable(),
    `\`${key}\`: \`YYYY-MM-DD\`, or \`null\` to take it out.`,
    (raw) => either(raw, dueOf, `\`${str(raw)}\` is not a date: write it YYYY-MM-DD`),
    "skip",
  );

export const TaskBody = body(
  "TaskBody",
  "What to change of a note that is a task. A field left out stays as it is; `null` takes its line out. At least one is sent.",
  {
    name: name("The note's name."),
    status: field(
      z.enum(STATUSES).nullable(),
      "The status; `null` makes the note no task.",
      (raw) => either(raw, statusOf, `\`${str(raw)}\` is not a status: ${STATUSES.join(", ")}`),
      "skip",
    ),
    due: day("due"),
    start: day("start"),
    priority: field(
      z.enum(PRIORITIES).nullable(),
      "The priority, or `null` for none.",
      (raw) => either(raw, priorityOf, `\`${str(raw)}\` is not a priority: ${PRIORITIES.join(", ")}`),
      "skip",
    ),
  },
  ["name"],
);

export const ProjectBody = body(
  "ProjectBody",
  "What to change of a note that is a project. A field left out stays as it is; `null` takes its line out. At least one is sent.",
  {
    name: name("The note's name."),
    status: field(
      z.enum(PROJECT_STATUSES).nullable(),
      "The project's status; `null` makes the note no project.",
      (raw) => either(raw, projectStatusOf, `\`${str(raw)}\` is not a project status: ${PROJECT_STATUSES.join(", ")}`),
      "skip",
    ),
    hue: field(
      z.enum(HUE_ORDER).nullable(),
      "Its colour, or `null` for none.",
      (raw) => either(raw, hueOf, `\`${str(raw)}\` is not a hue: ${HUE_ORDER.join(", ")}`),
      "skip",
    ),
  },
  ["name"],
);

export const EventBody = body(
  "EventBody",
  "When a note that is an event starts and ends. A field left out stays as it is; `null` takes its line out. A time with no offset is read in the vault's time zone.",
  {
    name: name("The note's name."),
    start: kept(z.string().nullable(), "A date (`YYYY-MM-DD`, all day) or a time."),
    end: kept(z.string().nullable(), "In `start`'s form: a date for an all-day event, a time for a timed one."),
  },
  ["name"],
);

export const TableBody = body(
  "TableBody",
  "Edits to a table's tabs, columns, rows and cells, applied in order (`src/table/ops.ts`). With no `base`, a write that meets a moved text is made again on the text that beat it.",
  {
    name: name("The table's name."),
    ops: field(
      z.array(z.looseObject({ op: z.string() })),
      "The edits, each `{op, …}`.",
      (raw) => {
        if (!Array.isArray(raw)) throw err(400, "expected `ops: [{op, …}]`");
        return raw as unknown[];
      },
      "read",
    ),
    base: Base(),
  },
  ["name", "ops"],
);

export const QuizBody = body(
  "QuizBody",
  "Edits to a quiz, one question at a time by its `{#id}` (`src/quiz/ops.ts`); every other byte is left alone. With no `base`, a write that meets a moved text is made again on the text that beat it.",
  {
    name: name("The quiz's name."),
    ops: field(
      z.array(z.looseObject({ op: z.string() })).min(1),
      "The edits, each `{op, …}`: at least one.",
      (raw) => {
        if (!Array.isArray(raw) || raw.length === 0) throw err(400, "expected `ops: [{op, …}]`");
        return raw as unknown[];
      },
      "read",
    ),
    base: Base(),
  },
  ["name", "ops"],
);

export const DraftBody = body(
  "DraftBody",
  "A text that is not a file yet, checked as a file of its kind would be; nothing is read or written.",
  {
    text: field(
      z.string().max(DRAFT_MAX),
      `The draft itself: at most ${DRAFT_MAX / (1024 * 1024)} MiB.`,
      (raw) => {
        if (typeof raw !== "string") throw err(400, "say what to check: `text`, the draft itself");
        if (raw.length > DRAFT_MAX) throw err(413, `a draft is at most ${DRAFT_MAX / (1024 * 1024)} MiB`);
        return raw;
      },
      "read",
    ),
    kind: field(
      z.enum(["board", "quiz", "table"]),
      "Which kind; left out, a board. A note has no diagnostics.",
      (raw) => {
        const kind = textKind(typeof raw === "string" ? raw : undefined);
        if (kind === "note") throw err(400, "a note has no diagnostics: it is Markdown, and any Markdown is a note");
        return kind;
      },
      "read",
    ),
    name: kept(z.string(), "Only labels the answer; left out, `draft`."),
  },
  ["text"],
);

// -- the answers -------------------------------------------------------------------------------

const Listing = named(
  "Listing",
  "Every document in the vault, by kind, with what the listing knows of each — keyed by name.",
  z.object({
    boards: z.array(z.string()),
    folders: z.array(z.string()),
    notes: z.array(z.string()),
    ids: z.record(z.string(), z.string()),
    shared: about("Always empty: nothing is shared here.", z.array(z.never())),
    titles: z.record(z.string(), z.string()),
    tasks: z.record(z.string(), Task),
    projects: z.record(z.string(), Project),
    events: z.record(z.string(), NoteEvent),
    tags: z.record(z.string(), z.array(z.string())),
    templates: about("The templates folder, `null` when there is none.", z.string().nullable()),
    created: z.record(z.string(), z.string()),
    quizzes: z.array(z.string()),
    questions: about("Each quiz's number of questions.", z.record(z.string(), z.int())),
    tables: z.array(z.string()),
    files: z.array(z.string()),
    sizes: about("Each attachment's size in bytes.", z.record(z.string(), z.int())),
  }),
);

const Text = named(
  "Text",
  "A document's text and the sha1 to write it back with.",
  z.object({ name: z.string(), id: z.string().nullable(), text: z.string(), base: Sha1 }),
);

const Ref = named(
  "Ref",
  "A reference out of a document: a `dag:` id, an embed or a `[[wikilink]]`, resolved to an id.",
  z.object({
    id: about('The target\'s id; `""` for a `[[wikilink]]` that names nothing.', z.string()),
    wiki: about("A `[[wikilink]]`'s target as written.", z.string().optional()),
    type: z.string(),
    part: about("A block anchor or an item id inside the target.", z.string().optional()),
    text: z.string(),
  }),
);

const IndexText = z.object({
  id: z.string(),
  name: z.string(),
  kind: TextKind,
  title: z.string(),
  task: Task.nullable(),
  project: Project.nullable(),
  event: NoteEvent.nullable(),
  tags: z.array(z.string()).nullable(),
  questions: about("How many questions a quiz asks; `null` for any other kind.", z.int().nullable()),
  refs: z.array(Ref),
});

const IndexFile = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("file"),
  title: z.string().nullable(),
  bytes: z.int(),
  refs: z.array(z.never()),
});

const Index = named(
  "Index",
  "Every document with what it says about itself and its references, each `[[wikilink]]` resolved; then every attachment with an id.",
  z.object({ docs: z.array(z.union([IndexText, IndexFile])) }),
);

const Brief = z.object({ id: z.string(), name: z.string(), kind: AnyKind, title: z.string().nullable() });

const Refs = named(
  "Refs",
  "One document's references out, each with the document it names (`null` when none), and its backlinks.",
  z.object({
    id: z.string(),
    name: z.string(),
    kind: AnyKind,
    title: z.string().nullable(),
    refs: z.array(Ref.extend({ target: Brief.nullable() })),
    backlinks: z.array(Brief.extend({ type: z.string() })),
  }),
);

const Graph = named(
  "Graph",
  "The vault as a graph (`src/graph/wire.ts`): documents as parallel arrays, links as pairs of indexes into them, and the fields a view colours, filters and groups by.",
  z.object({
    v: about("The wire's version.", z.literal(1)),
    ids: z.array(z.string()),
    names: z.array(z.string()),
    titles: z.array(z.string().nullable()),
    links: about("Pairs of document indexes, flat: `[from, to, from, to, …]`.", z.array(z.int())),
    fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        none: z.string(),
        type: z.enum(["one", "many"]),
        tree: z.literal(true).optional(),
        values: z.array(z.looseObject({ key: z.string(), label: z.string() })),
        of: z.array(z.int()).optional(),
        start: z.array(z.int()).optional(),
        items: z.array(z.int()).optional(),
      }),
    ),
  }),
);

const Corpus = named(
  "Corpus",
  "Every text cut into the units search matches, streamed as it is made.",
  z.object({
    docs: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: AnyKind,
        title: about("Absent when the document has none.", z.string().optional()),
        units: z.array(
          z.object({
            part: about(
              "Where in the document: an item id, `^anchor` or `L<line>`; absent, the document itself.",
              z.string().optional(),
            ),
            what: about("What matched: `title`, an item type, or a note block.", z.string()),
            text: z.string(),
          }),
        ),
      }),
    ),
  }),
);

const Hit = named(
  "Hit",
  "One match (`src/search/wire.ts`): where, how well, and the snippet with the matched words between `**`.",
  z.object({
    id: z.string(),
    name: z.string(),
    kind: AnyKind,
    title: z.string().nullable(),
    part: about("An item id on a board, `^anchor` or `L<line>` in a note; `null` is the document itself.", z.string().nullable()),
    what: z.string(),
    score: z.number(),
    terms: z.array(z.string()),
    snippet: z.string(),
    runs: z.array(z.looseObject({})),
  }),
);

const Search = named(
  "Search",
  "The hits for `q`, best first. With `tag` and no words, the documents carrying the tag by title, and how many.",
  z.object({
    query: z.string(),
    tag: z.string().optional(),
    hits: z.array(Hit),
    docs: z
      .array(z.object({ id: z.string().nullable(), name: z.string(), kind: TextKind, title: z.string().nullable() }))
      .optional(),
    count: z.int().optional(),
  }),
);

const Created = named(
  "Created",
  "The document as it was filed: the name it settled on, its id, its text and sha1.",
  z.object({ name: z.string(), id: z.string().nullable(), base: Sha1, text: z.string() }),
);

const Renamed = named(
  "Renamed",
  "The name the document settled on and its id; a rename also says which links it kept (`relinked`), a copy does not.",
  z.object({ name: z.string(), id: z.string().nullable(), relinked: Relinked.optional() }),
);

const Edited = (what: string, extra: z.ZodRawShape) =>
  z.object({
    name: z.string(),
    changed: about(`Whether the ${what} moved; when it did not, \`text\` and \`base\` are the file's as it was.`, z.boolean()),
    ...extra,
    diagnostics: z.array(Diagnostic),
    base: Sha1,
    text: z.string(),
  });

const TableEdited = named(
  "TableEdited",
  "The table after the edits: whether it moved, the ids made for new tabs, columns and rows, its diagnostics, and its text.",
  Edited("table", {
    minted: z.object({ tabs: z.array(z.string()), columns: z.array(z.string()), rows: z.array(z.string()) }),
  }),
);

const QuizEdited = named(
  "QuizEdited",
  "The quiz after the edits: whether it moved, the ids of the questions each op made or touched, its diagnostics, and its text.",
  Edited("quiz", { ids: z.array(z.string()) }),
);

const Table = named(
  "Table",
  "A table as the grammar reads it (`src/table/data.ts`): its tabs with their columns and rows, and its diagnostics.",
  z.object({
    name: z.string(),
    id: z.string().nullable(),
    base: Sha1,
    title: z.string(),
    description: z.string(),
    tabs: z.array(z.looseObject({ id: z.string(), name: z.string() })),
    diagnostics: z.array(Diagnostic),
  }),
);

const Diagnosis = named(
  "Diagnosis",
  "What the grammar says about one text, by kind: a board's per item, a table's and a quiz's with their counts.",
  z.union([
    z.object({
      board: z.array(Diagnostic),
      items: z.array(z.looseObject({ id: z.string(), type: z.string(), diagnostics: z.array(Diagnostic) })),
      errors: z.int(),
      warnings: z.int(),
    }),
    z.object({ tabs: z.int(), rows: z.int(), diagnostics: z.array(Diagnostic) }),
    z.object({ questions: z.int(), diagnostics: z.array(Diagnostic) }),
  ]),
);

const Fences = named(
  "Fences",
  "A board's fences as the format reads them (`src/board/fences.ts`): each one's info line, where it is, and what it holds.",
  z.object({ fences: z.array(z.looseObject({})) }),
);

// -- the query parameters --------------------------------------------------------------------

const Name = param("The document's name: its path in the vault without the suffix.", z.string());
const Kind = param("Which kind; left out, a board.", TextKind.optional());
const flag = (what: string) => param(`${what} \`1\`, \`true\` or \`yes\`.`, z.enum(["1", "true", "yes"]).optional());

// -- the rows ----------------------------------------------------------------------------------

const TAG = "documents";
const NOT_A_KIND = "A `kind` that is not one: `` `<kind>` is not a kind of file ``.";

export const DOC_ROUTES = [
  route({
    method: "get",
    path: "/__board/list",
    operationId: "list",
    summary: "Every document in the vault",
    description:
      "Kept between answers while the vault is watched, and changed only where something moved (#280): a warm listing costs what changed.",
    tag: TAG,
    answers: { 200: json("The listing.", Listing) },
  }),
  route({
    method: "get",
    path: "/__board/get",
    operationId: "get",
    summary: "A document's text",
    tag: TAG,
    query: z.object({ name: Name, kind: Kind }),
    answers: { 200: json("Its text, and the sha1 to write it back with.", Text) },
    refuses: { 400: NOT_A_KIND, 404: "No such document." },
  }),
  route({
    method: "get",
    path: "/__board/index",
    operationId: "index",
    summary: "Every document and its references",
    tag: TAG,
    answers: { 200: json("The index, streamed.", Index) },
  }),
  route({
    method: "get",
    path: "/__board/graph",
    operationId: "graph",
    summary: "The vault as a graph",
    description: "The index without the references' text, a fraction of its size: what the graph view draws.",
    tag: TAG,
    answers: { 200: json("The graph, streamed.", Graph) },
  }),
  route({
    method: "get",
    path: "/__board/refs",
    operationId: "refs",
    summary: "One document's references and backlinks",
    tag: TAG,
    query: z.object({ name: Name, kind: param("Which kind, an attachment too; left out, a board.", AnyKind.optional()) }),
    answers: { 200: json("Its references out and in.", Refs) },
    refuses: { 400: NOT_A_KIND, 404: "No such document." },
  }),
  route({
    method: "get",
    path: "/__board/corpus",
    operationId: "corpus",
    summary: "Every text cut into search units",
    tag: TAG,
    answers: { 200: json("The corpus, streamed as the grammar's worker cuts it.", Corpus) },
  }),
  route({
    method: "get",
    path: "/__board/search",
    operationId: "search",
    summary: "Search the vault",
    description:
      "`tag` keeps the hits in documents carrying that tag (#327); with no words it lists those documents, by title. It narrows what is ranked, before `limit` counts.",
    tag: TAG,
    query: z.object({
      q: param("The words; blank, no hits.", z.string().optional()),
      tag: param("Only documents carrying this tag.", z.string().optional()),
      limit: param("At most this many hits: a whole number above zero.", z.string().regex(/^\d+$/).optional()),
    }),
    answers: { 200: json("The hits.", Search) },
    refuses: { 400: "A `tag` that is not one, or a `limit` that is not a whole number above zero." },
  }),
  route({
    method: "get",
    path: "/__board/resolve",
    operationId: "resolve",
    summary: "The document an id names",
    tag: TAG,
    query: z.object({ id: param("A document's id.", z.string()) }),
    answers: { 200: json("Its name and kind.", z.object({ id: z.string(), name: z.string(), kind: AnyKind })) },
    refuses: { 404: "Nothing has the id." },
  }),
  route({
    method: "post",
    path: "/__board/patch",
    operationId: "patch",
    summary: "Edit a board's items",
    description:
      "The ops are applied to the board's text as it is now. With a `base` that is not its sha1, nothing is written and the 409 carries the text that won.",
    tag: TAG,
    query: z.object({ name: Name }),
    body: { schema: PatchBody },
    answers: { 200: json("The board as written.", Version) },
    refuses: {
      400: "`ops` that is not a list, an op the board refuses, or a `base` that is not a string.",
      404: "No such board.",
    },
    conflict: true,
  }),
  route({
    method: "post",
    path: "/__board/put",
    operationId: "put",
    summary: "Write a document's whole text",
    description:
      "The documented whole-text write: with a `base`, over that version only — a 409 carries the text that won; with none, over whatever is there. A draft with no `id:` line keeps the document's id (#401).",
    tag: TAG,
    query: z.object({ name: Name, kind: Kind }),
    body: { schema: PutBody },
    answers: { 200: json("The text as written.", Version) },
    refuses: { 400: `${NOT_A_KIND} No \`text\`, or a \`base\` that is not a string.`, 404: "No such document." },
    conflict: true,
  }),
  route({
    method: "post",
    path: "/__board/create",
    operationId: "create",
    summary: "Make a document",
    tag: TAG,
    body: { schema: CreateBody },
    answers: { 200: json("The document as filed.", Created) },
    refuses: { 400: `No \`text\`. ${NOT_A_KIND} A name the vault refuses, or a non-board under \`components/\`.` },
  }),
  route({
    method: "post",
    path: "/__board/rename",
    operationId: "rename",
    summary: "Rename or move a document",
    description: "The vault's `[[wikilinks]]` to it are kept naming it (`server/relink.ts`).",
    tag: TAG,
    body: { schema: RenameBody },
    answers: { 200: json("The name it settled on, and the links kept.", Renamed) },
    refuses: { 400: `${NOT_A_KIND} A name the vault refuses.`, 404: "No such document." },
  }),
  route({
    method: "post",
    path: "/__board/duplicate",
    operationId: "duplicate",
    summary: "Copy a document",
    tag: TAG,
    body: { schema: RenameBody },
    answers: { 200: json("The copy's name and id.", Renamed) },
    refuses: { 400: `${NOT_A_KIND} A name the vault refuses.`, 404: "No such document." },
  }),
  route({
    method: "post",
    path: "/__board/delete",
    operationId: "delete",
    summary: "Move a document to the trash",
    description:
      "Not a delete for good: the file, its images and its id go into the trash entry, and `/__board/trash/restore` puts them back.",
    tag: TAG,
    body: { schema: DeleteBody },
    answers: {
      200: json(
        "The name as sent, its kind, and the trash entry.",
        z.object({ name: about("`name` as it was sent.", z.unknown()), kind: AnyKind, trash: TrashEntry }),
      ),
    },
    refuses: { 400: NOT_A_KIND, 404: "No such document." },
  }),
  route({
    method: "post",
    path: "/__board/retitle",
    operationId: "retitle",
    summary: "Set a document's title",
    description:
      "The `title:` line, or an attachment's record. With `follow`, the file is renamed to the title too; the links that named it either way are kept naming it.",
    tag: TAG,
    body: { schema: RetitleBody },
    answers: {
      200: json(
        "Where it settled, its id and title, and the links kept.",
        z.object({ name: z.string(), id: z.string().nullable(), title: z.string(), relinked: Relinked }),
      ),
    },
    refuses: { 400: `${NOT_A_KIND} No title, or a name the vault refuses.`, 404: "No such document." },
    conflict: true,
  }),
  route({
    method: "post",
    path: "/__board/task",
    operationId: "task",
    summary: "Set a task's status, dates or priority",
    description:
      "Recomputed over the text that beat it on a conflict, rather than refused: a line or two nobody else is likely to be writing.",
    tag: TAG,
    body: { schema: TaskBody },
    answers: {
      200: json("The task as it is now; `null` when the note is no task.", z.object({ name: z.string(), task: Task.nullable() })),
    },
    refuses: {
      400: "A value that is not a status, a date or a priority; none sent; or a date or priority for a note with no status.",
      404: "No such note.",
      409: "The note kept changing underneath the edit.",
    },
  }),
  route({
    method: "post",
    path: "/__board/project",
    operationId: "project",
    summary: "Set a project's status or colour",
    tag: TAG,
    body: { schema: ProjectBody },
    answers: {
      200: json(
        "The project as it is now; `null` when the note is no project.",
        z.object({ name: z.string(), project: Project.nullable() }),
      ),
    },
    refuses: {
      400: "A value that is not a project status or a hue; none sent; or a colour for a note with no status.",
      404: "No such note.",
      409: "The note kept changing underneath the edit.",
    },
  }),
  route({
    method: "post",
    path: "/__board/event",
    operationId: "event",
    summary: "Set when an event starts and ends",
    tag: TAG,
    body: { schema: EventBody },
    answers: {
      200: json(
        "The event as it is now; `null` when the note is no event.",
        z.object({ name: z.string(), event: NoteEvent.nullable() }),
      ),
    },
    refuses: {
      400: "A time that does not read; none sent; a task (its dates are `/__board/task`'s); an end with no start, in the other form, or before the start.",
      404: "No such note.",
      409: "The note kept changing underneath the edit.",
    },
  }),
  route({
    method: "get",
    path: "/__board/table",
    operationId: "table",
    summary: "A table, read",
    description: "With `stamp`, the tabs, columns and rows that have no id are given one, and written, first.",
    tag: TAG,
    query: z.object({
      name: param("The table's name.", z.string()),
      tab: param("Only this tab.", z.string().optional()),
      view: flag("The tab as its sorts and filters show it:"),
      stamp: flag("Give every tab, column and row an id first:"),
    }),
    answers: { 200: json("The table.", Table) },
    refuses: { 404: "No such table, or no such tab in it.", 409: "The table kept changing while it was stamped." },
  }),
  route({
    method: "post",
    path: "/__board/table",
    operationId: "editTable",
    summary: "Edit a table",
    tag: TAG,
    body: { schema: TableBody },
    answers: { 200: json("The table after the edits.", TableEdited) },
    refuses: {
      400: "`ops` that is not a list, an op the table refuses, or a `base` that is not a string.",
      404: "No such table.",
    },
    conflict: true,
  }),
  route({
    method: "post",
    path: "/__board/quiz",
    operationId: "editQuiz",
    summary: "Edit a quiz's questions",
    tag: TAG,
    body: { schema: QuizBody },
    answers: { 200: json("The quiz after the edits.", QuizEdited) },
    refuses: { 400: "No ops, an op the quiz refuses, or a `base` that is not a string.", 404: "No such quiz." },
    conflict: true,
  }),
  route({
    method: "get",
    path: "/__board/diagnostics",
    operationId: "diagnostics",
    summary: "What the grammar says about a document",
    tag: TAG,
    query: z.object({
      name: Name,
      kind: param("Which kind; left out, a board. A note has none.", z.enum(["board", "quiz", "table"]).optional()),
    }),
    answers: { 200: json("Its diagnostics.", Diagnosis) },
    refuses: { 400: `${NOT_A_KIND} A note, which has none.`, 404: "No such document." },
  }),
  route({
    method: "post",
    path: "/__board/diagnostics",
    operationId: "diagnoseDraft",
    summary: "What the grammar says about a draft",
    description:
      "Answered exactly as `GET` answers for a file of that kind, and nothing read or written: an agent drafting documents that name each other can check each before any is written.",
    tag: TAG,
    body: { schema: DraftBody },
    answers: { 200: json("Its diagnostics.", Diagnosis) },
    refuses: { 400: `No \`text\`. ${NOT_A_KIND} A note, which has none.`, 413: `A draft over ${DRAFT_MAX / (1024 * 1024)} MiB.` },
  }),
  route({
    method: "get",
    path: "/__board/fences",
    operationId: "fences",
    summary: "A board's fences",
    tag: TAG,
    query: z.object({ name: param("The board's name.", z.string()) }),
    answers: { 200: json("Its fences.", Fences) },
    refuses: { 404: "No such board." },
  }),
];
