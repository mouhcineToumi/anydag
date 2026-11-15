import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  File as FileGlyph,
  FileText,
  Folder as FolderIcon,
  GraduationCap,
  LayoutTemplate,
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
import { collation } from "@/locale";
import { tagKey } from "@/note/tags";
import { hueVars } from "@/render/hue";
import { byDocument } from "@/search/results";
import { useSearch } from "@/search/useSearch";
import type { Found } from "@/search/wire";

import { IconButton } from "./controls";
import { Dialog } from "./Dialog";
import { useSidebar } from "./Shell";
import { tagMatches } from "./tagFilter";
import { hueOfTag, useTagList } from "./tags/tagStore";
import { openTemplates } from "./templates";
import { cardLines, flatten, keyOf, labelOf, leaf, parentOf, prune, tokens, tree, type CardLine, type Entry } from "./tree";
import { middle } from "./tabs/intent";
import { drawn, offsetsOf, scrollFor, windowFor, type Window } from "./virtual";

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
  /** Each document's tags, by name — what a tag chip in the box narrows the list to (#327). */
  tags?: Readonly<Record<string, readonly string[]>>;
  /** Which notes are tasks and which are events: what a row under a tag says it is. */
  tasks?: Readonly<Record<string, unknown>>;
  events?: Readonly<Record<string, unknown>>;
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
const NO_TAGS: Readonly<Record<string, readonly string[]>> = {};

/** The 2px a folder after another, or the first file after the folders, keeps above it (`CardLine`'s `gap`). */
const GAP = 2;

/** The rows the arrows walk outside the tree: the tags `#` offers, the matches in the text and a miss's offers. */
const OUTSIDE = "[data-dag-search-tag-option],[data-dag-hit],[data-dag-hits-new-board],[data-dag-hits-new-note]";

/** What is typed when a tag is being picked: `#` and the start of its name. */
const TAG_TYPED = /^#([^\s#]*)$/;

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
  tags = NO_TAGS,
  tasks = NO_TAGS,
  events = NO_TAGS,
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
  /* A tag chip in the box (#327): only the documents carrying it, names and text alike. */
  const [tag, setTag] = useState<string | null>(null);
  const known = useTagList();
  /* `#` and the start of a name: the tags to pick from, and no search until one is picked. */
  const picking = TAG_TYPED.exec(query);
  const pickingWhat = picking ? (picking[1] ?? "") : null;
  const offered = useMemo(() => {
    if (pickingWhat === null) return [];
    const typed = tagKey(pickingWhat);
    return (known ?? [])
      .filter((t) => t.count > 0 && tagKey(t.name).includes(typed) && (!tag || tagKey(t.name) !== tagKey(tag)))
      .sort((a, b) => Number(!tagKey(a.name).startsWith(typed)) - Number(!tagKey(b.name).startsWith(typed)))
      .slice(0, 8);
  }, [pickingWhat, known, tag]);
  const words = picking ? "" : query;
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

  /* The whole tree, before the search narrows it — and before a tag does: an attachment carries none. */
  const every = useMemo<Entry[]>(
    () => [
      ...boards.map((name) => ({ kind: "board" as const, name, title: titles[name] })),
      ...notes.map((name) => ({ kind: "note" as const, name, title: titles[name] })),
      ...quizzes.map((name) => ({ kind: "quiz" as const, name, title: titles[name] })),
      ...tables.map((name) => ({ kind: "table" as const, name, title: titles[name] })),
      ...files.map((name) => ({ kind: "file" as const, name, title: titles[name] })),
    ],
    [boards, notes, quizzes, tables, files, titles],
  );
  const entries = useMemo(
    () => (tag ? every.filter((e) => e.kind !== "file" && tagMatches({ kind: "tag", name: tag }, tags[e.name])) : every),
    [every, tag, tags],
  );
  /* Under a tag the folders are only those its documents are in: an empty one carries nothing. */
  const all = useMemo(() => tree(entries, tag ? [] : folders), [entries, tag, folders]);

  /* What the search left. An empty query keeps everything, including the folders with nothing in
     them — otherwise a folder somebody has just made is unreachable the moment anything is typed. */
  const terms = useMemo(() => tokens(words), [words]);
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
  const { hits, settled } = useSearch(words, tag);

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
  const miss = !tag && terms.length > 0 && settled && shown.length === 0 && root.folders.length === 0 && hits.length === 0;
  /* A tag and no words: every document carrying it, one list by title, each saying its kind. */
  const tagged = useMemo(
    () =>
      tag && terms.length === 0
        ? [...entries].sort((a, b) => collation({ numeric: true }).compare(labelOf(a), labelOf(b)))
        : null,
    [tag, terms.length, entries],
  );

  /*
   * **The tree, or the tagged list, as lines, and only the lines in view drawn** (`virtual.ts`, as the
   * sidebar does): with nothing typed the card lists every name in the vault, and 50,000 of them were
   * 400,000 elements and 3.8 s before the first row showed (#267). Each line is placed by its offset,
   * from heights measured off the lines that are drawn — a row, a folder's heading, an empty
   * folder's line — so the phone's taller rows are the stylesheet's to say.
   */
  const lines = useMemo<CardLine[] | null>(() => {
    if (picking) return null;
    if (tagged) return tagged.map((entry) => ({ type: "file", entry, depth: 0, gap: false }));
    return terms.length === 0 || shown.length > 0 || root.folders.length > 0 ? cardLines(root) : null;
  }, [picking, tagged, terms.length, shown.length, root]);
  const [heights, setHeights] = useState({ folder: 30, file: 31, empty: 26, measured: false });
  const offsets = useMemo(
    () =>
      offsetsOf(
        (lines ?? []).map(
          (l) => (l.type === "folder" ? heights.folder : l.type === "file" ? heights.file : heights.empty) + (l.gap ? GAP : 0),
        ),
      ),
    [lines, heights],
  );
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const rowsRef = useRef<HTMLDivElement>(null);
  /* Measured after every commit, off whichever lines are drawn: one more draw when a height was guessed wrong. */
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    if (!rows) return;
    const of = (selector: string) => rows.querySelector(selector)?.getBoundingClientRect().height || 0;
    const folder = of(".dag-folder-row");
    const file = of(".dag-board-row");
    const empty = of(".dag-panel__empty--folder");
    setHeights((h) =>
      (folder && folder !== h.folder) || (file && file !== h.file) || (empty && empty !== h.empty) || (file && !h.measured)
        ? { folder: folder || h.folder, file: file || h.file, empty: empty || h.empty, measured: h.measured || file > 0 }
        : h,
    );
  });
  /* `null` until the list has been measured: the first draw assumes a view as tall as the screen. */
  const [view, setView] = useState<Window | null>(null);
  /** Where the lines start down the scrolling list: under the tags `#` offers, when there are some. */
  const baseOf = (list: HTMLElement, rows: HTMLElement) =>
    rows.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  const syncView = useCallback(() => {
    const list = listRef.current;
    const rows = rowsRef.current;
    if (!list || !rows) return;
    const top = list.scrollTop - baseOf(list, rows);
    setView((prev) => windowFor(offsetsRef.current, top, list.clientHeight, prev));
  }, []);
  useLayoutEffect(syncView, [offsets, syncView]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(syncView);
    watch.observe(list);
    return () => watch.disconnect();
  }, [syncView]);

  /** Scroll so line `i` shows — only when it does not already. */
  const reveal = useCallback(
    (i: number, block: "nearest" | "center") => {
      const list = listRef.current;
      const rows = rowsRef.current;
      if (!list || !rows || i >= offsetsRef.current.length - 1) return;
      const base = baseOf(list, rows);
      const top = list.scrollTop - base;
      const to = scrollFor(offsetsRef.current, i, top, list.clientHeight, block);
      if (to !== top) list.scrollTop = to + base;
      syncView();
    },
    [syncView],
  );

  /* The line the focus is on is drawn wherever the list is scrolled, so the focus is never lost to a
     line going out of the DOM; and one asked to be focused before it was drawn is, once it is. */
  const [focused, setFocused] = useState<number | null>(null);
  const wanted = useRef<number | null>(null);
  const lineButton = (i: number) =>
    rowsRef.current?.querySelector<HTMLButtonElement>(`[data-dag-browser-line="${i}"] button`) ?? null;
  const focusLine = useCallback(
    (i: number) => {
      reveal(i, "nearest");
      const el = lineButton(i);
      if (el) el.focus({ preventScroll: true });
      else wanted.current = i;
    },
    [reveal],
  );
  useLayoutEffect(() => {
    const i = wanted.current;
    if (i === null) return;
    wanted.current = null;
    lineButton(i)?.focus({ preventScroll: true });
  });

  /* The lines the arrows stop at: a file's, but not an attachment's, which no arrow ever reached. */
  const stops = useMemo(() => {
    const out: number[] = [];
    (lines ?? []).forEach((l, i) => {
      if (l.type === "file" && l.entry.kind !== "file") out.push(i);
    });
    return out;
  }, [lines]);

  /*
   * And it opens showing where you already are, centred: fifty-four boards is six screens of list,
   * and a card that opens at the top makes a person scroll to find out where they are before they
   * can decide where to go. `"center"` rather than `"nearest"`, which would leave the row flush
   * against an edge with the rows around it out of view. Once, the first time the row is in the list
   * — which on a vault still being listed is after the card opened — and not once the list has been
   * scrolled: following `board` after that would pull the list from under somebody reading it.
   */
  const current = board ?? note ?? quiz ?? table ?? file;
  const centred = useRef(false);
  useLayoutEffect(() => {
    // Not before a row has been measured: a guessed height puts the row somewhere else.
    if (centred.current || !lines || tagged || !heights.measured) return;
    const i = lines.findIndex((l) => l.type === "file" && l.entry.name === current);
    if (i < 0) return;
    centred.current = true;
    if (!listRef.current?.scrollTop) reveal(i, "center");
  }, [lines, current, tagged, reveal, heights.measured]);

  /** A tag picked from what `#` offered: it is the chip, and the box is the words again. */
  const pickTag = (name: string) => {
    setTag(name);
    setQuery("");
    searchRef.current?.focus();
  };
  const dropTag = () => {
    setTag(null);
    searchRef.current?.focus();
  };

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

  /**
   * Move focus along the rows: the tags `#` offers, the tree's files, the matches in the text and a
   * miss's offers, in that order. Outside the tree the DOM is the list; in it, `stops` is, since the
   * line after the last one drawn is not in the DOM until the list scrolls to it.
   */
  const step = useCallback(
    (from: EventTarget | null, dir: 1 | -1) => {
      const outside = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(OUTSIDE) ?? []);
      const before = outside.filter((el) => el.hasAttribute("data-dag-search-tag-option"));
      const after = outside.filter((el) => !el.hasAttribute("data-dag-search-tag-option"));
      const total = before.length + stops.length + after.length;
      if (total === 0) return;
      const el = from instanceof HTMLElement ? from : null;
      const line = el?.closest("[data-dag-browser-line]");
      let at = -1;
      if (line) at = before.length + stops.indexOf(Number(line.getAttribute("data-dag-browser-line")));
      else if (el && before.includes(el as HTMLButtonElement)) at = before.indexOf(el as HTMLButtonElement);
      else if (el && after.includes(el as HTMLButtonElement))
        at = before.length + stops.length + after.indexOf(el as HTMLButtonElement);
      const next = at < 0 ? (dir === 1 ? 0 : total - 1) : Math.min(Math.max(at + dir, 0), total - 1);
      if (next < before.length) before[next]?.focus();
      else if (next < before.length + stops.length) focusLine(stops[next - before.length]!);
      else after[next - before.length - stops.length]?.focus();
    },
    [stops, focusLine],
  );

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(null, 1);
    } else if (e.key === "Backspace" && tag && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
      /* At the start of the box, the chip before it is the next thing to take back. */
      e.preventDefault();
      dropTag();
    } else if (e.key === "Enter" && picking) {
      e.preventDefault();
      if (offered[0]) pickTag(offered[0].name);
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
    } else if (tag) {
      setTag(null);
    } else {
      onClose();
    }
  };

  /**
   * One file. A board row is `data-dag-board`, as every spec that finds one expects, a note row
   * `data-dag-note`, a quiz row `data-dag-quiz` and a table row `data-dag-table`. Under a tag and no
   * words, a row also says its kind at its end, and the open file is not marked: the list is by title.
   */
  const renderFile = (entry: Entry) => {
    const { name, kind } = entry;
    if (tagged)
      return (
        <div className="dag-board-row">
          <button
            {...{ [`data-dag-${kind}`]: name }}
            className="dag-board"
            onClick={() => open(entry)}
            onAuxClick={middle(() => open(entry))}
          >
            <KindMark kind={kind} name={name} className="dag-board__kind" />
            {labelOf(entry)}
            <span className="dag-board__what">{tasks[name] ? "task" : events[name] ? "event" : kind}</span>
          </button>
        </div>
      );
    const open_ = { board, note, quiz, table, file }[kind];
    const isCurrent = name === open_;
    return (
      <div className="dag-board-row">
        <button
          {...{ [`data-dag-${kind}`]: name }}
          className={isCurrent ? "dag-board dag-board--on" : "dag-board"}
          aria-current={isCurrent ? "true" : undefined}
          title={kind === "board" ? name : `${name} (${kind})`}
          onClick={() => open(entry)}
          onAuxClick={middle(() => open(entry))}
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
   * One line, placed at its offset and indented by its depth, with one guide rule per level — the
   * rules the nested folders drew, so four levels of nesting are four lines a reader can walk back up.
   */
  const renderLine = (line: CardLine, i: number) => {
    const style = {
      "--depth": line.depth,
      top: offsets[i],
      height: offsets[i + 1]! - offsets[i]!,
      paddingTop: line.gap ? GAP : undefined,
    } as CSSProperties;
    const key = line.type === "file" ? keyOf(line.entry) : `${line.type}:${line.path}`;
    return (
      <div key={key} className="dag-browser__line" style={style} data-dag-browser-line={i}>
        {line.type === "file" ? (
          renderFile(line.entry)
        ) : line.type === "folder" ? (
          <div className="dag-folder-row">
            <FolderIcon {...ICON} aria-hidden="true" />
            {/* The leaf, not the path: the indent says the rest. */}
            <h2 className="dag-browser__folder" data-dag-folder={line.path} title={line.path}>
              {line.name}
            </h2>
          </div>
        ) : (
          <p className="dag-panel__empty dag-panel__empty--folder">empty</p>
        )}
      </div>
    );
  };
  const drawnLines = lines
    ? drawn(view ?? windowFor(offsets, 0, window.innerHeight), lines.length, focused === null ? [] : [focused])
    : [];

  return (
    /* The app's dialog frame (`ui/Dialog.tsx`): over the sidebar too, with the scrim every dialog
       has, the page behind it inert, and Tab kept inside — it said `aria-modal` and Tab walked out
       of it into the sidebar. */
    <Dialog scrim={{ "data-dag-boards": "" }} onClose={onClose} className="dag-browser" aria-label="Boards" onKeyDown={onEscape}>
      <div className="dag-panel__search">
        <Search {...ICON} aria-hidden="true" />
        {tag ? (
          <span className="dag-tag dag-tag--x" data-dag-search-tag={tag}>
            <span className="dag-tag__dot" style={hueVars(hueOfTag(known, tag))} aria-hidden="true" />
            <span className="dag-tag__name">{tag}</span>
            <IconButton
              size="sm"
              className="dag-tag__remove"
              data-dag-search-tag-remove=""
              aria-label={`Remove the tag ${tag}`}
              onClick={dropTag}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </span>
        ) : null}
        <input
          ref={searchRef}
          type="text"
          className="dag-panel__input"
          placeholder={searchLabel(notes.length, quizzes.length, tables.length, files.length)}
          aria-label={
            tag
              ? `${searchLabel(notes.length, quizzes.length, tables.length, files.length)} tagged ${tag}`
              : searchLabel(notes.length, quizzes.length, tables.length, files.length)
          }
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
          aria-label={query || tag ? "Clear search" : "Close"}
          title={query || tag ? "Clear (Escape)" : "Close (Escape)"}
          onClick={() => {
            if (!query && !tag) return onClose();
            if (query) setQuery("");
            else setTag(null);
            searchRef.current?.focus();
          }}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </div>

      <div className="dag-panel__list" ref={listRef} onKeyDown={onListKey} onScroll={syncView}>
        {picking ? (
          <section className="dag-hits" aria-label="Tags" data-dag-search-tags="">
            <h2 className="dag-hits__head">Tags</h2>
            {offered.map((t) => (
              <button
                key={t.name}
                type="button"
                className="dag-board"
                data-dag-search-tag-option={t.name}
                onClick={() => pickTag(t.name)}
              >
                <span className="dag-tag__dot dag-board__kind" style={hueVars(t.hue)} aria-hidden="true" />
                {t.name}
                <span className="dag-board__what">{t.count === 1 ? "1 document" : `${t.count} documents`}</span>
              </button>
            ))}
            {offered.length === 0 ? (
              <p className="dag-panel__empty" data-dag-search-tags-empty="">
                {known === null ? "reading the tags…" : `no tag matches “${query.slice(1)}”`}
              </p>
            ) : null}
          </section>
        ) : null}

        {!picking && entries.length === 0 && terms.length === 0 ? (
          <p className="dag-panel__empty">
            {tag ? `nothing is tagged ${tag}` : "nothing here yet: the sidebar makes a board or a note"}
          </p>
        ) : null}

        {lines && lines.length > 0 ? (
          <div
            ref={rowsRef}
            className="dag-browser__rows"
            style={{ height: offsets[lines.length] }}
            onFocus={(e) => {
              const line = (e.target as HTMLElement).closest("[data-dag-browser-line]");
              setFocused(line ? Number(line.getAttribute("data-dag-browser-line")) : null);
            }}
            onBlur={() => setFocused(null)}
          >
            {drawnLines.map((i) => renderLine(lines[i]!, i))}
          </div>
        ) : null}

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
                onAuxClick={middle(() => openHit(h))}
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
                {/* The words typed are the title, and the template is chosen next. */}
                <button
                  type="button"
                  className="dag-hits__new"
                  data-dag-hits-new-from-template=""
                  onClick={() => {
                    openTemplates({ folder: here, title: query.trim() });
                    onClose();
                  }}
                >
                  <LayoutTemplate {...ICON} aria-hidden="true" />
                  <span className="dag-hits__make-name">New note “{query.trim()}” from template…</span>
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <p className="dag-panel__count" data-dag-boards-count="">
        {tagged
          ? `${tagged.length} ${tagged.length === 1 ? "document" : "documents"}`
          : shown.length === every.length
            ? countOf(boards.length, notes.length, quizzes.length, tables.length, files.length)
            : `${shown.length} of ${every.length}`}
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
