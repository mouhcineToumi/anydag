import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardTree } from "@/board/useBoard";
import { afterQuickAdd, QuickAdd, TasksView, type QuickAddState } from "@/ui/Tasks";

/**
 * The Tasks page's quick add. What was silent or looked like a button is the whole of issue 80:
 * one labelled control, a title that survives a refusal, and an empty state that points at it.
 */

const EMPTY: BoardTree = {
  loaded: true,
  fresh: true,
  boards: [],
  folders: [],
  notes: [],
  titles: {},
  tasks: {},
  projects: {},
  events: {},
  created: {},
  ids: {},
  quizzes: [],
  questions: {},
  tables: [],
  files: [],
  sizes: {},
};

const typing = (title: string): QuickAddState => ({ title, problem: null });

describe("the New task box", () => {
  it("keeps the title and says why when a create is refused, and empties when it lands", () => {
    const refused = afterQuickAdd(typing("Ship the pricing page"), {
      error: "`con` is a name Windows reserves",
    });
    expect(refused).toEqual({ title: "Ship the pricing page", problem: "`con` is a name Windows reserves" });

    /* The lock's notice owns its own words; the box keeps what was typed so it can be retried. */
    expect(afterQuickAdd(typing("Ship the pricing page"), { locked: true })).toEqual({
      title: "Ship the pricing page",
      problem: null,
    });

    expect(afterQuickAdd(typing("Ship the pricing page"), { name: "ship-the-pricing-page" })).toEqual({
      title: "",
      problem: null,
    });
  });

  it("is one labelled row, and its placeholder says what Enter does", () => {
    const html = renderToStaticMarkup(createElement(QuickAdd, { status: "todo", into: "", locked: false }));
    expect(html).toContain('placeholder="New task — type a title and press Enter"');
    expect(html).toContain('aria-label="New task — type a title and press Enter"');
    expect(html).toMatch(/<label[^>]*class="dag-tasks__add-row"/);
    expect(html).toContain('data-dag-task-add-row="todo"');
    expect(html).toContain('data-dag-task-add="todo"');
  });

  it("leaves the empty state pointing at that same control", () => {
    const html = renderToStaticMarkup(createElement(TasksView, { list: EMPTY, layout: "list", onOpen: () => {} }));
    const empty = /<p[^>]*data-dag-tasks-empty[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(empty).toContain("+ New task");
    expect(empty).toContain("press Enter");
  });
});
