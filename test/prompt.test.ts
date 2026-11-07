import { describe, expect, it } from "vitest";

import { applyPatch } from "@/board/patch";
import { parseBoard } from "@/board/parseBoard";
import { resizeOf } from "@/board/types";
import { CODES } from "@/dsl/codes";
import { replacement } from "@/edit/generate";

/**
 * The `prompt` card as a board item, and the one edit that ever happens to it: being replaced by the
 * diagram it asked for.
 */

const BOARD = [
  "---",
  "pages: [One, Two]",
  "---",
  "",
  "```md {#intro x=0 y=0}",
  "Hello",
  "```",
  "",
  "```prompt {#ask x=40 y=320 w=420 page=page-2 group=g1 as=arch}",
  "A web app talking to an API and a database.",
  "```",
  "",
  "```md {#after x=600 y=0}",
  "Bye",
  "```",
  "",
].join("\n");

describe("the prompt item", () => {
  it("parses as its own type, carrying the type it asks for and its text", () => {
    const b = parseBoard("t", BOARD);
    const card = b.items.find((it) => it.id === "ask")!;
    expect(card).toMatchObject({
      type: "prompt",
      as: "arch",
      body: "A web app talking to an API and a database.",
      page: "page-2",
    });
    expect(b.errors).toEqual([]);
  });

  it("drops an `as=` that is not a diagram type, with a warning, and stays a prompt", () => {
    const b = parseBoard("t", "```prompt {#p as=flowchart}\nx\n```\n");
    expect(b.items[0]).toMatchObject({ type: "prompt", as: undefined });
    expect(b.errors.map((e) => [e.code, e.severity])).toEqual([[CODES.WB_BAD_AS, "warn"]]);
  });

  it("resizes as a box, like a note", () => {
    expect(resizeOf("prompt")).toBe("box");
  });
});

describe("replacement", () => {
  const draft = { type: "arch" as const, attrs: { dir: "LR" }, body: 'service api "API"\ndb pg "Postgres"\napi --> pg' };

  it("puts the diagram exactly where the card was, and the card is gone", () => {
    const b = parseBoard("t", BOARD);
    const card = b.items.find((it) => it.id === "ask")!;
    const done = applyPatch(BOARD, replacement(card, draft, "arch-k3f9"));
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    const next = parseBoard("t", done.text);
    expect(next.errors).toEqual([]);
    expect(next.items.map((it) => it.id)).toEqual(["intro", "arch-k3f9", "after"]);
    const made = next.items[1]!;
    expect(made).toMatchObject({ type: "arch", x: 40, y: 320, page: "page-2", group: "g1", dir: "LR", body: draft.body });
    /* A text box's width is not a diagram's. */
    expect(made.w).toBeUndefined();
    expect(done.text).not.toContain("```prompt");
  });

  it("leaves an unpinned card's diagram unpinned, and names no page the card did not name", () => {
    const text = "```prompt {#ask}\nsomething\n```\n";
    const card = parseBoard("t", text).items[0]!;
    const done = applyPatch(text, replacement(card, draft, "arch-a1b2"));
    expect(done.ok && done.text).toBe('```arch {#arch-a1b2 dir=LR}\nservice api "API"\ndb pg "Postgres"\napi --> pg\n```\n');
  });
});
