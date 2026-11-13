import { Link as LinkMark, Lock, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { FileKind } from "@/board/useBoard";
import { AssistantToggle } from "@/assistant/Toggle";
import { chordFor } from "@/edit/bindings";
import { appLink } from "@/refs/link";
import { LOCK_KEYS, toggleLock, useLocked } from "@/settings/lock";

import { copyText } from "./clipboard";
import { LockButton } from "./Lock";
import { Lockup } from "./Logo";
import { PageMore, type MoreItem } from "./PageMore";
import { useSidebar } from "./Shell";
import { ancestors, leaf } from "./tree";

/* A file just made from the sidebar, whose title comes next — asked where it is drawn, here, once its
   page opens. `NoteTitle`'s `nameWhenOpened`, for the kinds whose title is only in this bar. */
let naming: { name: string; title: string } | null = null;

/**
 * Ask the top bar to take the title of `name` as soon as the page opening it draws one, starting
 * from `title` — what the file was made with. Said by the caller because the page cannot know it
 * yet: the board page stays up from one board to the next, and until the new file is read the title
 * it holds is the last file's.
 */
export function nameInBar(name: string, title: string): void {
  naming = { name, title };
}

function takeNaming(name: string): string | null {
  if (naming?.name !== name) return null;
  const { title } = naming;
  naming = null;
  return title;
}

/**
 * The bar across the top of every page: where the file is, what it is called, and what can be done to
 * it.
 *
 * Everything that makes something moved to `Dock` and `ZoomBar`, and the toggle to `Shell`;
 * what is left is the place the toggle sits, the lockup while the sidebar is away, the
 * folders above the file, its title, and on the right the page's own controls. **That right end was
 * where the phone audit started.** A note had *1 backlink*, *Make it a task*, *Make it an event*,
 * *Export* and *Copy link* as five labelled buttons, and at 929px the title they shared the bar with came out as three
 * letters. Now the right end is the controls that say something at a glance — how many things link
 * here, the page's main action, and Export, which deserves to be seen — and a `⋯` holding
 * the rest. Under 720px the bar folds: no folders, no lockup, Export into the `⋯`.
 *
 * **The title is also where a board, a quiz or a table is named**. A press on it opens the
 * search — a reader looking for "what else is there" looks at the name — and
 * a double-click, *Rename* in the `⋯`, or a file just made puts the title into a box right where it is
 * drawn. It used to be asked in the file's sidebar row, which meant bringing the column over the page
 * on a narrow window to ask it, and a new note asked it twice.
 *
 * The class name stays `dag-toolbar` deliberately: `pages.spec.ts` measures this element to know
 * where the board starts.
 */
export function Toolbar({
  boardName,
  title,
  kind,
  onBoards,
  more = [],
  children,
}: {
  /** What is open. `null` before anything has been, which is where `Welcome` takes over. */
  boardName: string | null;
  title?: string;
  /** What kind of file is open, when one is: what makes its title renameable here. */
  kind?: FileKind;
  onBoards(): void;
  /** The page's rows for the `⋯`, above the bar's own. */
  more?: MoreItem[];
  /** What sits at the far end of the bar — the backlinks, the page's main action, Export. */
  children?: ReactNode;
}) {
  const chord = chordFor("boards");
  const sidebar = useSidebar();
  const away = !sidebar?.docked;
  const crumbs = boardName ? ancestors(boardName) : [];
  /* With nothing open there is no title to show: the welcome card says what to do, and a title
     reading "Open a board" was a button pretending to be a name. */
  const shown = title ?? (boardName ? (sidebar ? leaf(boardName) : boardName) : null);
  const locked = useLocked();
  /* Renaming is a change to the file, so the lock takes it; the row stays, greyed, so the
     menu says what unlocking would give back. */
  const renameable = Boolean(sidebar && kind && boardName);
  /* What the box starts from while it is open: the title the file was made with, when it was just
     made, or what the bar shows. `null` is shut. */
  const [renaming, setRenaming] = useState<string | null>(null);

  /* A file made a moment ago is named here the first time its page draws this bar. Remembered, because
     StrictMode runs this twice and the second run finds the request already taken. */
  const took = useRef<string | null>(null);
  useEffect(() => {
    if (!boardName || !renameable || locked) return setRenaming(null);
    const made = takeNaming(boardName);
    if (made !== null) {
      took.current = boardName;
      setRenaming(made);
    } else if (took.current !== boardName) setRenaming(null);
  }, [boardName, renameable, locked]);

  /* *Copy link* on every file: the app's link by the file's id, which a rename does not
     break and which opens on this machine. What it says for a moment after is the
     bar's, because the menu has shut by then. */
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const id = boardName && kind ? sidebar?.idOf(boardName) : undefined;

  const rows: MoreItem[] = [...more];
  if (id)
    rows.push({
      key: "copy-link",
      label: "Copy link",
      icon: LinkMark,
      hook: "data-dag-toolbar-copy-link",
      onSelect: () => void copyText(appLink(id)).then((ok) => setCopied(ok ? "yes" : "no")),
      split: more.length > 0,
    });
  if (renameable)
    rows.push({
      key: "rename",
      label: "Rename",
      icon: Pencil,
      hook: "data-dag-toolbar-rename",
      onSelect: () => setRenaming(shown ?? ""),
      split: more.length > 0 && !id,
      disabled: locked,
    });
  /* The lock's switch lives here while the page is editable (the UI review): an open padlock in the
     bar said nothing about which state it was in. Locked, the bar says *Read only* in so many words. */
  if (sidebar && !locked)
    rows.push({
      key: "lock",
      label: "Lock: read only",
      icon: Lock,
      hook: "data-dag-readonly-lock",
      title: `Browse without changing anything (${LOCK_KEYS})`,
      onSelect: () => toggleLock(),
      split: rows.length > 0,
    });

  return (
    /* `data-dag-toolbar-edge`: the bar is at the window's left edge, which is where the macOS desktop
       app's traffic lights are (`--window-inset` in `chrome.css`). */
    <header className="dag-toolbar" data-dag-toolbar="" data-dag-toolbar-edge={away ? "" : undefined}>
      {/* Where `Shell`'s toggle is drawn while the column is away. */}
      {sidebar && away ? <span className="dag-sidebar-toggle-slot" aria-hidden="true" /> : null}
      {/* The mark *and the name*, while the sidebar that otherwise carries them is away — and it
          is the way home here too, as it is in the column's head: one press to the welcome card.
          `?snapshot=1` drops this whole header, which is what keeps the reference baselines
          independent of it. */}
      {/* The logo, the folders and the title below are words that take you somewhere — the wordmark,
          a path, a name — drawn as text in the bar, not as `Button`s with a box round them. */}
      {away ? (
        <button
          type="button"
          className="dag-toolbar__logo"
          data-dag-toolbar-home=""
          aria-label="Home"
          title="Home"
          onClick={() => sidebar?.home()}
        >
          <Lockup size={20} />
        </button>
      ) : null}

      <div className="dag-toolbar__where">
        {sidebar && crumbs.length ? (
          <nav className="dag-toolbar__crumbs" aria-label="Folders">
            {crumbs.map((folder) => (
              <span key={folder} className="dag-toolbar__crumb-wrap">
                <button
                  type="button"
                  className="dag-toolbar__crumb"
                  data-dag-crumb={folder}
                  title={`Show ${folder} in the sidebar`}
                  onClick={() => sidebar.reveal(folder)}
                >
                  {leaf(folder)}
                </button>
                <span className="dag-toolbar__sep" aria-hidden="true">
                  /
                </span>
              </span>
            ))}
          </nav>
        ) : null}

        {renaming !== null && boardName && kind && sidebar ? (
          <TitleBox
            key={boardName}
            value={renaming}
            onDone={(v) => {
              setRenaming(null);
              if (v && v !== renaming) sidebar.retitle(kind, boardName, v);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : shown !== null ? (
          <button
            type="button"
            className="dag-toolbar__board"
            data-dag-open-boards=""
            /* The name *and* what pressing it does, because the two are not the same sentence and a
               screen reader gets only this one. */
            aria-label={boardName ? `${shown}: search everything` : "Search everything"}
            title={
              renameable && !locked
                ? `Search (${chord ?? "Space O"}). Double-click to rename`
                : chord
                  ? `Search (${chord})`
                  : "Search"
            }
            onClick={onBoards}
            onDoubleClick={renameable && !locked ? () => setRenaming(shown) : undefined}
          >
            <span className="dag-toolbar__title">{shown}</span>
          </button>
        ) : null}
      </div>

      <div className="dag-toolbar__end">
        {copied ? (
          <span className="dag-toolbar__copied" role="status" data-dag-toolbar-copied={copied}>
            {copied === "yes" ? "Link copied" : "Could not copy"}
          </span>
        ) : null}
        {children}
        {/* The lock, on every page that has a bar: a reader that is not the canvas — the
            Tasks page, the calendar, a quiz — still writes files, and the lock is about all of them. */}
        {sidebar && locked ? <LockButton /> : null}
        {sidebar ? <AssistantToggle /> : null}
        <PageMore items={rows} />
      </div>
    </header>
  );
}

/**
 * The title being typed where it is drawn. Enter or leaving the box keeps what was typed — a name
 * somebody typed and then clicked away from is a name they meant — and Escape takes it back. The text
 * arrives selected, so typing replaces *Untitled*.
 */
function TitleBox({ value, onDone, onCancel }: { value: string; onDone(v: string): void; onCancel(): void }) {
  const [text, setText] = useState(value);
  const box = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (keep) onDone(text.trim());
    else onCancel();
  };
  return (
    <input
      ref={box}
      className="dag-toolbar__name"
      data-dag-toolbar-name=""
      spellCheck={false}
      autoComplete="off"
      aria-label="Title"
      value={text}
      size={Math.max(8, Math.min(40, text.length + 2))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
