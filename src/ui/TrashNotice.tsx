import { Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FileKind, TrashEntry } from "@/board/useBoard";

import { restoreFromTrash } from "./trashApi";
import { counted, leaf } from "./tree";

/** One thing a delete moved to the trash, and what to put back with it. */
export interface Gone {
  entry: TrashEntry;
  /** The favourites that went with it, as `kind:name` — a favourite again when it comes back. */
  favourites: readonly string[];
  /** The file that was open when it went, when it was among what went — open again when it comes back. */
  open: { kind: FileKind; name: string } | null;
}

/** How long the notice stays when nobody is near it. Long enough to read and reach; the trash keeps it after. */
const SHOWN = 8000;

/** What went, in a sentence. */
function said(gone: readonly Gone[], titles: Readonly<Record<string, string>>): string {
  if (gone.length > 1) return `Moved ${counted(gone.length, ["item", "items"])} to the trash.`;
  const e = gone[0]!.entry;
  if (e.kind === "folder") {
    const inside = e.holds ? [e.holds.boards, e.holds.notes, e.holds.quizzes, e.holds.tables, e.holds.files].reduce((n, l) => n + l.length, 0) : 0;
    const what = inside === 1 ? "the file" : `the ${counted(inside, ["file", "files"])}`;
    return `Moved the folder “${leaf(e.name)}”${inside ? ` and ${what} in it` : ""} to the trash.`;
  }
  return `Moved “${e.title ?? titles[e.name] ?? leaf(e.name)}” to the trash.`;
}

/**
 * *Moved to the trash · Undo*: what a delete says in place of the question it used to ask.
 *
 * Deleting asks nothing, because it can be taken back — so this is the
 * taking back, for the moment somebody notices they did not mean it. **Undo restores every entry the
 * delete made**, reopens the file that was open and makes a favourite a favourite again; after the
 * notice goes, the Trash page is where the same thing is done. It stays while the pointer or the
 * focus is on it, so it never goes from under a hand reaching for it.
 *
 * `Shell`'s, above both pages, because the sidebar that deletes is: a notice drawn by a page would go
 * with the page when the deleted file was the one open.
 */
export function TrashNotice({
  gone,
  titles,
  onRestored,
  onTrash,
  onClose,
}: {
  gone: readonly Gone[];
  titles: Readonly<Record<string, string>>;
  onRestored(g: Gone, back: TrashEntry): void;
  onTrash(): void;
  onClose(): void;
}) {
  const [state, setState] = useState<"shown" | "restoring" | { failed: string }>("shown");
  const [held, setHeld] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (held || state !== "shown") return;
    const timer = window.setTimeout(() => close.current(), SHOWN);
    return () => window.clearTimeout(timer);
  }, [held, state]);

  const undo = async () => {
    setState("restoring");
    let failed = 0;
    let why = "";
    /* The last to go comes back first, so what a person sees return is the reverse of what left. */
    for (const g of [...gone].reverse()) {
      const back = await restoreFromTrash(g.entry.id);
      if (typeof back === "string") {
        failed += 1;
        why = back;
      } else onRestored(g, back);
    }
    dispatchEvent(new CustomEvent("dag:boards"));
    if (!failed) return close.current();
    setState({
      failed:
        failed === gone.length && gone.length === 1
          ? `It could not be put back: ${why} It is still in the trash.`
          : `${counted(failed, ["item", "items"])} could not be put back, and ${failed === 1 ? "is" : "are"} still in the trash.`,
    });
  };

  const busy = state === "restoring";
  return (
    <div
      className="dag-trash-notice"
      role="status"
      data-dag-trash-notice=""
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <Trash2 size={16} strokeWidth={2} aria-hidden="true" className="dag-trash-notice__mark" />
      <p className="dag-trash-notice__text">{typeof state === "object" ? state.failed : busy ? "Putting it back…" : said(gone, titles)}</p>
      {state === "shown" ? (
        <button type="button" className="dag-trash-notice__act" data-dag-trash-undo="" onClick={() => void undo()}>
          <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
          Undo
        </button>
      ) : null}
      <button
        type="button"
        className="dag-trash-notice__act"
        data-dag-trash-view=""
        disabled={busy}
        onClick={() => {
          onTrash();
          close.current();
        }}
      >
        View trash
      </button>
      <button type="button" className="dag-icon dag-trash-notice__close" data-dag-trash-dismiss="" aria-label="Dismiss" disabled={busy} onClick={() => close.current()}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
