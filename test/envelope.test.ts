import { describe, expect, it } from "vitest";
import { importKind, openId, sealId } from "../src/board/envelope";

describe("the id envelope an export carries", () => {
  it("round-trips a board with no frontmatter byte for byte", () => {
    const text = "```md {#a}\nhi\n```\n";
    const sealed = sealId(text, "0123456789");
    expect(sealed.startsWith("---\nid: 0123456789\n---\n")).toBe(true);
    expect(openId(sealed)).toEqual({ text, id: "0123456789" });
  });

  it("round-trips a board with a frontmatter of its own", () => {
    const text = "---\ntitle: Plan\npages: [a, b]\n---\n\n```md {#a}\nhi\n```\n";
    const sealed = sealId(text, "abcdefghjk");
    expect(sealed).toContain("id: abcdefghjk\ntitle: Plan");
    expect(openId(sealed)).toEqual({ text, id: "abcdefghjk" });
  });

  it("replaces an id already sealed rather than stacking a second", () => {
    const once = sealId("x\n", "0123456789");
    const twice = sealId(once, "abcdefghjk");
    expect(twice.match(/^id:/gm)).toHaveLength(1);
    expect(openId(twice).id).toBe("abcdefghjk");
  });

  it("leaves a board with no envelope alone", () => {
    const text = "---\ntitle: t\n---\nx\n";
    expect(openId(text)).toEqual({ text });
  });
});

describe("importKind", () => {
  it("reads the kind off the name first, and a plain Markdown file with frontmatter is a board", () => {
    expect(importKind("drill.quiz.md", "## Q\n")).toBe("quiz");
    expect(importKind("Plan.NOTE.md", "---\ntitle: x\n---\n# Plan\n")).toBe("note");
    expect(importKind("plan.board.md", "")).toBe("board");
    expect(importKind("plan.md", "---\ntitle: x\n---\n")).toBe("board");
    expect(importKind("readme.md", "# Just text\n")).toBeNull();
  });

  it("does not take an exported note for a board, as both importers did before the quiz", () => {
    expect(importKind("onboarding.note.md", "---\nid: abcdefghjk\ntitle: Onboarding\n---\n")).toBe("note");
  });
});
