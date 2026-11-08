// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getDefaultSlashMenuItems } from "@blocknote/core/extensions";
import { ServerBlockNoteEditor } from "@blocknote/server-util";

import { OWN_SLASH, SLASH, SLASH_KEYS, pasteKind } from "@/blocks/menus";
import { NOTE_BLOCKS, NOTE_STYLES, blocksToMd, mdToBlocks, type NoteBlock } from "@/note/markdown";
import { noteSchema } from "@/note/schema";

/**
 * The menus are a closed set, and the file is what closes it: anything the editor offers must be
 * something a `.note.md` can say. Three lists have to agree — the schema, the slash menu, and the
 * bridge's own `NOTE_BLOCKS` — and each check here is one of the ways they could drift.
 */

describe("the schema", () => {
  it("holds exactly the blocks and marks Markdown has", () => {
    expect(Object.keys(noteSchema.blockSchema).sort()).toEqual([...NOTE_BLOCKS].sort());
    expect(Object.keys(noteSchema.styleSchema).sort()).toEqual([...NOTE_STYLES].sort());
  });

  it("lets code sit inside bold, which BlockNote's own code mark refuses", async () => {
    const server = ServerBlockNoteEditor.create({ schema: noteSchema });
    const blocks = await server._withDOM(async () => {
      server.editor.replaceBlocks(server.editor.document, [
        { type: "paragraph", content: [{ type: "text", text: "x", styles: { bold: true, code: true } }] },
      ] as never);
      return server.editor.document as unknown as NoteBlock[];
    });
    expect(blocksToMd(blocks)).toBe("**`x`**");
  });
});

describe("the slash menu", () => {
  const server = ServerBlockNoteEditor.create({ schema: noteSchema });
  const offered = getDefaultSlashMenuItems(server.editor).map((i) => i.key as string);

  it("names only items BlockNote has — a key that matches nothing is a menu entry that silently vanished", () => {
    for (const key of SLASH_KEYS) expect(offered).toContain(key);
  });

  it("makes only blocks the bridge holds, and reaches every one of them", () => {
    const made = new Set([...Object.values(SLASH), ...Object.values(OWN_SLASH)]);
    for (const type of made) expect(NOTE_BLOCKS).toContain(type);
    for (const type of NOTE_BLOCKS) expect(made.has(type)).toBe(true);
  });

  it("leaves out what Markdown cannot say", () => {
    for (const key of ["toggle_heading", "toggle_list", "heading_4", "video", "audio", "file", "emoji", "page_break"]) {
      expect(SLASH_KEYS).not.toContain(key);
    }
  });

  const samples: Record<string, NoteBlock> = {
    paragraph: { type: "paragraph", content: [{ type: "text", text: "p", styles: {} }] },
    heading: { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "h", styles: {} }] },
    bulletListItem: { type: "bulletListItem", content: [{ type: "text", text: "b", styles: {} }] },
    numberedListItem: { type: "numberedListItem", content: [{ type: "text", text: "n", styles: {} }] },
    checkListItem: { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "c", styles: {} }] },
    quote: { type: "quote", content: [{ type: "text", text: "q", styles: {} }] },
    codeBlock: { type: "codeBlock", props: { language: "ts" }, content: "x" },
    divider: { type: "divider" },
    table: {
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: [[{ type: "text", text: "a", styles: {} }]] }, { cells: [[{ type: "text", text: "1", styles: {} }]] }],
      },
    },
    image: { type: "image", props: { url: "n.assets/p.png", name: "p" } },
    embed: { type: "embed", props: { href: "dag:0123456789", title: "The plan" } },
    equation: { type: "equation", props: { tex: "x^2", fenced: false } },
  };
  for (const type of NOTE_BLOCKS) {
    it(`a ${type} comes back from the file as a ${type}`, () => {
      const back = mdToBlocks(blocksToMd([samples[type]]));
      expect(back.map((b) => b.type)).toEqual([type]);
    });
  }
});

describe("a paste", () => {
  it("reads plain text as Markdown", () => {
    expect(pasteKind(["text/plain"], "")).toBe("markdown");
  });
  it("leaves a file, and BlockNote's own clipboard, to BlockNote", () => {
    expect(pasteKind(["Files", "text/plain"], "")).toBe("default");
    expect(pasteKind(["blocknote/html", "text/html", "text/plain"], "<p>x</p>")).toBe("default");
  });
  it("takes HTML from a web page as HTML, and a code editor's coloured plain text as Markdown", () => {
    expect(pasteKind(["text/html", "text/plain"], "<p><b>x</b></p>")).toBe("default");
    expect(pasteKind(["text/html", "text/plain"], '<div style="white-space: pre;"><span># x</span></div>')).toBe("markdown");
  });
});
