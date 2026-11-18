/**
 * The answer shapes more than one family sends: a document's kind and name, a task, a project, an
 * event, a trash entry, the links a rename kept, an attachment, a grammar diagnostic. Each is what
 * the code that makes it returns (`server/vault.ts`, `src/note/*`, `server/trash.ts`,
 * `server/relink.ts`), and every one is held to the answers the suites record (`test/server/spec.ts`).
 */

import { z } from "zod";

import { HUE_ORDER } from "../../src/dsl/ir";
import { PROJECT_STATUSES } from "../../src/note/project";
import { PRIORITIES, STATUSES } from "../../src/note/task";
import { KINDS, TEXT_KINDS } from "../names";
import { about, named } from "./fields";

export const TextKind = named("TextKind", "A document with text: a board, a note, a quiz or a table.", z.enum(TEXT_KINDS));
export const AnyKind = named("Kind", "Any document: a text, or an attachment (`file`).", z.enum(KINDS));
export const Hue = named("Hue", "One of the ten hues a tag or a project is drawn in.", z.enum(HUE_ORDER));

/** The sha1 a text was read at: what a write sends back as its `base`. */
export const Sha1 = about("The sha1 of the text, which a write sends back as `base`.", z.string());

export const Named = named("Named", "A document, by its name and kind.", z.object({ name: z.string(), kind: TextKind }));

export const Task = named(
  "Task",
  "A note that is a task, as its frontmatter says, with what the listing knows beside it.",
  z.object({
    status: z.enum(STATUSES),
    due: about("`YYYY-MM-DD`.", z.string().optional()),
    start: about("`YYYY-MM-DD`.", z.string().optional()),
    priority: z.enum(PRIORITIES).optional(),
    items: about("Its check items: how many are ticked, of how many.", z.object({ done: z.int(), total: z.int() }).optional()),
    body: about("Present when the note has a body under its frontmatter.", z.literal(true).optional()),
    changed: about("The file's modified time, in ms.", z.number().optional()),
  }),
);

export const Project = named(
  "Project",
  "A note that is a project: its status, and its colour when it has one.",
  z.object({ status: z.enum(PROJECT_STATUSES), hue: Hue.optional() }),
);

export const NoteEvent = named(
  "Event",
  "A note that is an event: `start` and `end`, each a date (`YYYY-MM-DD`, all day) or a time with its offset.",
  z.object({ start: z.string(), end: z.string().optional() }),
);

export const Removed = named(
  "Removed",
  "What a folder held when it went, by kind, and every folder, itself included.",
  z.object({
    boards: z.array(z.string()),
    notes: z.array(z.string()),
    quizzes: z.array(z.string()),
    tables: z.array(z.string()),
    files: z.array(z.string()),
    folders: z.array(z.string()),
  }),
);

export const TrashEntry = named(
  "TrashEntry",
  "One thing in the trash: a document or a folder, kept until `expires`.",
  z.object({
    id: about("The entry's own id: what restore and delete name.", z.string()),
    name: z.string(),
    kind: z.enum([...KINDS, "folder"]),
    title: z.string().nullable(),
    deleted: z.string(),
    expires: z.string(),
    doc: about("The document's id, `null` for a folder or a document that had none.", z.string().nullable()),
    holds: about("What a folder held; `null` for a document.", Removed.nullable()),
  }),
);

export const Relinked = named(
  "Relinked",
  "The `[[wikilinks]]` a change of name kept pointing at the document: how many, in which files, and the files that kept changing and were not rewritten. `null` when the vault does not update links.",
  z
    .object({
      links: z.int(),
      files: z.array(Named),
      missed: z.array(Named),
    })
    .nullable(),
);

export const FileAnswer = named(
  "File",
  "An attachment.",
  z.object({
    name: z.string(),
    id: z.string().nullable(),
    title: z.string().nullable(),
    ext: z.string(),
    mime: z.string(),
    bytes: z.int(),
  }),
);

export const Diagnostic = named(
  "Diagnostic",
  "One thing the grammar says about a text. Branch on `code` (`docs/dsl/`), never on `message`.",
  z.looseObject({
    code: z.string(),
    severity: z.string(),
    line: z.int(),
    col: z.int().optional(),
    message: z.string(),
  }),
);

/** A text as it is now: what every write answers. */
export const Version = named(
  "Version",
  "The text as it is now, and its sha1 to send as the next write's `base`.",
  z.object({ base: Sha1, text: z.string() }),
);
