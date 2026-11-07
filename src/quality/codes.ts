/**
 * A stable name for every way a drawn diagram can read badly.
 *
 * The sibling of `src/dsl/codes.ts`, one phase later. That file names what is wrong with the
 * *text* of a board — a line and a column, found by parsing. These name what is wrong with the
 * *picture*, found by measuring a layout, and the distinction is not bookkeeping:
 *
 * - **There is no line number.** Two edges cross because of where ELK put three cards, and no
 *   character in the board file is responsible. A finding names the ids involved instead, which is
 *   what an author can actually act on.
 * - **There is no severity.** Every one of these is advisory. A `usecase` diagram is a dense
 *   bipartite graph and some of its edges will cross whatever anyone does; refusing to draw it
 *   would be absurd. `E_` stops a diagram, `W_` annotates it, `Q_` describes it.
 *
 * What they share is the contract that matters: **branch on the code.** The sentence a tool prints
 * beside one is written for a person and may be reworded; the code will not be. Append-only, and a
 * retired code is never reused.
 */

export const QUALITY_CODES = {
  /** Two edges sharing no endpoint cross. `[edge, edge]`. */
  Q_EDGE_CROSSING: "Q_EDGE_CROSSING",
  /**
   * A route passes through a card that is neither of its endpoints — the worst thing a route can
   * do, and the one defect a screenshot never catches, because the line looks perfectly well drawn
   * until you read what it crosses. `[edge, node]`.
   */
  Q_EDGE_OVER_NODE: "Q_EDGE_OVER_NODE",
  /** Two edge labels still overlap after `separateLabels` has had its six pushes. `[edge, edge]`. */
  Q_LABEL_OVERLAP: "Q_LABEL_OVERLAP",
  /** A label sits on a card. Ten pixels of mono type on a border is not a label. `[edge, node]`. */
  Q_LABEL_OVER_NODE: "Q_LABEL_OVER_NODE",
  /**
   * Two cards overlap.
   *
   * `test/layout.test.ts` has always asserted this cannot happen — on the eleven reference boards.
   * This is the same invariant asked of the board someone just wrote, which is the only place it
   * could ever be news. It should never fire; when it does, a layout is wrong rather than ugly.
   * `[node, node]`.
   */
  Q_NODE_OVERLAP: "Q_NODE_OVERLAP",
  /**
   * A line, or the label on it, reaches past the item's own box, where the page clips it and an
   * export cuts it off. The graph layouts grow their frame to hold every route and label,
   * so this should never fire there; it is what says so when some layout does not. `[edge]`.
   */
  Q_EDGE_OUTSIDE: "Q_EDGE_OUTSIDE",
  /**
   * A sketch box's words are wider than the box the author gave it, so they are cut off at its
   * edge. The box is the author's — `w=` decides and the text has to fit — so nothing
   * grows; this is the one place an agent hears about it without reading a picture. `[node]`.
   */
  Q_TEXT_CLIPPED: "Q_TEXT_CLIPPED",
} as const;

export type QualityCode = (typeof QUALITY_CODES)[keyof typeof QUALITY_CODES];
