import { PanelLeft } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import {
  FILE_KINDS,
  blankBoardText,
  blankEventText,
  blankNoteText,
  blankQuizText,
  blankTableText,
  blankTaskText,
  createFile,
  createFolder,
  createNote,
  deleteBoard,
  deleteFolder,
  duplicateBoard,
  everyFile,
  moveBoard,
  moveFolder,
  retitleFile,
  setEvent,
  setProject,
  setTask,
  type FileKind,
  type TextKind,
  type TrashEntry,
  UNTITLED,
} from "@/board/useBoard";
import { filedIn, guess } from "@/board/guess";
import { uploadFiles } from "@/files/upload";
import { nextHourEvent, type NoteEvent } from "@/note/event";
import { folderTitle, projectText, type Project } from "@/note/project";
import { titleStem, type Task } from "@/note/task";
import { FAVOURITES, SIDEBAR, SIDEBAR_FOLDERS, SIDEBAR_WIDTH, readFlag, readPref, writeFlag, writeLocal, writePref } from "@/settings/prefs";
import type { QuizzesRun } from "@/ui/quiz/Gallery";
import { usePractice } from "@/ui/quiz/practice";
import { openVault, transferFile, transferFolder, vaultsNow } from "@/vault/api";
import { GONE, switchVault } from "@/vault/current";

import { isLocked, refuseLocked } from "@/settings/lock";
import { LockNotice, useLockKey, useLockedRoot } from "./Lock";
import { nameWhenOpened } from "./NoteTitle";
import { nameInBar } from "./Toolbar";
import { AssistantPanel } from "@/assistant/Panel";
import { usePanel } from "@/assistant/panelState";
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_W, Sidebar, folderKey, type SidebarFiles, type Thing } from "./Sidebar";
import { TrashNotice, type Gone } from "./TrashNotice";
import { ancestors, follow, keyOf, leaf, rebase, type Change } from "./tree";

/**
 * What the sidebar is doing, for the one other place that has to know: the toolbar, which keeps
 * the toggle's place and carries the lockup while the sidebar is not there to carry them.
 */
export interface SidebarControl {
  /** Docked beside the page, taking its width. False while it is put away, peeking or narrow. */
  docked: boolean;
  /** Show this folder: open it and everything above it, and bring the column up if it is away. */
  reveal(folder: string): void;
  /**
   * Make a board, a note, a task or a quiz, open it, and name it where it is drawn — what New board
   * does, and what the welcome card's two buttons do, so there is one way a file begins.
   * A task is a note that starts with a status, an event one that starts with a start
   *; a quiz is a kind of its own.
   */
  create(kind: TextKind | "task" | "event", folder?: string): void;
  /**
   * A page renamed the file it has open — a note's own title, written where it is drawn.
   * What the sidebar remembers by name follows it, as it follows a rename made in a row.
   */
  renamed(kind: FileKind, from: string, to: string): void;
  /**
   * Call the open file something, from the top bar: the sidebar's own rename, so what is
   * open, the favourites and the folders all follow it the way they follow a row's.
   */
  retitle(kind: FileKind, name: string, title: string): void;
  /** A listed file's permanent id, which a link to it carries. */
  idOf(name: string): string | undefined;
}

const SidebarContext = createContext<SidebarControl | null>(null);

/** The sidebar's control, or `null` where there is none — a snapshot draws no sidebar. */
export function useSidebar(): SidebarControl | null {
  return useContext(SidebarContext);
}

/**
 * Below this the column never docks, and is a sheet over the whole window instead — a phone.
 *
 * It was 960px, on the argument that 248px of a 960px window is a quarter of the canvas. The
 * cost of that rule turned out to be worse: a 929px laptop window could not keep its
 * navigation open at all, and at that width the column now narrows to 232px rather than leaving
 * (`.dag-sidebar`'s width). Under 720px there is no room for a page beside it, whatever the
 * preference says — and the preference is not overwritten.
 */
const NARROW = "(max-width: 719px)";

/** How long the pointer may be off the peeking column before it goes, so a diagonal exit does not flicker. */
const PEEK_GRACE = 300;

function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia(NARROW).matches,
  );
}

const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

/* `kind:name`, for a kind there is. Read off `FILE_KINDS` rather than spelled out: spelled
   `(board|note)`, a favourite quiz was dropped the next time the page loaded. */
const FAVOURITE_KEY = new RegExp(`^(${FILE_KINDS.join("|")}):.`);

/** What a new file of each kind starts as. Keyed on the kind, so a sixth kind is a type error here. An
    attachment is uploaded rather than made, so it has no blank. */
const BLANK: Readonly<Record<TextKind, () => string>> = { board: blankBoardText, note: blankNoteText, quiz: blankQuizText, table: blankTableText };

function readFavourites(): string[] {
  try {
    const raw = JSON.parse(readPref(FAVOURITES) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && FAVOURITE_KEY.test(x)) : [];
  } catch {
    return [];
  }
}

function readFolders(): Set<string> {
  try {
    const raw = JSON.parse(readPref(SIDEBAR_FOLDERS) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The window: the sidebar down the left, and the page — a board or a note — beside it.
 *
 * **Above both pages, which is the whole reason it exists.** `App` renders a `NoteApp` or a
 * `BoardApp` and never both, so a sidebar inside either would be unmounted and rebuilt every time
 * somebody went from a board to a note: the scroll gone, the list fetched again, a flash of nothing
 * where the files were. Here it stays exactly where it was, and so does the one subscription to the
 * list — `useBoardList` used to be called once per page.
 *
 * **It never renders under `?snapshot=1`.** `App` does not wrap a snapshot at all, so the 45 visual
 * baselines see the same `.dag-app` at the same place they always have.
 *
 * Three states, and only one of them costs canvas. *Docked* is a flex child beside the page, and
 * is what the preference remembers. *Peeking* is the same column slid in over the page while the
 * pointer is on the toggle, and costs nothing. *Narrow* is a window too small to spare the width,
 * where a click on the toggle brings it over the page until something is opened, the pointer
 * presses elsewhere, or Escape.
 *
 * **One toggle, in one place, whatever the column is doing.** It used to be two buttons
 * that took turns: the header's, at the column's top *right* while it was docked, and the
 * toolbar's, at the window's top *left* while it was away — so the control jumped the width of the
 * sidebar every time it was pressed, and the next press had to go and find it. A peek drew both at
 * once, the toolbar's and a third, "keep it open", in the floating column's header. Claude.ai's is
 * the model: one button at the top left that never moves. So it is drawn
 * here, once, above both the column and the page, and each of those keeps an empty slot where it
 * sits (`.dag-sidebar-toggle-slot`) — the sidebar's header while it is docked, the toolbar while it
 * is not. Being one element is also what keeps the keyboard's place: a button that unmounted under
 * the Enter that pressed it dropped the focus on `<body>`.
 */
export function Shell({
  boards,
  notes,
  folders,
  titles,
  ids,
  tasks,
  projects,
  events,
  quizzes,
  questions,
  tables,
  attachments,
  sizes,
  loading = false,
  board,
  note,
  quiz,
  table,
  file,
  tasksOpen,
  openTasks,
  calendarOpen,
  openCalendar,
  quizzesOpen,
  openQuizzes,
  trashOpen,
  openTrash,
  assistantOpen,
  openAssistant,
  open,
  children,
}: {
  boards: string[];
  notes: string[];
  folders: string[];
  /** What anyone with a link can view, by name, which the sidebar marks and lists. */
  /** What each file is called, by name — what every row draws. */
  titles: Readonly<Record<string, string>>;
  /** Every listed file's permanent id, by name — what *Copy link* puts on the clipboard. */
  ids: Readonly<Record<string, string>>;
  /** Which notes are tasks, and their status — what a row's glyph and the Tasks count draw. */
  tasks: Readonly<Record<string, Task>>;
  /** Which notes are projects, and their status and colour — what marks a folder as one. */
  projects: Readonly<Record<string, Project>>;
  /** Which notes are events, and when — what a row's glyph and its menu say. */
  events: Readonly<Record<string, NoteEvent>>;
  /** Every quiz, the third kind of file, and how many questions each asks. */
  quizzes: string[];
  questions: Readonly<Record<string, number>>;
  /** Every table, a fourth kind with a text. */
  tables: string[];
  /** Every attachment, and how big each is. */
  attachments: string[];
  sizes: Readonly<Record<string, number>>;
  /** The list has not answered and this browser kept none: the sidebar says it is loading. */
  loading?: boolean;
  /** What is open, which the sidebar marks and reveals. At most one of the four is set. */
  board: string | null;
  note: string | null;
  quiz: string | null;
  table: string | null;
  file: string | null;
  /** Whether the Tasks page is open, and the way to it — a page, not a file, so not `open`. */
  tasksOpen: boolean;
  openTasks(): void;
  /** The same for the Calendar page. */
  calendarOpen: boolean;
  openCalendar(): void;
  /** The same for the Quizzes page; with `"mistakes"`, the Mistakes run it starts, and with
      `folder:<path>` every quiz in a folder as one run. */
  quizzesOpen: boolean;
  openQuizzes(run?: QuizzesRun): void;
  /** The same for the Trash page. */
  trashOpen: boolean;
  openTrash(): void;
  /** The Assistant page (`?chat=`), and the way to it — on a chat, or `1` for the newest. */
  assistantOpen: boolean;
  openAssistant(chat?: string | null): void;
  open(kind: FileKind, name: string | null): void;
  children: ReactNode;
}) {
  /* The Assistant's panel, down the right of whatever page is open (`space A`). */
  const panel = usePanel();
  const [docked, setDocked] = useState(() => readFlag(SIDEBAR, true));
  const narrow = useNarrow();
  /* Over the page, for a hover or for a narrow window's click. Two flags rather than one, because
     they end differently: a peek goes when the pointer leaves, a click stays until it is answered. */
  const [peeking, setPeeking] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [width, setWidth] = useState(() => {
    const n = Number(readPref(SIDEBAR_WIDTH));
    return Number.isFinite(n) && n > 0 ? clampWidth(n) : SIDEBAR_W;
  });
  const [openFolders, setOpenFolders] = useState<Set<string>>(readFolders);
  /* A folder somebody asked to see from outside the column — the toolbar's breadcrumb — which the
     sidebar focuses and scrolls to once. A counter beside it, so asking twice for one folder is two
     asks. */
  const [shown, setShown] = useState<{ folder: string; n: number } | null>(null);
  /* Something just made, whose name is asked for next where its row is drawn. A counter beside
     the key, so a second request for one row is a second request. */
  const [naming, setNaming] = useState<{ key: string; n: number } | null>(null);
  const [favourites, setFavourites] = useState<string[]>(readFavourites);
  const saveFavourites = useCallback((next: (had: string[]) => string[]) => {
    setFavourites((had) => {
      const out = next(had);
      if (out.length === had.length && out.every((k, i) => k === had[i])) return had;
      writePref(FAVOURITES, out.length ? JSON.stringify(out) : null);
      return out;
    });
  }, []);
  /** Keep the favourites in step with what just happened to a file or a folder here. */
  const moved = useCallback((change: Change) => saveFavourites((had) => follow(had, change)), [saveFavourites]);
  const nameNext = useCallback((key: string) => setNaming((was) => ({ key, n: (was?.n ?? 0) + 1 })), []);
  /* What the last delete moved to the trash, which the notice offers to put back. A counter
     beside it, so a second delete is a second notice with its own time to read it. */
  const [trashed, setTrashed] = useState<{ gone: Gone[]; n: number } | null>(null);

  const mode: "docked" | "overlay" | null = !narrow && docked ? "docked" : peeking || pinned ? "overlay" : null;

  /* On a phone the sidebar is the home screen: with nothing open there is no page to show,
     and the files are what somebody opens the app to reach. Brought up each time the page becomes
     empty — a delete, a workspace switch, a cold load — and put away as anything is opened. */
  const nothing = !board && !note && !quiz && !table && !file && !tasksOpen && !calendarOpen && !quizzesOpen && !trashOpen && !assistantOpen;
  useEffect(() => {
    if (narrow && nothing) setPinned(true);
  }, [narrow, nothing]);

  const setFolders = useCallback((next: (had: Set<string>) => Set<string>) => {
    setOpenFolders((had) => {
      const out = next(had);
      if (out === had) return had;
      writeLocal(SIDEBAR_FOLDERS, JSON.stringify([...out].sort()));
      return out;
    });
  }, []);

  /* What is open, by kind — a `Record`, so every question below asks all five and a sixth kind is
     a type error rather than a table taken for a board. */
  const opened = useMemo<Readonly<Record<FileKind, string | null>>>(() => ({ board, note, quiz, table, file }), [board, note, quiz, table, file]);

  /* How many questions are in Mistakes, for the count beside Quizzes. Asked here rather
     than in the column, which mounts again on every peek: this is up for as long as the window is. */
  const mistakes = usePractice()?.pool.length ?? 0;

  /* What is open is always visible: its folders are opened whenever it changes. Opened, never shut
     — the rest of the tree stays as the person left it. */
  const current = board ?? note ?? quiz ?? table ?? file;
  useEffect(() => {
    if (!current) return;
    const up = ancestors(current);
    if (up.length === 0) return;
    setFolders((had) => (up.every((f) => had.has(f)) ? had : new Set([...had, ...up])));
  }, [current, setFolders]);

  const leave = useRef<number | undefined>(undefined);
  const cancelLeave = () => window.clearTimeout(leave.current);

  const toggle = useCallback(() => {
    cancelLeave();
    setPeeking(false);
    if (narrow) {
      setPinned((v) => !v);
      return;
    }
    setPinned(false);
    setDocked((v) => {
      writeFlag(SIDEBAR, !v);
      return !v;
    });
  }, [narrow]);

  const peek = useCallback(() => {
    cancelLeave();
    setPeeking(true);
  }, []);
  const unpeek = useCallback(() => {
    cancelLeave();
    leave.current = window.setTimeout(() => setPeeking(false), PEEK_GRACE);
  }, []);
  useEffect(() => cancelLeave, []);

  const reveal = useCallback(
    (folder: string) => {
      setFolders((had) => {
        const want = [...ancestors(folder), folder];
        return want.every((f) => had.has(f)) ? had : new Set([...had, ...want]);
      });
      setShown((was) => ({ folder, n: (was?.n ?? 0) + 1 }));
      if (narrow || !docked) setPinned(true);
    },
    [narrow, docked, setFolders],
  );

  const dismiss = useCallback(() => {
    cancelLeave();
    setPeeking(false);
    setPinned(false);
  }, []);

  /*
   * `ctrl+\` — Notion's own chord — here rather than in `useEditor`, so it works on a note as well
   * as a board, and while the caret is in a note's text: a modifier chord is not a character, which
   * is why this toggle is a modifier and not a leader binding. BlockNote binds nothing to it (checked
   * against its keymap, where `Mod+K` is the link and `Mod-\` is nobody's).
   *
   * `e.code` as well as `e.key`, because the backslash key moves between layouts and what a hand
   * learns is the key beside Enter.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "\\" && e.code !== "Backslash") return;
      e.preventDefault();
      toggle();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [toggle]);

  /* The lock: its key and the root's attribute, here because this is on every page but a
     snapshot, which is read-only anyway. */
  useLockKey();
  useLockedRoot();

  /* The vault this tab is in was closed — in another tab, or from the terminal — and every request
     is now refused with a 404 that says so. Going home (another open vault, or the picker) is the
     one answer that does not leave somebody typing into a page whose writes all fail. */
  useEffect(() => {
    const home = () => switchVault("");
    addEventListener(GONE, home);
    return () => removeEventListener(GONE, home);
  }, []);

  /* A pinned overlay goes when the pointer presses anywhere that is not it — or the toggle that
     summoned it, which toggles it itself. */
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const down = (e: PointerEvent) => {
      const at = e.target as Element | null;
      /* The delete-folder modal is in a portal on `<body>`, and a question the column asked is
         still the column: answering it must not put the column away with the question in it. */
      if (at?.closest("[data-dag-sidebar],[data-dag-sidebar-toggle],[data-dag-sidebar-dialog]")) return;
      setPinned(false);
    };
    /* Capture, because the canvas takes the press it starts a gesture with and it would never
       bubble this far — and a press on the canvas is exactly the "somewhere else" that means it. */
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [pinned]);

  const onOpen = useCallback(
    (kind: FileKind, name: string) => {
      open(kind, name);
      dismiss();
    },
    [open, dismiss],
  );

  /*
   * Everything the sidebar does to a file, and the two things only this layer knows how to do
   * about it: **what is open follows** — a rename or a move of the open file opens it under its new
   * name, a folder move carries it along, a delete leaves nothing open rather than the first
   * survivor — and **what was just made is named next**, where it is drawn: a board or a quiz in
   * its row, a note in the title at the top of its page. Every call opens or names what
   * the server settled on, never what was asked for: it keeps names unique by numbering.
   */
  const bring = useCallback(
    (kind: FileKind, made: string, title: string = UNTITLED) => {
      /* Named where its title is drawn, the top bar — never in a row of the column, which
         had to be brought over the page for it and asked the question a second place the page's own
         title then asked again. */
      nameInBar(made, title);
      onOpen(kind, made);
    },
    [onOpen],
  );

  const files = useMemo<SidebarFiles>(() => {
    const isOpen = (kind: FileKind, name: string) => opened[kind] === name;
    /* The one file that is open, with its kind — or none. */
    const openKind = FILE_KINDS.find((k) => opened[k] !== null);
    const raw: SidebarFiles = {
      newFile(kind, folder) {
        /* The free name is found here, as a new folder's is, so the row can be drawn before the server
           answers; the server still numbers it if somebody took it meanwhile. One namespace
           for every kind, and names are titles: `Untitled`, `Untitled 2`, case aside. */
        const known = new Set(everyFile({ boards, notes, quizzes, tables, files: attachments }).map((f) => f.name.toLowerCase()));
        const base = folder ? `${folder}/Untitled` : "Untitled";
        let ask = base;
        for (let i = 2; known.has(ask.toLowerCase()); i++) ask = `${base} ${i}`;
        /* A task is a note that starts with a status, and an event one that starts at the next whole
           hour; every other kind starts as its own blank. */
        const as: TextKind = kind === "task" || kind === "event" ? "note" : kind;
        const next = nextHourEvent();
        const done = guess({ op: "add", kind: as, name: ask, title: UNTITLED });
        const making =
          kind === "task"
            ? createNote(ask, blankTaskText())
            : kind === "event"
              ? createNote(ask, blankEventText(next.start, next.end))
              : createFile(kind, ask, BLANK[kind]());
        void making.then((made) => {
          done(made !== null);
          if (!made) return;
          if (as !== "note") return bring(as, made);
          /* A note — or a task, which is one — is named in its own title at the top of its page
, Notion's way: the row would be a second box asking the same question. */
          nameWhenOpened(made);
          onOpen("note", made);
        });
      },
      async upload(list, folder) {
        /* Into the folder asked for, which is opened so the rows appear where they were dropped
. Nothing is opened for them: an upload is filing something away, and the page
           somebody is working on stays theirs. */
        const { done, errors } = await uploadFiles(list, folder);
        if (done.length && folder) setFolders((had) => (had.has(folder) ? had : new Set([...had, ...ancestors(`${folder}/x`)])));
        return errors;
      },
      task(name, change) {
        /* The list hears it through the change feed like any other write, and redraws the row. */
        void setTask(name, change);
      },
      event(name, change) {
        void setEvent(name, change);
      },
      makeProject(folder) {
        /* The folder's project note, named after the folder and titled after it in words, then
           opened with its title ready to type — a new note's way. `/create` numbers a
           name that is taken, so a folder already holding a note of that name is no obstacle. */
        const title = folderTitle(folder);
        void createNote(`${folder}/${titleStem(title) || "project"}`, projectText(title)).then((made) => {
          if (!made) return;
          nameWhenOpened(made);
          onOpen("note", made);
        });
      },
      project(name, change) {
        void setProject(name, change);
      },
      newFolder(parent) {
        /* `/mkdir` is idempotent — `Untitled` asked for twice is one folder — so the number is found
           here, against every folder there is, Obsidian's way: `Untitled`, `Untitled 2`. */
        const known = new Set(folders);
        for (const { name } of everyFile({ boards, notes, quizzes, tables, files: attachments })) for (const a of ancestors(name)) known.add(a);
        const base = parent ? `${parent}/Untitled` : "Untitled";
        const lower = new Set([...known].map((k) => k.toLowerCase()));
        let path = base;
        for (let i = 2; lower.has(path.toLowerCase()); i++) path = `${base} ${i}`;
        const done = guess({ op: "folder-add", path });
        void createFolder(path).then((made) => {
          done(made !== null);
          if (!made) return;
          if (parent) setFolders((had) => (had.has(parent) ? had : new Set([...had, parent])));
          nameNext(folderKey(made));
        });
      },
      retitle(kind, name, title) {
        /* The title is written, and the name follows it where the store settles it — so what is
           open follows too, and a favourite, exactly as a rename always has. */
        const done = guess({ op: "title", kind, name, title });
        void retitleFile(name, title, kind).then((made) => {
          done(made !== null);
          if (!made || made === name) return;
          moved({ kind: "file", file: kind, from: name, to: made });
          if (isOpen(kind, name)) open(kind, made);
        });
      },
      duplicate(kind, name) {
        /* A copy is opened and named next, because the next thing anybody does to one is name it. */
        void duplicateBoard(name, undefined, kind).then((made) => {
          /* A copy carries its original's title, which is where naming it starts from. */
          if (made) bring(kind, made, titles[name] ?? leaf(name));
        });
      },
      async trash(things: readonly Thing[]) {
        /* Into the trash, each the way it would go alone, in order — and what was open, a
           favourite or a folder shown open lets go of it, as a delete always has: what is left open
           is nothing rather than the first survivor. What it all was is kept for the
           notice's Undo, which puts each back where it was. */
        const left: Thing[] = [];
        const gone: Gone[] = [];
        const was = openKind ? opened[openKind] : null;
        /* Every row goes at once, and comes back if the server refuses it. */
        const guesses = things.map((t) => guess("folder" in t ? { op: "folder-remove", path: t.folder } : { op: "remove", kind: t.kind, name: t.name }));
        for (const [i, t] of things.entries()) {
          if ("folder" in t) {
            const path = t.folder;
            const went = await deleteFolder(path, true);
            guesses[i](Boolean(went?.trash));
            if (!went?.trash) {
              left.push(t);
              continue;
            }
            const under = (f: string) => f === path || f.startsWith(`${path}/`);
            const favs = favourites.filter((k) => under(k.slice(k.indexOf(":") + 1)));
            moved({ kind: "folder", from: path, to: null });
            setFolders((had) => ([...had].some(under) ? new Set([...had].filter((f) => !under(f))) : had));
            const byKind: Record<FileKind, readonly string[]> = {
              board: went.boards,
              note: went.notes,
              quiz: went.quizzes ?? [],
              table: went.tables ?? [],
              file: went.files ?? [],
            };
            const wasOpen = openKind && was !== null && byKind[openKind].includes(was) ? { kind: openKind, name: was } : null;
            if (wasOpen) open(wasOpen.kind, null);
            gone.push({ entry: went.trash, favourites: favs, open: wasOpen });
          } else {
            const entry = await deleteBoard(t.name, t.kind);
            guesses[i](entry !== null);
            if (!entry) {
              left.push(t);
              continue;
            }
            const key = keyOf(t);
            moved({ kind: "file", file: t.kind, from: t.name, to: null });
            const wasOpen = isOpen(t.kind, t.name) ? { kind: t.kind, name: t.name } : null;
            if (wasOpen) open(t.kind, null);
            gone.push({ entry, favourites: favourites.includes(key) ? [key] : [], open: wasOpen });
          }
        }
        if (gone.length) setTrashed((had) => ({ gone, n: (had?.n ?? 0) + 1 }));
        return left;
      },
      move(kind, name, folder) {
        const done = guess({ op: "move", kind, from: name, to: filedIn(name, folder) });
        return moveBoard(name, folder, kind).then((made) => {
          done(made !== null);
          if (!made) return false;
          moved({ kind: "file", file: kind, from: name, to: made });
          if (folder) setFolders((had) => (had.has(folder) ? had : new Set([...had, ...ancestors(`${folder}/x`)])));
          if (isOpen(kind, name)) open(kind, made);
          return true;
        });
      },
      moveFolder(path, to) {
        const done = guess({ op: "folder-move", from: path, to });
        /* Shown open where it is going, at once, if it was open where it was — beside the old path,
           which is kept, so a refusal leaves it open where it stays. */
        setFolders((had) => {
          const into = [...had].filter((f) => f === path || f.startsWith(`${path}/`)).map((f) => rebase(f, path, to));
          return into.length ? new Set([...had, ...into]) : had;
        });
        return moveFolder(path, to).then((got) => {
          done(!("error" in got));
          /* Refused: what the server said, which the sidebar says under the tree. */
          if ("error" in got) return got.error;
          const made = got.folder;
          moved({ kind: "folder", from: path, to: made });
          /* Everything remembered about what was under it moves with it: which of its folders were
             open, and the file that is open, if it was in there. */
          setFolders((had) => {
            const next = new Set([...had].map((f) => rebase(f, path, made)));
            for (const a of ancestors(`${made}/x`)) next.add(a);
            next.delete(made);
            if (had.has(path)) next.add(made);
            /* Numbered by the server: what was shown open under the asked-for path is not a folder. */
            if (made !== to) for (const f of had) if (f === to || f.startsWith(`${to}/`)) next.delete(f);
            return next;
          });
          const was = openKind ? opened[openKind] : null;
          if (openKind && was && rebase(was, path, made) !== was) open(openKind, rebase(was, path, made));
          return null;
        });
      },
      async transfer(what, to) {
        /* Gone from this vault, whichever way it went: its favourite, the folders shown open under
           it, and the page, when it was the file open here — the delete's rules, read off what the
           server says moved. It is opened in its new vault by going there, never here. */
        const done = guess("folder" in what ? { op: "folder-remove", path: what.folder } : { op: "remove", kind: what.kind, name: what.name });
        try {
          /* A vault on the recent list that is not being served is opened first. */
          const target = vaultsNow()?.find((v) => v.id === to);
          if (target && !target.open) await openVault(target.path);
          if ("folder" in what) {
            const gone = await transferFolder(what.folder, to);
            const path = what.folder;
            moved({ kind: "folder", from: path, to: null });
            const under = (f: string) => f === path || f.startsWith(`${path}/`);
            setFolders((had) => ([...had].some(under) ? new Set([...had].filter((f) => !under(f))) : had));
            const went: Record<FileKind, readonly string[]> = { board: gone.boards, note: gone.notes, quiz: gone.quizzes, table: gone.tables ?? [], file: gone.files ?? [] };
            const was = openKind ? opened[openKind] : null;
            if (openKind && was !== null && went[openKind].includes(was)) open(openKind, null);
          } else {
            await transferFile(what.kind, what.name, to);
            moved({ kind: "file", file: what.kind, from: what.name, to: null });
            if (isOpen(what.kind, what.name)) open(what.kind, null);
          }
          done(true);
          dispatchEvent(new CustomEvent("dag:boards"));
          return null;
        } catch (error) {
          done(false);
          return error instanceof Error ? error.message : "It could not be moved. Try again.";
        }
      },
      favourite(kind, name, on) {
        const key = keyOf({ kind, name });
        /* A write is also where a favourite naming nothing is let go: by now the list is loaded, so
           "not there" means gone rather than not fetched yet. */
        const present = new Set(everyFile({ boards, notes, quizzes, tables, files: attachments }).map(keyOf));
        saveFavourites((had) => {
          const kept = had.filter((k) => k !== key && present.has(k));
          return on ? [...kept, key] : kept;
        });
      },
    };
    /*
     * The lock's floor under the sidebar: the column does not offer these while locked, and
     * whatever reaches one anyway — a key, a drag that slipped through, the welcome card — is refused
     * here and says so. A favourite is the person's preference rather than a file, and stays.
     */
    const held =
      <A extends unknown[], R>(f: (...a: A) => R, refused: (...a: A) => R) =>
      (...a: A): R =>
        isLocked() ? (refuseLocked(), refused(...a)) : f(...a);
    const no = () => Promise.resolve(false);
    return {
      ...raw,
      newFile: held(raw.newFile, () => undefined),
      upload: held(raw.upload, () => Promise.resolve([])),
      task: held(raw.task, () => undefined),
      event: held(raw.event, () => undefined),
      makeProject: held(raw.makeProject, () => undefined),
      project: held(raw.project, () => undefined),
      newFolder: held(raw.newFolder, () => undefined),
      retitle: held(raw.retitle, () => undefined),
      duplicate: held(raw.duplicate, () => undefined),
      /* Nothing went, so everything asked for is what is left — and stays selected. */
      trash: held(raw.trash, (things) => Promise.resolve([...things])),
      move: held(raw.move, no),
      moveFolder: held(raw.moveFolder, () => Promise.resolve("Read only: unlock to move it.")),
      transfer: held(raw.transfer, () => Promise.resolve("Read only: unlock to move it.")),
    };
  }, [opened, boards, notes, quizzes, tables, attachments, folders, titles, favourites, open, onOpen, bring, nameNext, setFolders, moved, saveFavourites]);

  const create = useCallback((kind: TextKind | "task" | "event", folder = "") => files.newFile(kind, folder), [files]);

  const renamed = useCallback((kind: FileKind, from: string, to: string) => moved({ kind: "file", file: kind, from, to }), [moved]);

  const retitle = useCallback((kind: FileKind, name: string, title: string) => files.retitle(kind, name, title), [files]);

  const idOf = useCallback((name: string) => ids[name], [ids]);
  const ctl = useMemo<SidebarControl>(
    () => ({ docked: mode === "docked", reveal, create, renamed, retitle, idOf }),
    [mode, reveal, create, renamed, retitle, idOf],
  );

  /* What Undo did with what came back: a favourite is a favourite again, under the name it has now,
     and the file that was open when it went is open again. */
  const restored = useCallback(
    (g: Gone, back: TrashEntry) => {
      const at = (name: string) => (g.entry.kind === "folder" ? rebase(name, g.entry.name, back.name) : back.name);
      if (g.favourites.length) {
        const keys = g.favourites.map((k) => `${k.slice(0, k.indexOf(":"))}:${at(k.slice(k.indexOf(":") + 1))}`);
        saveFavourites((had) => [...had, ...keys.filter((k) => !had.includes(k))]);
      }
      if (g.open) open(g.open.kind, at(g.open.name));
    },
    [open, saveFavourites],
  );

  /* What a press does from here, which is what the button says. A narrow window's overlay is the
     column showing, and pressing puts it away; a peek on a wide one is not yet kept, and pressing
     keeps it — docks it, which is what reaching for the column while it floats means. */
  const shut = mode === "docked" || (narrow && pinned);

  const onWidth = useCallback((w: number) => {
    const settled = clampWidth(w);
    setWidth(settled);
    writePref(SIDEBAR_WIDTH, String(settled));
  }, []);

  return (
    <div
      className="dag-shell"
      ref={shell}
      style={{ "--sidebar-w": `${width}px` } as CSSProperties}
      data-sidebar-sized={width === SIDEBAR_W ? undefined : ""}
    >
      <SidebarContext.Provider value={ctl}>
        {/* First in the DOM, so first in the tab order, which is where it is drawn. */}
        <button
          type="button"
          className="dag-icon dag-sidebar-toggle"
          data-dag-sidebar-toggle={mode ?? "away"}
          aria-label={shut ? "Hide the sidebar" : "Show the sidebar"}
          title={shut ? "Hide the sidebar (Ctrl+\\)" : "Show the sidebar (Ctrl+\\)"}
          onClick={toggle}
          /* A press does not take the focus, so it stays on the board: a focused button eats the
             canvas's keys — `typing()` counts one — and the `space` that opens a chord would press
             it again. The dock gives the focus back after a press; this has no board to give it
             to, so it never takes it. Tab and Enter still reach it, and keep it: it is one element,
             so the focus has nowhere to fall. */
          onMouseDown={(e) => e.preventDefault()}
          /* The peek is for a column that is away: over a docked one there is nothing to slide in. */
          onPointerEnter={mode === "docked" || narrow ? undefined : peek}
          onPointerLeave={mode === "docked" || narrow ? undefined : unpeek}
        >
          {/* One glyph for both states, as Claude.ai's is, and not only for the look. Swapping the
              icon replaces the node under a pointer that has not moved, and React reads the new
              node's `pointerover` as the pointer *entering* the button: a click that put the column
              away peeked it straight back. The label and the tooltip say which way it goes. */}
          <PanelLeft size={16} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
        </button>
        {mode ? (
          <Sidebar
            mode={mode}
            boards={boards}
            notes={notes}
            folders={folders}
            titles={titles}
            ids={ids}
            tasks={tasks}
            projects={projects}
            events={events}
            quizzes={quizzes}
            questions={questions}
            tables={tables}
            attachments={attachments}
            sizes={sizes}
            loading={loading}
            board={board}
            note={note}
            quiz={quiz}
            table={table}
            file={file}
            tasksOpen={tasksOpen}
            onTasks={() => {
              openTasks();
              dismiss();
            }}
            calendarOpen={calendarOpen}
            onCalendar={() => {
              openCalendar();
              dismiss();
            }}
            quizzesOpen={quizzesOpen}
            mistakes={mistakes}
            onQuizzes={() => {
              openQuizzes();
              dismiss();
            }}
            onPracticeFolder={(folder) => {
              openQuizzes(`folder:${folder}`);
              dismiss();
            }}
            assistantOpen={assistantOpen}
            onAssistant={() => {
              openAssistant();
              dismiss();
            }}
            trashOpen={trashOpen}
            onTrash={() => {
              openTrash();
              dismiss();
            }}
            openFolders={openFolders}
            onFolder={(path, isOpen) =>
              setFolders((had) => {
                if (had.has(path) === isOpen) return had;
                const next = new Set(had);
                if (isOpen) next.add(path);
                else next.delete(path);
                return next;
              })
            }
            shown={shown}
            naming={naming}
            favourites={favourites}
            files={files}
            onOpen={onOpen}
            onWidth={onWidth}
            onPointerEnter={mode === "overlay" && peeking ? cancelLeave : undefined}
            onPointerLeave={mode === "overlay" && peeking && !pinned ? unpeek : undefined}
            onDismiss={dismiss}
            sheet={narrow}
          />
        ) : null}
        {children}
        {panel.open && !assistantOpen ? <AssistantPanel onOpen={open} onPage={openAssistant} /> : null}
        {trashed ? (
          <TrashNotice
            key={trashed.n}
            gone={trashed.gone}
            titles={titles}
            onRestored={restored}
            onTrash={openTrash}
            onClose={() => setTrashed(null)}
          />
        ) : null}
        <LockNotice />
      </SidebarContext.Provider>
    </div>
  );
}
