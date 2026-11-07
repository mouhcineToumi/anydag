import { HUE_ORDER } from "../../src/dsl/ir";
import {
  folderOf,
  folderTitle,
  hueOf,
  PROJECT_LABEL,
  PROJECT_STATUSES,
  projectFolders,
  projectStatusOf,
  projectText,
  within,
  withProject,
  type Project,
  type ProjectChange,
  type ProjectStatus,
} from "../../src/note/project";
import { titleStem, type Task } from "../../src/note/task";

import { UsageError, bool, str } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import { docUrl, launch, appBase } from "./docs";

/**
 * Projects: a folder holding a note whose frontmatter has a `project:`.
 *
 * A project *is* a note, so reading and writing its description are the `note` commands. What is
 * here is what only a project has: the list of them with what each holds, making a folder one, and
 * the one route that changes a project's status or colour without touching anything else. Which
 * tasks a project holds is `task ls --project`.
 */

export interface Listed {
  notes: string[];
  folders?: string[];
  titles?: Record<string, string>;
  tasks?: Record<string, Task>;
  projects?: Record<string, Project>;
}

function statusArg(raw: string): ProjectStatus {
  const s = projectStatusOf(raw);
  if (!s) throw new UsageError(`\`${raw}\` is not a project status: ${PROJECT_STATUSES.join(", ")}`);
  return s;
}

function hueArg(raw: string): string {
  const h = hueOf(raw);
  if (!h) throw new UsageError(`\`${raw}\` is not a hue: ${HUE_ORDER.join(", ")}`);
  return h;
}

const trim = (path: string): string => path.replace(/^\/+|\/+$/g, "");

/**
 * The project a word names: its folder, or its note. Either is what a person has to hand — the
 * folder is what the sidebar shows, the note is what `note cat` takes — so either is accepted.
 */
export function projectNamed(listed: Listed, word: string): { note: string; folder: string } {
  const owners = projectFolders(listed.projects ?? {});
  const path = trim(word);
  const byFolder = owners.get(path);
  if (byFolder) return { note: byFolder, folder: path };
  if (listed.projects?.[path] && owners.get(folderOf(path)) === path) return { note: path, folder: folderOf(path) };
  throw new UsageError(`\`${word}\` is not a project: \`anydag project ls\` lists them, and \`anydag project new <folder>\` makes one`);
}

async function setProject(ctx: Ctx, name: string, change: ProjectChange): Promise<void> {
  const body: Record<string, unknown> = { name };
  if ("project" in change) body.status = change.project ?? null;
  if ("hue" in change) body.hue = change.hue ?? null;
  const done = await ctx.api.post<{ name: string; project: Project | null }>("/__board/project", body);
  emit(ctx, done, () => {
    ctx.io.out(done.project ? `${done.name}  ${done.project.status}${done.project.hue ? `  ${done.project.hue}` : ""}` : `${done.name}  not a project`);
  });
}

export const PROJECTS: Command[] = [
  {
    name: ["project", "ls"],
    args: "",
    summary: "every project: its folder, status, colour and how many of its tasks are open",
    flags: [{ name: "status", type: "string", value: "<status>", help: "only these: active, paused or done" }],
    routes: ["GET /__board/list"],
    async run(ctx, p) {
      const listed = await ctx.api.get<Listed>("/__board/list");
      const only = str(p, "status");
      const status = only ? statusArg(only) : undefined;
      const tasks = Object.entries(listed.tasks ?? {});
      const rows = [...projectFolders(listed.projects ?? {})]
        .map(([folder, note]) => {
          const project = listed.projects![note]!;
          const mine = tasks.filter(([n]) => within(n, folder));
          return {
            folder,
            note,
            title: listed.titles?.[note] ?? note.slice(note.lastIndexOf("/") + 1),
            ...project,
            tasks: mine.length,
            open: mine.filter(([, t]) => t.status !== "done").length,
          };
        })
        .filter((r) => !status || r.status === status)
        .sort((a, b) => a.folder.localeCompare(b.folder));
      emit(ctx, rows, () => {
        if (!rows.length) return ctx.io.err("no projects");
        for (const line of table(rows.map((r) => [PROJECT_LABEL[r.status], r.hue ?? "", r.folder, r.title, `${r.open} open of ${r.tasks}`]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["project", "new"],
    args: "<folder>",
    min: 1,
    summary: "make a folder a project — its project note, titled after the folder",
    help:
      "Writes the folder's project note — `<folder>/<name>.note.md`, `project: active` — which is the whole of what " +
      "makes a folder a project. The folder is made if it is not there, and everything in it, now or later, is in " +
      "the project. The note's body is the project's description: write it with `note write` or `note edit`.",
    flags: [
      { name: "title", type: "string", value: "<title>", help: "what it is called; the folder's name in words by default" },
      { name: "status", type: "string", value: "<status>", help: "active (the default), paused or done" },
      { name: "hue", type: "string", value: "<hue>", help: `its colour: ${HUE_ORDER.join(", ")}` },
      { name: "open", type: "boolean", help: "open it in the browser afterwards" },
    ],
    routes: ["GET /__board/list", "POST /__board/create"],
    async run(ctx, p) {
      const folder = trim(p.pos[0]!);
      if (!folder) throw new UsageError("a project is a folder: name one — the top level cannot be a project");
      const listed = await ctx.api.get<Listed>("/__board/list");
      const had = projectFolders(listed.projects ?? {}).get(folder);
      if (had) throw new UsageError(`\`${folder}\` is a project already: its note is \`${had}\``);
      const title = str(p, "title")?.trim() || folderTitle(folder);
      const status = statusArg(str(p, "status") ?? "active");
      const rawHue = str(p, "hue");
      const change: ProjectChange = { project: status, ...(rawHue ? { hue: hueArg(rawHue) } : {}) };
      const text = withProject(projectText(title), change);
      const made = await ctx.api.post<{ name: string; id: string; base: string }>("/__board/create", {
        name: `${folder}/${titleStem(title) || "project"}`,
        text,
        kind: "note",
      });
      const url = docUrl(await appBase(ctx), made.name, "note", false);
      emit(ctx, { ...made, folder, project: { status, ...(change.hue ? { hue: change.hue } : {}) }, url }, () => {
        ctx.io.out(made.name);
        ctx.io.err(`made ${folder} a project (${PROJECT_LABEL[status].toLowerCase()}) — ${url}`);
      });
      if (bool(p, "open")) launch(url);
    },
  },
  {
    name: ["project", "set"],
    args: "<folder|note>",
    min: 1,
    summary: "change a project's status or colour, or make its folder a plain folder again",
    help:
      "Changes the `project:` and `hue:` lines of the project's note and nothing else. Name the project by its " +
      "folder or by its note. --none takes both lines out: the note stays, as a plain note, and the folder stops " +
      "being a project.",
    flags: [
      { name: "status", type: "string", value: "<status>", help: "active, paused or done" },
      { name: "hue", type: "string", value: "<hue>", help: `its colour: ${HUE_ORDER.join(", ")}` },
      { name: "no-hue", type: "boolean", help: "take the colour off" },
      { name: "none", type: "boolean", help: "no longer a project: take the status and the colour off" },
    ],
    routes: ["GET /__board/list", "POST /__board/project"],
    async run(ctx, p) {
      const change: ProjectChange = {};
      if (bool(p, "none")) {
        change.project = null;
        change.hue = null;
      }
      const s = str(p, "status");
      if (s) change.project = statusArg(s);
      const h = str(p, "hue");
      if (h) change.hue = hueArg(h);
      if (bool(p, "no-hue")) change.hue = null;
      if (!("project" in change) && !("hue" in change)) throw new UsageError("say what to change: --status, --hue, --no-hue or --none");
      const listed = await ctx.api.get<Listed>("/__board/list");
      await setProject(ctx, projectNamed(listed, p.pos[0]!).note, change);
    },
  },
];
