import { useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";

import { contentBounds, placeItems } from "@/board/flow";
import { isLinkType, type Board } from "@/board/types";
import { Viewport, type ViewportHandle } from "@/canvas/Viewport";
import { BoardEdges } from "@/render/BoardEdges";
import { Item } from "@/render/Item";
import type { Theme } from "@/theme/contract";

import { useGroups, useMeasures, usePublishReady, useSolo } from "./drawing";

/**
 * A board, drawn and nothing else.
 *
 * The canvas without the editor: the same `Item`, `BoardEdges` and `Viewport` the canvas draws with,
 * so a board looks exactly as it does where it is edited, and none of `src/edit/` — no selection,
 * no gestures, no clipboard, no panel. `Item` has always drawn without a `ctl`; that is what
 * `?snapshot=1` has been doing since M4, and this is the same drawing with the pan and zoom left on.
 *
 * Takes the parsed board rather than a name, because who loads it differs: the view page reads it
 * and subscribes to the change feed through `useBoard`, and an embed inside a note does the same
 * one level down. Takes the theme for the same reason: a board opened on its own wears the theme its
 * frontmatter names, and a board embedded in a note wears the note's.
 *
 * Pan with a drag anywhere — the hand is the only tool — and zoom with ctrl or cmd and the wheel or
 * a pinch, the way the canvas does. `handleRef` is how a caller fits, zooms or resets it.
 */
export function BoardView({
  board,
  page,
  theme,
  publish = false,
  scrollThrough = false,
  handleRef,
  onZoom,
  onReady,
  children,
}: {
  board: Board;
  /** The page to draw; the board's first when absent or when the board has no such page. */
  page?: string | null;
  theme: Theme;
  /** Publish `data-dag-ready` on the document. Exactly one board on a page may; an embed may not. */
  publish?: boolean;
  /** A plain wheel scrolls the page around the board — for a board embedded in a note. */
  scrollThrough?: boolean;
  handleRef?: Ref<ViewportHandle>;
  onZoom?(zoom: number): void;
  /**
   * Told whether every item on the page has reported its size — the readiness `publish` puts on the
   * document, for a caller that is not allowed to: an embed, which a note printed to PDF waits on.
   */
  onReady?(ready: boolean): void;
  /** Drawn over the board inside the viewport's layer — nothing uses it yet but a caller's overlay. */
  children?: ReactNode;
}) {
  const shown = page && board.pages.some((p) => p.id === page) ? page : board.pages[0]?.id ?? "page-1";
  const { sizes, nodeBoxes, onMeasure } = useMeasures();
  const places = useMemo(() => placeItems(board, shown, sizes), [board, shown, sizes]);
  const bounds = useMemo(() => contentBounds(places), [places]);

  /* What is on the paper — which is not everything in the file: an `edges` fence draws nothing, and
     an item that never draws never reports a size, so leaving it in would mean never being ready. */
  const items = useMemo(
    () => board.items.filter((it) => it.page === shown && !it.hidden && !isLinkType(it.type)),
    [board, shown],
  );
  const solo = useSolo(items, nodeBoxes);
  const groups = useGroups(items);

  const ready = items.every((it) => sizes.has(it.id));
  usePublishReady(publish, ready, sizes, bounds);
  const told = useRef(onReady);
  told.current = onReady;
  useEffect(() => told.current?.(ready), [ready]);

  const fallback = useRef<ViewportHandle>(null);

  return (
    <Viewport content={bounds} handleRef={handleRef ?? fallback} tool="hand" onZoom={onZoom} scrollThrough={scrollThrough}>
      {items.map((it) => {
        const place = places.get(it.id);
        if (!place) return null;
        return (
          <Item
            key={it.id}
            item={it}
            place={place}
            boardName={board.name}
            theme={theme}
            onMeasure={onMeasure}
            selected={false}
            solo={false}
            picked={false}
          />
        );
      })}
      {board.links.length > 0 ? (
        <BoardEdges
          links={board.links}
          boxes={places}
          nodeBoxes={nodeBoxes}
          solo={solo}
          groups={groups}
          theme={theme}
          picked={null}
        />
      ) : null}
      {children}
    </Viewport>
  );
}
