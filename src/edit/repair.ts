import { locateItems } from "@/board/locate";
import { DIAGRAM_TYPES, isItemType, type Board } from "@/board/types";
import { CODES, type Code } from "@/dsl/codes";
import { nearest } from "@/dsl/suggest";

/**
 * What a problem about the file itself can be put right with, in the words a person would use.
 *
 * Four codes only: the ones where the file does not parse far enough for a control to exist, or
 * where the one attribute at fault has no control that could remove it. Each is a short sentence
 * saying what is wrong and what the button does, **and what it costs** — a repair that throws part
 * of the file away says which part, and ctrl+Z brings it back, because every repair is one write
 * through `put` like any other edit.
 *
 * Pure, with no pointer and no React: the problems dock draws a `Repair` and `useEditor` carries a
 * `Fix` out. It reads the board **and the text it was parsed from**, because an unknown fence's word
 * is in the text and in no field of the board.
 */

/** A fix, as plain data the dock hands back to the editor. */
export type Fix =
  /** Keep the settings that read, drop the ones that do not. */
  | { kind: "frontmatter" }
  /** Relabel the unknown fence opening on `line`, which carries `from`, as one of `choices`. */
  | { kind: "retype"; line: number; from: string; to: string }
  /** Take one attribute off an item's fence line. */
  | { kind: "attr"; item: string; key: string };

export interface Repair {
  /** What is wrong and what the button will do, in a sentence or two. */
  words: string;
  /** The button's label. */
  action: string;
  fix: Fix;
  /**
   * For a relabel: the kinds to pick between, and the one worth leading with when the unknown word
   * is close to one. Absent for a fix with nothing to choose.
   */
  choices?: { value: string; suggested: boolean }[];
}

const REPAIRABLE: ReadonlySet<Code> = new Set([
  CODES.EB_FRONTMATTER,
  CODES.EB_UNKNOWN_TYPE,
  CODES.EB_BAD_LAYOUT,
  CODES.EB_BAD_ASPECT,
]);

/** Whether `plan` can say anything about this code — the dock asks before it renders a row's extras. */
export const repairable = (code: Code): boolean => REPAIRABLE.has(code);

/** The kinds a stray fence may be relabelled as: what a person can draw, and text. */
const RETYPE_CHOICES: readonly string[] = [...DIAGRAM_TYPES, "md"];

export function planRepair(
  text: string,
  board: Pick<Board, "items">,
  problem: { code: Code; line: number; message: string },
): Repair | null {
  switch (problem.code) {
    case CODES.EB_FRONTMATTER:
      return {
        words:
          "The settings at the top of this file — its title, pages, theme and flow — cannot be read. " +
          "Keep what can be read and drop the rest; undo brings it back.",
        action: "Keep what can be read",
        fix: { kind: "frontmatter" },
      };

    case CODES.EB_UNKNOWN_TYPE: {
      const from = locateItems(text, isItemType).unknown.find((u) => u.line === problem.line)?.type;
      if (!from) return null;
      const near = nearest(from, RETYPE_CHOICES);
      const choices = RETYPE_CHOICES.map((value) => ({ value, suggested: value === near }));
      /* The suggestion leads, so the select opens on the likeliest answer rather than on `erd`. */
      choices.sort((a, b) => Number(b.suggested) - Number(a.suggested));
      return {
        words:
          `A block is labelled \`${from}\`, which AnyDag does not draw, so it is skipped. ` +
          (near ? `Did you mean \`${near}\`? ` : "") +
          "Pick what it should be; its text stays as it is.",
        action: "Change the label",
        fix: { kind: "retype", line: problem.line, from, to: choices[0]!.value },
        choices,
      };
    }

    case CODES.EB_BAD_LAYOUT:
    case CODES.EB_BAD_ASPECT: {
      const item = board.items.find((it) => it.line === problem.line);
      if (!item) return null;
      const layout = problem.code === CODES.EB_BAD_LAYOUT;
      const key = layout ? "layout" : "aspect";
      const raw = String(item.attrs.map[key] ?? "");
      return {
        words: layout
          ? `\`layout=${raw}\` is not a layout. The only one is \`fixed\`, where you place every card yourself. ` +
            "Take it off and the diagram lays itself out."
          : `\`aspect=${raw}\` is not a shape. It is a width over a height, or 0 to never wrap. ` +
            "Take it off and the theme's shape applies; Advanced → Wrapping sets another.",
        action: layout ? "Lay it out automatically" : "Use the theme's shape",
        fix: { kind: "attr", item: item.id, key },
      };
    }

    default:
      return null;
  }
}
