import { describe, expect, it } from "vitest";
import { ServerBlockNoteEditor } from "@blocknote/server-util";

import { blocksToMd, load, mdToBlocks, saved, settle, type NoteBlock } from "@/note/markdown";
import { noteSchema } from "@/note/schema";

/**
 * A reference and an embed through the bridge. The file is the truth, so what matters is
 * that each comes back as the Markdown it was, through the editor's own schema, and that an
 * untouched note with references in it still saves byte for byte.
 */
const NOTE = "# Plan\n\nSee [the plan](dag:0123456789) and [a block](dag:abcdefghjk#^para).\n\n![Architecture](dag:mnpqrstvwx)\n\n![a picture](n.assets/p.png)\n";

describe("references in a note", () => {
  it("reads a dag: link as a reference and a dag: image on its own line as an embed", () => {
    const blocks = mdToBlocks(NOTE);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "embed", "image"]);
    const refs = (blocks[1]!.content as { type: string }[]).filter((c) => c.type === "ref");
    expect(refs).toEqual([
      { type: "ref", props: { href: "dag:0123456789", title: "the plan" } },
      { type: "ref", props: { href: "dag:abcdefghjk#^para", title: "a block" } },
    ]);
    expect(blocks[2]!.props).toEqual({ href: "dag:mnpqrstvwx", title: "Architecture" });
  });

  it("writes both back as the Markdown they were", () => {
    expect(blocksToMd(mdToBlocks(NOTE))).toBe(NOTE.trimEnd());
  });

  it("goes through the editor's own schema unchanged", async () => {
    const server = ServerBlockNoteEditor.create({ schema: noteSchema });
    const back = await server._withJSDOM(async () => {
      server.editor.replaceBlocks(server.editor.document, mdToBlocks(NOTE) as never);
      return server.editor.document as unknown as NoteBlock[];
    });
    expect(blocksToMd(back)).toBe(NOTE.trimEnd());
  });

  it("saves an untouched note with references in it byte for byte", () => {
    const { blocks, loaded } = load(NOTE);
    expect(saved(settle(loaded, blocks), blocks).body).toBe(NOTE);
  });
});
