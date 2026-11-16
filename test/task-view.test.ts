import { describe, expect, it } from "vitest";

import type { Task } from "@/note/task";
import {
  compareRows,
  DEFAULT_DISPLAY,
  displayOf,
  displayText,
  dueBucket,
  filtersInUse,
  groupRows,
  NO_FILTERS,
  passes,
  toggleFilter,
  valueCounts,
  type ViewRow,
} from "@/ui/taskView";

/**
 * The Tasks page's Order, Display and Filter (#311): how the list is ordered, grouped and narrowed,
 * with no drawing in it. Today is fixed at 2026-11-15 throughout.
 */

const NOW = "2026-11-15";
const row = (title: string, task: Partial<Task>, project?: string): ViewRow => ({
  name: title.toLowerCase().replace(/\s+/g, "-"),
  title,
  task: { status: "todo", ...task },
  ...(project ? { project: { name: `${project.toLowerCase()}/${project.toLowerCase()}`, title: project } } : {}),
});
const titles = (rows: readonly ViewRow[]) => rows.map((r) => r.title);

describe("ordering", () => {
  const rows = [
    row("Alpha", { priority: "low", due: "2026-11-20", changed: 3 }),
    row("Bravo", { due: "2026-11-16", changed: 1 }, "Pricing"),
    row("Charlie", { priority: "urgent", changed: 2 }, "Atlas"),
    row("Delta", { priority: "high", due: "2026-11-16" }),
  ];

  it("puts the highest priority first, and a task with none after low either way", () => {
    expect(titles([...rows].sort(compareRows({ by: "priority", dir: "first" }, null)))).toEqual([
      "Charlie",
      "Delta",
      "Alpha",
      "Bravo",
    ]);
    expect(titles([...rows].sort(compareRows({ by: "priority", dir: "last" }, null)))).toEqual([
      "Alpha",
      "Delta",
      "Charlie",
      "Bravo",
    ]);
  });

  it("orders by date soonest first with the undated last, and breaks a tie with the second key", () => {
    expect(titles([...rows].sort(compareRows({ by: "due", dir: "first" }, null)))).toEqual([
      "Bravo",
      "Delta",
      "Alpha",
      "Charlie",
    ]);
    expect(titles([...rows].sort(compareRows({ by: "due", dir: "first" }, { by: "priority", dir: "first" })))).toEqual([
      "Delta",
      "Bravo",
      "Alpha",
      "Charlie",
    ]);
  });

  it("orders by project, newest change and title", () => {
    expect(titles([...rows].sort(compareRows({ by: "project", dir: "first" }, null)))).toEqual([
      "Charlie",
      "Bravo",
      "Alpha",
      "Delta",
    ]);
    expect(titles([...rows].sort(compareRows({ by: "changed", dir: "first" }, null)))).toEqual([
      "Alpha",
      "Charlie",
      "Bravo",
      "Delta",
    ]);
    expect(titles([...rows].sort(compareRows({ by: "title", dir: "last" }, null)))).toEqual([
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
  });
});

describe("grouping", () => {
  const rows = [
    row("Late", { due: "2026-11-10" }),
    row("Finished late", { status: "done", due: "2026-11-10" }),
    row("Now", { due: NOW, status: "in-progress" }),
    row("Soon", { due: "2026-11-22", priority: "high" }, "Atlas"),
    row("Far", { due: "2026-11-23" }, "Atlas"),
    row("Whenever", {}, "Pricing"),
  ];
  const byTitle = compareRows({ by: "title", dir: "first" }, null);

  it("buckets due dates: overdue, today, the next 7 days, later, a done task's past date, none", () => {
    expect(rows.map((r) => dueBucket(r.task, NOW))).toEqual(["overdue", "earlier", "today", "week", "later", "none"]);
  });

  it("gives a status its three groups and a priority its five, empty or not", () => {
    const status = groupRows(rows, "status", byTitle, NOW);
    expect(status.map((g) => [g.key, g.rows.length])).toEqual([
      ["in-progress", 1],
      ["todo", 4],
      ["done", 1],
    ]);
    const priority = groupRows(rows, "priority", byTitle, NOW);
    expect(priority.map((g) => g.label)).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);
    expect(titles(priority[1]!.rows)).toEqual(["Soon"]);
  });

  it("shows only the due and project groups something is in, the projects by title and None last", () => {
    expect(groupRows(rows, "due", byTitle, NOW).map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "Next 7 days",
      "Later",
      "Earlier",
      "No date",
    ]);
    const projects = groupRows(rows, "project", byTitle, NOW);
    expect(projects.map((g) => g.label)).toEqual(["Atlas", "Pricing", "No project"]);
    expect(titles(projects[0]!.rows)).toEqual(["Far", "Soon"]);
    expect(groupRows(rows, "none", byTitle, NOW)).toHaveLength(1);
  });
});

describe("filtering", () => {
  const rows = [
    row("A", { priority: "high" }, "Atlas"),
    row("B", { priority: "high", due: "2026-11-01" }),
    row("C", { status: "in-progress" }, "Atlas"),
    row("D", {}),
  ];

  it("keeps a row with any of a field's values, and every field in use must pass", () => {
    const high = toggleFilter(NO_FILTERS, "priority", "high");
    expect(titles(rows.filter((r) => passes(high, r, NOW)))).toEqual(["A", "B"]);
    const highOrNone = toggleFilter(high, "priority", "none");
    expect(titles(rows.filter((r) => passes(highOrNone, r, NOW)))).toEqual(["A", "B", "C", "D"]);
    const inAtlas = toggleFilter(highOrNone, "project", "atlas/atlas");
    expect(titles(rows.filter((r) => passes(inAtlas, r, NOW)))).toEqual(["A", "C"]);
    expect(filtersInUse(inAtlas)).toEqual(["priority", "project"]);
    expect(toggleFilter(inAtlas, "project", "atlas/atlas").project).toEqual([]);
  });

  it("counts each value with the other fields on and its own off", () => {
    const inAtlas = toggleFilter(toggleFilter(NO_FILTERS, "project", "atlas/atlas"), "priority", "high");
    expect(Object.fromEntries(valueCounts(rows, inAtlas, "priority", NOW))).toEqual({ high: 1, none: 1 });
    expect(Object.fromEntries(valueCounts(rows, inAtlas, "due", NOW))).toEqual({ none: 1 });
    expect(Object.fromEntries(valueCounts(rows, NO_FILTERS, "project", NOW))).toEqual({ "atlas/atlas": 2, "": 2 });
  });
});

describe("the display preference", () => {
  it("is grouped by status and ordered by due date until somebody says otherwise, and stores nothing then", () => {
    expect(displayOf(null)).toEqual(DEFAULT_DISPLAY);
    expect(DEFAULT_DISPLAY.group).toBe("status");
    expect(DEFAULT_DISPLAY.order.by).toBe("due");
    expect(displayText(DEFAULT_DISPLAY)).toBeNull();
  });

  it("reads back what it stored, and the default for anything it cannot read", () => {
    const mine = { ...DEFAULT_DISPLAY, group: "priority" as const, tie: null, hidden: ["changed" as const] };
    expect(displayOf(displayText(mine))).toEqual(mine);
    expect(displayOf("{not json")).toEqual(DEFAULT_DISPLAY);
    expect(displayOf(JSON.stringify({ group: "colour", order: { by: "mood" }, hidden: ["changed", "x"] }))).toEqual({
      ...DEFAULT_DISPLAY,
      hidden: ["changed"],
    });
  });
});
