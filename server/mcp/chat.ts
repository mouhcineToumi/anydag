/**
 * The MCP server a chat's harness runs (`anydag-server mcp --chat <id>`): the same
 * tools, plus two of its own.
 *
 * Every request carries `X-AnyDag-Chat`, and **the server enforces** the reach, the approvals and
 * the grants (`server/chat/live.ts`): what this file leaves out is to spare the model the schemas and a
 * refusal, never the only thing standing in the way.
 */

import { z } from "zod";

import { IMAGE_BY_URL, listTools, NOTE_VAULT, TOOLS, ToolError, type Tool } from "./tools";

/**
 * Never in a chat. Opening or making a vault reaches any folder the person can write to; a chat
 * reaches another vault by `vault_request` and the person's grant. The rest are the app's own
 * settings, a second model, sync, and the person's quiz record.
 */
export const NEVER_IN_CHAT = new Set([
  "vault_open",
  "vault_create",
  "vault_close",
  "settings",
  "llm",
  "generate",
  "sync_now",
  "sync_status",
  "quiz_answer",
  "quiz_threshold",
  "trash_empty",
  "file_upload",
]);

const changeBlock: Tool = {
  name: "change_block",
  description:
    'Start a new group of changes, titled with what it does ("Draw the login flow", "File the meeting notes under 2026/"). Every change after it, until the next change_block, is one block the person can undo in one click. Call it before each distinct group of changes.',
  write: true,
  input: { title: z.string().describe("What the changes in this block do, in a few words.") },
  async run(args: { title: string }, kit) {
    return kit.api("POST", "/__board/chat/block", { body: { title: args.title } });
  },
};

const vaultRequest: Tool = {
  name: "vault_request",
  description:
    "Ask the person to let this chat reach another open vault (ids from `vault_list`). Waits for their answer, up to five minutes. Say why in their terms. Ask for `edit` only if you need to change it.",
  write: false,
  input: {
    vault: z.string().describe("The vault's id, from vault_list."),
    why: z.string().describe("Why you need it, in one sentence the person reads."),
    mode: z.enum(["ask", "edit"]).optional().describe("`ask` to read it (the default), `edit` to change it too."),
  },
  async run(args: { vault: string; why: string; mode?: "ask" | "edit" }, kit) {
    return kit.api("POST", "/__board/chat/access", { body: { vault: args.vault, why: args.why, mode: args.mode ?? "ask" } });
  },
};

/* -- one tool per operation, with a kind ------------------------------------------------------ */

type DocKind = "board" | "note" | "quiz" | "table" | "file";
const ALL: DocKind[] = ["board", "note", "quiz", "table", "file"];
const TEXT: DocKind[] = ["board", "note", "quiz", "table"];

/**
 * The eight things every kind of document can have done to it, each one tool taking a `kind` rather
 * than five named `<kind>_<op>` — in a chat only, where every schema is input tokens on every
 * request (81 tools and about 15k tokens once; this is 52). An outside agent keeps the named
 * tools, whose names its client already knows. Each validates its arguments against the named
 * tool's own schema and runs it, so a default, a refusal and an answer are that tool's exactly.
 */
const DOC_OPS: { op: string; kinds: DocKind[]; description: string }[] = [
  {
    op: "list",
    kinds: ALL,
    description:
      "Every document of one `kind` in a vault, with its title and id, and every folder. For notes it also says which are tasks, projects and events. For quizzes, how many questions each asks. For files, each attachment's type and size, and what this vault accepts. `folder` narrows it to what is under that folder. It comes `limit` at a time (100, at most 500); `next_cursor` is the next page's `cursor`, and `total` says how many there are.",
  },
  {
    op: "read",
    kinds: TEXT,
    description:
      "One document's whole text, and the `base` (a sha1) a write of it must carry. An attachment is `file_get`.\n\n" +
      "- note: Markdown with optional frontmatter. A reference is `[Title](dag:<id>)`, an embed `![Title](dag:<id>)`; a `[[wikilink]]` is followed by name.\n" +
      "- quiz: a `##` heading per question, its options one checklist (`- [x]` right, `- [ ]` wrong), one `>` quote explaining. An option's indented lines, a code block included, are its own. A question with no checklist and a final `>` quote is answered in words.\n" +
      '- table: a `## Tab {#id}` heading per tab over a GFM pipe table; a header cell is `Name {#id type}` (text, number, date, checkbox, select `options="a,b"`, link), a row\'s first cell ends `{#id}`. `table_get` and `table_edit` work on cells.\n' +
      "- board: fenced diagrams; `board_fences` lists its items without the text.",
  },
  {
    op: "create",
    kinds: TEXT,
    description:
      "Make a document. The name is settled by the server and numbered if taken (`plan` becomes `plan-2`), so open the `name` that comes back. A `/` in `name` is its folder, made if missing. With a `title` (not for a board) the file is named after it; with neither text nor title it starts *Untitled*. Check a board with `board_diagnose` and a quiz with `quiz_check`.",
  },
  {
    op: "write",
    kinds: TEXT,
    description:
      "Replace a document's whole text, under the `base` from `doc_read`. Without one the write wins and throws away whatever a person changed meanwhile. With one, a document that moved answers a conflict carrying its new text: read it, redo the change, write again. Keep every `{#id}` and every fence's `#id`, because references, answers and cards name them. A board fence without one is given one, so take `base` from the answer. For part of a document the smaller writes are `board_patch`, `quiz_question_set` and `table_edit`.",
  },
  {
    op: "rename",
    kinds: ALL,
    description:
      "Rename or move a document: `to` is its whole new name, and a `/` in it is the folder it moves into. Its images go with it, and its id, so every reference to it survives. A file keeps its extension (`work/final` is `work/final.pdf`). Within one vault; `board_transfer` moves to another.",
  },
  {
    op: "duplicate",
    kinds: ALL,
    description:
      "Copy a document: a new one with an id of its own, numbered if `to` is taken. A file's copy is called what the original is and takes no `to`. Nothing answered in a quiz comes with its copy.",
  },
  {
    op: "delete",
    kinds: ALL,
    description:
      "Delete a document. It goes to the vault's trash, where `trash_restore` puts it back with its id for thirty days. A file needs `confirm` set to its name, because every document that uses it shows it as missing until it is back; `refs` with its name says which. Only when the person asked.",
  },
  {
    op: "title",
    kinds: ALL,
    description:
      "Call a document something: the `title:` line of its frontmatter and no other byte (an attachment's title is the vault's). With `follow` its file name follows the title, numbered if taken; open the `name` that comes back. Its id never changes.",
  },
];

const named = new Map(TOOLS.map((t) => [t.name, t]));

/** The `<kind>_<op>` tools the `doc_*` ones stand for, which a chat is not offered. */
const FOLDED = new Set(DOC_OPS.flatMap(({ op, kinds }) => kinds.map((k) => `${k}_${op}`)));

function docTool(op: string, kinds: DocKind[], description: string): Tool {
  const inners = kinds.map((k) => {
    const t = named.get(`${k}_${op}`);
    if (!t) throw new Error(`no tool ${k}_${op} for doc_${op}`);
    return t;
  });
  // Every argument any of them takes, each optional here; the named tool's own schema decides.
  const input: Record<string, z.ZodType> = { kind: z.enum(kinds as [DocKind, ...DocKind[]]).describe("What kind of document.") };
  for (const t of inners) for (const [k, v] of Object.entries(t.input)) if (!(k in input)) input[k] = (v as z.ZodType).optional();
  return {
    name: `doc_${op}`,
    description,
    write: inners.some((t) => t.write),
    input,
    async run({ kind, ...rest }: Record<string, unknown> & { kind: DocKind }, kit) {
      const inner = named.get(`${kind}_${op}`)!;
      const got = z.object(inner.input).safeParse(Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (!got.success)
        throw new ToolError(
          `doc_${op} for a ${kind}: ${got.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
        );
      return inner.run(got.data, kit);
    },
  };
}

const docTools = DOC_OPS.map(({ op, kinds, description }) => docTool(op, kinds, description));

/* Every named tool's description ends saying what `vault` is, which its argument and the chat's
   system prompt say already: in a chat that is a sentence per tool per request for nothing. */
const tail = `\n${NOTE_VAULT}`;
const brief = (t: Tool): Tool => (t.description.endsWith(tail) ? { ...t, description: t.description.slice(0, -tail.length) } : t);

/*
 * **A chat fetches nothing by URL** (#9). `image_add`'s `url` — and a `feedback` file's — has this
 * process fetch the address itself, so the request leaves the machine without passing the chat's
 * guard or an approval card, carrying whatever the agent put in it. The chat's kit refuses a `url`
 * (`Kit.noFetch`); here every `url` argument is taken out of the schemas too, at any depth, so the
 * model is never offered one to try.
 */
const hasUrl = (s: z.ZodType): boolean => {
  if (s instanceof z.ZodObject)
    return Object.entries(s.shape as z.ZodRawShape).some(([k, v]) => k === "url" || hasUrl(v as z.ZodType));
  if (s instanceof z.ZodArray) return hasUrl(s.element as z.ZodType);
  if (s instanceof z.ZodOptional || s instanceof z.ZodDefault) return hasUrl(s.unwrap() as z.ZodType);
  return false;
};

const urlless = (shape: z.ZodRawShape): z.ZodRawShape =>
  Object.fromEntries(
    Object.entries(shape)
      .filter(([k]) => k !== "url")
      .map(([k, v]) => [k, withoutUrl(v as z.ZodType)]),
  );

function withoutUrl(s: z.ZodType): z.ZodType {
  if (!hasUrl(s)) return s;
  let out: z.ZodType;
  if (s instanceof z.ZodObject) out = z.object(urlless(s.shape as z.ZodRawShape));
  else if (s instanceof z.ZodArray) out = z.array(withoutUrl(s.element as z.ZodType));
  else if (s instanceof z.ZodOptional) out = withoutUrl(s.unwrap() as z.ZodType).optional();
  else if (s instanceof z.ZodDefault) out = withoutUrl(s.unwrap() as z.ZodType).default(s.def.defaultValue as never);
  else return s;
  return s.description ? out.describe(s.description) : out;
}

const noUrl = (t: Tool): Tool =>
  hasUrl(z.object(t.input)) ? { ...t, input: urlless(t.input), description: t.description.replace(IMAGE_BY_URL, "") } : t;

/** The tools a chat is offered: every one the `cloud` switch leaves (`listTools`), but `NEVER_IN_CHAT` and the folded per-kind tools. */
export function chatTools(cloud: boolean): Tool[] {
  const allowed = (t: Tool) => !NEVER_IN_CHAT.has(t.name);
  const base = [
    ...docTools,
    ...listTools(cloud)
      .filter((t) => !FOLDED.has(t.name))
      .map(brief),
  ]
    .filter(allowed)
    .map(noUrl);
  return [...base, changeBlock, vaultRequest];
}
