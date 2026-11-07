import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { boardCorpus, corpusTexts, noteCorpus } from "../src/search/corpus";

/**
 * What a search can find. A unit is something a result can open onto, so every one of
 * these is really a claim about a link: the part is what the page will look for, and the text is
 * what the person typed a word of.
 */

const BOARD = `---
title: Checkout
---

\`\`\`md {#intro x=0 y=0}
# Payments

We settle **every** order through \`stripe\`.
\`\`\`

\`\`\`arch {#flow title="Order flow" x=0 y=200}
service api "Orders API" "FastAPI"
db pg "Postgres"
api --> pg "writes"
\`\`\`

\`\`\`md {#secret hidden}
Nobody sees this.
\`\`\`

\`\`\`edges {#links}
intro --> flow
\`\`\`
`;

describe("a board", () => {
  const doc = boardCorpus(BOARD);

  it("is its title, and one unit per item, named by the item's id", () => {
    expect(doc.title).toBe("Checkout");
    expect(doc.units.map((u) => [u.part, u.what])).toEqual([
      [undefined, "title"],
      ["intro", "md"],
      ["flow", "arch"],
    ]);
  });

  it("reads Markdown as the words a person reads, code included", () => {
    expect(doc.units[1]!.text).toBe("Payments We settle every order through stripe.");
  });

  it("reads a diagram as every title, meta and label its parse draws", () => {
    const flow = doc.units.find((u) => u.part === "flow")!.text;
    for (const w of ["Order flow", "Orders API", "FastAPI", "Postgres", "writes"]) expect(flow).toContain(w);
  });

  it("leaves out what draws nothing: a hidden item and an edges fence", () => {
    expect(doc.units.some((u) => u.part === "secret" || u.part === "links")).toBe(false);
  });

  it("reads a sequence, a chart, a caption and a prompt", () => {
    const text = [
      "```sequence {#s}",
      'participant u "Shopper"',
      'u -> u "checks the basket"',
      "```",
      "",
      "```chart {#c}",
      "bar",
      "x Q1 Q2",
      'series web "Web revenue" 1 2',
      "```",
      "",
      "```image {#i src=x.png}",
      "The whiteboard photo",
      "```",
      "",
      "```prompt {#p}",
      "A browser talking to an API",
      "```",
      "",
    ].join("\n");
    const units = Object.fromEntries(boardCorpus(text).units.map((u) => [u.part, u.text]));
    expect(units.s).toContain("Shopper");
    expect(units.s).toContain("checks the basket");
    expect(units.c).toContain("Web revenue");
    expect(units.c).toContain("Q2");
    expect(units.i).toBe("The whiteboard photo");
    expect(units.p).toBe("A browser talking to an API");
  });
});

describe("a note", () => {
  const NOTE = "---\ntitle: Onboarding\n---\n# Week one\n\nMeet the team. ^meet\n\n- laptop\n- badge and keys\n\nPlain words.\n";
  const doc = noteCorpus(NOTE);

  it("is its title, then a unit per block — and per list item, which the editor holds as a block", () => {
    expect(doc.title).toBe("Onboarding");
    expect(doc.units.map((u) => u.what)).toEqual(["title", "heading", "paragraph", "list", "list", "paragraph"]);
  });

  it("names a block by its anchor when it has one, and never counts the anchor as a word", () => {
    const meet = doc.units.find((u) => u.text.startsWith("Meet"))!;
    expect(meet.part).toBe("^meet");
    expect(meet.text).toBe("Meet the team.");
  });

  it("names every other block by the line it starts on in the file, frontmatter counted", () => {
    const lines = NOTE.split("\n");
    for (const u of doc.units.filter((x) => x.part?.startsWith("L"))) {
      const n = Number(u.part!.slice(1));
      expect(lines[n - 1]!.replace(/^#+ |^- /, "")).toContain(u.text.split(" ")[0]!);
    }
    expect(doc.units.find((u) => u.text === "badge and keys")!.part).toBe("L9");
  });

  it("reads a table a cell at a time, rather than running the cells together", () => {
    const { units } = noteCorpus("| Name | Role |\n| - | - |\n| Ada | Lead |\n");
    expect(units[0]!.text).toBe("Name · Role Ada · Lead");
  });
});

describe("corpusTexts", () => {
  it("tells a note from a board by its key, as `Store.texts` keys them", () => {
    const out = corpusTexts({ plan: BOARD, "notes/n.note.md": "# Hello\n" });
    expect(out.plan!.units.some((u) => u.what === "arch")).toBe(true);
    expect(out["notes/n.note.md"]!.units).toEqual([{ part: "L1", what: "heading", text: "Hello" }]);
  });

  it("reads every board and note in the repository without throwing, and every part is a name a page can find", () => {
    const root = path.resolve(__dirname, "../boards");
    const texts: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!e.name.startsWith(".") && !e.name.endsWith(".assets")) walk(p);
        } else if (e.name.endsWith(".board.md")) texts[path.relative(root, p).slice(0, -".board.md".length)] = fs.readFileSync(p, "utf8");
        else if (e.name.endsWith(".note.md")) texts[path.relative(root, p)] = fs.readFileSync(p, "utf8");
      }
    };
    walk(root);
    expect(Object.keys(texts).length).toBeGreaterThan(10);
    for (const doc of Object.values(corpusTexts(texts)))
      for (const u of doc.units) {
        expect(u.text.length).toBeGreaterThan(0);
        if (u.part !== undefined) expect(u.part).toMatch(/^(\^[a-z0-9-]+|L\d+|[A-Za-z0-9_.-]+)$/);
      }
  });
});
