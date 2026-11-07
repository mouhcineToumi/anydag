import { within } from "../../src/note/project";
import { compareTasks, dueOf, statusOf, STATUS_LABEL, STATUSES, titleStem, type Task, type TaskStatus } from "../../src/note/task";

import { UsageError, bool, str } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import { docUrl, launch, appBase } from "./docs";
import { projectNamed, type Listed as ListedProjects } from "./projects";

/**
 * Tasks: a note whose frontmatter has a `status:`.
 *
 * A task *is* a note, so reading, writing, moving and deleting one are the `note` commands and are
 * not repeated here. What is here is what only a task has: the list the Tasks page draws, making a
 * note that starts as one, and the one route that changes a status or a due date without touching
 * anything else in the file.
 */

type Listed = ListedProjects;

/** A status off the command line, or a usage error naming the three. */
function statusArg(raw: string): TaskStatus {
  const s = statusOf(raw);
  if (!s) throw new UsageError(`\`${raw}\` is not a status: ${STATUSES.join(", ")}`);
  return s;
}

function dueArg(raw: string): string {
  const d = dueOf(raw);
  if (!d) throw new UsageError(`\`${raw}\` is not a date: write it YYYY-MM-DD`);
  return d;
}

/** The Tasks page's order: in progress, to do, done — each by due date, then by title. */
function ordered(listed: Listed): { name: string; task: Task; title: string }[] {
  return Object.entries(listed.tasks ?? {})
    .map(([name, task]) => ({ name, task, title: listed.titles?.[name] ?? name.slice(name.lastIndexOf("/") + 1) }))
    .sort(compareTasks);
}

async function setTask(ctx: Ctx, name: string, change: { status?: TaskStatus | null; due?: string | null; start?: string | null }): Promise<void> {
  const done = await ctx.api.post<{ name: string; task: Task | null }>("/__board/task", { name, ...change });
  emit(ctx, done, () => {
    const t = done.task;
    ctx.io.out(t ? `${done.name}  ${t.status}${t.start ? `  from ${t.start}` : ""}${t.due ? `  due ${t.due}` : ""}` : `${done.name}  not a task`);
  });
}

export const TASKS: Command[] = [
  {
    name: ["task", "ls"],
    args: "[<folder>]",
    summary: "every task, in the Tasks page's order — in progress, to do, done",
    flags: [
      { name: "status", type: "string", value: "<status>", help: "only these: todo, in-progress or done" },
      { name: "open", type: "boolean", help: "only what is not done" },
      { name: "project", type: "string", value: "<project>", help: "only the tasks in this project: its folder, or its note" },
    ],
    routes: ["GET /__board/list"],
    async run(ctx, p) {
      const listed = await ctx.api.get<Listed>("/__board/list");
      const under = p.pos[0]?.replace(/\/+$/, "");
      const only = str(p, "status");
      const status = only ? statusArg(only) : undefined;
      /* A project is its folder, nested projects' tasks included — the Tasks page's filter. */
      const named = str(p, "project");
      const scope = named ? projectNamed(listed, named).folder : undefined;
      const rows = ordered(listed).filter(
        (r) =>
          (!under || r.name.startsWith(`${under}/`)) &&
          (!scope || within(r.name, scope)) &&
          (!status || r.task.status === status) &&
          (!bool(p, "open") || r.task.status !== "done"),
      );
      emit(ctx, rows, () => {
        if (!rows.length) return ctx.io.err("no tasks");
        for (const line of table(rows.map((r) => [STATUS_LABEL[r.task.status], r.task.due ?? "", r.name, r.title]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["task", "new"],
    args: "<title>",
    min: 1,
    summary: "make a note that is a task; its file is named after the title",
    help:
      "The words are the task's title, and the file is named after them — `Ship the pricing page` is " +
      "`ship-the-pricing-page`, numbered if taken — in --folder when one is given. It starts as `todo` unless " +
      "--status says otherwise. Its description is the note's body: write it with `note write` or `note edit`.",
    flags: [
      { name: "folder", type: "string", value: "<folder>", help: "where it goes; made if it is not there" },
      { name: "status", type: "string", value: "<status>", help: "todo (the default), in-progress or done" },
      { name: "due", type: "string", value: "<YYYY-MM-DD>", help: "when it is due" },
      { name: "start", type: "string", value: "<YYYY-MM-DD>", help: "the day it begins — the calendar spans it to the due date" },
      { name: "open", type: "boolean", help: "open it in the browser afterwards" },
    ],
    routes: ["POST /__board/create"],
    async run(ctx, p) {
      const title = p.pos.join(" ").trim();
      if (!title) throw new UsageError("a task needs a title");
      const status = statusArg(str(p, "status") ?? "todo");
      const rawDue = str(p, "due");
      const due = rawDue ? dueArg(rawDue) : undefined;
      const rawStart = str(p, "start");
      const start = rawStart ? dueArg(rawStart) : undefined;
      /* Named after the title as `/retitle` names a file — a `/` in it is a character, never a folder. */
      const leaf = titleStem(title) || "untitled";
      const folder = str(p, "folder")?.replace(/^\/+|\/+$/g, "");
      const text = `---\ntitle: ${JSON.stringify(title)}\nstatus: ${status}\n${due ? `due: ${due}\n` : ""}${start ? `start: ${start}\n` : ""}---\n`;
      const made = await ctx.api.post<{ name: string; id: string; base: string }>("/__board/create", {
        name: folder ? `${folder}/${leaf}` : leaf,
        text,
        kind: "note",
      });
      const url = docUrl(await appBase(ctx), made.name, "note", false);
      emit(ctx, { ...made, task: { status, ...(due ? { due } : {}), ...(start ? { start } : {}) }, url }, () => {
        ctx.io.out(made.name);
        ctx.io.err(`made task ${made.name} (${STATUS_LABEL[status].toLowerCase()}${due ? `, due ${due}` : ""}) — ${url}`);
      });
      if (bool(p, "open")) launch(url);
    },
  },
  {
    name: ["task", "set"],
    args: "<name>",
    min: 1,
    summary: "change a task's status or dates, make a note a task, or make a task a note again",
    help:
      "Changes the `status:`, `due:` and `start:` lines of the note's frontmatter and nothing else, as the Tasks page " +
      "does. --status on a plain note makes it a task; --none takes all three out and leaves a plain note. A date " +
      "alone is refused on a note that is not a task yet, because a date is not what makes one.",
    flags: [
      { name: "status", type: "string", value: "<status>", help: "todo, in-progress or done" },
      { name: "due", type: "string", value: "<YYYY-MM-DD>", help: "when it is due" },
      { name: "no-due", type: "boolean", help: "take the due date off" },
      { name: "start", type: "string", value: "<YYYY-MM-DD>", help: "the day it begins — the calendar spans it to the due date" },
      { name: "no-start", type: "boolean", help: "take the start date off" },
      { name: "none", type: "boolean", help: "no longer a task: take the status and both dates off" },
    ],
    routes: ["POST /__board/task"],
    async run(ctx, p) {
      const change: { status?: TaskStatus | null; due?: string | null; start?: string | null } = {};
      if (bool(p, "none")) {
        change.status = null;
        change.due = null;
        change.start = null;
      }
      const s = str(p, "status");
      if (s) change.status = statusArg(s);
      const d = str(p, "due");
      if (d) change.due = dueArg(d);
      if (bool(p, "no-due")) change.due = null;
      const st = str(p, "start");
      if (st) change.start = dueArg(st);
      if (bool(p, "no-start")) change.start = null;
      if (!("status" in change) && !("due" in change) && !("start" in change)) {
        throw new UsageError("say what to change: --status, --due, --no-due, --start, --no-start or --none");
      }
      await setTask(ctx, p.pos[0]!, change);
    },
  },
  {
    name: ["task", "done"],
    args: "<name>",
    min: 1,
    summary: "mark a task done — `task set <name> --status done`",
    routes: ["POST /__board/task"],
    async run(ctx, p) {
      await setTask(ctx, p.pos[0]!, { status: "done" });
    },
  },
];
