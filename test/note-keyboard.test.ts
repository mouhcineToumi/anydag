import { BlockNoteSchema } from "@blocknote/core";
import { describe, expect, it } from "vitest";

import { noteBlockSpecs, noteSchema } from "@/note/schema";

/**
 * What Enter does in a list is each block spec's `keyboard`, and BlockNote writes it when it builds a
 * schema from a spec's `experimental_keyboard`. Building is not repeatable: a spec that has been built
 * and is handed to `BlockNoteSchema.create` again comes out with the defaults, so a bullet split into
 * a paragraph on Enter and an empty item did not end its list (#385). Every editor builds from
 * `noteBlockSpecs()`; these hold that the result keeps the keyboard of the spec it came from.
 */

type Keyboard = (block: unknown) => {
  splitKeepsType: boolean;
  emptyEnterResets: boolean;
  enter: string;
  emptyChildEnter: string;
};
const keyboard = (schema: { blockSpecs: Record<string, unknown> }, type: string): ReturnType<Keyboard> =>
  (schema.blockSpecs[type] as { implementation: { keyboard: Keyboard } }).implementation.keyboard({
    node: { attrs: {} },
    props: {},
  });

const LISTS = ["bulletListItem", "numberedListItem", "checkListItem"] as const;

describe("Enter in a list", () => {
  it("makes the next item of the same kind, and an empty one leaves the list", () => {
    for (const type of LISTS) {
      const k = keyboard(noteSchema, type);
      expect(k.splitKeepsType, type).toBe(true);
      expect(k.emptyEnterResets, type).toBe(true);
    }
  });

  it("is the same in a schema built from the note's specs, as every editor does", () => {
    const editor = BlockNoteSchema.create({ blockSpecs: noteBlockSpecs() });
    for (const type of LISTS) expect(keyboard(editor, type), type).toEqual(keyboard(noteSchema, type));
    expect(keyboard(editor, "callout").enter).toBe("into-children");
  });

  it("is what a schema built from built specs loses — the reason `noteBlockSpecs` is a function", () => {
    const twice = BlockNoteSchema.create({ blockSpecs: { ...noteSchema.blockSpecs } });
    expect(keyboard(twice, "bulletListItem").splitKeepsType).toBe(false);
  });
});
