import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  File as FileGlyph,
  FileText,
  Folder as FolderIcon,
  GraduationCap,
  Plus,
  Search,
  Table2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import { itemName } from "@/board/types";
import type { FileKind } from "@/board/useBoard";
import { FileIcon } from "@/files/FileIcon";
import { byDocument } from "@/search/results";
import { useSearch } from "@/search/useSearch";
import type { Found } from "@/search/wire";

import { Dialog } from "./Dialog";
import { useSidebar } from "./Shell";
import { flatten, keyOf, labelOf, leaf, parentOf, prune, tokens, tree, type Entry, type Tree } from "./tree";

interface Props {
  boards: string[];
  /**
   * Every note: a second kind of file, listed and foldered with the boards and opened full-window
   *. Absent is none, which is what a caller that predates notes passes.
   */
  notes?: string[];
  /** Every quiz, the third kind. Absent is none. */
  quizzes?: string[];
  /** Every table, the fourth kind. Absent is none. */
  tables?: string[];
  /** Every attachment, the fourth, found by what it is called. Absent is none. */
  files?: string[];
  /** Every folder on disk, the empty ones included — which is why it is not derived from `boards`. */
  folders: string[];
  /** What each file is called, by name: a row says this, and the search looks in it too. */
  titles?: Readonly<Record<string, string>>;
  board: string | null;
  /** The note that is open, if a note is what is open. */
  note?: string | null;
  /** The quiz that is open, if a quiz is what is open. */
  quiz?: string | null;
  /** The table that is open, if a table is what is open. */
  table?: string | null;
  /** The attachment that is open, if one is. */
  file?: string | null;
  /** Open a file of any kind — one callback where there were `onBoard` and `onNote`. */
  onOpen(kind: FileKind, name: string): void;
  /**
   * Open a document at one part of it — a match in its text: an item on a board, a block
   * in a note, or nothing, for a match in its title. Absent, a match opens the document at its top.
   */
  onOpenAt?(kind: FileKind, name: string, part?: string): void;
  onClose(): void;
}

/** Lucide at one size and weight, stated once — the same rule the dock follows. */
const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The boards on this machine, over the board rather than beside it.
 *
 * **It was a permanent column down the left**, and before that a `<select>` in the
 * toolbar. The `<select>` was replaced because a dropdown is fine for the three or four boards a
 * new checkout has and useless at thirty: one visible line, sorted by nothing a reader chose, and
 * unsearchable without knowing the exact name. The column answered all of that and then charged
 * 232px of canvas for it, permanently, on every board — to show a list somebody consults for the
 * two seconds it takes to switch. A dialog is the same list at the moment it is wanted, and the
 * canvas gets its width back.
 *
 * It is the shortcut sheet's and the settings card's shape — scrim, card, Escape, a click outside
 * — which is what this app already does for a surface that is neither a column nor a strip.
 *
 * Focus is roving rather than an `aria-activedescendant` combobox: the rows are real buttons, so
 * Enter and Space already open one, and the only thing left to write is which button an arrow key
 * moves to.
 *
 * **It is a search, and almost only a search.** Renaming, moving, duplicating and deleting a file
 * used to happen here too, on four icons that appeared on every row's hover; they are the sidebar's
 * now, on each row's `⋯`, and this card is what `space O`, the toolbar's name and the sidebar's
 * Search row open. A control in two places is two places to keep in step, and the one kept is the
 * one that is up while the files are being worked on.
 *
 * The one thing it makes is what a miss offers: the words somebody typed, as a board or a note, in
 * the open file's folder. That goes through the sidebar's own create (`useSidebar().create`), so a
 * file begins one way whether it was asked for here or from the `+`.
 */
/** No notes, as one array rather than a fresh one per render — which would recompute the tree every time. */
const NO_NOTES: string[] = [];
const NO_QUIZZES: string[] = [];
const NO_TABLES: string[] = [];
const NO_FILES: string[] = [];
const NO_TITLES: Readonly<Record<string, string>> = {};

/** What each kind wears before its name, in a row and in a hit. A board wears none in a row, as it never has. */
const KIND_ICON = { board: Workflow, note: FileText, quiz: GraduationCap, table: Table2, file: FileGlyph } satisfies Record<
  FileKind,
  LucideIcon
>;

/** A kind's mark — an attachment's by its type, a PDF's and a video's apart. */
function KindMark({ kind, name, className }: { kind: FileKind; name?: string; className?: string }) {
  if (kind === "file" && name) return <FileIcon name={name} {...ICON} className={className} />;
  const Mark = KIND_ICON[kind];
  return <Mark {...ICON} className={className} aria-hidden="true" />;
}

export function BoardBrowser({
  boards,
  notes = NO_NOTES,
  quizzes = NO_QUIZZES,
  tables = NO_TABLES,
  files = NO_FILES,
  folders,
  titles = NO_TITLES,
  board,
  note = null,
  quiz = null,
  table = null,
  file = null,
  onOpen,
  onOpenAt,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /* The sidebar's own create path, for a miss: one way a file begins. `null` only where the whole
     Shell is absent — a snapshot, which draws no search either. */
  const sidebar = useSidebar();

  /* The card takes focus when it opens, and it takes it into the search box rather than onto the
     card itself: what a person came here to do is find a board, and a dialog that opens with the
     caret already in the filter is one keystroke from the answer. The card owning its own Escape
     needs focus to be *inside* it, which this satisfies — see the handler below. */
  useEffect(() => searchRef.current?.focus(), []);

  /*
   * And it opens showing where you already are.
   *
   * The column could leave this to chance: it was up the whole time, so whatever it was scrolled
   * to was where somebody had left it. A card that appears for two seconds cannot — fifty-four
   * boards is six screens of list, the open one is `aria-current` somewhere in the middle of it,
   * and a dialog that opens at the top makes a person scroll to find out where they are before
   * they can decide where to go.
   *
   * **`"center"`, not `"nearest"`.** `"nearest"` scrolls the least it can, which leaves the row
   * flush against whichever edge it came in from — so the board you are on is on screen and the
   * rows *around* it are not, and a copy made from its own row appears below the fold. That is a
   * row nothing can hover, which is how the suite found it. Centring costs nothing when the target
   * is already in the first screenful, because `scrollIntoView` never scrolls past the top.
   *
   * Once, on open — the dependency list is empty deliberately. Re-running it whenever `board`
   * changed would yank the list back the moment a rename or a duplicate landed, under the pointer
   * of somebody who was reading a different part of it.
   */
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, []);

  /* The whole tree, before the search narrows it. */
  const entries = useMemo<Entry[]>(
    () => [
      ...boards.map((name) => ({ kind: "board" as const, name, title: titles[name] })),
      ...notes.map((name) => ({ kind: "note" as const, name, title: titles[name] })),
      ...quizzes.map((name) => ({ kind: "quiz" as const, name, title: titles[name] })),
      ...tables.map((name) => ({ kind: "table" as const, name, title: titles[name] })),
      ...files.map((name) => ({ kind: "file" as const, name, title: titles[name] })),
    ],
    [boards, notes, quizzes, tables, files, titles],
  );
  const all = useMemo(() => tree(entries, folders), [entries, folders]);

  /* What the search left. An empty query keeps everything, including the folders with nothing in
     them — otherwise a folder somebody has just made is unreachable the moment anything is typed. */
  const terms = useMemo(() => tokens(query), [query]);
  const root = useMemo(
    () => (terms.length === 0 ? all : (prune(all, terms) ?? { ...all, folders: [], files: [] })),
    [all, terms],
  );

  /* In the order the rows are drawn, so the count is what is on screen and Enter opens the row a
     reader would call the first one — which stopped being `boards[0]` when folders went first. */
  const shown = useMemo(() => flatten(root), [root]);

  /*
   * And what the words are *in*. The names above answer "which file is called that"; this
   * answers "where did I write that", across every board's items and every note's blocks, in one
   * list. The server matches (`/__board/search`) and the page draws what it sends, so the page never
   * holds the vault's text; a query goes out when typing pauses and a newer one cancels it.
   */
  const { hits, settled } = useSearch(query);

  /*
   * A file that matched by name is already a row; listing its blocks under the words would say the
   * same file twice. It appears once, by its name — its best match — and the row says the words are
   * in its text as well. `byDocument` is the whole of that rule, and `test/search-results.test.ts`
   * holds it.
   */
  const named = useMemo(() => new Set(shown.map(keyOf)), [shown]);
  const split = useMemo(() => byDocument(hits, named), [hits, named]);

  /* Where a file made from a miss goes: the folder the open file is in, as the sidebar's New does.
     Nothing open is the top level. */
  const here = parentOf(board ?? note ?? quiz ?? table ?? file ?? "");

  /* A miss is no name, no text and no folder: there is nothing to show, so there is something to
     make. Not while the answer is still on its way — a hit may be a moment away, and "nothing
     matches" must not become a button somebody presses before the answer lands. */
  const miss = terms.length > 0 && settled && shown.length === 0 && root.folders.length === 0 && hits.length === 0;

  /**
   * Opening a board is what this is for, so it is also what closes it.
   *
   */
  const open = useCallback(
    (e: Entry) => {
      onOpen(e.kind, e.name);
      onClose();
    },
    [onOpen, onClose],
  );

  /** A match opens its document where the words are: the item, the block — or the top, for a title. */
  const openHit = useCallback(
    (h: Found) => {
      if (onOpenAt) onOpenAt(h.kind, h.name, h.part ?? undefined);
      else onOpen(h.kind, h.name);
      onClose();
    },
    [onOpenAt, onOpen, onClose],
  );

  /**
   * Make what was typed. The sidebar's New path in the open folder: it makes the file under that
   * title, opens it, and closes this card. The board is first, which is what Enter on a miss presses.
   */
  const create = useCallback(
    (kind: "board" | "note") => {
      const title = query.trim();
      if (!title || !sidebar) return;
      sidebar.create(kind, here, title);
      onClose();
    },
    [query, sidebar, here, onClose],
  );

  /** Move focus along the rendered rows. The DOM is the list, so nothing has to be kept in step. */
  const step = useCallback((from: EventTarget | null, dir: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-dag-board],[data-dag-note],[data-dag-quiz],[data-dag-table],[data-dag-hit],[data-dag-hits-new-board],[data-dag-hits-new-note]",
      ) ?? [],
    );
    if (rows.length === 0) return;
    const i = rows.indexOf(from as HTMLButtonElement);
    const next = i === -1 ? (dir === 1 ? 0 : rows.length - 1) : Math.min(Math.max(i + dir, 0), rows.length - 1);
    rows[next]?.focus();
  }, []);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(null, 1);
    } else if (e.key === "Enter") {
      /* Type enough to leave one board standing and press Enter — the search is the picker. With
         no name left standing, the best match in the text is the first row, so it is what opens;
         with nothing at all, the first of the two offers — New board — is what Enter makes. */
      e.preventDefault();
      if (query.trim() && shown[0]) open(shown[0]);
      else if (settled && hits[0]) openHit(hits[0]);
      else if (shown[0]) open(shown[0]);
      else if (miss) create("board");
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(e.target, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(e.target, -1);
    }
  };

  /*
   * One Escape, and it lets go of the innermost thing first: the filter, then the card.
   *
   * It is handled here and stopped, for the reason the settings card states: `typing()` in
   * `useEditor` counts a focused INPUT, BUTTON or SELECT as somebody typing and leaves the window
   * keys alone, which is true of everything in here — so the window's Escape chain cannot see the
   * key and the card has to own it. Stopping it keeps that chain's order intact.
   */
  const onEscape = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (query) {
      setQuery("");
    } else {
      onClose();
    }
  };

  /**
   * One file. A board row is `data-dag-board`, as every spec that finds one expects, a note row
   * `data-dag-note`, a quiz row `data-dag-quiz` and a table row `data-dag-table`; each but a board wears its mark before its
   * name, and a board wears none, as it never has.
   */
  const renderFile = (entry: Entry) => {
    const { name, kind } = entry;
    const open_ = { board, note, quiz, table, file }[kind];
    const current = name === open_;
    return (
      <div key={keyOf(entry)} className="dag-board-row">
        <button
          {...{ [`data-dag-${kind}`]: name }}
          className={current ? "dag-board dag-board--on" : "dag-board"}
          aria-current={current ? "true" : undefined}
          title={kind === "board" ? name : `${name} (${kind})`}
          onClick={() => open(entry)}
        >
          {/* Every kind wears its mark, a board too: with five kinds in one list, the one
              with no mark was the one a reader had to work out by elimination. */}
          <KindMark kind={kind} name={name} className="dag-board__kind" />
          {labelOf(entry)}
          {/* The same file, found twice, said once: its name is the row and this is the second
              half. Its block matches are not repeated in the section below. */}
          {split.inText.has(keyOf(entry)) ? <span className="dag-board__also"> · and in the text</span> : null}
        </button>
      </div>
    );
  };

  /**
   * One folder and everything under it, recursively — the root included, which is the node with no
   * heading and no indent.
   */
  const renderFolder = (node: Tree): React.ReactNode => (
    <section key={node.path || "."} className="dag-browser__group">
      {node.path ? (
        <div className="dag-folder-row">
          <FolderIcon {...ICON} aria-hidden="true" />
          {/* The leaf, not the path. `projects/201-notes/svg` spelled out on one line is
              three levels of structure said at the one size in this card that is hardest to read,
              above a board indented exactly as far as a board at the top level. The indent says
              the rest. */}
          <h2 className="dag-browser__folder" data-dag-folder={node.path} title={node.path}>
            {node.name}
          </h2>
        </div>
      ) : null}
      <div className={node.path ? "dag-browser__children" : undefined}>
        {node.folders.map(renderFolder)}
        {node.files.map(renderFile)}
        {node.path && node.folders.length === 0 && node.files.length === 0 ? (
          <p className="dag-panel__empty dag-panel__empty--folder">empty</p>
        ) : null}
      </div>
    </section>
  );

  return (
    /* The app's dialog frame (`ui/Dialog.tsx`): over the sidebar too, with the scrim every dialog
       has, the page behind it inert, and Tab kept inside — it said `aria-modal` and Tab walked out
       of it into the sidebar. */
    <Dialog scrim={{ "data-dag-boards": "" }} onClose={onClose} className="dag-browser" aria-label="Boards" onKeyDown={onEscape}>
      <div className="dag-panel__search">
        <Search {...ICON} aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          className="dag-panel__input"
          placeholder={searchLabel(notes.length, quizzes.length, tables.length, files.length)}
          aria-label={searchLabel(notes.length, quizzes.length, tables.length, files.length)}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
        {/* One ×, which does what Escape does: with words typed it takes them back, and
              with none it closes. Two of them side by side, one clearing and one closing, looked
              the same and did different things. */}
        <button
          className="dag-panel__clear"
          data-dag-boards-close=""
          aria-label={query ? "Clear search" : "Close"}
          title={query ? "Clear (Escape)" : "Close (Escape)"}
          onClick={() => {
            if (!query) return onClose();
            setQuery("");
            searchRef.current?.focus();
          }}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </div>

      <div className="dag-panel__list" ref={listRef} onKeyDown={onListKey}>
        {entries.length === 0 && terms.length === 0 ? (
          <p className="dag-panel__empty">nothing here yet: the sidebar makes a board or a note</p>
        ) : null}

        {terms.length === 0 || shown.length > 0 || root.folders.length > 0 ? renderFolder(root) : null}

        {terms.length > 0 && (split.hits.length > 0 || hits.length === 0) ? (
          <section className="dag-hits" aria-label={split.hits.length > 0 ? "In the text" : undefined} data-dag-hits="">
            {split.hits.length > 0 ? <h2 className="dag-hits__head">In the text</h2> : null}
            {split.hits.map((h, i) => (
              <button
                /* With its place: two units of one document can share a part — two blocks with no
                     anchor on one line of a table, say — and a key React sees twice is a console
                     warning, which is a failed suite. */
                key={`${h.id}#${h.part ?? ""}#${i}`}
                type="button"
                className="dag-hit"
                data-dag-hit={h.name}
                data-dag-hit-kind={h.kind}
                data-dag-hit-part={h.part ?? ""}
                title={h.name}
                onClick={() => openHit(h)}
              >
                <span className="dag-hit__where">
                  <KindMark kind={h.kind} name={h.name} />
                  <span className="dag-hit__doc">{h.title ?? leaf(h.name)}</span>
                  <span className="dag-hit__what">{WHAT[h.what] ?? kindWord(h.what)}</span>
                </span>
                <span className="dag-hit__text">
                  {h.runs.map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
                </span>
              </button>
            ))}
            {hits.length === 0 ? (
              <p className="dag-panel__empty" data-dag-hits-empty="">
                {!settled
                  ? "searching the text of every board and note…"
                  : shown.length === 0 && root.folders.length === 0
                    ? `nothing matches “${query}”`
                    : `no text matches “${query}”`}
              </p>
            ) : null}
            {miss && sidebar ? (
              <div className="dag-hits__make">
                {/* The board first: it is what Enter on a miss makes. */}
                <button type="button" className="dag-hits__new" data-dag-hits-new-board="" onClick={() => create("board")}>
                  <Plus {...ICON} aria-hidden="true" />
                  <span className="dag-hits__make-name">New board “{query.trim()}”</span>
                </button>
                <button type="button" className="dag-hits__new" data-dag-hits-new-note="" onClick={() => create("note")}>
                  <Plus {...ICON} aria-hidden="true" />
                  <span className="dag-hits__make-name">New note “{query.trim()}”</span>
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <p className="dag-panel__count">
        {shown.length === entries.length
          ? countOf(boards.length, notes.length, quizzes.length, tables.length, files.length)
          : `${shown.length} of ${entries.length}`}
        {terms.length > 0 ? ` · ${hits.length} in the text` : null}
      </p>
    </Dialog>
  );
}

/** What a match is in, in the words of the person reading the list rather than the file's. */
const WHAT: Record<string, string> = {
  title: "title",
  md: "text",
  note: "sticky note",
  image: "caption",
  prompt: "prompt",
  question: "question",
  file: "file name",
  heading: "heading",
  paragraph: "paragraph",
  list: "list",
  quote: "quote",
  code: "code",
  table: "table",
  equation: "equation",
};

/** A diagram's kind as a word in the result line, lower case like the rest of it — "git graph", "C4". */
function kindWord(what: string): string {
  const name = itemName(what);
  return /^[A-Z0-9]+$/.test(name) ? name : name.toLowerCase();
}

/** What the search box says it looks through: only the kinds there are any of, in the sentence's own order. */
function searchLabel(notes: number, quizzes: number, tables = 0, files = 0): string {
  const kinds = [
    "boards",
    ...(notes ? ["notes"] : []),
    ...(quizzes ? ["quizzes"] : []),
    ...(tables ? ["tables"] : []),
    ...(files ? ["files"] : []),
  ];
  return `Search ${kinds.length < 2 ? kinds.join("") : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`}`;
}

/** "12 boards", or "12 boards · 3 notes · 2 quizzes" once there are any of the others to count. */
function countOf(boards: number, notes: number, quizzes = 0, tables = 0, files = 0): string {
  const parts = [`${boards} board${boards === 1 ? "" : "s"}`];
  if (notes) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  if (quizzes) parts.push(`${quizzes} ${quizzes === 1 ? "quiz" : "quizzes"}`);
  if (tables) parts.push(`${tables} table${tables === 1 ? "" : "s"}`);
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
