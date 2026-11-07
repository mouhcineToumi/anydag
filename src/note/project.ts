/**
 * A project: a folder holding a note whose frontmatter has a `project:`.
 *
 * The task decision one level up. A task is a note with a `status:`; a project is a note with a
 * `project:`, and the folder it sits in is the project — so it has an id, a title, a description in
 * the block editor, references, backlinks, search and share because it is a note, and a folder
 * gains nothing it did not have. The value is the project's status; `hue:` beside it is its colour.
 *
 * **One parser reads a project**, this one — the page, the server, the CLI and the MCP tools all
 * import it — held to `test/fixtures/projects.json`. **Membership is a path**, computed here from the names the listing already has: a document is in a project when it
 * is under the project's folder, and nothing records it anywhere.
 *
 * No browser, no React, no `@/` aliases: the local server imports this through `src/refs/extract.ts`.
 */
import { parse as parseYaml } from "yaml";

import { HUE_ORDER, type Hue } from "../dsl/ir";
import { withKeys } from "./task";

/** The three a project can be. `active` is what *Make it a project* writes. */
export const PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_LABEL: Readonly<Record<ProjectStatus, string>> = { active: "Active", paused: "Paused", done: "Done" };

/** What a project is, off its note's frontmatter. `hue` is absent when it has none. */
export interface Project {
  status: ProjectStatus;
  hue?: Hue;
}

/** What a write asks for: a key left out stays as it is, `null` takes its line out. */
export interface ProjectChange {
  project?: ProjectStatus | null;
  hue?: Hue | null;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * A `project:` value, or `undefined` when it is not one of the three. Lenient in case and blanks
 * only — `project: yes` or `project: true` is somebody meaning something the three cannot hold,
 * and two parsers agreeing on a table of synonyms for ever is the cost `statusOf` refused too.
 */
export function projectStatusOf(raw: unknown): ProjectStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return (PROJECT_STATUSES as readonly string[]).includes(s) ? (s as ProjectStatus) : undefined;
}

/** A `hue:` value: one of the ten theme hues, or `undefined` — a colour the theme does not own is none. */
export function hueOf(raw: unknown): Hue | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return HUE_ORDER.includes(s) ? s : undefined;
}

/** The project a note's text describes, or `undefined` for a note that is not one. */
export function projectOf(text: string): Project | undefined {
  const m = FRONT.exec(text);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = parseYaml(m[1]!);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const fields = data as { project?: unknown; hue?: unknown };
  const status = projectStatusOf(fields.project);
  if (!status) return undefined;
  const hue = hueOf(fields.hue);
  return hue ? { status, hue } : { status };
}

/** `text` with its frontmatter's `project:` and `hue:` set as `change` asks — `withTask`'s rule. */
export function withProject(text: string, change: ProjectChange): string {
  return withKeys(text, change, ["project", "hue"]);
}

/** The folder a name is in, `""` at the top level. */
export const folderOf = (name: string): string => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");

/** Whether `name` is anywhere under `folder` — a file in it, or in a folder inside it. */
export const within = (name: string, folder: string): boolean => folder !== "" && name.startsWith(`${folder}/`);

/**
 * Every folder that is a project, with the note that makes it one: `folder → note name`.
 *
 * A folder's project is the project note **directly** in it, and the first by name when an agent
 * has written two — a deterministic answer rather than an error nobody would see. A project note
 * at the top level has no folder and makes nothing a project.
 */
export function projectFolders(projects: Readonly<Record<string, Project>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of Object.keys(projects).sort()) {
    const folder = folderOf(name);
    if (folder && !out.has(folder)) out.set(folder, name);
  }
  return out;
}

/**
 * The project a document belongs to — the note that names it — or `undefined`. The **innermost**:
 * a folder that is a project inside a folder that is a project is what names what is in it, which
 * is what a person nesting one meant. A project's own note is in its own project.
 */
export function projectFor(name: string, folders: ReadonlyMap<string, string>): string | undefined {
  for (let folder = folderOf(name); folder; folder = folderOf(folder)) {
    const note = folders.get(folder);
    if (note) return note;
  }
  return undefined;
}

/**
 * What a folder's project is called when *Make it a project* makes it: the folder's last part, as
 * words — `pricing-relaunch` is *Pricing relaunch*. The person renames it in the title field the
 * page opens on; this is only a better first answer than *Untitled*.
 */
export function folderTitle(folder: string): string {
  const leaf = folder.slice(folder.lastIndexOf("/") + 1);
  const words = leaf.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Project";
}

/** A project note's text as *Make it a project* writes it: a title and a status, and no body yet. */
export const projectText = (title: string): string => `---\ntitle: ${JSON.stringify(title)}\nproject: active\n---\n`;
