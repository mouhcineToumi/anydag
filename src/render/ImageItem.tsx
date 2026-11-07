import { useContext } from "react";

import type { BoardItem } from "@/board/types";

import { AssetUrlContext } from "./assets";
import { BrokenItem } from "./ErrorItem";
import { hueVars } from "./hue";

/**
 * An image on the board.
 *
 * `src` is relative to the board file, so a board folder is self-contained: the markdown and its
 * images move together. Which route serves it is `AssetUrlContext`'s: the viewer's session, or a
 * share link's for somebody who has one.
 *
 * A hue is bound on the `<figure>` and read by its descendants through inheritance — `--dag-h` is a
 * custom property, so `img`'s and `figcaption`'s own `var(--dag-h, …)` see it without a modifier
 * class. The fallback stays the theme's plain `outline`/`slate`, not `--dag-h-default`: an unhued
 * image must draw exactly as it always has, not adopt the theme's default hue.
 */
export function ImageItem({ item, boardName }: { item: BoardItem; boardName: string }) {
  const assets = useContext(AssetUrlContext);
  if (!item.src) return <BrokenItem what="image" messages={[]} why="has no src= to show" />;

  const url = assets(boardName, item.src);
  const caption = item.body.trim();

  return (
    <figure
      className="dag-image"
      style={{ ...hueVars(item.hue), ...(item.h !== undefined ? { minHeight: item.h } : undefined) }}
    >
      <img src={url} alt={caption || item.id} draggable={false} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
