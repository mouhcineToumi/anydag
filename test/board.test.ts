import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseAttrs, serializeAttrs } from "@/board/attrs";
import { CODES, severityOf } from "@/dsl/codes";
import { rewriteFenceAttrs, scanFences } from "@/board/fences";
import { placeItems } from "@/board/flow";
import { parseBoard } from "@/board/parseBoard";
import { applyPatch } from "@/board/patch";

/**
 * The board layer: fences, attributes, auto-flow and the patch that writes back.
 *
 * None of it had a test. That was survivable while the file was read-only — a mistake showed up as
 * a diagram that looked wrong, which the screenshots caught. It stops being survivable the moment
 * the tool writes to a file a person also edits, because the failure mode changes from "renders
 * oddly" to "silently mangles the document".
 */

const BOARD = `---
title: A board
---

# Notes

\`\`\`md {#intro}
Some prose.
\`\`\`

\`\`\`arch {#infra x=40 y=80 title="What runs where" dir=LR}
service api "API"
\`\`\`

\`\`\`image {#shot w=520 src=demo.assets/a.png}
\`\`\`
`;

describe("attributes round-trip", () => {
  it("puts every key back in the order it was written", () => {
    const attrs = parseAttrs('#infra x=40 y=80 title="What runs where" dir=LR');
    expect(attrs.order).toEqual(["id", "x", "y", "title", "dir"]);
    expect(serializeAttrs(attrs)).toBe('#infra x=40 y=80 title="What runs where" dir=LR');
  });

  it("keeps a key it has never heard of", () => {
    const attrs = parseAttrs("#a owner=ops rank=3 draft");
    expect(serializeAttrs(attrs)).toBe("#a owner=ops rank=3 draft");
  });

  it("reads back a coordinate it wrote above the origin", () => {
    /* A drag can put an item at a negative x or y — the canvas has no corner — and `serializeAttrs`
       writes that back into the fence. Until the reader took a leading `-`, the patch turned a
       board file into one that no longer parsed. */
    const errors: { col: number; code: string; message: string }[] = [];
    const attrs = parseAttrs("#map x=-176 y=-8.5 w=520", errors as never);
    expect(errors).toEqual([]);
    expect(attrs.map.x).toBe(-176);
    expect(attrs.map.y).toBe(-8.5);
    expect(serializeAttrs(attrs)).toBe("#map x=-176 y=-8.5 w=520");
  });

  it("serialises without braces, because the fence line owns those", () => {
    expect(serializeAttrs(parseAttrs("#a"))).toBe("#a");
  });

  it("re-quotes a value that needs it", () => {
    const attrs = parseAttrs('#a title="two words"');
    expect(serializeAttrs(attrs)).toContain('title="two words"');
    expect(parseAttrs(serializeAttrs(attrs)).map.title).toBe("two words");
  });
});

describe("rewriting one fence", () => {
  it("touches nothing but the info string", () => {
    const fence = scanFences(BOARD).find((f) => f.attrText.includes("#infra"))!;
    const out = rewriteFenceAttrs(BOARD, fence, "#infra x=0 y=0")!;
    expect(out.split("\n").filter((l) => !l.startsWith("```arch"))).toEqual(
      BOARD.split("\n").filter((l) => !l.startsWith("```arch")),
    );
    expect(out).toContain("```arch {#infra x=0 y=0}");
  });

  it("reports rather than pretends when the offsets no longer land on a fence", () => {
    const fence = scanFences(BOARD).find((f) => f.attrText.includes("#infra"))!;
    expect(rewriteFenceAttrs("nothing like a board", fence, "#infra")).toBeNull();
  });
});

describe("a hostile line in a board (#9)", () => {
  /* The opener's pattern once had three `[ \t]*` side by side: an opener, a run of blanks and one
     stray character took cubic time — about ten seconds at this length, and hours at a few times it. */
  const hostile = [
    `\`\`\`${" ".repeat(4000)}!`,
    `\`\`\`md${" \t".repeat(2000)}!`,
    `\`\`\`md {${"} ".repeat(2000)}!`,
    `${"`".repeat(4000)}!`,
  ];

  it("scans an opener followed by thousands of blanks in linear time", () => {
    const text = ["```md", "hello", "```", ...hostile, "```md", "after", "```"].join("\n");
    const t = performance.now();
    const fences = scanFences(text);
    expect(performance.now() - t).toBeLessThan(250);
    expect(fences.map((f) => f.body)).toEqual(["hello", "after"]);
  });

  it("still reads every opener it read before", () => {
    const opener = (line: string) => scanFences(`${line}\nx\n\`\`\``).find((f) => f.line === 1);
    expect(opener("```")).toMatchObject({ type: "", attrText: "" });
    expect(opener("  ```md  ")).toMatchObject({ type: "md", attrText: "" });
    expect(opener("```md{#a}")).toMatchObject({ type: "md", attrText: "#a" });
    expect(opener('````arch \t {#a title="}"}\t')).toMatchObject({ type: "arch", attrText: '#a title="}"' });
    expect(opener("``` {#a} ")).toMatchObject({ type: "", attrText: "#a" });
    expect(opener("```md x")).toBeUndefined();
    expect(opener("```md {#a} b")).toBeUndefined();
  });

  it("does not hand a line longer than any opener to the pattern", () => {
    const long = `\`\`\`md {#a title="${"x".repeat(20_000)}"}`;
    expect(scanFences(`${long}\nbody\n\`\`\``).filter((f) => f.line === 1)).toEqual([]);
    expect(rewriteFenceAttrs(long, { openStart: 0, openEnd: long.length } as never, "#b")).toBeNull();
  });
});

describe("applyPatch", () => {
  it("pins an item that had no position", () => {
    const out = applyPatch(BOARD, [{ id: "intro", attrs: { x: 100, y: 200 } }]);
    expect(out.ok && out.text).toContain("```md {#intro x=100 y=200}");
  });

  it("moves one that had one, in place", () => {
    const out = applyPatch(BOARD, [{ id: "infra", attrs: { x: 0, y: 8 } }]);
    expect(out.ok && out.text).toContain('```arch {#infra x=0 y=8 title="What runs where" dir=LR}');
  });

  it("unpins", () => {
    const out = applyPatch(BOARD, [{ id: "infra", attrs: { x: null, y: null } }]);
    expect(out.ok && out.text).toContain('```arch {#infra title="What runs where" dir=LR}');
  });

  it("applies several ops to one file without shifting each other's offsets", () => {
    const out = applyPatch(BOARD, [
      { id: "intro", attrs: { x: 0, y: 0 } },
      { id: "infra", attrs: { x: 640, y: 0 } },
      { id: "shot", attrs: { x: 0, y: 480 } },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#intro x=0 y=0}");
    expect(out.text).toContain('```arch {#infra x=640 y=0 title="What runs where" dir=LR}');
    expect(out.text).toContain("```image {#shot w=520 src=demo.assets/a.png x=0 y=480}");
    /* Every fence still parses, and nothing outside the three info strings moved. `md-1` is the
       loose prose above the first fence, which the board format promotes to an item of its own. */
    expect(parseBoard("t", out.text).items.map((i) => i.id)).toEqual(["md-1", "intro", "infra", "shot"]);
    expect(out.text).toContain("# Notes");
    expect(out.text).toContain("Some prose.");
  });

  it("refuses the whole patch when any id is unknown", () => {
    const out = applyPatch(BOARD, [
      { id: "intro", attrs: { x: 1 } },
      { id: "nope", attrs: { x: 1 } },
    ]);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain("nope");
  });

  it("is a no-op for a value that is already set", () => {
    const out = applyPatch(BOARD, [{ id: "infra", attrs: { x: 40, y: 80 } }]);
    expect(out.ok && out.text).toBe(BOARD);
  });
});

describe("auto-flow", () => {
  const board = parseBoard("t", BOARD);
  const place = () => placeItems(board, "page-1", new Map());

  it("treats an item with either coordinate as pinned", () => {
    const placed = place();
    expect(placed.get("infra")!.pinned).toBe(true);
    expect(placed.get("intro")!.pinned).toBe(false);
  });

  /*
   * The rule the drag write-back has to work around.
   *
   * Pinning one item on a board that had none moves every other item on it, because the flow
   * starts below the lowest pin rather than packing into the gaps. So a first drag cannot patch
   * only the item that was dragged — see `App`, which pins the whole visible set in one op.
   */
  it("flows unpinned items below every pinned one", () => {
    const placed = place();
    const pinned = [...placed.values()].filter((p) => p.pinned);
    const loose = [...placed.values()].filter((p) => !p.pinned);
    const bottom = Math.max(...pinned.map((p) => p.y + p.h));
    for (const p of loose) expect(p.y).toBeGreaterThanOrEqual(bottom);
  });
});

describe("layout attributes on the fence", () => {
  const board = (info: string) => parseBoard("t", `---\ntitle: t\n---\n\n\`\`\`arch {${info}}\nservice a "A"\n\`\`\`\n`);

  it("reads a wrap target the theme would otherwise decide", () => {
    expect(board("#d aspect=0").items[0]?.aspect).toBe(0);
    expect(board("#d aspect=2.4").items[0]?.aspect).toBe(2.4);
  });

  it("leaves aspect absent when nothing said one, so the theme still owns it", () => {
    expect(board("#d").items[0]?.aspect).toBeUndefined();
  });

  it("refuses an aspect that is not a number, or is negative", () => {
    expect(board("#d aspect=wide").errors[0]?.code).toBe(CODES.EB_BAD_ASPECT);
    expect(board("#d aspect=-1").errors[0]?.code).toBe(CODES.EB_BAD_ASPECT);
  });

  /* Both change the layout without changing a character of the DSL, and the layout cache is keyed
     on the hash — so a hash that ignored them served the previous layout back. */
  it("keys the layout cache on dir and aspect, not just the body", () => {
    const h = (info: string) => board(info).items[0]?.hash;
    expect(h("#d")).not.toBe(h("#d dir=TB"));
    expect(h("#d")).not.toBe(h("#d aspect=0"));
    expect(h("#d aspect=0")).not.toBe(h("#d aspect=1.6"));
  });
});

describe("an item's own hue", () => {
  const note = (info: string) => parseBoard("t", `---\ntitle: t\n---\n\n\`\`\`md {${info}}\nHello\n\`\`\`\n`);

  it("reads a hue from HUE_ORDER", () => {
    expect(note("#n hue=teal").items[0]?.hue).toBe("teal");
    expect(note("#n hue=coral").items[0]?.hue).toBe("coral");
  });

  it("leaves hue absent when nothing said one", () => {
    expect(note("#n").items[0]?.hue).toBeUndefined();
  });

  it("drops an unknown hue and warns, rather than failing the parse", () => {
    const b = note("#n hue=purple");
    expect(b.items[0]?.hue).toBeUndefined();
    expect(b.items[0]?.type).toBe("md");
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]?.code).toBe(CODES.WB_BAD_HUE);
    expect(b.errors[0]?.severity).toBe("warn");
  });

  it("does not key the layout cache on hue — colour only, no layout", () => {
    expect(note("#n").items[0]?.hash).toBe(note("#n hue=teal").items[0]?.hash);
  });

  it("round-trips through applyPatch's attrs, like any other attribute", () => {
    const text = "```md {#n x=0 y=0}\nHello\n```\n";
    const out = applyPatch(text, [{ id: "n", attrs: { hue: "teal" } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(parseBoard("t", out.text).items[0]?.hue).toBe("teal");
  });
});

describe("diagnostic codes", () => {
  /*
   * Every code names a real condition.
   *
   * A code table drifts in one direction: someone deletes the last site that raises a code and the
   * name lives on, so a fix loop branches on something that can never happen. This walks the source
   * for `CODES.X` uses rather than trusting the table.
   */
  it("is not carrying a code nothing raises", () => {
    /* `plugins/` too: the generator raises `EG_` codes about a model's answer, on the server. */
    const src = [...walk(path.resolve(__dirname, "../src")), ...walk(path.resolve(__dirname, "../plugins"))]
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    const unused = Object.keys(CODES).filter((c) => !new RegExp(`CODES\\.${c}\\b`).test(src));
    expect(unused).toEqual([]);
  });

  it("gives every severity the prefix that matches it", () => {
    for (const code of Object.values(CODES)) {
      expect(severityOf(code)).toBe(code.startsWith("W") ? "warn" : "error");
    }
  });
});

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith("codes.ts")) acc.push(full);
  }
  return acc;
}

describe("applyPatch — frontmatter", () => {
  const WITH = `---\ntitle: Demo\ntheme: paper\n---\n\n\`\`\`md {#a}\nhi\n\`\`\`\n`;

  it("adds a key without disturbing the others or the body", () => {
    const r = applyPatch(WITH, [{ meta: { pages: [{ id: "page-1", name: "Board" }] } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("title: Demo");
    expect(r.text).toContain("theme: paper");
    expect(r.text).toContain("```md {#a}");
    expect(parseBoard("t", r.text).pages).toEqual([{ id: "page-1", name: "Board" }]);
  });

  it("removes a key with null", () => {
    const r = applyPatch(WITH, [{ meta: { theme: null } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain("theme:");
    expect(r.text).toContain("title: Demo");
  });

  it("gives a file with no frontmatter one", () => {
    const r = applyPatch("```md {#a}\nhi\n```\n", [{ meta: { title: "New" } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith("---\ntitle: New\n---\n\n")).toBe(true);
    expect(parseBoard("t", r.text).items).toHaveLength(1);
  });

  it("runs alongside item ops in one patch", () => {
    /* A page added and a card moved onto it is one action, and one undo has to take back both. */
    const r = applyPatch(WITH, [
      {
        meta: {
          pages: [
            { id: "page-1", name: "One" },
            { id: "page-2", name: "Two" },
          ],
        },
      },
      { id: "a", attrs: { page: "page-2" } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const board = parseBoard("t", r.text);
    expect(board.pages).toHaveLength(2);
    expect(board.items[0]!.page).toBe("page-2");
  });

  it("leaves broken frontmatter alone rather than replacing it", () => {
    const broken = "---\ntitle: [unclosed\n---\n\n```md {#a}\nhi\n```\n";
    const r = applyPatch(broken, [{ meta: { title: "New" } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(broken);
  });
});
