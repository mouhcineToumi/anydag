import { Trash2, Undo2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import type { FileKind, TrashEntry } from "@/board/useBoard";

import { Toast, ToastName, ToastWords, toastAct } from "./Toast";
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

/**
 * What went, in a sentence, and the same sentence as one line for the toast: the name in it gives
 * way in the middle when the line is too long for the toast, so a sixty-character name is still one
 * line and still ends in its extension.
 */
function said(gone: readonly Gone[], titles: Readonly<Record<string, string>>): { text: string; line: ReactNode } {
  const plain = (text: string) => ({ text, line: <ToastWords>{text}</ToastWords> });
  const named = (before: string, name: string, after: string) => ({
    text: `${before}${name}${after}`,
    line: (
      <>
        <ToastWords>{before}</ToastWords>
        <ToastName text={name} />
        <ToastWords>{after}</ToastWords>
      </>
    ),
  });
  if (gone.length > 1) return plain(`Moved ${counted(gone.length, ["item", "items"])} to the trash.`);
  const e = gone[0]!.entry;
  if (e.kind === "folder") {
    const inside = e.holds
      ? [e.holds.boards, e.holds.notes, e.holds.quizzes, e.holds.tables, e.holds.files].reduce((n, l) => n + l.length, 0)
      : 0;
    const what = inside === 1 ? "the file" : `the ${counted(inside, ["file", "files"])}`;
    return named("Moved the folder “", leaf(e.name), `”${inside ? ` and ${what} in it` : ""} to the trash.`);
  }
  return named("Moved “", e.title ?? titles[e.name] ?? leaf(e.name), "” to the trash.");
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
  const close = useRef(onClose);
  close.current = onClose;

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
  const line = said(gone, titles);
  const text = typeof state === "object" ? state.failed : busy ? "Putting it back…" : line.text;
  return (
    <Toast
      icon={Trash2}
      data-dag-trash-notice=""
      title={text}
      /* It goes on its own only while it is offering Undo: a failure stays until it is read. */
      timeout={state === "shown" ? SHOWN : undefined}
      onTimeout={() => close.current()}
      onDismiss={busy ? undefined : () => close.current()}
      dismissData={{ "data-dag-trash-dismiss": "" }}
      actions={
        <>
          {state === "shown" ? (
            <button type="button" className={toastAct()} data-dag-trash-undo="" onClick={() => void undo()}>
              <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
              Undo
            </button>
          ) : null}
          <button
            type="button"
            className={toastAct()}
            data-dag-trash-view=""
            disabled={busy}
            onClick={() => {
              onTrash();
              close.current();
            }}
          >
            View trash
          </button>
        </>
      }
    >
      {state === "shown" ? line.line : <ToastWords>{text}</ToastWords>}
    </Toast>
  );
}
