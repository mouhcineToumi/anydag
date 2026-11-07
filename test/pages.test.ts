import { describe, expect, it } from "vitest";

import { dropBefore, reorderPages } from "@/board/pages";
import { applyPatch } from "@/board/patch";
import { parseBoard } from "@/board/parseBoard";
import type { BoardPage } from "@/board/types";

const P = (...ids: string[]): BoardPage[] => ids.map((id) => ({ id, name: id.toUpperCase() }));
const ids = (list: BoardPage[]) => list.map((p) => p.id);

describe("reorderPages", () => {
  it("moves a page in front of another", () => {
    expect(ids(reorderPages(P("a", "b", "c"), "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(reorderPages(P("a", "b", "c"), "a", "c"))).toEqual(["b", "a", "c"]);
  });

  it("moves a page to the end with a null target", () => {
    expect(ids(reorderPages(P("a", "b", "c"), "a", null))).toEqual(["b", "c", "a"]);
  });

  it("keeps every page, and only reorders", () => {
    const was = P("a", "b", "c", "d");
    const now = reorderPages(was, "b", null);
    expect(now).toHaveLength(4);
    expect(new Set(ids(now))).toEqual(new Set(ids(was)));
    expect(now.find((p) => p.id === "b")!.name).toBe("B");
  });

  /* Identity, not equality: `pages.reorder` skips the write on it, so a drop that asks for the
     order the board already has costs no round trip and lands no undo entry. */
  it("hands back the same array when nothing moves", () => {
    const was = P("a", "b", "c");
    expect(reorderPages(was, "a", "a")).toBe(was);
    expect(reorderPages(was, "a", "b")).toBe(was);
    expect(reorderPages(was, "c", null)).toBe(was);
    expect(reorderPages(was, "nope", "a")).toBe(was);
    expect(reorderPages(was, "a", "nope")).toBe(was);
  });
});

describe("dropBefore", () => {
  it("reads the half of the tab the pointer let go over", () => {
    const p = P("a", "b", "c");
    expect(dropBefore(p, "b", false)).toBe("b");
    expect(dropBefore(p, "b", true)).toBe("c");
    /* Past the last tab is the end of the list, which is a null rather than an id. */
    expect(dropBefore(p, "c", true)).toBe(null);
    expect(dropBefore(p, "nope", false)).toBe(null);
  });
});

describe("a reorder as a patch", () => {
  /*
   * The pages declared as bare strings is the case worth freezing: `parseBoard` assigns those ids
   * *positionally* (`page-${i+1}`), and the reorder writes the list back as objects. If the ids
   * travelled with the position rather than with the page, every item on the board would silently
   * change page the first time somebody dragged a tab.
   */
  it("moves no item when the frontmatter declared its pages as strings", () => {
    const text = [
      "---",
      "pages:",
      "  - Intro",
      "  - Detail",
      "---",
      "",
      "```md {#a page=page-2}",
      "on the second",
      "```",
      "",
      "```md {#b}",
      "on the first",
      "```",
      "",
    ].join("\n");

    const was = parseBoard("t", text);
    expect(was.pages).toEqual([
      { id: "page-1", name: "Intro" },
      { id: "page-2", name: "Detail" },
    ]);

    const next = reorderPages(was.pages, "page-2", "page-1");
    const r = applyPatch(text, [{ meta: { pages: next.map((p) => ({ id: p.id, name: p.name })) } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const now = parseBoard("t", r.text);
    expect(ids(now.pages)).toEqual(["page-2", "page-1"]);
    expect(now.pages[0]!.name).toBe("Detail");
    /* The items are where they were — the tabs moved, not the content. */
    expect(now.items.find((it) => it.id === "a")!.page).toBe("page-2");
    expect(now.items.find((it) => it.id === "b")!.page).toBe("page-1");
    expect(r.text).toContain("on the second");
  });
});

describe("an item that never named a page", () => {
  const declared = `---
title: Six pages
pages:
  - id: docs
    name: What the office produces
  - id: gap
    name: The gap matrix
---

\`\`\`md {#intro page=docs}
On the first page.
\`\`\`

\`\`\`image {#shot x=168 y=1792 w=948 src=b.assets/paste-6d5a1249.png}
\`\`\`
`;

  it("is on the first page, whatever that page is called — not a phantom `page-1`", () => {
    const b = parseBoard("b", declared);
    /* The defect: an image appended with no `page=` to a board declaring named pages drew in plain
       view *and* reported `unknown page \`page-1\``. It is the first page's, silently. */
    expect(b.errors).toEqual([]);
    expect(b.items.find((i) => i.id === "shot")?.page).toBe("docs");
    expect(b.items.find((i) => i.id === "intro")?.page).toBe("docs");
  });

  it("but a page it *names* and the board does not have is still an error", () => {
    const b = parseBoard("b", declared.replace("{#shot ", "{#shot page=nope "));
    expect(b.errors.map((e) => e.code)).toEqual(["EB_UNKNOWN_PAGE"]);
    /* Still drawn, on the first page, which is where a reader will find it. */
    expect(b.items.find((i) => i.id === "shot")?.page).toBe("docs");
  });

  it("and loose prose, which has no fence line to carry an attribute, is never the error", () => {
    const b = parseBoard("b", declared.replace("```image {#shot x=168 y=1792 w=948 src=b.assets/paste-6d5a1249.png}\n```", "Just a paragraph."));
    expect(b.errors).toEqual([]);
    expect(b.items.at(-1)?.page).toBe("docs");
  });

  it("leaves a board that declares no pages exactly as it was", () => {
    const b = parseBoard("b", "```md {#one}\nOne.\n```\n");
    expect(b.errors).toEqual([]);
    expect(b.pages).toEqual([{ id: "page-1", name: "Board" }]);
    expect(b.items[0]?.page).toBe("page-1");
  });
});
