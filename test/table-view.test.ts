// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CellView } from "@/view/TableRead";

/**
 * A table's cells as they are drawn. The read-only page, a card and a snapshot all draw with
 * `CellView`, and the editor's grid does too, so an empty cell has to be empty in all of them
 * rather than throw on the way to the page (issue #43).
 */

const draw = (text: string) => renderToStaticMarkup(createElement(CellView, { type: "date", text, options: [] }));

describe("a date cell", () => {
  it("draws an empty one empty, and does not throw", () => {
    expect(() => draw("")).not.toThrow();
    expect(draw("")).toBe("");
  });

  it("still draws a written day as words, in UTC", () => {
    const html = draw("2026-09-02");
    expect(html).toContain('class="dag-grid__value"');
    expect(html).toMatch(/datetime="2026-09-02"/i);
    expect(html).toContain("Sep 2, 2026");
  });

  it("still shows an unreadable day as written, with the unread marker", () => {
    const html = draw("2026-13-01");
    expect(html).toContain("data-dag-grid-unread");
    expect(html).toContain("2026-13-01");
    expect(html).not.toContain("<time");
  });
});
