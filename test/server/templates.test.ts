/** Note templates: the list, a note made from one, the starters, and what a template is left out of. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
let session: Session;
let app: ReturnType<typeof createApp>;

/* 2026-11-14 23:30 UTC — the 15th in Tokyo. */
const NOW = new Date(Date.UTC(2026, 10, 14, 23, 30, 0));

beforeEach(async () => {
  env = makeEnv();
  session = new Session(env.home, env.vault, "test");
  app = createApp({ session, token: "t", page: null });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  /* "Today" is the person's zone, not the machine's: pinned, so the suite reads the same everywhere. */
  await setting({ "dag:time-zone": "UTC" }, "/api/settings");
});
afterEach(async () => {
  vi.useRealTimers();
  await env.cleanup();
  sweepTemps();
});

const headers = { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" };
const url = (at: string) => `http://127.0.0.1${at}${at.includes("?") ? "&" : "?"}vault=${env.vault.id}`;
const get = async (at: string) => (await app.request(url(at), { headers })).json() as Promise<any>;
const post = (at: string, body: unknown) => app.request(url(at), { method: "POST", headers, body: JSON.stringify(body) });
const setting = (settings: Record<string, unknown>, at = "/api/vault/settings") =>
  app.request(url(at), { method: "PUT", headers, body: JSON.stringify({ settings }) });

const TASK = "---\nstatus: todo\ndue: {{date}}\n---\n# {{title}}\n";
const EVENT = "---\nstart: {{date}}\n---\nOn {{date}}.\n";

describe("the templates folder", () => {
  it("is none, and writes nothing, when the vault has no Templates folder", async () => {
    write(env.root, "plan.md", "# Plan\n");
    const got = await get("/__board/templates");
    expect(got).toEqual({ folder: null, configured: false, templates: [] });
    expect(fs.existsSync(path.join(env.root, "Templates"))).toBe(false);
    expect((await get("/__board/list")).templates).toBeNull();
  });

  it("defaults to Templates when that folder exists, and lists its notes by title with what each makes", async () => {
    write(env.root, "Templates/Meeting.md", "---\ntitle: Weekly {{date}}\n---\n# {{title}}\n");
    write(env.root, "Templates/Chore.md", TASK);
    write(env.root, "Templates/Trip.md", EVENT);
    write(env.root, "Templates/deep/Idea.md", "# {{title}}\n");
    write(env.root, "Notes/Elsewhere.md", "# not a template\n");
    const got = await get("/__board/templates");
    expect(got.folder).toBe("Templates");
    expect(got.configured).toBe(false);
    /* By the file's name — a template's own `title:` is the new note's, and may say `{{date}}`. */
    expect(got.templates).toEqual([
      expect.objectContaining({ name: "Templates/Chore", title: "Chore", makes: "task" }),
      expect.objectContaining({ name: "Templates/deep/Idea", title: "Idea", makes: "note" }),
      expect.objectContaining({ name: "Templates/Meeting", title: "Meeting", makes: "note" }),
      expect.objectContaining({ name: "Templates/Trip", title: "Trip", makes: "event" }),
    ]);
    const list = await get("/__board/list");
    expect(list.titles["Templates/Meeting"]).toBe("Meeting");
  });

  it("is the folder Settings names, and that wins over Templates", async () => {
    write(env.root, "Templates/A.md", "# a\n");
    write(env.root, "Notes/Tpl/B.md", "# b\n");
    expect((await setting({ "dag:templates": "/Notes/Tpl/" })).status).toBe(200);
    const got = await get("/__board/templates");
    expect(got.folder).toBe("Notes/Tpl");
    expect(got.configured).toBe(true);
    expect(got.templates.map((t: any) => t.name)).toEqual(["Notes/Tpl/B"]);
    /* A named folder that is not there yet holds nothing, and is not made. */
    await setting({ "dag:templates": "Nowhere" });
    expect((await get("/__board/templates")).templates).toEqual([]);
    expect(fs.existsSync(path.join(env.root, "Nowhere"))).toBe(false);
  });
});

describe("a template is no task, project or event", () => {
  it("is left out of the list's tasks, events and projects, and out of the index", async () => {
    write(env.root, "Templates/Chore.md", TASK.replace("{{date}}", "2026-12-01"));
    write(env.root, "Templates/Trip.md", EVENT.replace("{{date}}", "2026-12-02"));
    write(env.root, "Templates/Proj.md", "---\nproject: active\n---\n");
    write(env.root, "Real.md", "---\nstatus: todo\n---\n# real\n");
    const list = await get("/__board/list");
    expect(Object.keys(list.tasks)).toEqual(["Real"]);
    expect(list.events).toEqual({});
    expect(list.projects).toEqual({});
    expect(list.templates).toBe("Templates");
    /* Still listed: a template is an ordinary note in the sidebar. */
    expect(list.notes).toEqual(expect.arrayContaining(["Templates/Chore", "Templates/Trip", "Real"]));
    const index = (await get("/__board/index")).docs as any[];
    for (const name of ["Templates/Chore", "Templates/Trip", "Templates/Proj"]) {
      const d = index.find((x) => x.name === name);
      expect([d.task, d.event, d.project]).toEqual([null, null, null]);
    }
    expect(index.find((x) => x.name === "Real").task).toEqual({ status: "todo" });
  });

  it("is a task again the moment it is moved out of the folder, and not before the folder is named", async () => {
    write(env.root, "Chore.md", TASK.replace("{{date}}", "2026-12-01"));
    expect(Object.keys((await get("/__board/list")).tasks)).toEqual(["Chore"]);
    await setting({ "dag:templates": "" });
    fs.mkdirSync(path.join(env.root, "Templates"));
    fs.renameSync(path.join(env.root, "Chore.md"), path.join(env.root, "Templates", "Chore.md"));
    expect((await get("/__board/list")).tasks).toEqual({});
  });

  it("hears a changed setting at once: the list is told to read again", async () => {
    write(env.root, "Notes/Tpl/Chore.md", TASK.replace("{{date}}", "2026-12-01"));
    expect(Object.keys((await get("/__board/list")).tasks)).toEqual(["Notes/Tpl/Chore"]);
    const emit = vi.spyOn(env.vault, "emit");
    await setting({ "dag:templates": "Notes/Tpl" });
    expect(emit.mock.calls.map(([c]) => c.type)).toContain("tree");
    expect((await get("/__board/list")).tasks).toEqual({});
  });
});

describe("POST /__board/from-template", () => {
  it("fills the variables once, and files the note under its title", async () => {
    write(
      env.root,
      "Templates/Meeting.md",
      "---\nid: abcdefghij\ntags: [x]\n---\n# {{title}}\n\n{{date}} {{time}} {{date:dddd D MMMM}} {{unknown}} {{date:}}\n",
    );
    const res = await post("/__board/from-template", { template: "Templates/Meeting", title: "Q4 planning" });
    expect(res.status).toBe(200);
    const made = (await res.json()) as any;
    expect(made.name).toBe("Q4 planning");
    expect(made.text).toContain("# Q4 planning\n");
    expect(made.text).toContain("2026-11-14 23:30 Saturday 14 November {{unknown}} {{date:}}");
    expect(made.text).toContain("tags: [x]");
    /* The template's own id is not the note's. */
    expect(made.text).not.toContain("abcdefghij");
    expect(made.id).toMatch(/^[0-9a-z]{10}$/);
    expect(readText(env.root, "Q4 planning.md")).toBe(made.text);
    /* The template is as it was. */
    expect(readText(env.root, "Templates/Meeting.md")).toContain("{{title}}");
  });

  it("reads today in the person's zone", async () => {
    write(env.root, "Templates/Day.md", "{{date}} {{time}}\n");
    await setting({ "dag:time-zone": "Asia/Tokyo" }, "/api/settings");
    const made = (await (await post("/__board/from-template", { template: "Templates/Day", title: "d" })).json()) as any;
    expect(made.text).toContain("2026-11-15 08:30");
  });

  it("starts Untitled with no title, numbered when taken, and in the folder asked for", async () => {
    write(env.root, "Templates/Blank.md", "# {{title}}\n");
    const a = (await (await post("/__board/from-template", { template: "Templates/Blank" })).json()) as any;
    const b = (await (await post("/__board/from-template", { template: "Templates/Blank", folder: "work/" })).json()) as any;
    const c = (await (await post("/__board/from-template", { template: "Templates/Blank" })).json()) as any;
    expect([a.name, b.name, c.name]).toEqual(["Untitled", "work/Untitled", "Untitled 2"]);
    expect(a.text).toContain("# Untitled");
  });

  it("takes the title a template's frontmatter fills in, and lets a typed title win over it", async () => {
    write(env.root, "Templates/Daily.md", '---\ntitle: "{{date}}"\n---\n## {{date:dddd}}\n');
    const day = (await (await post("/__board/from-template", { template: "Templates/Daily" })).json()) as any;
    expect(day.name).toBe("2026-11-14");
    const typed = (await (await post("/__board/from-template", { template: "Templates/Daily", title: "Retro" })).json()) as any;
    expect(typed.name).toBe("Retro");
    expect(typed.text).not.toContain("2026-11-14\n---");
  });

  it("keeps a title with a colon a valid title in the frontmatter", async () => {
    write(env.root, "Templates/T.md", "---\ntitle: {{title}}\n---\nbody\n");
    const made = (await (await post("/__board/from-template", { template: "Templates/T", title: "Plan: Q4" })).json()) as any;
    const list = await get("/__board/list");
    expect(list.titles[made.name]).toBe("Plan: Q4");
  });

  it("makes a task, or an event, from a template that carries the line — and the template stays off the Tasks list", async () => {
    write(env.root, "Templates/Chore.md", TASK);
    write(env.root, "Templates/Trip.md", EVENT);
    const task = (await (await post("/__board/from-template", { template: "Templates/Chore", title: "Do it" })).json()) as any;
    const event = (await (await post("/__board/from-template", { template: "Templates/Trip", title: "Go" })).json()) as any;
    const list = await get("/__board/list");
    expect(list.tasks[task.name]).toEqual({ status: "todo", due: "2026-11-14" });
    expect(list.events[event.name]).toEqual({ start: "2026-11-14" });
    expect(Object.keys(list.tasks)).toEqual([task.name]);
    expect(Object.keys(list.events)).toEqual([event.name]);
  });

  it("refuses what is not a template, and a folder outside the vault", async () => {
    write(env.root, "Templates/A.md", "# a\n");
    write(env.root, "Notes/B.md", "# b\n");
    expect((await post("/__board/from-template", { template: "Notes/B" })).status).toBe(404);
    expect((await post("/__board/from-template", { template: "Templates/Missing" })).status).toBe(404);
    expect((await post("/__board/from-template", {})).status).toBe(404);
    expect((await post("/__board/from-template", { template: "Templates/A", folder: "../out" })).status).toBe(400);
    expect(
      fs
        .readdirSync(env.root)
        .filter((f) => f.endsWith(".md"))
        .sort(),
    ).toEqual([]);
  });
});

describe("POST /__board/templates/starters", () => {
  it("writes nothing until asked, then a meeting, a day and an ADR into Templates", async () => {
    write(env.root, "plan.md", "# Plan\n");
    await get("/__board/templates");
    await get("/__board/list");
    expect(fs.existsSync(path.join(env.root, "Templates"))).toBe(false);
    const got = (await (await post("/__board/templates/starters", {})).json()) as any;
    expect(got.folder).toBe("Templates");
    expect(got.created.sort()).toEqual(["Templates/ADR", "Templates/Daily", "Templates/Meeting"]);
    expect(got.skipped).toEqual([]);
    const list = await get("/__board/templates");
    expect(list.templates.map((t: any) => t.makes)).toEqual(["note", "note", "note"]);
    /* A starter made into a note is no task or event. */
    for (const t of list.templates as { name: string }[]) {
      const made = (await (await post("/__board/from-template", { template: t.name, title: `From ${t.name}` })).json()) as any;
      expect(made.text).not.toContain("{{");
    }
  });

  it("never writes over a file that is there, and goes where Settings says", async () => {
    await setting({ "dag:templates": "Tpl" });
    write(env.root, "Tpl/Meeting.md", "mine\n");
    const got = (await (await post("/__board/templates/starters", {})).json()) as any;
    expect(got.folder).toBe("Tpl");
    expect(got.skipped).toEqual(["Tpl/Meeting"]);
    expect(got.created.sort()).toEqual(["Tpl/ADR", "Tpl/Daily"]);
    expect(readText(env.root, "Tpl/Meeting.md")).toBe("mine\n");
    const again = (await (await post("/__board/templates/starters", {})).json()) as any;
    expect(again.created).toEqual([]);
    expect(again.skipped.sort()).toEqual(["Tpl/ADR", "Tpl/Daily", "Tpl/Meeting"]);
  });
});
