import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { TextKind } from "@/board/useBoard";

import { TagEditor } from "./TagEditor";
import { applyTags } from "./tagStore";

/** Which document's tags are being changed, and the control the card hangs from. */
export interface Tagging {
  kind: TextKind;
  name: string;
  /** The `⋯` or the sidebar row it was asked from: the focus goes back there. */
  anchor: HTMLElement | null;
}

const WIDTH = 280;

/**
 * *Tags…* — a document's tags in a card under the control it was asked from: the top bar's `⋯` on a
 * board, a quiz or a table, and every sidebar row's menu. The same editor as a note's Tags row, a new
 * tag made the same way, written through `POST /__board/tags/apply`, which registers a tag it creates
 * with the colour chosen.
 *
 * What it draws is the listing's copy of the document's tags, and the answer of its own last write
 * until the listing catches up — the feed brings that a moment later.
 */
export function TagPopover({ what, tags, onClose }: { what: Tagging; tags: readonly string[]; onClose(): void }) {
  const card = useRef<HTMLDivElement>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);

  /* The listing moved: it is the copy to draw again. */
  useEffect(() => setMine(null), [tags]);

  useLayoutEffect(() => {
    const place = () => {
      const el = what.anchor?.isConnected ? what.anchor : null;
      const margin = 8;
      const w = Math.min(WIDTH, innerWidth - margin * 2);
      if (!el) return setAt({ left: (innerWidth - w) / 2, top: 64, width: w });
      const r = el.getBoundingClientRect();
      /* Under the `⋯` at the right of the bar the card's right edge meets the button's; under a row it starts with it. */
      const right = r.left + r.width / 2 > innerWidth / 2;
      const left = Math.max(margin, Math.min(right ? r.right - w : r.left, innerWidth - w - margin));
      const top = Math.min(r.bottom + 6, innerHeight - margin - 120);
      setAt({ left, top, width: w });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [what.anchor]);

  /* Placed, it takes the focus: a field cannot while the card is still hidden for measuring. */
  const placed = at !== null;
  useEffect(() => {
    if (placed) card.current?.querySelector<HTMLElement>("[data-dag-tag-input]")?.focus();
  }, [placed]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || what.anchor?.contains(t)) return;
      /* A chip's colour card is drawn outside this one, fixed to the window. */
      if ((t as Element).closest?.("[data-dag-tag-hues]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose, what.anchor]);

  const close = () => {
    onClose();
    if (what.anchor?.isConnected) what.anchor.focus();
  };

  return (
    <div
      ref={card}
      className="dag-tagpop"
      role="dialog"
      aria-label="Tags"
      data-dag-tagpop={what.name}
      style={at ?? { visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <p className="dag-tagpop__head">Tags</p>
      <TagEditor
        tags={mine ?? tags}
        editable
        variant="pop"
        onChange={async (change, created) => {
          setProblem(null);
          const done = await applyTags(what.kind, what.name, change, created?.hue);
          if (!done.ok) return setProblem(done.error);
          setMine(done.got.tags);
        }}
      />
      {problem ? (
        <p className="dag-tagpop__problem" role="alert" data-dag-tagpop-problem="">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
