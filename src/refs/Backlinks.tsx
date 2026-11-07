import { File as FileGlyph, FileText, GraduationCap, LayoutDashboard, Link2, Table2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FileKind } from "@/board/useBoard";

import { backlinksOf, hrefFor, titleOf, useIndex } from "./useIndex";

/* Each kind's mark, keyed on the kind so a quiz is never drawn as a board. */
const KIND_ICON = { board: LayoutDashboard, note: FileText, quiz: GraduationCap, table: Table2, file: FileGlyph } satisfies Record<FileKind, LucideIcon>;

/**
 * What links here — the backlinks panel, on every note and board.
 *
 * The same index every reference is drawn from, read the other way: a document is listed when any
 * of its references names this one's id. So it needs no table of its own and cannot disagree with
 * what the references themselves say, and a rename of either end changes nothing but the titles.
 *
 * A count in the bar, which opens the list. Nothing at all while the document has no id yet — the
 * first answer from the index — nor while nothing links here.
 */
export function Backlinks({ id }: { id: string | null | undefined }) {
  const index = useIndex();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);

  if (!id || !index.loaded) return null;
  const from = backlinksOf(index, id);
  /* Only when something does: *0 backlinks* was a button on every new file's bar, saying
     nothing and taking the room the file's title needed. */
  if (from.length === 0) return null;
  return (
    <div className="dag-backlinks" ref={box} data-dag-backlinks={from.length}>
      <button
        type="button"
        className="dag-backlinks__toggle"
        data-dag-backlinks-toggle=""
        aria-expanded={open}
        title="What links here"
        onClick={() => setOpen((v) => !v)}
      >
        <Link2 size={14} strokeWidth={2} aria-hidden="true" />
        {from.length}
        <span className="dag-backlinks__word">{from.length === 1 ? " backlink" : " backlinks"}</span>
      </button>
      {open ? (
        <div className="dag-backlinks__list" role="dialog" aria-label="What links here">
          {from.map((d) => {
            const Icon = KIND_ICON[d.kind];
            return (
              <a key={d.id} className="dag-backlinks__row" href={hrefFor(d.id)} data-dag-backlink={d.id}>
                <Icon size={14} aria-hidden="true" />
                <span className="dag-backlinks__title">{titleOf(d)}</span>
                <span className="dag-backlinks__path">{d.name}</span>
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
