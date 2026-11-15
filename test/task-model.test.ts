import { describe, expect, it } from "vitest";

import { indexedTask, taskFactsOf } from "@/note/task";
import { dueText } from "@/ui/TaskGlyph";
import { compareRecent, countLine, onTab, sinceText, tabOf } from "@/ui/taskModel";

/**
 * The Tasks page's rules with no drawing in them (#311): what the listing counts off a task's body,
 * which tab a task is on, how a date and a last change are said, and what the count line says.
 */

describe("what the listing counts off a task's text", () => {
  it("counts check items ticked of all, and says there is a body", () => {
    const text = "---\nstatus: todo\n---\n## Steps\n\n- [x] one\n- [ ] two\n* [X] three\n1. [ ] four\n2) [x] five\n- not a box\n";
    expect(taskFactsOf(text)).toEqual({ body: true, items: { done: 3, total: 5 } });
  });

  it("says nothing of a quick task: no body, no items", () => {
    expect(taskFactsOf("---\nstatus: todo\ndue: 2026-11-12\n---\n")).toEqual({});
    expect(taskFactsOf("---\nstatus: todo\n---\n\n  \n")).toEqual({});
  });

  it("has a body with no check items, and gives no items then", () => {
    expect(taskFactsOf("---\nstatus: todo\n---\nWhy we are doing this.\n")).toEqual({ body: true });
  });

  it("does not count a check item inside a code fence, which is an example", () => {
    const text =
      "---\nstatus: todo\n---\n- [ ] real\n```md\n- [x] example\n- [ ] example\n```\n~~~\n- [ ] also\n~~~\n- [x] real too\n";
    expect(taskFactsOf(text).items).toEqual({ done: 1, total: 2 });
  });

  it("needs the space after the box, as GFM does", () => {
    expect(taskFactsOf("---\nstatus: todo\n---\n- [x]no\n- [ ]\n").items).toEqual({ done: 0, total: 1 });
  });

  it("is a task's frontmatter and its facts together, and nothing for a plain note", () => {
    expect(indexedTask("---\nstatus: done\ndue: 2026-11-12\n---\n- [x] a\n", 1_700_000_000_123.4)).toEqual({
      status: "done",
      due: "2026-11-12",
      body: true,
      items: { done: 1, total: 1 },
      changed: 1_700_000_000_123,
    });
    expect(indexedTask("---\ntitle: Plain\n---\n- [ ] a\n", 1)).toBeUndefined();
  });
});

describe("the tabs", () => {
  it("lists what is not done on Open, what is on Done, and everything on All", () => {
    expect(onTab("todo", "open")).toBe(true);
    expect(onTab("in-progress", "open")).toBe(true);
    expect(onTab("done", "open")).toBe(false);
    expect(onTab("done", "done")).toBe(true);
    expect(onTab("todo", "done")).toBe(false);
    expect(onTab("done", "all")).toBe(true);
  });

  it("reads a stored tab, and anything else as Open", () => {
    expect(tabOf("done")).toBe("done");
    expect(tabOf("all")).toBe("all");
    expect(tabOf(null)).toBe("open");
    expect(tabOf("board")).toBe("open");
  });

  it("orders the Done tab by what changed last, then by title", () => {
    const rows = [
      { title: "B", task: { status: "done" as const, changed: 10 } },
      { title: "A", task: { status: "done" as const, changed: 30 } },
      { title: "C", task: { status: "done" as const, changed: 10 } },
      { title: "D", task: { status: "done" as const } },
    ];
    expect(rows.sort(compareRecent).map((r) => r.title)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("the count line", () => {
  it("says how many are open and how many of them are late", () => {
    expect(countLine("open", { all: 13, shown: 13, late: 2 }, false)).toBe("13 open, 2 overdue");
    expect(countLine("open", { all: 13, shown: 13, late: 0 }, false)).toBe("13 open");
  });

  it("says how many the words leave of the tab's", () => {
    expect(countLine("open", { all: 13, shown: 3, late: 0 }, true)).toBe("3 of 13 open");
    expect(countLine("open", { all: 13, shown: 0, late: 0 }, true)).toBe("0 of 13 open");
  });

  it("never calls a done task overdue, and counts All as tasks", () => {
    expect(countLine("done", { all: 3, shown: 3, late: 1 }, false)).toBe("3 done");
    expect(countLine("all", { all: 16, shown: 16, late: 2 }, false)).toBe("16 tasks, 2 overdue");
    expect(countLine("all", { all: 1, shown: 1, late: 0 }, false)).toBe("1 task");
  });
});

describe("when a task last changed", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  it("is as few characters as a column holds", () => {
    expect(sinceText(now - 10_000, now)).toBe("now");
    expect(sinceText(now - 5 * 60_000, now)).toBe("5m");
    expect(sinceText(now - 2 * 3_600_000, now)).toBe("2h");
    expect(sinceText(now - 3 * 86_400_000, now)).toBe("3d");
    expect(sinceText(now - 15 * 86_400_000, now)).toBe("2w");
    expect(sinceText(now - 100 * 86_400_000, now)).toBe("3mo");
    expect(sinceText(now - 800 * 86_400_000, now)).toBe("2y");
  });

  it("calls a time in the future now, rather than a negative", () => {
    expect(sinceText(now + 60_000, now)).toBe("now");
  });
});

describe("a due date in words", () => {
  it("names the days either side of today", () => {
    expect(dueText("2026-11-15", "2026-11-15")).toBe("Today");
    expect(dueText("2026-11-16", "2026-11-15")).toBe("Tomorrow");
    expect(dueText("2026-11-14", "2026-11-15")).toBe("Yesterday");
  });

  it("gives the weekday within a week, the day further off, and the year when it is another", () => {
    const week = dueText("2026-11-12", "2026-11-15");
    expect(week).toMatch(/Thu/);
    expect(week).toMatch(/12/);
    expect(dueText("2026-11-25", "2026-11-15")).not.toMatch(/Wed/);
    expect(dueText("2027-01-03", "2026-11-15")).toMatch(/2027/);
  });
});
