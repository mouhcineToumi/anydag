import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkWikilinks } from "@/refs/wikilinks";

import type { BoardItem } from "@/board/types";

import { remarkMath } from "@/note/math";
import { refComponents, urlTransform } from "@/refs/Ref";

import { hueVars } from "./hue";

/* A reference on a board goes to its target, and a note, a task or a board placed on one is a card of
   one fixed size with a button that opens it — never the note's whole text, which grew the
   card with every line and pushed the board around it, and never a board drawn inside a board, which
   is a viewport inside a viewport panning two things.
   Made on first use rather than at import: `Ref` draws boards, a board draws this, and a module
   cycle is only safe while nothing in it runs before every module in it has loaded. */
let refs: Components | null = null;
const REFS = (): Components => (refs ??= refComponents({ boards: false, placed: true }));

/* GFM, and equations between dollars. One array, so a re-render hands react-markdown the same plugins. */
const PLUGINS = [remarkGfm, remarkMath, remarkWikilinks];

/**
 * Markdown, including GFM tables.
 *
 * `react-markdown` builds elements rather than setting `innerHTML`. A board can hold text that came
 * from a paste or from a file Claude read somewhere else, so the renderer never gets to be the
 * place a stray `<script>` runs.
 *
 * A hued note wears its tint as its fill (`.dag-md--note` already has one to fall back to, so an
 * unhued note is unchanged in every theme). A hued plain paragraph gets a quiet rule down its left
 * edge instead — doubling the note's full-fill treatment on prose that is not a note would be
 * noise — and only when it actually has one: `dag-md--hued` is a class, not a bare `var()` fallback,
 * so an unhued paragraph keeps its current box exactly, border and padding included.
 *
 * Memoised: `react-markdown` parses on every render, and `Item` re-renders for its own
 * reasons — selected, moved — which parsed every selected note again on each. A new parse of the
 * board is a new `item`, so a change to the text still draws.
 */
export const MarkdownItem = memo(function MarkdownItem({ item }: { item: BoardItem }) {
  const classes = ["dag-md"];
  if (item.note) classes.push("dag-md--note");
  else if (item.hue) classes.push("dag-md--hued");
  return (
    <div className={classes.join(" ")} style={{ ...hueVars(item.hue), ...(item.h !== undefined ? { minHeight: item.h } : undefined) }}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={REFS()} urlTransform={urlTransform}>
        {item.body}
      </ReactMarkdown>
    </div>
  );
});
