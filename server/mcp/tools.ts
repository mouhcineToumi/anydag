/**
 * The MCP tools. **Each tool calls
 * its route** through a `Backend`, with the body the page would send — so the rules are the routes',
 * not a copy. What a tool adds is only what a caller with no page needs: a deep link to open, a name
 * where a route answers an id, and a `confirm` where the page would have asked in a modal.
 *
 * Two naming facts: `vault` in a tool's arguments is the id of an open vault;
 * scopes are one `--read-only` flag, and a tool says whether it `write`s;
 * and nothing is shared or signed in to, so the share and account tools are gone. The one thing that
 * leaves the machine is `feedback`, and only when the person asked for it in their words.
 *
 * Plain Node, no `@/` aliases and no `Session`: this is imported by the parity test as the list of
 * tool names, and by `server.ts` to register them.
 */

import { z } from "zod";

import { HUE_ORDER } from "../../src/dsl/ir";
import { eventOf, isDay } from "../../src/note/event";
import { cleanTitle } from "../../src/note/format";
import { PROJECT_STATUSES, hueOf, projectFolders, projectFor, withProject, type Project } from "../../src/note/project";
import { STATUSES, dueOf, titleStem, withTask } from "../../src/note/task";
import { withEvent } from "../../src/note/event";
import { FetchRefused, fetchFile, type Fetched } from "../fetch";
import { endsBeforeItStarts, placed, withTitle } from "../frontmatter";
import { grammar } from "../grammar";
import { extOf } from "../names";
import { MIME } from "../uploads";
import type { Answer, Backend, CallOptions } from "./backend";

/* -- the shapes a tool and its server share ------------------------------------------------- */

/** A refusal in a tool's words. `server.ts` turns it into an MCP tool error. */
export class ToolError extends Error {}

/** A picture, which a model gets to look at as image content rather than as text. */
export class Picture {
  constructor(
    readonly data: Uint8Array,
    readonly mime: string,
  ) {}
}

export interface Kit {
  readOnly: boolean;
  /** Where the answers come from (`in-process`, or the app's port). */
  via: string;
  /** A route's JSON answer; a refusal is a `ToolError` carrying the route's own words. */
  api(method: string, route: string, o?: Call): Promise<any>;
  /** A route's bytes (a file), with the same refusals. */
  bytes(method: string, route: string, o?: Call): Promise<{ data: Uint8Array; mime: string }>;
  /** The deep link that opens a document, in `vault` or the default one. */
  url(name: string, kind: string, vault?: string): Promise<string>;
  /** Refuse by naming the flag — for a tool that only sometimes writes. */
  needWrite(what: string): void;
}

interface Call extends Omit<CallOptions, "raw"> {
  vault?: string | undefined;
}

export interface Tool {
  name: string;
  description: string;
  /** Whether it changes anything. `--read-only` refuses every tool that does. */
  write: boolean;
  input: z.ZodRawShape;
  run(args: any, kit: Kit): Promise<unknown>;
}

const READ_ONLY_FLAG = "--read-only";

/** What a route said when it refused, as a sentence: its `error`, its `code`, and for a 409 the base it now has. */
function refusal(status: number, body: any): ToolError {
  const said = body && typeof body === "object" ? body : {};
  let text = String(said.error ?? (typeof body === "string" && body ? body : `refused (${status})`));
  if (said.code) text += ` (code: ${said.code})`;
  if (status === 409 && said.base) {
    text += ` — its base is now ${said.base}; read it again and redo the change against what is there`;
  }
  return new ToolError(text);
}

const decoder = new TextDecoder();

/** `home`, for a chat's MCP server: the vault a document link names when a tool named none. */
export function makeKit(backend: Backend, readOnly: boolean, home?: string): Kit {
  const send = async (method: string, route: string, o: Call = {}, raw = false): Promise<Answer> => {
    const { vault, ...rest } = o;
    const got = await backend.call(method, route, { ...rest, query: { ...rest.query, vault }, raw });
    if (got.status >= 200 && got.status < 300) return got;
    let body: unknown = got.json;
    if (body === undefined && got.bytes) {
      const text = decoder.decode(got.bytes);
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    throw refusal(got.status, body);
  };
  const enc = encodeURIComponent;
  const kit: Kit = {
    readOnly,
    via: backend.via,
    async api(method, route, o) {
      return (await send(method, route, o)).json;
    },
    async bytes(method, route, o) {
      const got = await send(method, route, o, true);
      return { data: got.bytes ?? new Uint8Array(), mime: (got.headers["content-type"] ?? "").split(";")[0]! };
    },
    async url(name, kind, vault) {
      let id = vault ?? home;
      if (!id) {
        const listed = await kit.api("GET", "/api/vaults");
        id = (listed.vaults as { id: string; default: boolean }[]).find((v) => v.default)?.id;
      }
      return `anydag://open?${id ? `vault=${enc(id)}&` : ""}${kind}=${enc(name)}`;
    },
    needWrite(what) {
      if (readOnly) throw new ToolError(`this server was started with ${READ_ONLY_FLAG}, so it cannot ${what}`);
    },
  };
  return kit;
}

/* -- small shared pieces --------------------------------------------------------------------- */

export const NOTE_VAULT = "`vault` is an open vault's id from `vault_list`; left out, the default one (the vault opened last).";
const vault = z.string().optional().describe("An open vault's id from `vault_list`; the default vault when left out.");
const KINDS = ["board", "note", "quiz", "table", "file"] as const;
const kindOf = z.enum(KINDS);
const PLURAL = { board: "boards", note: "notes", quiz: "quizzes", table: "tables" } as const;
const TEXT_CAP = 200_000;
const TASK_ORDER: Record<string, number> = { "in-progress": 0, todo: 1, done: 2 };

const tool = <S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  write: boolean;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>, kit: Kit) => Promise<unknown>;
}): Tool => def as Tool;

const withNote = (text: string): string => `${text.trim()}\n${NOTE_VAULT}`;

/** A new document's text: the one given, titled when a title is given; *Untitled* when neither says anything. */
function blank(kind: string, title: string | undefined, text: string, named: boolean): string {
  if (title) return withTitle(text, title, kind);
  return text || named ? text : withTitle("", "Untitled", kind);
}

const leafOf = (n: string) => n.slice(n.lastIndexOf("/") + 1);
const inFolder = (folder: string | undefined, leaf: string) =>
  folder && folder.replace(/^\/+|\/+$/g, "") ? `${folder.replace(/^\/+|\/+$/g, "")}/${leaf}` : leaf;

/** The first and last day an event touches, as written. */
function eventDays(event: { start: string; end?: string }): [string, string] {
  const first = event.start.slice(0, 10);
  const end = event.end;
  if (end === undefined || endsBeforeItStarts(event)) return [first, first];
  let last = end.slice(0, 10);
  if (!isDay(end) && end.slice(11, 16) === "00:00" && last > first) {
    const d = new Date(`${last}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    last = d.toISOString().slice(0, 10);
  }
  return [first, last > first ? last : first];
}

/** A project's folder, named by its folder or by its note; `undefined` when it names none. */
function projectArg(project: string, listed: { projects: Record<string, Project> }): { only: string | null; none: boolean } {
  if (project === "none") return { only: null, none: true };
  const folders = projectFolders(listed.projects);
  const only = folders.has(project)
    ? project
    : project in listed.projects
      ? project.slice(0, project.lastIndexOf("/"))
      : undefined;
  if (only === undefined || !only) throw new ToolError(`no project \`${project}\` — \`project_list\` says which there are`);
  return { only, none: false };
}

function pictureOf(data: Uint8Array, mime: string, path: string): Picture {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "png";
  const fixed = { jpg: "image/jpeg", svg: "image/svg+xml" }[ext];
  return new Picture(data, mime.startsWith("image/") ? mime : (fixed ?? `image/${ext}`));
}

/* -- the seven things a document of any kind has ---------------------------------------------- */

/*
 * A listing a model can read: one folder of it, a page at a time.
 *
 * `quiz_list` answered every quiz with every folder beside it, and at 224 quizzes that was 102 KB —
 * over a client's limit for a tool's answer, so an agent could not read it at all. Every list tool
 * takes `folder` (everything under it, subfolders included — the project rule) and pages its names,
 * `limit` at a time from an opaque `cursor`, saying how many there are in all and where the next page
 * starts. The maps beside the names — titles, ids, tasks — are cut to the page.
 */
/** Enough to see a folder whole, little enough to read: about 45 KB of quizzes at the most. */
const LIMIT = 100;
const MAX_LIMIT = 500;

interface Page {
  names: string[];
  folders: string[];
  total: number;
  next_cursor: string | null;
}

/** The three arguments every list tool takes. */
const pageArgs = {
  folder: z.string().optional().describe("Only what is under this folder, subfolders included."),
  limit: z.number().int().default(LIMIT).describe(`How many at a time: ${LIMIT} unless said, at most ${MAX_LIMIT}.`),
  cursor: z.string().optional().describe("Where the page starts: a listing's `next_cursor`, as it came."),
};

const PAGE_NOTE =
  "`folder` narrows it to what is under that folder, subfolders included; it comes `limit` at a time (100, at most 500), and `next_cursor`, when there is more, is the `cursor` for the next page — `total` says how many there are in all.";

const under = (name: string, folder: string): boolean => name.startsWith(`${folder}/`);

/** The names under `folder` (all of them without one), `limit` from `cursor`, and the folders under it. */
function page(
  names: Iterable<string>,
  folders: Iterable<string>,
  opts: { folder?: string; limit?: number; cursor?: string } = {},
): Page {
  const where = (opts.folder ?? "").replace(/^\/+|\/+$/g, "");
  const size = opts.limit ?? LIMIT;
  if (!Number.isInteger(size) || size < 1 || size > MAX_LIMIT) throw new ToolError(`\`limit\` is from 1 to ${MAX_LIMIT}`);
  const start = opts.cursor ? Number(opts.cursor) : 0;
  if (!Number.isInteger(start) || start < 0 || (opts.cursor !== undefined && !/^\d+$/.test(opts.cursor))) {
    throw new ToolError("that `cursor` is not one a listing gave — pass `next_cursor` as it came");
  }
  const matching = [...names].filter((n) => !where || under(n, where));
  const shown = matching.slice(start, start + size);
  const end = start + shown.length;
  return {
    names: shown,
    folders: [...folders].filter((f) => !where || f === where || under(f, where)),
    total: matching.length,
    next_cursor: end < matching.length ? String(end) : null,
  };
}

async function docList(
  kit: Kit,
  kind: "board" | "note" | "quiz" | "table",
  v?: string,
  paging: { folder?: string; limit?: number; cursor?: string } = {},
) {
  const got = await kit.api("GET", "/__board/list", { vault: v });
  const shown = page(got[PLURAL[kind]] as string[], got.folders as string[], paging);
  const names = shown.names;
  const mine = new Set(names);
  const only = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m ?? {}).filter(([n]) => mine.has(n)));
  const out: Record<string, unknown> = {
    [PLURAL[kind]]: names,
    folders: shown.folders,
    titles: only(got.titles),
    ids: only(got.ids),
    total: shown.total,
    next_cursor: shown.next_cursor,
  };
  if (kind === "note") {
    out.tasks = only(got.tasks);
    out.projects = only(got.projects);
    out.events = only(got.events);
    out.created = only(got.created);
  }
  if (kind === "quiz") out.questions = only(got.questions);
  return out;
}

const docRead = async (kit: Kit, kind: string, name: string, v?: string) => ({
  ...(await kit.api("GET", "/__board/get", { vault: v, query: { name, kind } })),
  url: await kit.url(name, kind, v),
});

async function docCreate(kit: Kit, kind: string, name: string, text: string, title: string | undefined, v?: string) {
  kit.needWrite(`make a ${kind}`);
  const body = { name, text: blank(kind, title, text, !!name), kind };
  const got = await kit.api("POST", "/__board/create", { vault: v, body });
  return { name: got.name, id: got.id, base: got.base, url: await kit.url(got.name, kind, v) };
}

async function docWrite(kit: Kit, kind: string, name: string, text: string, base: string | undefined, v?: string) {
  kit.needWrite(`write a ${kind}`);
  const got = await kit.api("POST", "/__board/put", {
    vault: v,
    query: { name, kind },
    body: { text, ...(base !== undefined ? { base } : {}) },
  });
  return { name, base: got.base, url: await kit.url(name, kind, v) };
}

async function docMove(kit: Kit, kind: string, name: string, to: string, copy: boolean, v?: string) {
  kit.needWrite(`${copy ? "copy" : "rename"} a ${kind}`);
  const got = await kit.api("POST", copy ? "/__board/duplicate" : "/__board/rename", { vault: v, body: { name, to, kind } });
  return { name: got.name, id: got.id, url: await kit.url(got.name, kind, v) };
}

async function docDelete(kit: Kit, kind: string, name: string, v?: string) {
  kit.needWrite(`delete a ${kind}`);
  const got = await kit.api("POST", "/__board/delete", { vault: v, body: { name, kind } });
  return { name, kind, trash: got.trash };
}

async function docTitle(kit: Kit, kind: string, name: string, title: string, follow: boolean, v?: string) {
  kit.needWrite(`retitle a ${kind}`);
  const got = await kit.api("POST", "/__board/retitle", { vault: v, body: { name, kind, title, follow } });
  return { ...got, url: await kit.url(got.name, kind, v) };
}

/** The tools every text kind has, named `<kind>_…` and described for that kind. */
function kindTools(
  kind: "note" | "quiz" | "table",
  lines: {
    read: string;
    create: string;
    write: string;
    rename: string;
    duplicate: string;
    del: string;
    title: string;
    list: string;
  },
): Tool[] {
  const createArgs = { name: z.string().default(""), text: z.string().default(""), title: z.string().optional(), vault };
  return [
    tool({
      name: `${kind}_list`,
      description: withNote(`${lines.list}\n\n${PAGE_NOTE}`),
      write: false,
      input: { ...pageArgs, vault },
      run: ({ folder, limit, cursor, vault: v }, kit) => docList(kit, kind, v, { folder, limit, cursor }),
    }),
    tool({
      name: `${kind}_read`,
      description: withNote(lines.read),
      write: false,
      input: { name: z.string(), vault },
      run: ({ name, vault: v }, kit) => docRead(kit, kind, name, v),
    }),
    tool({
      name: `${kind}_create`,
      description: withNote(lines.create),
      write: true,
      input: createArgs,
      run: ({ name, text, title, vault: v }, kit) => docCreate(kit, kind, name, text, title, v),
    }),
    tool({
      name: `${kind}_write`,
      description: withNote(lines.write),
      write: true,
      input: { name: z.string(), text: z.string(), base: z.string().optional(), vault },
      run: ({ name, text, base, vault: v }, kit) => docWrite(kit, kind, name, text, base, v),
    }),
    tool({
      name: `${kind}_rename`,
      description: withNote(lines.rename),
      write: true,
      input: { name: z.string(), to: z.string(), vault },
      run: ({ name, to, vault: v }, kit) => docMove(kit, kind, name, to, false, v),
    }),
    tool({
      name: `${kind}_duplicate`,
      description: withNote(lines.duplicate),
      write: true,
      input: { name: z.string(), to: z.string(), vault },
      run: ({ name, to, vault: v }, kit) => docMove(kit, kind, name, to, true, v),
    }),
    tool({
      name: `${kind}_delete`,
      description: withNote(lines.del),
      write: true,
      input: { name: z.string(), vault },
      run: ({ name, vault: v }, kit) => docDelete(kit, kind, name, v),
    }),
    tool({
      name: `${kind}_title`,
      description: withNote(lines.title),
      write: true,
      input: { name: z.string(), title: z.string(), follow: z.boolean().default(false), vault },
      run: ({ name, title, follow, vault: v }, kit) => docTitle(kit, kind, name, title, follow, v),
    }),
  ];
}

/* -- the tools ------------------------------------------------------------------------------- */

const boardTools: Tool[] = [
  tool({
    name: "board_list",
    description: withNote(
      "Every board in a vault, and every folder — the empty ones included.\n\n" +
        "A board's name carries its folder: `reference/erd` is the board `erd` in `reference/`. `ids` maps each name to its permanent id, which a rename or a move does not change.\n\n" +
        PAGE_NOTE,
    ),
    write: false,
    input: { ...pageArgs, vault },
    run: ({ folder, limit, cursor, vault: v }, kit) => docList(kit, "board", v, { folder, limit, cursor }),
  }),
  tool({
    name: "board_read",
    description: withNote(
      "One board's whole text, with the `base` any write of it has to carry.\n\n" +
        "`base` is a sha1 of the file. Pass the one you read back to `board_write` or `board_patch`: a board has two writers — you and a person dragging a box — and a write against a version that has moved is refused rather than silently winning. `url` is a deep link the AnyDag app opens.",
    ),
    write: false,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => docRead(kit, "board", name, v),
  }),
  tool({
    name: "board_fences",
    description: withNote(
      "What items are on a board — each one's id, type, page and line — without its whole text. Read this before `board_read` on a board you only need one item of.",
    ),
    write: false,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => kit.api("GET", "/__board/fences", { vault: v, query: { name } }),
  }),
  tool({
    name: "board_diagnose",
    description: withNote(
      "What is wrong with a board's text, as stable codes with the line each is on.\n\n" +
        "`E_*` stops a diagram drawing and `W_*` does not; `EB_*` is the board file itself — the frontmatter, a fence line, an attribute — rather than the DSL inside it. **Branch on the code**: the message beside it is written for a person and may be reworded.\n\n" +
        "Give `text` to check a draft before `board_create`, with nothing read or written.\n\n" +
        "This is the parser's half only. What is wrong with the *drawing* — an edge through a card, two labels on one spot — is measured off a laid-out page; open the `url` in the app.",
    ),
    write: false,
    input: { name: z.string().default(""), text: z.string().optional(), vault },
    run: async ({ name, text, vault: v }, kit) => {
      if (text !== undefined) return draftCheck(kit, "board", name, text);
      if (!name) throw new ToolError("say which board: `name`, or `text` for a draft");
      return {
        ...(await kit.api("GET", "/__board/diagnostics", { vault: v, query: { name, kind: "board" } })),
        url: await kit.url(name, "board", v),
      };
    },
  }),
  tool({
    name: "board_create",
    description: withNote(
      "Make a board. The name is settled by the server and may not be the one asked for.\n\n" +
        "A name already taken is numbered rather than refused — `plan` becomes `plan-2` — so open the `name` that comes back rather than the one that went in. A `/` in the name puts the board in that folder, making it if it does not exist.",
    ),
    write: true,
    input: { name: z.string().default(""), text: z.string().default(""), vault },
    run: ({ name, text, vault: v }, kit) => docCreate(kit, "board", name || "board", text, undefined, v),
  }),
  tool({
    name: "board_write",
    description: withNote(
      "Replace a board's whole text. What to use when you are writing or rewriting a diagram.\n\n" +
        "Pass the `base` from `board_read`. Without one the write wins unconditionally, which will throw away an edit somebody made while you were thinking; with one, a board that moved underneath answers a conflict carrying the text that replaced it, and the right response is to read that, redo the change against it and write again.\n\n" +
        "Give every fence a `#id`. One you leave off is written for you — the id the item would have been numbered with — so the text that comes back may differ from the text you sent by exactly those ids; read `base` from the answer rather than hashing what you sent.",
    ),
    write: true,
    input: { name: z.string(), text: z.string(), base: z.string().optional(), vault },
    // Every item leaves carrying its id in the file, whatever the agent wrote — the stamp is the
    // grammar's, run here because `/put` is the undo path and never stamps.
    run: async ({ name, text, base, vault: v }, kit) => {
      kit.needWrite("write a board");
      return docWrite(kit, "board", name, await grammar.stamp(text), base, v);
    },
  }),
  tool({
    name: "board_patch",
    description: withNote(
      "Change part of a board, leaving the rest of the file byte for byte as it was.\n\n" +
        'An op is one of `{id, attrs}` · `{id, body}` · `{id, remove: true}` · `{insert: "<text>", after?: "<id>"}` · `{meta: {...}}` — the frontmatter. Use this rather than `board_write` when a person may be editing the same board: it rewrites one span, so their concurrent change to another item survives and the diff stays the size of the edit.\n\n' +
        "`attrs` merges; a key set to null is removed. A `remove` takes every link that named the item, or a card inside it, out of the board's `edges` fences in the same write.",
    ),
    write: true,
    input: { name: z.string(), ops: z.array(z.record(z.string(), z.unknown())), base: z.string().optional(), vault },
    run: async ({ name, ops, base, vault: v }, kit) => {
      kit.needWrite("patch a board");
      const got = await kit.api("POST", "/__board/patch", {
        vault: v,
        query: { name },
        body: { ops, ...(base !== undefined ? { base } : {}) },
      });
      return { name, base: got.base, text: got.text, url: await kit.url(name, "board", v) };
    },
  }),
  tool({
    name: "board_rename",
    description: withNote(
      "Rename or move a board. A `/` in `to` is the folder it moves into, assets and all.\n\nWithin one vault; `board_transfer` moves a board to another.",
    ),
    write: true,
    input: { name: z.string(), to: z.string(), vault },
    run: ({ name, to, vault: v }, kit) => docMove(kit, "board", name, to, false, v),
  }),
  tool({
    name: "board_duplicate",
    description: withNote("Copy a board. The copy's name is numbered if `to` is taken."),
    write: true,
    input: { name: z.string(), to: z.string(), vault },
    run: ({ name, to, vault: v }, kit) => docMove(kit, "board", name, to, true, v),
  }),
  tool({
    name: "board_delete",
    description: withNote(
      "Delete a board." +
        " It goes to the vault's trash, where `trash_restore` puts it back as it was — with its id, so every reference to it works again — for thirty days.",
    ),
    write: true,
    input: { name: z.string(), vault },
    run: async ({ name, vault: v }, kit) => {
      const got = await docDelete(kit, "board", name, v);
      return { name: got.name, trash: got.trash };
    },
  }),
  tool({
    name: "board_transfer",
    description:
      "Move a board, a note, a quiz, a table or an attachment — or with `folder`, a whole folder and everything in it — from one vault to another, with its id, so a reference to it keeps working.\n\n" +
      "`vault` is where it is now (left out, the default) and `to` the id of the open vault it goes to, both from `vault_list`. A name already taken there is numbered, so open the `name` that comes back; a folder already there is refused. The original is removed once the copy is made.",
    write: true,
    input: { name: z.string().default(""), to: z.string(), vault, kind: kindOf.default("board"), folder: z.string().optional() },
    run: async ({ name, to, vault: v, kind, folder }, kit) => {
      kit.needWrite("move a document between vaults");
      const body = folder !== undefined ? { folder, to } : { name, kind, to };
      const got = await kit.api("POST", "/__board/transfer", { vault: v, body });
      return folder !== undefined ? got : { ...got, vault: to, url: await kit.url(got.name, kind, to) };
    },
  }),
  tool({
    name: "board_mkdir",
    description: withNote(
      "Make a folder. Idempotent — a folder asked for twice is one folder, not `reference-2`.\n\nOnly needed for a folder with nothing in it yet: a board named `reference/erd` makes `reference/` on its own.",
    ),
    write: true,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => {
      kit.needWrite("make a folder");
      return kit.api("POST", "/__board/mkdir", { vault: v, body: { name } });
    },
  }),
  tool({
    name: "board_rmdir",
    description: withNote(
      "Remove a folder. An empty one goes on its own; one with anything in it is refused.\n\n" +
        "With `recursive`, everything in it goes too — every board, note, quiz, table, image and folder — into the trash as one entry, which `trash_restore` puts back whole. **Ask the person** first all the same, and pass `confirm` as the folder's path exactly: that is their answer. What went comes back, counted, with the trash entry.",
    ),
    write: true,
    input: { name: z.string(), recursive: z.boolean().default(false), confirm: z.string().optional(), vault },
    run: ({ name, recursive, confirm, vault: v }, kit) => {
      kit.needWrite("remove a folder");
      if (recursive && confirm !== name)
        throw new ToolError(`emptying \`${name}\` takes everything in it: ask the person, and pass \`confirm\` as \`${name}\``);
      return kit.api("POST", "/__board/rmdir", { vault: v, body: { name, recursive } });
    },
  }),
  tool({
    name: "board_mvdir",
    description: withNote(
      "Rename or move a folder with every board, note, image and folder in it, in one step.\n\n" +
        "`to` is the whole new path: `work` → `archive/work` moves it into `archive/`, and `work` → `done` renames it. A destination that already exists is refused, never numbered, and so is moving a folder into itself. To move one board, use `board_rename` with its new full name.",
    ),
    write: true,
    input: { name: z.string(), to: z.string(), vault },
    run: ({ name, to, vault: v }, kit) => {
      kit.needWrite("move a folder");
      return kit.api("POST", "/__board/mvdir", { vault: v, body: { name, to } });
    },
  }),
  tool({
    name: "board_title",
    description: withNote(
      "Call a board something: the `title:` line of its frontmatter, and no other byte.\n\n" +
        "The title is what a person knows it by — the sidebar's row, a reference's words. With `follow`, the file's name follows it (`Q3 plan` → `Q3 plan`, numbered if taken), as the sidebar's rename does; open the `name` that comes back. Its id never changes.",
    ),
    write: true,
    input: { name: z.string(), title: z.string(), follow: z.boolean().default(false), vault },
    run: ({ name, title, follow, vault: v }, kit) => docTitle(kit, "board", name, title, follow, v),
  }),
];

const noteTools = kindTools("note", {
  list: "Every note in a vault, with its title and id, and every folder.\n\n`tasks` says which notes are tasks (a `status:` and maybe a `due:` and a `start:`), `projects` which are projects (a `project:` and maybe a `hue:`), `events` which are events (a `start:` and maybe an `end:`); `created` when each was made, in UTC.",
  read: "One note's whole text — Markdown with optional frontmatter — and the `base` a write of it must carry. A reference to another document is `[Title](dag:<id>)`; an embed `![Title](dag:<id>)`. A plain `[[wikilink]]` is followed by name and never rewritten.",
  create:
    "Make a note. The name is settled by the server — numbered if taken. With a `title` the file is named after it, in the folder `name` gives (`work/` puts it in `work`); with neither text nor title it starts *Untitled*, as New note does. Plain Markdown: headings, lists, checklists, tables, quotes, code, images.",
  write:
    "Replace a note's whole text.\n\nPass the `base` from `note_read`: a person may be typing in it, and a note that moved underneath answers a conflict naming its new base — read it again, redo the change, write again. Without one the write wins unconditionally.",
  rename: "Rename or move a note, its images with it. A `/` in `to` is the folder it moves into.",
  duplicate: "Copy a note. The copy is a new document with its own id.",
  del:
    "Delete a note." +
    " It goes to the vault's trash, where `trash_restore` puts it back as it was — with its id, so every reference to it works again — for thirty days.",
  title:
    "Call a note something: its frontmatter's `title:`, and no other byte. With `follow` the file's name follows the title, as the title field at the top of the note's page does.",
});

const quizTools = kindTools("quiz", {
  list: "Every quiz in a vault, with its title, id and how many questions it asks.",
  read: "One quiz's whole text, and the `base` a write of it must carry.\n\nA quiz is strict Markdown: a `##` heading per question, its options one checklist (`- [x]` right, `- [ ]` wrong), and one `>` quote explaining the answer. With no checklist, the closing quote is the answer: an open question, or a flashcard when the heading says `card` (`## What is MVCC? {#q1a2b3 card}`). An option may run over several lines — every line indented two spaces under it is its own, a fenced code block included — so a snippet goes in its option, not in the prompt. `quiz_questions` answers the same as data.",
  create:
    "Make a quiz. The name is settled by the server and may be numbered; with a `title` the file is named after it. Write the questions as `## Question?` then `- [x] right` / `- [ ] wrong` then `> why`, and check it with `quiz_check`. An option may hold a code block, indented two spaces under its `- [ ]` line. A question with no checklist and a `>` quote at its end is answered in words: the quote is its model answer, and the person says whether they had it.",
  write:
    "Replace a quiz's whole text, under the `base` from `quiz_read`. Keep every question's `{#id}`: what somebody answered is recorded against it. To change one question, add one, remove one or reorder them, `quiz_question_set`, `quiz_question_remove` and `quiz_question_move` send that question alone and leave every other byte as it is.",
  rename: "Rename or move a quiz. Its id, and so what was answered in it, go with it.",
  duplicate: "Copy a quiz. The copy is a new document: nothing answered in the original is in it.",
  del:
    "Delete a quiz." +
    " It goes to the vault's trash, where `trash_restore` puts it back as it was — with its id, so every reference to it works again — for thirty days.",
  title: "Call a quiz something: its frontmatter's `title:`. With `follow` the file's name follows.",
});

/** A draft checked with nothing read or written. */
function draftCheck(kit: Kit, kind: string, name: string, text: string) {
  return kit.api("POST", "/__board/diagnostics", { body: { text, kind, name } });
}

/** `POST /__board/quiz`: the ops, and what an agent needs back — not the whole text again. */
async function questionOps(kit: Kit, name: string, ops: Record<string, unknown>[], base: string | undefined, v?: string) {
  kit.needWrite("edit a quiz");
  const got = await kit.api("POST", "/__board/quiz", { vault: v, body: { name, ops, ...(base !== undefined ? { base } : {}) } });
  const ids: string[] = got.ids ?? [];
  const mine = new Set(ids);
  const problems = ((got.diagnostics ?? []) as any[]).filter((d) => mine.has(d.question) || d.severity === "error");
  return {
    name,
    id: ids[0] ?? null,
    changed: Boolean(got.changed),
    base: got.base,
    problems,
    url: await kit.url(name, "quiz", v),
  };
}

function at(op: Record<string, unknown>, before?: string, after?: string): Record<string, unknown> {
  if (before && after) throw new ToolError("`before` or `after`, not both");
  if (before) op.before = before;
  if (after) op.after = after;
  return op;
}

const quizMore: Tool[] = [
  tool({
    name: "quiz_question_set",
    description: withNote(
      "Write **one** question of a quiz and no other byte of it: add it, or replace the question with its `{#id}` — rather than sending the whole quiz to `quiz_write`.\n\n" +
        "`markdown` is the question as the file holds it, from its `##` heading: the prompt, the options as one checklist (an option may hold a code block, indented two spaces), and the `>` explanation — or, for a question answered in words, no checklist and a `>` model answer. It is written exactly as given. Its id is the heading's `{#id}`, or `id`; with neither it is a new question and one is minted. A new one goes at the end, or `before` or `after` the question named. Refused, with why, if it is not exactly one question a run could ask.\n\n" +
        "Pass `base` to refuse the write if the quiz moved since you read it; without one an edit that meets another writer's is redone on the text that beat it. Answers the question's `id`, the quiz's new `base`, and the `problems` the parser has with it.",
    ),
    write: true,
    input: {
      name: z.string(),
      markdown: z.string(),
      id: z.string().optional(),
      before: z.string().optional(),
      after: z.string().optional(),
      base: z.string().optional(),
      vault,
    },
    run: ({ name, markdown, id, before, after, base, vault: v }, kit) =>
      questionOps(kit, name, [at({ op: "set", markdown, ...(id ? { id } : {}) }, before, after)], base, v),
  }),
  tool({
    name: "quiz_question_remove",
    description: withNote(
      "Remove one question from a quiz by its `{#id}`, and the blank lines it leaves — no other byte changes. What was answered in it stays in the person's record, unasked.",
    ),
    write: true,
    input: { name: z.string(), id: z.string(), base: z.string().optional(), vault },
    run: ({ name, id, base, vault: v }, kit) => questionOps(kit, name, [{ op: "remove", id }], base, v),
  }),
  tool({
    name: "quiz_question_move",
    description: withNote(
      "Move one question of a quiz `before` or `after` another, by their `{#id}`s — or to the end with neither. Every question keeps its bytes; only the order changes.",
    ),
    write: true,
    input: {
      name: z.string(),
      id: z.string(),
      before: z.string().optional(),
      after: z.string().optional(),
      base: z.string().optional(),
      vault,
    },
    run: ({ name, id, before, after, base, vault: v }, kit) =>
      questionOps(kit, name, [at({ op: "move", id }, before, after)], base, v),
  }),
  tool({
    name: "quiz_check",
    description: withNote(
      "What the parser says about a quiz: how many questions, and every problem as a stable code with its line — `EQ_` for a question a run cannot ask, `WQ_` for one that still works. Give `text` to check a draft before `quiz_create`, with nothing read or written.",
    ),
    write: false,
    input: { name: z.string().default(""), text: z.string().optional(), vault },
    run: ({ name, text, vault: v }, kit) => {
      if (text !== undefined) return draftCheck(kit, "quiz", name, text);
      if (!name) throw new ToolError("say which quiz: `name`, or `text` for a draft");
      return kit.api("GET", "/__board/diagnostics", { vault: v, query: { name, kind: "quiz" } });
    },
  }),
  tool({
    name: "quiz_questions",
    description: withNote(
      "A quiz's questions as data — each one's `id`, prompt, options with `correct` marked, and the explanation — for running it in a conversation: ask, let the person answer, say whether they were right and why, and record it with `quiz_answer`. A question with `card: true` is a flashcard: give the prompt, let them think, then show `why` as the back and ask whether they had it.\n\n" +
        "A question's answers are recorded under its `id`. One without an id is given one here, as the page does before a run starts — which writes the quiz; under `--read-only` the ids stay `null` and those questions cannot be recorded.",
    ),
    // Writes only to mint ids, and not at all under --read-only, so it is a read as far as the flag goes.
    write: false,
    input: { name: z.string(), vault },
    run: async ({ name, vault: v }, kit) => {
      const got = await kit.api("GET", "/__board/get", { vault: v, query: { name, kind: "quiz" } });
      const parsed = await grammar.quiz(got.text, !kit.readOnly);
      if (parsed.changed) {
        await kit.api("POST", "/__board/put", {
          vault: v,
          query: { name, kind: "quiz" },
          body: { text: parsed.text, base: got.base },
        });
      }
      return {
        name,
        id: got.id,
        description: (parsed as any).description ?? "",
        questions: (parsed as any).questions,
        diagnostics: (parsed as any).diagnostics ?? [],
        url: await kit.url(name, "quiz", v),
      };
    },
  }),
  tool({
    name: "quiz_answer",
    description: withNote(
      'Record what the person answered: `answers` is `[{question: "<id>", correct: true|false}]`, in the order they were given.\n\n' +
        "**Only answers the person gave**, never ones you worked out: a wrong one puts the question into Mistakes, and in the `mistakes` run enough right in a row (`quiz_threshold`) take it out. A question is named by the `id` `quiz_questions` gave it.",
    ),
    write: true,
    input: {
      name: z.string(),
      answers: z.array(z.object({ question: z.string(), correct: z.boolean() })),
      run: z.enum(["quiz", "mistakes"]).default("quiz"),
      vault,
    },
    run: async ({ name, answers, run, vault: v }, kit) => {
      kit.needWrite("record answers");
      const got = await kit.api("GET", "/__board/get", { vault: v, query: { name, kind: "quiz" } });
      const events = answers.map((a) => ({ quiz: got.id, question: a.question, correct: a.correct, run }));
      return kit.api("POST", "/api/practice", { vault: v, body: { events } });
    },
  }),
  tool({
    name: "quiz_mistakes",
    description: withNote(
      "Every question still in Mistakes, in the order the Mistakes run asks them, each with the quiz it is from, its streak and how often it was got wrong — and `graduate`, how many right in a row take one out.",
    ),
    write: false,
    input: { vault },
    run: async ({ vault: v }, kit) => {
      const got = await kit.api("GET", "/api/practice", { vault: v });
      const listed = await kit.api("GET", "/__board/list", { vault: v });
      const byId = new Map(Object.entries(listed.ids as Record<string, string>).map(([n, i]) => [i, n]));
      return { ...got, pool: (got.pool ?? []).map((e: any) => ({ ...e, name: byId.get(e.quiz) ?? null })) };
    },
  }),
  tool({
    name: "quiz_threshold",
    description: withNote(
      "How many right answers in a row, in the Mistakes run, take a question out of Mistakes — or, with `graduate` (1 to 10), set it. The vault's, for every quiz in it.",
    ),
    // Only setting it writes; reading is allowed under --read-only.
    write: false,
    input: { graduate: z.number().int().optional(), vault },
    run: async ({ graduate, vault: v }, kit) => {
      if (graduate === undefined) return { graduate: (await kit.api("GET", "/api/practice", { vault: v })).graduate };
      kit.needWrite("change the quiz threshold");
      return kit.api("PUT", "/api/practice", { vault: v, body: { graduate } });
    },
  }),
];

const tableTools: Tool[] = [
  ...kindTools("table", {
    list: "Every table in a vault, with its title and id, and every folder.",
    read: "One table's whole text, and the `base` a write of it must carry.\n\nA table is Markdown: a `## Tab {#id}` heading per tab and a GFM pipe table under it. A header cell is a column, `Name {#id type}` with the type one of text, number, date, checkbox, select (`options=\"a,b\"`) or link; a row's first cell ends `{#id}`. `table_get` answers the same as data, and `table_edit` changes cells without writing the whole text.",
    create:
      "Make a table. The name is settled by the server and may be numbered; with a `title` the file is named after it. Every tab, column and row it holds is given an id if it has none, so it can be addressed by `table_edit` at once. With no text it has no tabs yet: add one with `table_edit`'s `addTab`, or write `## Tab` and a GFM table, or `importCsv`.",
    write:
      "Replace a table's whole text, under the `base` from `table_read`. Keep every `{#id}`: a reference, a sort, a filter and a card on a board name them. To change a few cells, rows or columns, `table_edit` is the smaller write and never loses a person's edit to another row.",
    rename: "Rename or move a table. Its id goes with it, so every card and reference to it still works.",
    duplicate: "Copy a table. The copy is a new document with its own id.",
    del:
      "Delete a table." +
      " It goes to the vault's trash, where `trash_restore` puts it back as it was — with its id, so every reference to it works again — for thirty days.",
    title: "Call a table something: its frontmatter's `title:`. With `follow` the file's name follows.",
  }),
  tool({
    name: "table_check",
    description: withNote(
      "What the parser says about a table: how many tabs and rows, and every problem as a stable code with its line — `ET_` for two things claiming one id, `WT_` for everything that still works: a cell its column cannot read, a row with no id, a sort naming a column that went. Give `text` to check a draft before `table_create`, with nothing read or written.",
    ),
    write: false,
    input: { name: z.string().default(""), text: z.string().optional(), vault },
    run: ({ name, text, vault: v }, kit) => {
      if (text !== undefined) return draftCheck(kit, "table", name, text);
      if (!name) throw new ToolError("say which table: `name`, or `text` for a draft");
      return kit.api("GET", "/__board/diagnostics", { vault: v, query: { name, kind: "table" } });
    },
  }),
  tool({
    name: "table_get",
    description: withNote(
      "A table as data: every tab with its columns (`id`, name, type, options) and rows, each row with its `id` and its cells by column id, twice — as written and as its type reads them.\n\n" +
        "The ids are what `table_edit` addresses. A tab, column or row with none is given one here — which writes the table; under `--read-only` those ids come back `null`. `tab` answers one tab; `view` gives each tab's rows as it shows them, filtered and in its sort order, where the default is every row in the file's order.",
    ),
    write: false,
    input: { name: z.string(), tab: z.string().optional(), view: z.boolean().default(false), vault },
    run: async ({ name, tab, view, vault: v }, kit) => ({
      ...(await kit.api("GET", "/__board/table", {
        vault: v,
        query: { name, tab, view: view ? 1 : undefined, stamp: kit.readOnly ? undefined : 1 },
      })),
      url: await kit.url(name, "table", v),
    }),
  }),
  tool({
    name: "table_edit",
    description: withNote(
      "Change a table's cells, rows, columns and tabs — `ops`, applied in order, each addressed by the ids `table_get` gives:\n\n" +
        '`{op: "cell", tab, row, column, value}` · `{op: "addRow", tab, values?: {column: value}, after?, before?, id?}` · `{op: "removeRow", tab, row}` · `{op: "moveRow", tab, row, before: row|null}` · `{op: "rowHeight", tab, row, h: px|null}` · `{op: "addColumn", tab, name, type?, options?, after?, id?, w?}` · `{op: "setColumn", tab, column, name?, type?, options?, w?}` · `{op: "removeColumn", tab, column}` · `{op: "moveColumn", tab, column, before: column|null}` · `{op: "addTab", name, after?, id?}` · `{op: "setTab", tab, name?, sort?, filter?}` · `{op: "removeTab", tab}` · `{op: "moveTab", tab, before: tab|null}` · `{op: "importCsv", name, csv}` (a new tab).\n\n' +
        "A value is the cell's text: a number, `YYYY-MM-DD`, `[x]`/`[ ]`, a select's option, or a link `[words](https://…)` / `[Title](dag:<id>)`. A sort is `amount:desc, name`; a filter `stage!=Lost; amount>=1000` (operators = != ~ !~ > >= < <=); `null` takes either off. An op naming something the table does not have refuses the whole list. Without `base` a list that meets somebody else's write is applied again to what they wrote; with one, it is refused. The ids it minted come back in `minted`.",
    ),
    write: true,
    input: { name: z.string(), ops: z.array(z.record(z.string(), z.unknown())), base: z.string().optional(), vault },
    run: async ({ name, ops, base, vault: v }, kit) => {
      kit.needWrite("edit a table");
      const got = await kit.api("POST", "/__board/table", {
        vault: v,
        body: { name, ops, ...(base !== undefined ? { base } : {}) },
      });
      return {
        name,
        base: got.base,
        changed: got.changed,
        minted: got.minted,
        diagnostics: got.diagnostics,
        url: await kit.url(name, "table", v),
      };
    },
  }),
];

const templateTools: Tool[] = [
  tool({
    name: "template_list",
    description: withNote(
      "The vault's note templates — the notes in its templates folder, which Settings names and which is `Templates` when that folder exists — each with its `name`, `title` and what it `makes`: a `note`, or a `task` or an `event` when its frontmatter carries a `status:` or a `start:`. `folder` is null when the vault has none, and then there are no templates; `template_starters` writes three (a meeting, a day, an ADR).\n\n" +
        "A template is an ordinary note: read it with `note_read`, change it with `note_write`. It is left out of `task_list`, `event_list` and the calendar even when it carries those lines.",
    ),
    write: false,
    input: { vault },
    run: ({ vault: v }, kit) => kit.api("GET", "/__board/templates", { vault: v }),
  }),
  tool({
    name: "note_from_template",
    description: withNote(
      "Make a note from a template: its frontmatter and text, with the variables filled in once — `{{title}}`, `{{date}}` (`YYYY-MM-DD`), `{{time}}` (`HH:mm`) and `{{date:FORMAT}}` (Moment's tokens: `YYYY MM DD dddd MMMM HH mm`, `[text]` kept as is) — in the person's time zone. Any other `{{…}}` is left as written. The note is a plain note afterwards: it does not remember the template.\n\n" +
        "`template` is a name from `template_list`. With a `title` the file is named after it, in `folder` if given; without one it starts *Untitled* (or takes the title its template's frontmatter fills in), and `{{title}}` reads *Untitled*. A template with a `status:` makes a task, one with a `start:` an event.",
    ),
    write: true,
    input: { template: z.string(), title: z.string().optional(), folder: z.string().optional(), vault },
    run: async ({ template, title, folder, vault: v }, kit) => {
      kit.needWrite("make a note from a template");
      const got = await kit.api("POST", "/__board/from-template", {
        vault: v,
        body: { template, ...(title !== undefined ? { title } : {}), ...(folder !== undefined ? { folder } : {}) },
      });
      return { name: got.name, id: got.id, base: got.base, url: await kit.url(got.name, "note", v) };
    },
  }),
  tool({
    name: "template_starters",
    description: withNote(
      "Write the three starter templates — Meeting, Daily and ADR — into the templates folder (`Templates` when the vault names none), making it if it is not there. **Only when the person asked for them**: opening a vault never makes the folder. A file that is already there is left as it is, and comes back under `skipped`.",
    ),
    write: true,
    input: { vault },
    run: ({ vault: v }, kit) => {
      kit.needWrite("add the starter templates");
      return kit.api("POST", "/__board/templates/starters", { vault: v, body: {} });
    },
  }),
];

const taskTools: Tool[] = [
  tool({
    name: "task_list",
    description: withNote(
      "Every task — a note whose frontmatter has a `status:` — with its title, status, due date, start date and the project it is in, in the Tasks page's order: in progress, to do, done, each by due date then title. A task with a start and a due date spans the days between on the calendar.\n\n" +
        "`project` narrows to one project, named by its folder or its note, subfolders included — or `none` for the tasks in no project. `status` narrows to one status.",
    ),
    write: false,
    input: { project: z.string().optional(), status: z.enum(STATUSES).optional(), vault },
    run: async ({ project, status, vault: v }, kit) => {
      const got = await kit.api("GET", "/__board/list", { vault: v });
      const folders = projectFolders(got.projects);
      const want = project ? projectArg(project, got) : null;
      const tasks = [];
      for (const [name, task] of Object.entries<any>(got.tasks)) {
        const home = projectFor(name, folders) ?? null;
        if (want?.only && !name.startsWith(`${want.only}/`)) continue;
        if (want?.none && home !== null) continue;
        if (status && task.status !== status) continue;
        tasks.push({
          name,
          title: got.titles[name] ?? null,
          status: task.status,
          due: task.due ?? null,
          start: task.start ?? null,
          project: home,
        });
      }
      tasks.sort(
        (a, b) =>
          (TASK_ORDER[a.status] ?? 3) - (TASK_ORDER[b.status] ?? 3) ||
          (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
          (a.title ?? a.name).toLowerCase().localeCompare((b.title ?? b.name).toLowerCase()),
      );
      return { tasks };
    },
  }),
  tool({
    name: "task_create",
    description: withNote(
      "Make a task: a note titled `title`, with a `status:` and, if given, a `due:` date and a `start:` date (`YYYY-MM-DD` each). Its file is named after the title, in `folder` if given — a project's folder puts it in that project. Its description is the note's body: write it with `note_write`.",
    ),
    write: true,
    input: {
      title: z.string(),
      folder: z.string().optional(),
      status: z.enum(STATUSES).default("todo"),
      due: z.string().optional(),
      start: z.string().optional(),
      vault,
    },
    run: async ({ title, folder, status, due, start, vault: v }, kit) => {
      kit.needWrite("make a task");
      for (const day of [due, start])
        if (day !== undefined && dueOf(day) === undefined) throw new ToolError(`\`${day}\` is not a date: write it YYYY-MM-DD`);
      const dates = { ...(due ? { due } : {}), ...(start ? { start } : {}) };
      const text = withTask(withTitle("", cleanTitle(title) ?? title, "note"), { status, ...dates });
      const name = inFolder(folder, titleStem(title) || "untitled");
      const got = await kit.api("POST", "/__board/create", { vault: v, body: { name, text, kind: "note" } });
      return { name: got.name, id: got.id, task: { status, ...dates }, url: await kit.url(got.name, "note", v) };
    },
  }),
  tool({
    name: "task_set",
    description: withNote(
      "Change a task's status, due date or start date — or make a plain note a task by giving it a status.\n\n" +
        '`status: "none"` makes it a plain note again, taking all three lines out. `due` and `start` are `YYYY-MM-DD`, or `"none"` to take that date off. Only those lines of the note change.',
    ),
    write: true,
    input: {
      name: z.string(),
      status: z.enum([...STATUSES, "none"]).optional(),
      due: z.string().optional(),
      start: z.string().optional(),
      vault,
    },
    run: ({ name, status, due, start, vault: v }, kit) => {
      kit.needWrite("change a task");
      const body: Record<string, unknown> = { name };
      if (status === "none") Object.assign(body, { status: null, due: null, start: null });
      else if (status !== undefined) body.status = status;
      if (due !== undefined && status !== "none") body.due = due === "none" ? null : due;
      if (start !== undefined && status !== "none") body.start = start === "none" ? null : start;
      if (Object.keys(body).length === 1)
        throw new ToolError("say what to change: a `status`, a `due` date, a `start` date, or more than one");
      return kit.api("POST", "/__board/task", { vault: v, body });
    },
  }),
];

const eventTools: Tool[] = [
  tool({
    name: "event_list",
    description: withNote(
      "Every event — a note whose frontmatter has a `start:` and no `status:` — soonest first, with its title, `start`, `end`, whether it is `all_day`, and the project it is in.\n\n" +
        "A date is all day, and an all-day `end` is the last day, inclusive; a time carries its offset, and a timed `end` is the moment it stops. `time_zone` is the one a time with no offset is written in. `since` and `until` (`YYYY-MM-DD`, both inclusive) keep the events that touch those days, reading a time's day as it is written. `project` narrows to one project, by its folder or its note, or `none` for no project. The description is the note's body: read it with `note_read`.",
    ),
    write: false,
    input: { since: z.string().optional(), until: z.string().optional(), project: z.string().optional(), vault },
    run: async ({ since, until, project, vault: v }, kit) => {
      for (const day of [since, until])
        if (day !== undefined && dueOf(day) === undefined) throw new ToolError(`\`${day}\` is not a date: write it YYYY-MM-DD`);
      const got = await kit.api("GET", "/__board/list", { vault: v });
      const folders = projectFolders(got.projects);
      const want = project ? projectArg(project, got) : null;
      const events = [];
      for (const [name, event] of Object.entries<any>(got.events)) {
        const home = projectFor(name, folders) ?? null;
        if (want?.only && !name.startsWith(`${want.only}/`)) continue;
        if (want?.none && home !== null) continue;
        const [first, last] = eventDays(event);
        if ((since && last < since) || (until && first > until)) continue;
        events.push({
          name,
          title: got.titles[name] ?? null,
          start: event.start,
          end: event.end ?? null,
          all_day: isDay(event.start),
          project: home,
          url: await kit.url(name, "note", v),
        });
      }
      events.sort(
        (a, b) =>
          eventDays(a as any)[0].localeCompare(eventDays(b as any)[0]) ||
          a.start.localeCompare(b.start) ||
          (a.title ?? a.name).localeCompare(b.title ?? b.name),
      );
      return { events, time_zone: await zoneOf(kit, v) };
    },
  }),
  tool({
    name: "event_create",
    description: withNote(
      "Make an event: a note titled `title` with a `start:` and, if given, an `end:`.\n\n" +
        "All day is a date — `start: 2026-10-12`, `end: 2026-10-14` is three days. A time is `2026-10-03T09:00`, **read in the vault's time zone** (`whoami` says which) — so write the wall-clock time they asked for and no offset; one with an offset, `+02:00` or `Z`, is the moment it names. Its `end` is the moment it stops, and without one the calendar gives it an hour. Its file is named after the title, in `folder` if given — a project's folder puts it in that project. Its description is the note's body: write it with `note_write`.",
    ),
    write: true,
    input: { title: z.string(), start: z.string(), end: z.string().optional(), folder: z.string().optional(), vault },
    run: async ({ title, start, end, folder, vault: v }, kit) => {
      kit.needWrite("make an event");
      const zone = await zoneOf(kit, v);
      const change: Record<string, string> = {};
      try {
        change.start = placed("start", start, zone);
        if (end !== undefined) change.end = placed("end", end, zone);
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      if (change.end !== undefined && isDay(change.end) !== isDay(change.start)) {
        throw new ToolError("an all-day event ends on a date, and a timed one at a time: send `end` in `start`'s form");
      }
      const text = withEvent(withTitle("", cleanTitle(title) ?? title, "note"), change);
      if (endsBeforeItStarts(eventOf(text)!))
        throw new ToolError(`\`${change.end}\` is before \`${change.start}\`: an event ends after it starts`);
      const name = inFolder(folder, titleStem(title) || "untitled");
      const got = await kit.api("POST", "/__board/create", { vault: v, body: { name, text, kind: "note" } });
      return { name: got.name, id: got.id, event: change, url: await kit.url(got.name, "note", v) };
    },
  }),
  tool({
    name: "event_set",
    description: withNote(
      "Move an event, or make a plain note one by giving it a `start`.\n\n" +
        '`start` and `end` are what `event_create` takes — a time with no offset is in the vault\'s time zone — and `end: "none"` takes the end off, and `start: "none"` makes it a plain note again, taking both lines out. Only those lines change. A task is refused: its dates are `task_set`\'s `start` and `due`.',
    ),
    write: true,
    input: { name: z.string(), start: z.string().optional(), end: z.string().optional(), vault },
    run: ({ name, start, end, vault: v }, kit) => {
      kit.needWrite("change an event");
      const body: Record<string, unknown> = { name };
      if (start === "none") Object.assign(body, { start: null, end: null });
      else if (start !== undefined) body.start = start;
      if (end !== undefined && start !== "none") body.end = end === "none" ? null : end;
      if (Object.keys(body).length === 1) throw new ToolError("say what to change: a `start`, an `end`, or both");
      return kit.api("POST", "/__board/event", { vault: v, body });
    },
  }),
];

/** The zone a time with no offset is read in: the vault's choice, else this machine's. */
async function zoneOf(kit: Kit, v?: string): Promise<string> {
  const me = await kit.api("GET", "/api/auth/me", { vault: v });
  return (me.zone as string | null) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

const projectTools: Tool[] = [
  tool({
    name: "project_list",
    description: withNote(
      "Every project — a folder holding a note with a `project:` in its frontmatter — with its status, colour, title, and how many of its tasks are in each status. Everything under the folder, subfolders included, is in the project.",
    ),
    write: false,
    input: { vault },
    run: async ({ vault: v }, kit) => {
      const got = await kit.api("GET", "/__board/list", { vault: v });
      const out = [];
      for (const [folder, note] of [...projectFolders(got.projects)].sort((a, b) => a[0].localeCompare(b[0]))) {
        const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        for (const [name, task] of Object.entries<any>(got.tasks))
          if (name.startsWith(`${folder}/`) && task.status in counts) counts[task.status]!++;
        out.push({
          folder,
          note,
          title: got.titles[note] ?? null,
          ...got.projects[note],
          tasks: counts,
          url: await kit.url(note, "note", v),
        });
      }
      return { projects: out };
    },
  }),
  tool({
    name: "project_create",
    description: withNote(
      "Make a folder a project: write its project note, titled `title` (the folder's name in words by default). The folder is made if it is not there, and everything in it, now or later, is in the project. `hue` is one of the ten colours. The note's body is the project's description: write it with `note_write`.",
    ),
    write: true,
    input: {
      folder: z.string(),
      title: z.string().optional(),
      status: z.enum(PROJECT_STATUSES).default("active"),
      hue: z.string().optional(),
      vault,
    },
    run: async ({ folder, title, status, hue, vault: v }, kit) => {
      kit.needWrite("make a project");
      const dir = folder.replace(/^\/+|\/+$/g, "");
      if (!dir) throw new ToolError("a project is a folder: name one — the top level cannot be a project");
      const got = await kit.api("GET", "/__board/list", { vault: v });
      const had = projectFolders(got.projects).get(dir);
      if (had) throw new ToolError(`\`${dir}\` is a project already: its note is \`${had}\``);
      const tint = hue === undefined ? undefined : hueOf(hue);
      if (hue !== undefined && !tint) throw new ToolError(`\`${hue}\` is not a hue: ${HUE_ORDER.join(", ")}`);
      const leaf = leafOf(dir).replace(/[-_]/g, " ").trim();
      const named = title ?? (leaf ? leaf[0]!.toUpperCase() + leaf.slice(1) : "Project");
      const change: Record<string, string | null> = { project: status, ...(tint ? { hue: tint } : {}) };
      const text = withProject(withTitle("", named, "note"), change);
      const made = await kit.api("POST", "/__board/create", {
        vault: v,
        body: { name: `${dir}/${titleStem(named) || "project"}`, text, kind: "note" },
      });
      return { folder: dir, name: made.name, id: made.id, project: change, url: await kit.url(made.name, "note", v) };
    },
  }),
  tool({
    name: "project_set",
    description: withNote(
      'Change a project\'s status or colour. Name it by its folder or its note.\n\n`status: "none"` makes the folder a plain folder again — the note stays, as a plain note. `hue` is one of the ten colours, or `"none"` to take it off.',
    ),
    write: true,
    input: { project: z.string(), status: z.enum([...PROJECT_STATUSES, "none"]).optional(), hue: z.string().optional(), vault },
    run: async ({ project, status, hue, vault: v }, kit) => {
      kit.needWrite("change a project");
      const got = await kit.api("GET", "/__board/list", { vault: v });
      // A plain note being made a project is named as itself: the route decides whether it can be.
      const note =
        project in got.projects ? project : (projectFolders(got.projects).get(project.replace(/^\/+|\/+$/g, "")) ?? project);
      const body: Record<string, unknown> = { name: note };
      if (status === "none") Object.assign(body, { status: null, hue: null });
      else if (status !== undefined) body.status = status;
      if (hue !== undefined && status !== "none") body.hue = hue === "none" ? null : hue;
      if (Object.keys(body).length === 1) throw new ToolError("say what to change: a `status`, a `hue`, or both");
      return kit.api("POST", "/__board/project", { vault: v, body });
    },
  }),
];

const findTools: Tool[] = [
  tool({
    name: "search",
    description: withNote(
      "Every place the words appear in the vault's boards, notes and quizzes, ranked — the page's own search. Every word must appear, every word is a prefix, a long word forgives a typo. A hit names its document and the `part` — an item id, a `^anchor` or `L<line>` — and its snippet marks the matched words with `**`.",
    ),
    write: false,
    input: { q: z.string(), limit: z.number().int().optional(), vault },
    run: ({ q, limit, vault: v }, kit) => kit.api("GET", "/__board/search", { vault: v, query: { q, limit } }),
  }),
  tool({
    name: "refs",
    description: withNote(
      "What refers to what. With a `name`: that document's references out, and its backlinks — every document that links to it or embeds it. With none: every document's references.\n\n" +
        "A reference is `[Title](dag:<id>)` in a note or on a board, an embed `![Title](dag:<id>)`; it names an id, so renaming or moving the target breaks nothing.",
    ),
    write: false,
    input: { name: z.string().optional(), kind: kindOf.default("board"), vault },
    run: async ({ name, kind, vault: v }, kit) => {
      if (name === undefined) return kit.api("GET", "/__board/index", { vault: v });
      return kit.api("GET", "/__board/refs", { vault: v, query: { name, kind } });
    },
  }),
  tool({
    name: "resolve",
    description: withNote("What a permanent id names — the `<id>` in `dag:<id>` — as `{id, name, kind}`."),
    write: false,
    input: { id: z.string(), vault },
    run: ({ id, vault: v }, kit) => kit.api("GET", "/__board/resolve", { vault: v, query: { id } }),
  }),
];

/**
 * A file fetched from `url` by the server, under `fetch.ts`'s rules and this vault's size limit
 * — or the bytes `data` already carries. Exactly one of the two.
 */
async function bytesFrom(
  kit: Kit,
  v: string | undefined,
  data: string | undefined,
  url: string | undefined,
): Promise<Fetched | null> {
  if ((data === undefined) === (url === undefined)) throw new ToolError("give exactly one of `data` and `url`");
  if (url === undefined) return null;
  const limits = ((await kit.api("GET", "/__board/files", { vault: v })) as { limits: { maxBytes: number } }).limits;
  try {
    return await fetchFile(url, { maxBytes: limits.maxBytes });
  } catch (e) {
    if (e instanceof FetchRefused) throw new ToolError(e.message);
    throw e;
  }
}

/** The extension a content type names, for a fetched file whose URL has none. */
function extFor(type: string): string | undefined {
  return Object.entries(MIME).find(([, m]) => m === type)?.[0];
}

const imageTools: Tool[] = [
  tool({
    name: "image_add",
    description: withNote(
      "Keep a picture in the vault. `data` is a `data:image/…;base64,…` URL, or plain base64 with `mime` saying what it is (`image/png`) — or, instead, `url`: an `https://` address the server fetches the picture from, so its bytes never pass through you. An address on this machine or a private network is refused.\n\n" +
        "It is stored as an attachment in the vault's attachments folder and referred to as `dag:<id>`. On a **board** it is placed too — an `image` item appended at `x`/`y` and `w` wide, on `page` — and the answer names the item. On a **note** or a **quiz** nothing is written: put `![what it shows](<src>)` where it belongs with `note_write`, using the `src` that comes back.",
    ),
    write: true,
    input: {
      name: z.string(),
      data: z.string().optional(),
      url: z.string().optional(),
      kind: z.enum(["board", "note", "quiz", "table"]).default("board"),
      mime: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      page: z.string().optional(),
      vault,
    },
    run: async ({ name, data, url, kind, mime, x, y, w, page, vault: v }, kit) => {
      kit.needWrite("add a picture");
      const got0 = await bytesFrom(kit, v, data, url);
      let dataUrl: string;
      if (got0) {
        const type = got0.contentType.startsWith("image/") ? got0.contentType : (mime ?? "");
        if (!type.startsWith("image/"))
          throw new ToolError(
            `\`${url}\` is not a picture (${got0.contentType || "no type given"}); say what it is with \`mime\`, or keep it with \`file_upload\``,
          );
        dataUrl = `data:${type};base64,${got0.data.toString("base64")}`;
      } else dataUrl = data!.startsWith("data:") ? data! : `data:${mime ?? "image/png"};base64,${data}`;
      if (kind !== "board") {
        const got = await kit.api("POST", "/__board/upload", { vault: v, query: { name, kind }, body: { dataUrl } });
        return { name, kind, ...got };
      }
      const body: Record<string, unknown> = { dataUrl };
      for (const [k, val] of Object.entries({ x, y, w, page })) if (val !== undefined) body[k] = val;
      const got = await kit.api("POST", "/__board/asset", { vault: v, query: { name }, body });
      return { name, kind, ...got, url: await kit.url(name, "board", v) };
    },
  }),
  tool({
    name: "image_get",
    description: withNote(
      "Look at a picture a board or a note keeps. `path` is the `src` exactly as the text writes it: `dag:<id>` for a picture kept as an attachment, or a path under a `<name>.assets/` folder — relative to the document `name` names, or to the top of the vault without one.",
    ),
    write: false,
    input: { path: z.string(), name: z.string().optional(), vault },
    run: async ({ path, name, vault: v }, kit) => {
      if (path.startsWith("dag:")) {
        const got = await kit.bytes("GET", "/__board/file", { vault: v, query: { id: path.slice(4) } });
        return pictureOf(got.data, got.mime, path);
      }
      let rel = path;
      if (name !== undefined) {
        const parts = [...name.split("/").slice(0, -1), ...path.split("/")];
        const out: string[] = [];
        for (const p of parts) {
          if (p === "..") out.pop();
          else if (p !== "." && p !== "") out.push(p);
        }
        rel = out.join("/");
        if (path.split("/").filter((p) => p === "..").length > name.split("/").length - 1)
          throw new ToolError("that `src` climbs out of the vault");
      }
      const got = await kit.bytes("GET", `/__board/assets/${rel.split("/").map(encodeURIComponent).join("/")}`, { vault: v });
      return pictureOf(got.data, got.mime, rel);
    },
  }),
  tool({
    name: "image_unused",
    description: withNote(
      "The pictures kept beside a board (in its `.assets/` folder) that no document's text names any more, and their size — what Settings' *Unused images* counts. Nothing is removed.",
    ),
    write: false,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => kit.api("GET", "/__board/assets/unused", { vault: v, query: { name } }),
  }),
  tool({
    name: "image_sweep",
    description: withNote(
      "Remove the pictures beside a board that no document's text names — `image_unused`'s list. A picture an undo would bring back is one of these, so only when the person asked.",
    ),
    write: true,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => {
      kit.needWrite("remove pictures");
      return kit.api("POST", "/__board/assets/sweep", { vault: v, query: { name } });
    },
  }),
];

const fileTools: Tool[] = [
  tool({
    name: "file_upload",
    description: withNote(
      "Keep a file — a PDF, a picture, a document, a sheet, slides, audio, video, an archive — as an attachment, listed with the boards and notes. `data` is its bytes as base64 (a `data:…;base64,…` URL is taken too) — or, instead, `url`: an `https://` address the server fetches it from, so its bytes never pass through you (an address on this machine or a private network is refused). `filename` is what it is called, extension and all (`Q3 Report.pdf`), which is what decides its type — with a `url` it defaults to the address's last segment; `folder` is where it goes, `\"\"` the top. What this vault accepts is `file_list`'s `limits`; anything else is refused, with why.\n\n" +
        'Refer to it from a note with `![Q3 Report.pdf](dag:<id>)` — drawn: a picture inline, anything else as a card — or `[Q3 Report.pdf](dag:<id>)`, a link; on a board a picture is an `image` fence with `src="dag:<id>"`. The `id` comes back, and `sha256`, the checksum of the bytes that arrived.',
    ),
    write: true,
    input: {
      filename: z.string().optional(),
      data: z.string().optional(),
      url: z.string().optional(),
      folder: z.string().default(""),
      title: z.string().optional(),
      vault,
    },
    run: async ({ filename, data, url, folder, title, vault: v }, kit) => {
      kit.needWrite("upload a file");
      const fetched = await bytesFrom(kit, v, data, url);
      let bytes: Buffer;
      let name = filename;
      if (fetched) {
        bytes = fetched.data;
        if (!name) {
          name = fetched.filename;
          const ext = extFor(fetched.contentType);
          if (ext && !/\.[A-Za-z0-9]{1,12}$/.test(name)) name = `${name || "download"}.${ext}`;
        }
        if (!name) throw new ToolError("the address names no file; say what it is called with `filename`");
      } else {
        if (!name) throw new ToolError("`filename` is what the file is called, extension and all");
        const raw = data!.startsWith("data:") && data!.includes(",") ? data!.split(",", 2)[1]! : data!;
        if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(raw)) throw new ToolError("`data` is not base64");
        bytes = Buffer.from(raw, "base64");
      }
      const got = await kit.api("POST", "/__board/file", { vault: v, query: { name, folder, title }, bytes });
      return { ...got, url: await kit.url(got.name, "file", v) };
    },
  }),
  tool({
    name: "file_list",
    description: withNote(
      "Every attachment — `{files: [{name, id, title, ext, mime, bytes}], limits: {maxBytes, types}}` — and what this vault accepts: the largest file, and the extensions.\n\n" +
        PAGE_NOTE,
    ),
    write: false,
    input: { ...pageArgs, vault },
    run: async ({ folder, limit, cursor, vault: v }, kit) => {
      const got = await kit.api("GET", "/__board/files", { vault: v });
      const byName = new Map((got.files as { name: string }[]).map((f) => [f.name, f]));
      const shown = page(byName.keys(), [], { folder, limit, cursor });
      return {
        files: shown.names.map((n) => byName.get(n)),
        limits: got.limits,
        total: shown.total,
        next_cursor: shown.next_cursor,
      };
    },
  }),
  tool({
    name: "file_get",
    description: withNote(
      "Look at an attachment, by `name` or by `id`: **a picture comes back as an image**, a text file (`.txt`, `.md`, `.csv`, `.json`) as its words, and anything else as what it is and the `url` the app opens it at — a PDF's pages and a spreadsheet's cells are not read here.",
    ),
    write: false,
    input: { name: z.string().optional(), id: z.string().optional(), vault },
    run: async ({ name, id, vault: v }, kit) => {
      if (!name && !id) throw new ToolError("name the file, or give its id");
      const listed = await kit.api("GET", "/__board/files", { vault: v });
      const info = (listed.files as any[]).find((f) => (name ? f.name === name : f.id === id));
      if (!info) throw new ToolError(`no file \`${name || id}\``);
      const got = await kit.bytes("GET", "/__board/file", { vault: v, query: { name: info.name } });
      if (got.mime.startsWith("image/") && !got.mime.includes("svg")) return pictureOf(got.data, got.mime, info.name);
      const out: Record<string, unknown> = {
        name: info.name,
        id: info.id,
        title: info.title,
        mime: got.mime,
        bytes: info.bytes,
        url: await kit.url(info.name, "file", v),
      };
      if (got.mime.startsWith("text/") || ["json", "md", "csv", "txt", "log", "tsv"].includes(info.ext)) {
        out.text = decoder.decode(got.data.slice(0, TEXT_CAP));
        out.truncated = got.data.length > TEXT_CAP;
      }
      return out;
    },
  }),
  tool({
    name: "file_rename",
    description: withNote(
      "Move or rename an attachment: `to` is its whole new name, folders and all — its extension is always its own, so `work/final` is `work/final.pdf`. Its id, and every reference to it, survive. To change only what it is called, `file_title`.",
    ),
    write: true,
    input: { name: z.string(), to: z.string(), vault },
    run: ({ name, to, vault: v }, kit) => docMove(kit, "file", name, to, false, v),
  }),
  tool({
    name: "file_duplicate",
    description: withNote("Copy an attachment: a new file, with an id of its own, called what the original is."),
    write: true,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => docMove(kit, "file", name, name, true, v),
  }),
  tool({
    name: "file_title",
    description: withNote(
      "Call an attachment something — what every list and card shows (`Q3 Report.pdf`). With `follow`, its file name follows the title, keeping its extension; open the `name` back.",
    ),
    write: true,
    input: { name: z.string(), title: z.string(), follow: z.boolean().default(true), vault },
    run: ({ name, title, follow, vault: v }, kit) => docTitle(kit, "file", name, title, follow, v),
  }),
  tool({
    name: "file_delete",
    description: withNote(
      "Delete an attachment: it goes to the trash, and `trash_restore` brings it back under its id. **`confirm` must be its name**, because until then every document that uses it shows it as missing — the answer lists those, and so does `refs` with the file's `name` before you ask. Only when the person asked.",
    ),
    write: true,
    input: { name: z.string(), confirm: z.string().default(""), vault },
    run: async ({ name, confirm, vault: v }, kit) => {
      kit.needWrite("delete a file");
      if (confirm !== name)
        throw new ToolError(`to delete \`${name}\`, pass \`confirm\` as its name; \`refs\` says what uses it first`);
      // A file that is not there is the delete's own 404 to say, below.
      const refs = await kit.api("GET", "/__board/refs", { vault: v, query: { name, kind: "file" } }).catch(() => null);
      const used = ((refs?.backlinks ?? []) as any[]).map((d) => ({ name: d.name, kind: d.kind, title: d.title ?? null }));
      const got = await docDelete(kit, "file", name, v);
      return { name, kind: "file", was_used_in: used, trash: got.trash };
    },
  }),
  tool({
    name: "component_delete",
    description: withNote(
      "Delete one of the person's saved components — the `saved` list `library` answers. Keeping one is `board_create` with a name under `components/`.",
    ),
    write: true,
    input: { name: z.string(), vault },
    run: ({ name, vault: v }, kit) => {
      kit.needWrite("delete a component");
      return kit.api("POST", "/__board/components/delete", { vault: v, body: { name } });
    },
  }),
];

/**
 * Which model a generation asks when the call names none: the person's choice (`dag:ai` in the app's
 * settings, #191), and — for a person whose app has not carried it over yet — the vault's old `llm`.
 */
async function llmChoice(kit: Kit, vault: string | undefined): Promise<Record<string, any>> {
  const app = ((await kit.api("GET", "/api/settings")).settings ?? {}) as Record<string, unknown>;
  try {
    const ai = typeof app["dag:ai"] === "string" ? JSON.parse(app["dag:ai"]) : null;
    if (ai?.llm && typeof ai.llm === "object") return ai.llm;
  } catch {
    /* A hand-edited value that is not JSON: as if there were none. */
  }
  const mine = (await kit.api("GET", "/api/vault/settings", { vault })).settings?.settings ?? {};
  return mine.llm && typeof mine.llm === "object" ? mine.llm : {};
}

/** A bundle with `change` merged in: a key set to null goes, and `settings` — the card's object — is merged a group at a time. */
function merged(held: Record<string, any> | null, change: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...(held ?? {}) };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete out[key];
    else if (key === "settings" && value && typeof value === "object" && out[key] && typeof out[key] === "object") {
      const groups = { ...out[key] };
      for (const [group, fields] of Object.entries<any>(value)) {
        groups[group] =
          fields && typeof fields === "object" && groups[group] && typeof groups[group] === "object"
            ? { ...groups[group], ...fields }
            : fields;
      }
      out[key] = groups;
    } else out[key] = value;
  }
  return out;
}

const grammarTools: Tool[] = [
  tool({
    name: "dsl_reference",
    description:
      "A cheat sheet. **With no `type` this lists the names**; pass one to get the text.\n\n" +
      "`common` is the statements every type shares and `edges` is the fence that joins two items; the rest are named for their type — `arch`, `erd`, `flow`, `state`, `activity`, `class`, `usecase`, `c4`, `sequence`, `mindmap`, `timeline`, `gitgraph`, `sketch`, `chart`.\n\n" +
      "Read `common` plus the one for your type before writing a fence body. These are the files that live beside the parsers, so they cannot be out of date with what the grammar accepts.",
    write: false,
    input: { type: z.string().optional() },
    run: ({ type }, kit) => kit.api("GET", "/__board/dsl", { query: { type } }),
  }),
  tool({
    name: "library",
    description: withNote(
      "Ready-made pieces, rendered as the text they become — plus this vault's saved ones.\n\n" +
        "Five layers: an **atom** is one statement, a **molecule** a container with something in it, a **pattern** several of those wired together, a **diagram** a whole board item, a **stack** several items. `type` narrows to one dialect, `id` fetches one blueprint, and `q` searches.\n\n" +
        '**Objects** are pictures to illustrate with — a person, a house, a book, a truck: one `sketch` `figure` each, a picture with its caption under it, about 1,700 of them. They are not listed unless `q` finds them (`q="truck"`); `objects` in the answer says how many there are and on which shelves.\n\n' +
        "Reach for one before writing from the cheat sheet, and prefer a *saved* component whose name matches what the person asked for — it is their own vocabulary.",
    ),
    write: false,
    input: { type: z.string().optional(), id: z.string().optional(), q: z.string().optional(), vault },
    run: ({ type, id, q, vault: v }, kit) => kit.api("GET", "/__board/library", { vault: v, query: { type, id, q } }),
  }),
  tool({
    name: "icons",
    description:
      "What `icon=` may say. About 4,500 names, so narrow with `q` rather than reading it all.\n\n" +
      "`mode` is how a name draws and is not inferable from its spelling: `brand` is the vendor's own colours on a neutral tile, `mono` a silhouette that takes the node's hue, `concept` a Lucide glyph. A truncated answer says so — compare `total` against `returned`.\n\n" +
      "The pictures are here too: every Unicode emoji, as `emoji:<name>` (`emoji:house`, `emoji:delivery-truck`) — in its own colours, or `mono:emoji:<name>` in the node's hue. A `sketch` `figure` draws one big with a caption under it; any card's `icon=` may wear one. `q=\"emoji:\"` narrows to them.",
    write: false,
    input: { q: z.string().optional(), mode: z.enum(["brand", "mono", "concept"]).optional() },
    run: ({ q, mode }, kit) => kit.api("GET", "/__board/icons", { query: { q, mode } }),
  }),
  tool({
    name: "llm",
    description:
      "Which model providers this machine could ask to draw, their models, and why one cannot — what `generate` may be pointed at. Never a key.\n\n" +
      "`fresh: true` asks every provider again instead of answering from the minute a yes is remembered for — after somebody signed in. `test` names one provider and makes one short call to it, so the answer says whether a model really answered (`ok`, `model`, `ms`) or why it did not; it spends a few tokens of the person's own key, so only when asked.",
    write: false,
    input: { fresh: z.boolean().optional(), test: z.string().optional() },
    run: ({ fresh, test }, kit) =>
      test
        ? kit.api("POST", "/__board/llm/test", { body: { provider: test } })
        : kit.api("GET", "/__board/llm", { query: { fresh: fresh ? "1" : undefined } }),
  }),
  tool({
    name: "generate",
    description: withNote(
      "Ask the model the person configured to draw a diagram — a prompt card's Generate. **It writes nothing**: the answer's `draft` is one checked fence, which you place with `board_patch` (`{insert: …}`) or use to replace an item's body.\n\n" +
        "`as_type` asks for a diagram type. With `source` — an item's body — it is a rewrite of that diagram rather than a new one, and `from_type` says its type. Provider, model and how hard it thinks are the person's settings unless given; `llm` lists what there is. It spends the person's own key, so only when asked — you can usually write the DSL yourself.\n\n" +
        "`kind: \"flashcards\"` asks for flashcards instead (`count` of them, 10 unless given, 30 at most): `prompt` is the topic — or, with `source` holding a note's text, what to focus on, and may then be empty. The answer's `cards` have each been read by the quiz parser as a flashcard; each one's `markdown` goes into a quiz with `quiz_question_set`, one at a time. Show the person the cards and add only the ones they keep.",
    ),
    // It writes no file, but it spends the person's money; --read-only is about files, so it is allowed.
    write: false,
    input: {
      prompt: z.string(),
      kind: z.enum(["diagram", "flashcards"]).optional(),
      count: z.number().int().optional(),
      as_type: z.string().optional(),
      source: z.string().optional(),
      from_type: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      reasoning: z.string().optional(),
      vault,
    },
    run: async ({ prompt, kind, count, as_type, source, from_type, provider, model, reasoning, vault: v }, kit) => {
      const chosen = await llmChoice(kit, v);
      const body: Record<string, unknown> = { prompt };
      for (const [k, val] of Object.entries({
        kind,
        count,
        as: as_type,
        source,
        from: from_type,
        provider: provider ?? chosen.provider,
        model: model ?? chosen.model,
        reasoning: reasoning ?? chosen.reasoning,
      })) {
        if (val !== undefined) body[k] = val;
      }
      return kit.api("POST", "/__board/generate", { vault: v, body });
    },
  }),
];

const appTools: Tool[] = [
  tool({
    name: "feedback",
    description:
      "Send the person's bug report or idea to AnyDag's maintainers: it becomes a **public** GitHub issue in `mouhcineToumi/anydag`. **Only when the person asked you to send feedback, in their words** — never on your own initiative, and never to report your own trouble with a tool.\n\n" +
      "`kind` is `bug` or `idea`; `text` is what happened or what they would like, in their words. `boards` and `notes` are names whose **whole text** is attached — only the ones they said to attach. `files` are up to five pictures, videos, PDFs or text files, each `{filename, data}` (base64) or `{filename, url}`; 10 MB in all. The app's version, system and arch go with it, and nothing else. Tell the person exactly what will be sent before you call this. The answer is the issue's `url`; a refusal says why, and nothing was sent.",
    write: true,
    input: {
      kind: z.enum(["bug", "idea"]),
      text: z.string(),
      boards: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
      files: z.array(z.object({ filename: z.string(), data: z.string().optional(), url: z.string().optional() })).default([]),
      vault,
    },
    run: async ({ kind, text, boards, notes, files, vault: v }, kit) => {
      kit.needWrite("send feedback");
      const sent: { name: string; type: string; data: string }[] = [];
      for (const f of files as { filename: string; data?: string; url?: string }[]) {
        const fetched = await bytesFrom(kit, v, f.data, f.url);
        const type = fetched?.contentType || MIME[extOf(f.filename)] || "application/octet-stream";
        const data = fetched ? Buffer.from(fetched.data).toString("base64") : f.data!;
        sent.push({ name: f.filename, type, data });
      }
      return kit.api("POST", "/api/feedback", { vault: v, body: { kind, text, boards, notes, files: sent } });
    },
  }),
  tool({
    name: "settings",
    description:
      "The person's preferences — or, with `set`, a change to them. **Only when they asked.**\n\n" +
      "`vault` level: the vault's own `settings.json` — `settings` (the settings card: `problems`, `paste`, `export`) and `dag:favourites`; travels with the vault's folder. `app` level: the person's, the same in every vault — `dag:theme`, `dag:ai` (a JSON string: `{llm: {provider, model, reasoning}, assistant: {provider, model}}` — which model a prompt card and a new Assistant chat use), how the window is laid out (`dag:library`, `dag:sidebar`, `dag:inspector-w` and the like) and `dag:time-zone`, the IANA zone times are read and written in. `set` merges keys into what is stored (`settings` a group at a time); a key set to null is removed. " +
      NOTE_VAULT,
    // Only a `set` writes; reading is allowed under --read-only.
    write: false,
    input: { level: z.enum(["vault", "app"]).default("vault"), set: z.record(z.string(), z.unknown()).optional(), vault },
    run: async ({ level, set, vault: v }, kit) => {
      const route = level === "app" ? "/api/settings" : "/api/vault/settings";
      const held = (await kit.api("GET", route, { vault: v })).settings as Record<string, any> | null;
      if (set === undefined) return { level, settings: held };
      kit.needWrite("change settings");
      const put = await kit.api("PUT", route, { vault: v, body: { settings: merged(held, set) } });
      return { level, ...put };
    },
  }),
  tool({
    name: "whoami",
    description:
      "What is answering: the AnyDag version, the vaults open (and which is the default, and so what a call with no `vault` is about), the time zone times are read in, whether this server is `read_only`, and whether it runs inside the app or on its own. There is no account: this is one person's machine.",
    write: false,
    input: {},
    run: async (_, kit) => {
      const health = await kit.api("GET", "/api/health");
      const listed = await kit.api("GET", "/api/vaults");
      const me = await kit.api("GET", "/api/auth/me");
      return {
        server: { version: health.version, via: kit.via },
        read_only: kit.readOnly,
        time_zone: me.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        vaults: (listed.vaults as any[])
          .filter((v) => v.open)
          .map((v) => ({ id: v.id, name: v.name, path: v.path, default: v.default })),
      };
    },
  }),
  tool({
    name: "vault_list",
    description:
      "Every vault this machine knows — a folder opened as a vault — newest first: `{id, name, path, open, default, missing}`. `open` ones are being served; `default` is the one a call with no `vault` is about; `missing` ones are on the list but their folder is gone. Every other tool's `vault` is an `id` from here.",
    write: false,
    input: {},
    run: (_, kit) => kit.api("GET", "/api/vaults"),
  }),
  tool({
    name: "vault_open",
    description:
      "Open a folder as a vault, or bring one already open to the front (it becomes the default). Nothing is written but `.anydag/vault.json`; an existing `.obsidian/` is never touched. A folder inside a vault, or holding one, is refused. Returns the vault's `id`.",
    write: true,
    input: { path: z.string() },
    run: ({ path }, kit) => {
      kit.needWrite("open a vault");
      return kit.api("POST", "/api/vaults/open", { body: { path } });
    },
  }),
  tool({
    name: "vault_create",
    description:
      "Make a folder called `name` inside `parent` and open it as a vault. Refused when something is already there. Returns the vault's `id`.",
    write: true,
    input: { parent: z.string(), name: z.string() },
    run: ({ parent, name }, kit) => {
      kit.needWrite("create a vault");
      return kit.api("POST", "/api/vaults/create", { body: { parent, name } });
    },
  }),
  tool({
    name: "vault_close",
    description:
      "Stop serving a vault. **Its folder is never deleted**; it stays on the recent list unless `forget` takes it off.",
    write: false,
    input: { id: z.string(), forget: z.boolean().default(false) },
    run: ({ id, forget }, kit) => kit.api("POST", "/api/vaults/close", { body: { id, forget } }),
  }),
];

/** The trash: what a delete moved aside, put back or deleted for good. */
const trashTools: Tool[] = [
  tool({
    name: "trash_list",
    description:
      "What is in the vault's trash, newest first: every file and folder deleted, each with its `id` (what `trash_restore` and `trash_delete` take), the `name` it had, its `kind`, when it was `deleted` and when it `expires` — gone for good — and for a folder what it `holds`. `days` is how long a thing stays.",
    write: false,
    input: { vault },
    run: ({ vault: v }, kit) => kit.api("GET", "/__board/trash", { vault: v }),
  }),
  tool({
    name: "trash_restore",
    description:
      "Put something back from the trash, where it was, with its id — so every reference to it works again. A name taken since is numbered: open the `name` that comes back. `id` is an entry's from `trash_list`.",
    write: true,
    input: { id: z.string(), vault },
    run: async ({ id, vault: v }, kit) => {
      kit.needWrite("restore from the trash");
      const got = await kit.api("POST", "/__board/trash/restore", { vault: v, body: { id } });
      if (got.kind === "folder") return got;
      return { ...got, url: await kit.url(got.name, got.kind, v) };
    },
  }),
  tool({
    name: "trash_delete",
    description:
      "Delete one thing in the trash **for good** — there is no way back from this. **Ask the person first**, and pass `confirm` as the entry's `name` exactly, from `trash_list`: that is their answer.",
    write: true,
    input: { id: z.string(), confirm: z.string(), vault },
    run: async ({ id, confirm, vault: v }, kit) => {
      kit.needWrite("delete from the trash");
      const held = await kit.api("GET", "/__board/trash", { vault: v });
      const entry = (held.entries as any[]).find((e) => e.id === id);
      if (!entry) throw new ToolError(`nothing in the trash is \`${id}\` — \`trash_list\` says what is`);
      if (confirm !== entry.name)
        throw new ToolError(
          `deleting \`${entry.name}\` for good cannot be undone: ask the person, and pass \`confirm\` as \`${entry.name}\``,
        );
      return kit.api("POST", "/__board/trash/delete", { vault: v, body: { id } });
    },
  }),
  tool({
    name: "trash_empty",
    description:
      "Delete **everything** in the trash for good — there is no way back from this. **Ask the person first**, and pass `confirm` as `empty the trash`: that is their answer. What went comes back as `ids`.",
    write: true,
    input: { confirm: z.string(), vault },
    run: ({ confirm, vault: v }, kit) => {
      kit.needWrite("empty the trash");
      if (confirm !== "empty the trash")
        throw new ToolError("emptying the trash cannot be undone: ask the person, and pass `confirm` as `empty the trash`");
      return kit.api("POST", "/__board/trash/empty", { vault: v });
    },
  }),
];

/**
 * Sync: what the vault's link says, and a sync now. Pairing and linking are not
 * tools — a passphrase is the person's, typed by them in Settings or a terminal.
 */
const syncTools: Tool[] = [
  tool({
    name: "sync_status",
    description:
      "Whether this vault syncs to a sync server, and how it is going: `state` (`idle`, `syncing`, `offline`, `paused` or `error`, with a `reason` for the last two, or `unlinked`), the `server`, the `remote` vault, this `device`, how many changes are `pending`, the `conflicts` copies written here, and the `last` time a pull and a push both finished. Linking is the person's to do, in Settings → Sync: it takes their passphrase.",
    write: false,
    input: { vault },
    run: ({ vault: v }, kit) => kit.api("GET", "/api/sync", { vault: v }),
  }),
  tool({
    name: "sync_now",
    description:
      "Pull what changed on the sync server and push what changed here, now — rather than waiting for the next change or poll — and answer the status once both finished. Changes files in the vault when another device changed them. Refused when the vault is not linked.",
    write: true,
    input: { vault },
    run: ({ vault: v }, kit) => {
      kit.needWrite("sync now");
      return kit.api("POST", "/api/sync/now", { vault: v });
    },
  }),
];

/**
 * Every tool, in the order the server lists them, the whole surface — the parity test reads the
 * names from here. What the MCP server *registers* is `listTools`'s, which the `cloud` switch
 * (`server/features.ts`) cuts to what the build carries.
 */
export const TOOLS: Tool[] = [
  ...boardTools,
  ...noteTools,
  ...templateTools,
  ...quizTools,
  ...quizMore,
  ...tableTools,
  ...taskTools,
  ...eventTools,
  ...projectTools,
  ...findTools,
  ...imageTools,
  ...fileTools,
  ...trashTools,
  ...syncTools,
  ...grammarTools,
  ...appTools,
];

/**
 * The tools that exist only when the build's `cloud` switch is on (`server/features.ts`): the ones
 * that reach an AnyDag server. `TOOLS` above stays the whole surface — the parity test and the
 * skill's check hold it — and `listTools` is what the MCP server registers, asked of the server the
 * tools run against (`GET /api/health`), so a client can never see a tool whose route is not there.
 */
const CLOUD = new Set(["sync_status", "sync_now", "feedback"]);

/** The tools to register: all of them, or only the ones the switch leaves. */
export function listTools(cloud: boolean): Tool[] {
  return cloud ? TOOLS : TOOLS.filter((t) => !CLOUD.has(t.name));
}
