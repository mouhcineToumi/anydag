import { describe, expect, it } from "vitest";

import { rewriteFenceAttrs, scanFences } from "@/board/fences";
import { locateItems } from "@/board/locate";
import { parseBoard } from "@/board/parseBoard";
import { applyPatch, type PatchOp } from "@/board/patch";
import { renameItemId, renameNodeLinks } from "@/board/rename";
import { repairFrontmatter, retypeFence } from "@/board/repair";
import { isItemType } from "@/board/types";
import { withKeys } from "@/note/task";
import { titleOf } from "@/refs/extract";

import { withoutTitle, withTitle } from "../server/frontmatter";
import { frontId, withId } from "../server/ids";

/**
 * A board file written on Windows: CRLF line endings, a byte-order mark, or both (#391, #392).
 *
 * The format's scanner once split on `\n` and matched each line with patterns that end at `$`, so a
 * fence line ending in `\r` was no fence at all: a CRLF board read as one prose card, and deleting it
 * erased the board. A BOM was text before the first `---`, so the frontmatter became a card and the
 * first drag wrote two blocks through overlapping spans.
 *
 * The rule these hold: a CRLF or BOM file reads **exactly** as its LF twin, and an edit writes the
 * twin's edit in the file's own line endings — every byte outside the span it touched, the line
 * endings and the mark included, kept.
 */

const BOM = "﻿";
const crlf = (s: string): string => s.replace(/\n/g, "\r\n");
/** Every other line break CRLF, the rest LF: what a file edited by two editors looks like. */
const mixed = (s: string): string => {
  let n = 0;
  return s.replace(/\n/g, () => (n++ % 2 === 0 ? "\r\n" : "\n"));
};

const WITH_FM = [
  "---",
  "title: Lines",
  "---",
  "",
  "```md {#b1 x=100 y=80 w=320}",
  "First card.",
  "",
  "Second paragraph.",
  "```",
  "",
  "```md",
  "Second card.",
  "```",
  "",
  "Some loose prose,",
  "over two lines.",
  "",
  "```arch {#infra x=600 y=0}",
  'service api "API"',
  'service db "DB"',
  "api --> db",
  "```",
  "",
  "````md {#quote}",
  "```",
  "code",
  "```",
  "````",
  "",
  "```edges {#links}",
  "b1 --> infra",
  "infra.api --> b1",
  "```",
  "",
].join("\n");

/* Without frontmatter the first block is the first thing in the file — right after a BOM, if any. */
const NO_FM = WITH_FM.slice(WITH_FM.indexOf("```md {#b1"));

const SOURCES = { "with frontmatter": WITH_FM, "without frontmatter": NO_FM } as const;

/** What a reader sees of a board, without line numbers' and offsets' bookkeeping. */
function shape(text: string) {
  const b = parseBoard("t", text);
  return {
    title: b.title,
    pages: b.pages,
    items: b.items.map((it) => ({ id: it.id, type: it.type, body: it.body, attrs: it.attrs, line: it.line, page: it.page })),
    links: b.links.map((l) => ({ from: l.from, to: l.to })),
    errors: b.errors,
  };
}

describe("reading a CRLF or BOM board (#391, #392)", () => {
  for (const [name, lf] of Object.entries(SOURCES)) {
    const twins: Record<string, string> = {
      CRLF: crlf(lf),
      "mixed CRLF and LF": mixed(lf),
      BOM: BOM + lf,
      "BOM and CRLF": BOM + crlf(lf),
      "BOM, mixed": BOM + mixed(lf),
    };
    for (const [kind, text] of Object.entries(twins)) {
      it(`${kind}, ${name}: the same items, ids, bodies and lines as its LF twin`, () => {
        const want = shape(lf);
        expect(want.items.map((it) => it.id)).toEqual(["b1", "md-1", "md-2", "infra", "quote", "links"]);
        expect(shape(text)).toEqual(want);
      });
    }
  }

  it("names the frontmatter's title through a BOM", () => {
    expect(parseBoard("t", BOM + WITH_FM).title).toBe("Lines");
    expect(parseBoard("t", BOM + crlf(WITH_FM)).title).toBe("Lines");
  });

  it("never makes a card of the mark itself", () => {
    expect(parseBoard("t", BOM).items).toEqual([]);
    expect(parseBoard("t", `${BOM}\r\n`).items).toEqual([]);
  });

  it("scans a fence whose lines end in CR, and keeps the CR outside its offsets", () => {
    const text = crlf("```md {#a}\nhello\nworld\n```\n");
    const [f] = scanFences(text);
    expect(f).toMatchObject({ type: "md", attrText: "#a", body: "hello\nworld", closed: true, line: 1 });
    expect(text.slice(f!.openStart, f!.openEnd)).toBe("```md {#a}");
    expect(text.slice(0, f!.blockEnd)).toBe("```md {#a}\r\nhello\r\nworld\r\n```");
    expect(rewriteFenceAttrs(text, f!, "#a x=1")).toBe(crlf("```md {#a x=1}\nhello\nworld\n```\n"));
  });

  it("scans a fence on the first line after a BOM", () => {
    const text = `${BOM}\`\`\`md {#a}\nhi\n\`\`\`\n`;
    const [f] = scanFences(text);
    expect(f).toMatchObject({ type: "md", attrText: "#a", body: "hi", openStart: 1 });
    expect(locateItems(text, isItemType).items.map((it) => [it.id, it.start])).toEqual([["a", 1]]);
  });
});

/*
 * Every edit op, against every twin. The LF twin's result is the reference: a pure CRLF file must come
 * back as exactly that result in CRLF, a BOM file as that result behind the mark. A mixed file has no
 * single translation, so it is held to the two things that matter — it reads back as the twin's
 * result does, and nothing outside the touched block moved.
 */
const OPS: Record<string, PatchOp[]> = {
  "move (pin x/y)": [{ id: "b1", attrs: { x: 140, y: 120 } }],
  "pin an anonymous fence": [{ id: "md-1", attrs: { x: 0, y: 400 } }],
  "pin loose prose (wraps it)": [{ id: "md-2", attrs: { x: 0, y: 600 } }],
  "a first drag pins everything": [
    { id: "b1", attrs: { x: 140, y: 120 } },
    { id: "md-1", attrs: { x: 0, y: 400 } },
    { id: "md-2", attrs: { x: 0, y: 600 } },
    { id: "infra", attrs: { x: 600, y: 40 } },
    { id: "quote", attrs: { x: 0, y: 800 } },
  ],
  "delete the first card (and its links)": [{ id: "b1", remove: true }],
  "delete loose prose": [{ id: "md-2", remove: true }],
  "delete the last item": [{ id: "links", remove: true }],
  "rewrite a body": [{ id: "b1", body: "One line now.\nAnd another.\n\nAnd a third." }],
  "rewrite a body to empty": [{ id: "md-1", body: "" }],
  "rewrite prose without pinning": [{ id: "md-2", body: "Loose prose,\nrewritten." }],
  "rewrite a body that needs longer ticks": [{ id: "b1", body: "```\nquoted\n```" }],
  retype: [{ id: "md-1", type: "arch", body: 'service x "X"' }],
  "insert at the end": [{ insert: { type: "md", attrs: { id: "new", x: 0, y: 0 }, body: "New card,\ntwo lines." } }],
  "insert after an item": [{ insert: { type: "md", attrs: { id: "new" }, body: "After b1." }, after: "b1" }],
  "set the title": [{ meta: { title: "Renamed" } }],
  "add pages": [{ meta: { pages: ["One", "Two"] } }],
  "bring to front": [{ id: "b1", move: "front" }],
  "send prose to back": [{ id: "md-2", move: "back" }],
};

/** Where the two texts first and last differ: everything before `head` and after `tail` is shared. */
function unchanged(before: string, after: string): { head: number; tail: number } {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return { head, tail };
}

describe("every edit keeps the file's line endings and its BOM (#391, #392)", () => {
  for (const [name, lf] of Object.entries(SOURCES)) {
    for (const [opName, ops] of Object.entries(OPS)) {
      if (name === "without frontmatter" && opName.startsWith("set the title")) continue;
      const ref = applyPatch(lf, ops);
      it(`${opName}, ${name}: the LF twin's edit applies`, () => expect(ref.ok).toBe(true));
      if (!ref.ok) continue;

      it(`${opName}, ${name}: CRLF writes the LF twin's result in CRLF`, () => {
        expect(applyPatch(crlf(lf), ops)).toEqual({ ok: true, text: crlf(ref.text) });
      });
      it(`${opName}, ${name}: BOM writes the LF twin's result behind the mark`, () => {
        expect(applyPatch(BOM + lf, ops)).toEqual({ ok: true, text: BOM + ref.text });
      });
      it(`${opName}, ${name}: BOM and CRLF together`, () => {
        expect(applyPatch(BOM + crlf(lf), ops)).toEqual({ ok: true, text: BOM + crlf(ref.text) });
      });
      it(`${opName}, ${name}: mixed endings read back as the LF twin's result, outside bytes kept`, () => {
        const text = BOM + mixed(lf);
        const out = applyPatch(text, ops);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.text.startsWith(BOM)).toBe(true);
        expect(out.text.slice(1).includes(BOM)).toBe(false);
        expect(shape(out.text)).toEqual(shape(ref.text));
        /* Nothing was rewritten wholesale into one style: a CRLF line far from the edit is still CRLF. */
        const { head, tail } = unchanged(text, out.text);
        const kept = text.slice(0, head) + text.slice(text.length - tail);
        expect(kept.length).toBeGreaterThan(0);
        expect(out.text.slice(0, head)).toBe(text.slice(0, head));
        expect(out.text.slice(out.text.length - tail)).toBe(text.slice(text.length - tail));
      });
    }
  }

  it("a pin on a mixed board touches one fence line and nothing else", () => {
    const text = BOM + mixed(WITH_FM);
    const out = applyPatch(text, [{ id: "infra", attrs: { x: 1, y: 2 } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toBe(text.replace("```arch {#infra x=600 y=0}", "```arch {#infra x=1 y=2}"));
  });

  it("a body edit on a mixed board keeps the open and close lines' endings", () => {
    const text = "```md {#a}\r\none\ntwo\r\n```\n\n```md {#b}\nB\n```\n";
    const out = applyPatch(text, [{ id: "a", body: "uno\ndos" }]);
    expect(out).toEqual({ ok: true, text: "```md {#a}\r\nuno\r\ndos\r\n```\n\n```md {#b}\nB\n```\n" });
  });

  it("reads a CRLF body sent by an agent as the same body", () => {
    const text = crlf(NO_FM);
    expect(applyPatch(text, [{ id: "b1", body: "First card.\r\n\r\nSecond paragraph." }])).toEqual({ ok: true, text });
    const out = applyPatch(text, [{ id: "b1", body: "a\r\nb" }]);
    expect(out.ok && out.text).toBe(text.replace("First card.\r\n\r\nSecond paragraph.", "a\r\nb"));
  });

  it("deleting the only card of a CRLF board leaves its frontmatter, not an empty file (#391)", () => {
    const text = crlf("---\ntitle: Lines\n---\n\n```md\nFirst card.\n```\n");
    const out = applyPatch(text, [{ id: "md-1", remove: true }]);
    expect(out).toEqual({ ok: true, text: crlf("---\ntitle: Lines\n---\n") });
  });

  it("deleting one of two CRLF cards keeps the other (#391)", () => {
    const text = crlf("---\ntitle: Lines\n---\n\n```md\nFirst card.\n```\n\n```md\nSecond card.\n```\n");
    expect(parseBoard("t", text).items.map((it) => it.body)).toEqual(["First card.", "Second card."]);
    const out = applyPatch(text, [{ id: "md-1", remove: true }]);
    expect(out).toEqual({ ok: true, text: crlf("---\ntitle: Lines\n---\n\n```md\nSecond card.\n```\n") });
  });

  it("the drag that corrupted a BOM board writes one clean pin (#392)", () => {
    const text = `${BOM}---\ntitle: BOM board\n---\n\n\`\`\`md {#b1 x=100 y=80 w=320}\nFirst.\n\`\`\`\n\n\`\`\`md {#b2 x=640 y=0 w=320}\nSecond.\n\`\`\`\n`;
    expect(parseBoard("t", text).items.map((it) => it.id)).toEqual(["b1", "b2"]);
    const out = applyPatch(text, [
      { id: "b1", attrs: { x: 120, y: 80 } },
      { id: "b2", attrs: { x: 640, y: 0 } },
    ]);
    expect(out).toEqual({ ok: true, text: text.replace("#b1 x=100", "#b1 x=120") });
    expect(parseBoard("t", out.ok ? out.text : "").items.map((it) => it.id)).toEqual(["b1", "b2"]);
  });

  it("removing the frontmatter's last key keeps the BOM and the endings", () => {
    const text = BOM + crlf("---\ntitle: Lines\n---\n\n```md {#a}\nA\n```\n");
    expect(applyPatch(text, [{ meta: { title: null } }])).toEqual({ ok: true, text: BOM + crlf("```md {#a}\nA\n```\n") });
  });

  it("a BOM board with no frontmatter grows one behind the mark", () => {
    const text = BOM + crlf("```md {#a}\nA\n```\n");
    expect(applyPatch(text, [{ meta: { title: "T" } }])).toEqual({
      ok: true,
      text: BOM + crlf("---\ntitle: T\n---\n\n```md {#a}\nA\n```\n"),
    });
  });
});

describe("renames and repairs on a CRLF or BOM board", () => {
  it("renames an item and every link to it, in CRLF, behind a BOM", () => {
    const ref = renameItemId(WITH_FM, "b1", "first");
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    expect(renameItemId(BOM + crlf(WITH_FM), "b1", "first")).toEqual({ ok: true, text: BOM + crlf(ref.text) });
    /* A prose rename pins an id, which wraps it in a fence. */
    const prose = renameItemId(WITH_FM, "md-2", "loose");
    expect(prose.ok).toBe(true);
    if (!prose.ok) return;
    expect(renameItemId(BOM + crlf(WITH_FM), "md-2", "loose")).toEqual({ ok: true, text: BOM + crlf(prose.text) });
  });

  it("follows a node rename into the links of a CRLF board", () => {
    const ref = renameNodeLinks(WITH_FM, "infra", "api", "gateway");
    expect(ref.ok && ref.text).toContain("infra.gateway --> b1");
    if (!ref.ok) return;
    expect(renameNodeLinks(crlf(WITH_FM), "infra", "api", "gateway")).toEqual({ ok: true, text: crlf(ref.text) });
    const text = BOM + mixed(WITH_FM);
    const out = renameNodeLinks(text, "infra", "api", "gateway");
    expect(out.ok && out.text).toBe(text.replace("infra.api --> b1", "infra.gateway --> b1"));
  });

  it("repairs a broken settings block behind a BOM, in CRLF", () => {
    const lf = "---\ntitle: Fine\nbroken: [\n---\n\n```md {#a}\nA\n```\n";
    const ref = repairFrontmatter(lf);
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    expect(repairFrontmatter(BOM + crlf(lf))).toEqual({ ...ref, text: BOM + crlf(ref.text) });
    const all = "---\nbroken: [\n---\n\n```md {#a}\nA\n```\n";
    const gone = repairFrontmatter(all);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(repairFrontmatter(BOM + crlf(all))).toEqual({ ...gone, text: BOM + crlf(gone.text) });
  });

  it("retypes an unknown fence behind a BOM, in CRLF", () => {
    const lf = "---\ntitle: T\n---\n\n```mermaidish {#a}\nA\n```\n";
    const ref = retypeFence(lf, 5, "mermaidish", "md");
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    expect(retypeFence(BOM + crlf(lf), 5, "mermaidish", "md")).toEqual({ ...ref, text: BOM + crlf(ref.text) });
  });
});

/*
 * The server's frontmatter writers — a board's id, minted the first time something links it, and
 * its title — went to the same `^---` and missed it past a BOM: a second frontmatter was written in
 * front of the mark, and the board's own became a card.
 */
describe("a board's id and title behind a BOM (#392)", () => {
  const lf = "---\ntitle: BOM board\n---\n\n```md {#b1}\nFirst.\n```\n";

  it("reads the title and the id past the mark", () => {
    expect(titleOf(BOM + crlf(lf))).toBe("BOM board");
    expect(frontId(`${BOM}---\nid: 0123456789\n---\n`)).toBe("0123456789");
  });

  it("writes an id into the frontmatter it has, behind the mark", () => {
    expect(withId(BOM + lf, "0123456789")).toBe(BOM + withId(lf, "0123456789"));
    expect(withId(BOM + crlf(lf), "0123456789")).toBe(BOM + crlf(withId(lf, "0123456789")));
    expect(withKeys(`${BOM}\`\`\`md\nA\n\`\`\`\n`, { id: "0123456789" }, ["id"])).toBe(
      `${BOM}---\nid: 0123456789\n---\n\`\`\`md\nA\n\`\`\`\n`,
    );
    expect(parseBoard("t", withId(BOM + crlf(lf), "0123456789")).items.map((it) => it.id)).toEqual(["b1"]);
  });

  it("retitles it, and takes the title away, behind the mark", () => {
    expect(withTitle(BOM + crlf(lf), "Renamed")).toBe(BOM + crlf(lf.replace("BOM board", "Renamed")));
    expect(withoutTitle(BOM + lf)).toBe(BOM + withoutTitle(lf));
  });
});
