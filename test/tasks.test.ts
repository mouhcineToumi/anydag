import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { splitNote } from "@/note/format";
import { indexTexts } from "@/refs/extract";
import { compareTasks, dueOf, nextStatus, overdue, STATUSES, statusOf, taskOf, titleStem, today, withTask, type TaskChange } from "@/note/task";

/**
 * What makes a note a task.
 *
 * The server's list route, the note page, a card on a board and the index all read it through
 * `src/note/task.ts`, held here to `test/fixtures/tasks.json` — so a note cannot be a task in the
 * sidebar and a plain note on the Tasks page.
 */
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tasks.json"), "utf8")) as {
  read: { why: string; text: string; task: { status: string; due?: string } | null }[];
  write: { why: string; text: string; set: TaskChange; out: string }[];
  stems: { why: string; title: string; stem: string }[];
};

describe("reading a task", () => {
  it.each(FIXTURE.read.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(taskOf(c.text) ?? null).toEqual(c.task);
  });
});

describe("writing a task", () => {
  it.each(FIXTURE.write.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withTask(c.text, c.set)).toBe(c.out);
  });

  it("writes what it reads back, for every status and with and without a due date", () => {
    for (const status of STATUSES) {
      for (const due of [undefined, "2026-10-03"]) {
        const text = withTask("---\ntitle: T\n---\nbody\n", { status, due: due ?? null });
        expect(taskOf(text)).toEqual(due ? { status, due } : { status });
        /* The note editor carries the frontmatter byte for byte and the body is the page's. */
        expect(splitNote(text).body).toBe("body\n");
        expect(splitNote(text).title).toBe("T");
      }
    }
  });

  it("works on a frontmatter alone, which is what the note page holds", () => {
    const front = splitNote("---\ntitle: T\n---\nbody").front;
    expect(withTask(front, { status: "todo" })).toBe("---\ntitle: T\nstatus: todo\n---\n");
    expect(withTask("", { status: "done" })).toBe("---\nstatus: done\n---\n");
    expect(withTask("---\nstatus: done\n---\n", { status: null })).toBe("");
  });
});

describe("the parts", () => {
  it("moves a status along the columns and from done back to the start", () => {
    expect(nextStatus("todo")).toBe("in-progress");
    expect(nextStatus("in-progress")).toBe("done");
    expect(nextStatus("done")).toBe("todo");
  });

  it("reads only strings", () => {
    expect(statusOf(undefined)).toBeUndefined();
    expect(statusOf(["todo"])).toBeUndefined();
    expect(dueOf(new Date())).toBeUndefined();
  });
});

describe("the index", () => {
  it("says which notes are tasks, and never a board, whatever its frontmatter says", () => {
    const got = indexTexts({
      "work/ship.note.md": "---\ntitle: Ship\nstatus: in-progress\ndue: 2026-10-03\n---\nbody\n",
      "idea.note.md": "---\ntitle: Idea\n---\n",
      plan: "---\ntitle: Plan\nstatus: todo\n---\n\n```md {#a}\nx\n```\n",
    });
    expect(got["work/ship.note.md"]!.task).toEqual({ status: "in-progress", due: "2026-10-03" });
    expect("task" in got["idea.note.md"]!).toBe(false);
    expect("task" in got.plan!).toBe(false);
  });
});

describe("the order and the date", () => {
  it("puts what is being worked on first, then by due date with no date last, then by title", () => {
    const rows = [
      { title: "b", task: { status: "todo" as const } },
      { title: "a", task: { status: "done" as const, due: "2026-01-01" } },
      { title: "c", task: { status: "todo" as const, due: "2026-10-03" } },
      { title: "d", task: { status: "in-progress" as const } },
      { title: "a", task: { status: "todo" as const } },
    ];
    expect([...rows].sort(compareTasks).map((r) => `${r.task.status}:${r.title}`)).toEqual([
      "in-progress:d",
      "todo:c",
      "todo:a",
      "todo:b",
      "done:a",
    ]);
  });

  it("is overdue only past its date and only while it is not done", () => {
    expect(today(new Date(2026, 8, 26))).toBe("2026-09-26");
    expect(overdue({ status: "todo", due: "2026-09-25" }, "2026-09-26")).toBe(true);
    expect(overdue({ status: "todo", due: "2026-09-26" }, "2026-09-26")).toBe(false);
    expect(overdue({ status: "done", due: "2026-09-25" }, "2026-09-26")).toBe(false);
    expect(overdue({ status: "todo" }, "2026-09-26")).toBe(false);
  });
});

describe("the name a task is filed under", () => {
  /* The stem a typed task is filed under. */
  it.each(FIXTURE.stems.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(titleStem(c.title)).toBe(c.stem);
  });
});
