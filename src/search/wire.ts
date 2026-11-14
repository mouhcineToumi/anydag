/**
 * One match as `GET /__board/search` answers it — what the search card draws.
 *
 * The page never holds a document's text: the server matches, ranks and cuts the snippet
 * (`src/search/engine.ts`, over the units `src/search/corpus.ts` makes), and the card draws the
 * `runs` it is sent. This file is only the shape, so `server/handle.ts` builds it and `results.ts`
 * and the card read it from one declaration. Types only: nothing here pulls the engine into the page.
 */
import type { FileKind } from "@/board/useBoard";

import type { Run } from "./engine";

export interface Found {
  /** The document's id, not the unit's. */
  id: string;
  name: string;
  kind: FileKind;
  title: string | null;
  /** Where inside the document: an item id on a board, `^anchor` or `L<line>` in a note. Null is the document itself. */
  part: string | null;
  /** What kind of thing matched — `title`, an item type, a note block. */
  what: string;
  score: number;
  /** The words of the unit that matched, folded. */
  terms: string[];
  /** The snippet with the matched words between `**`, which is how the CLI prints it. */
  snippet: string;
  /** The same snippet as runs, for a caller that draws its own marks. */
  runs: Run[];
}
