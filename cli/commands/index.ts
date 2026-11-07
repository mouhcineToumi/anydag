import manifest from "../../docs/parity.json";
import type { Command } from "../context";
import { cliOutside, cliRefused } from "../parity";

import { APP } from "./app";
import { DOCS } from "./docs";
import { FILES } from "./files";
import { PICTURE } from "./picture";
import { SYNC } from "./sync";
import { TRASH } from "./trash";
import { VAULT } from "./vault";

/**
 * Every command, and the headings `anydag help` lists them under.
 *
 * The admin CLI: the vault first, because nothing else works before one is open, then the files as
 * whole documents, the trash, sync, the pictures and exports only a browser can make, and the
 * preferences. Everything finer than a whole file — an item, a card, a question, a cell — is the page's
 * and the MCP server's (`docs/parity.json`).
 */
export const COMMANDS: Command[] = [...VAULT, ...DOCS, ...FILES, ...TRASH, ...SYNC, ...PICTURE, ...APP];

/**
 * The routes no command reaches, in two sets read out of `docs/parity.json`: `REFUSED`, each with
 * the reason, and `OUTSIDE`, the routes of every feature the admin CLI does not carry — the page and
 * MCP reach those, and the CLI is not meant to. `test/cli-routes.test.ts` and `test/parity.test.ts`
 * hold the two halves: every route is reached by some command's `routes`, refused, or outside, and
 * nothing refused is also reached.
 */
export const REFUSED: Record<string, string> = cliRefused(manifest);
export const OUTSIDE: string[] = cliOutside(manifest);

export interface Group {
  name: string;
  title: string;
  blurb: string;
}

export const GROUPS: Group[] = [
  { name: "vault", title: "vault", blurb: "folders the app serves — every command takes --vault" },
  { name: "files", title: "files", blurb: "what there is" },
  { name: "board", title: "board", blurb: "a board as a file" },
  { name: "note", title: "note", blurb: "a note as a file" },
  { name: "quiz", title: "quiz", blurb: "a quiz as a file" },
  { name: "table", title: "table", blurb: "a table as a file" },
  { name: "file", title: "file", blurb: "attachments: any file, kept beside the boards and notes and referred to by id" },
  { name: "folder", title: "folder", blurb: "folders of boards, notes, tables and files" },
  { name: "trash", title: "trash", blurb: "what was deleted, kept for thirty days — restored, or deleted for good" },
  { name: "sync", title: "sync", blurb: "this vault's link to a sync server — end-to-end encrypted, the passphrase never an argument" },
  { name: "picture", title: "picture", blurb: "the laid-out page, in a browser: snapshots, tidy and exports" },
  { name: "app", title: "app", blurb: "preferences and logs" },
];
