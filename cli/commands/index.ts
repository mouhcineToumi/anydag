import manifest from "../../docs/parity.json";
import type { Command } from "../context";
import { cliRefused } from "../parity";

import { APP } from "./app";
import { ASSETS } from "./assets";
import { CHAT } from "./chat";
import { DOCS } from "./docs";
import { EVENTS } from "./events";
import { FILES } from "./files";
import { GRAMMAR } from "./grammar";
import { INSIDE } from "./inside";
import { ITEMS } from "./items";
import { MODELS } from "./models";
import { PICTURE } from "./picture";
import { PROJECTS } from "./projects";
import { QUIZ } from "./quiz";
import { REMOTE } from "./remote";
import { SYNC } from "./sync";
import { TABLE } from "./table";
import { TASKS } from "./tasks";
import { TRASH } from "./trash";
import { VAULT } from "./vault";

/**
 * Every command, and the headings `anydag help` lists them under.
 *
 * The order here is the order of the help: the vault first, because nothing else works before
 * one is open, then the files, then what is inside a board from the outside in — items, then the pages and
 * links between them, then what is inside one diagram.
 */
export const COMMANDS: Command[] = [...VAULT, ...DOCS, ...TASKS, ...EVENTS, ...PROJECTS, ...QUIZ, ...TABLE, ...FILES, ...TRASH, ...SYNC, ...REMOTE, ...CHAT, ...ITEMS, ...INSIDE, ...ASSETS, ...GRAMMAR, ...MODELS, ...PICTURE, ...APP];

/**
 * The routes no command reaches, each with the reason — read out of `docs/parity.json`,
 * where every feature says what reaches it from here or why nothing does. `test/cli-routes.test.ts`
 * and `test/parity.test.ts` hold the two halves: every route is reached by some command's `routes`
 * or is here, and nothing here is also reached.
 */
export const REFUSED: Record<string, string> = cliRefused(manifest);

export interface Group {
  name: string;
  title: string;
  blurb: string;
}

export const GROUPS: Group[] = [
  { name: "vault", title: "vault", blurb: "folders the app serves — every command takes --vault" },
  { name: "files", title: "files", blurb: "what there is, and what changes" },
  { name: "board", title: "board", blurb: "a board as a file" },
  { name: "note", title: "note", blurb: "a note as a file" },
  { name: "task", title: "task", blurb: "a note with a status — what the Tasks page lists" },
  { name: "event", title: "event", blurb: "a note with a start — what the calendar draws beside the tasks" },
  { name: "project", title: "project", blurb: "a folder with a note that says so — what the Tasks page filters by" },
  { name: "quiz", title: "quiz", blurb: "a quiz as a file, and the questions still in Mistakes" },
  { name: "table", title: "table", blurb: "a table as a file, and its cells, rows, columns and tabs by id" },
  { name: "file", title: "file", blurb: "attachments: any file, kept beside the boards and notes and referred to by id" },
  { name: "folder", title: "folder", blurb: "folders of boards, notes, tables and files" },
  { name: "trash", title: "trash", blurb: "what was deleted, kept for thirty days — restored, or deleted for good" },
  { name: "sync", title: "sync", blurb: "this vault's link to a sync server — end-to-end encrypted, the passphrase never an argument" },
  { name: "remote", title: "remote access", blurb: "whether a paired phone reaches the running app — the person's to turn on, never an agent's" },
  { name: "chat", title: "chat", blurb: "the Assistant: a conversation with a model that works on this vault — started, followed, approved and undone" },
  { name: "item", title: "item", blurb: "what is on a board — the gestures on the canvas" },
  { name: "page", title: "page", blurb: "a board's pages" },
  { name: "link", title: "link", blurb: "lines between items" },
  { name: "node", title: "node", blurb: "the cards inside one diagram — what picking a card reaches" },
  { name: "edge", title: "edge", blurb: "the edges inside one diagram" },
  { name: "row", title: "row", blurb: "a card's rows: columns, members" },
  { name: "chart", title: "chart", blurb: "a chart's own settings" },
  { name: "image", title: "image", blurb: "pictures kept beside a board or a note" },
  { name: "component", title: "component", blurb: "what you keep off your own boards" },
  { name: "grammar", title: "grammar", blurb: "what an author cannot invent" },
  { name: "models", title: "models", blurb: "asking a model to draw" },
  { name: "prompt", title: "prompt", blurb: "prompt cards" },
  { name: "picture", title: "picture", blurb: "the laid-out page, in a browser" },
  { name: "app", title: "app", blurb: "preferences" },
];
