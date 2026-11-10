import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowRightLeft,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  Cloud,
  CloudAlert,
  Copy,
  Download,
  File as FileGlyph,
  FilePlus2,
  FileQuestion,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Grid2x2Plus,
  Link as LinkMark,
  ListTodo,
  MessageCircleWarning,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SquareCheckBig,
  Star,
  StarOff,
  Table2,
  Trash2,
  Upload,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import { prefetchDoc } from "@/board/prefetch";
import { assertNever, everyFile, type FileKind, type TextKind } from "@/board/useBoard";
import { FileIcon as AttachmentIcon } from "@/files/FileIcon";
import { downloadName, fileWhat } from "@/files/types";
import { draggedFiles, fileUrl } from "@/files/upload";
import { Said } from "@/files/Said";
import { nextHourEvent, type EventChange, type NoteEvent } from "@/note/event";
import { projectFolders, type Project, type ProjectChange } from "@/note/project";
import type { Task, TaskChange } from "@/note/task";
import { hueVars } from "@/render/hue";
import { chordFor } from "@/edit/bindings";
import type { SettingsTab } from "@/settings/tabs";
import { loadVaults } from "@/vault/api";
import { currentVault } from "@/vault/current";
import { useVaults } from "@/vault/useVaults";

import { askPage, type ChromeRequest } from "./chrome";
import { Lockup } from "./Logo";
import { holdStill, startDrag } from "./pointerDrag";
import { copyText } from "./clipboard";
import { appLink } from "@/refs/link";
import { TaskGlyph } from "./TaskGlyph";
import {
  ancestors,
  between,
  counted,
  keyOf,
  labelOf,
  leaf,
  moveTargets,
  parentOf,
  picked as pickedOf,
  pickedCount,
  rows as rowsOf,
  tree,
  type Entry,
  type Picked,
  type Row,
} from "./tree";
import { VaultSwitcher } from "./Vaults";
import { statusTone, statusWords } from "@/sync/status";
import { useSyncStatus } from "@/sync/useSyncStatus";
import { LOCK_HINT, lockedAffordance, refuseLocked, useLocked } from "@/settings/lock";
import { useFeatures } from "@/features";
import { ATTACHMENTS, CHANGED as PREFS_CHANGED, readPref } from "@/settings/prefs";

/** Lucide at one size and weight, stated once — the dock's rule. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SMALL = { ...ICON, size: 14 } as const;

/**
 * A file row let go over a board's canvas: `dag:place-file` on the document, which the
 * board page answers by placing that file's card where the pointer was. An event rather than a
 * callback for `dag:chrome`'s reason: the sidebar is above both pages and knows neither. A selection
 * let go there is every file in it, placed together.
 */
export interface PlaceFile {
  files: { kind: FileKind; name: string }[];
  /** Where it was let go, on the glass: the page turns it into a point on the board. */
  x: number;
  y: number;
}

/** A row's identity — in the roving focus, in the one question asked at a time, and in a request to name it. */
export const folderKey = (path: string): string => `folder:${path}`;
const rowKey = (r: Row): string => (r.type === "folder" ? folderKey(r.path) : keyOf(r.entry));
const whereOf = (r: Row): string => (r.type === "folder" ? r.path : r.entry.name);

const EMPTY: string[] = [];
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_TITLES: Readonly<Record<string, string>> = {};
const NO_TASKS: Readonly<Record<string, Task>> = {};
const NO_PROJECTS: Readonly<Record<string, Project>> = {};
const NO_EVENTS: Readonly<Record<string, NoteEvent>> = {};
const NO_QUESTIONS: Readonly<Record<string, number>> = {};
const NO_SIZES: Readonly<Record<string, number>> = {};

/**
 * Each kind of file's mark. A `Record` over `FileKind`, never `kind === "note" ? … : board`: that
 * shape drew a quiz as a board, and a fourth kind left out of this is a type error.
 */
const KIND_ICON = { board: Workflow, note: FileText, quiz: GraduationCap, table: Table2, file: FileGlyph } satisfies Record<
  FileKind,
  LucideIcon
>;

/**
 * A file's mark: a board's, a note's, a quiz's — or, for a note that is a task, its status
 *, which is the one thing about a task worth seeing without opening it. A project's note
 * wears a briefcase in the project's colour, before a status it may also carry, and an
 * event a calendar with a clock on it.
 */
function FileIcon({ entry, task, project, event }: { entry: Entry; task?: Task; project?: Project; event?: NoteEvent }) {
  /* An attachment wears its type's — a PDF, a spreadsheet, a video. */
  if (entry.kind === "file") return <AttachmentIcon name={entry.name} {...SMALL} />;
  if (entry.kind === "note" && project)
    return <Briefcase {...SMALL} className="dag-sidebar__project" style={hueVars(project.hue)} aria-hidden="true" />;
  if (entry.kind === "note" && task) return <TaskGlyph status={task.status} />;
  if (entry.kind === "note" && event) return <CalendarClock {...SMALL} className="dag-sidebar__event" aria-hidden="true" />;
  const Icon = KIND_ICON[entry.kind];
  return <Icon {...SMALL} aria-hidden="true" />;
}

/**
 * What a row's tooltip says: the file's name, and its kind when that is not a board. A quiz says how
 * many questions it asks when the list has said.
 */
function hintOf(
  e: Entry,
  questions: Readonly<Record<string, number>>,
  sizes: Readonly<Record<string, number>> = NO_SIZES,
): string {
  switch (e.kind) {
    /* An attachment says what it is and how big: `specs/q3.pdf (PDF · 2.3 MB)`. */
    case "file":
      return `${e.name} (${fileWhat(e.name, sizes[e.name])})`;
    case "board":
      return e.name;
    case "note":
      return `${e.name} (note)`;
    case "quiz": {
      const n = questions[e.name];
      return n === undefined ? `${e.name} (quiz)` : `${e.name} (quiz, ${counted(n, ["question", "questions"])})`;
    }
    case "table":
      return `${e.name} (table)`;
    default:
      return assertNever(e.kind);
  }
}

/** The width somebody gets before they drag it, and the two ends of the drag. A drag is also held
    to half the window (`dragCap`), as the CSS holds it. */
export const SIDEBAR_W = 248;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 640;

/** How wide a drag may make the column on this window: `.dag-sidebar`'s `--sidebar-cap` for a width
    somebody chose, so the grip never runs on past a column that has stopped following it. */
const dragCap = (windowW: number) => Math.min(SIDEBAR_MAX, Math.max(232, Math.floor(windowW / 2)));

/** How long a dragged row hovers over a shut folder before the folder opens under it — Finder's spring. */
const SPRING = 600;
/**
 * Every element of the tree marked as where a drop would land — **the tree itself included**, which is
 * the top level's target and which `querySelectorAll` on it never finds, being a search of its
 * descendants. A clearing of the marks that missed it left the whole tree outlined after a drag
 * that had once passed over the
 * tree's own empty space; scrolling it under the pointer
 * is what made that the usual case rather than a rare one.
 */
function overMarks(tree: HTMLElement | null): HTMLElement[] {
  if (!tree) return [];
  const inside = [...tree.querySelectorAll<HTMLElement>("[data-dag-sidebar-over]")];
  return tree.dataset.dagSidebarOver === undefined ? inside : [tree, ...inside];
}

/** Where the dragged chip sits from the pointer: below and to the right, clear of the row it aims at. */
const GHOST_OFFSET = { x: 14, y: 10 };
/** How near the tree's top or bottom a dragged row starts to scroll it, and its fastest, per frame. */
const GLIDE_EDGE = 36;
const GLIDE_SPEED = 16;
/**
 * How long a finger rests on a row before it begins a selection — the platforms' long
 * press — and before the row can be dragged at all. On a phone the column is a list a
 * person scrolls, and a row that took every swipe as a drag moved files about under a thumb that
 * meant only to look further down. Held still this long, the row is picked; a finger that then moves
 * carries the selection, and one that lifts leaves it begun. A mouse needs none of it — it does not
 * scroll by pressing.
 */
const HOLD = 450;

/** How long the pointer rests on a row before its text is asked for — long enough not to ask about every row it passes. */
const REST = 80;
let resting: number | undefined;

/**
 * Rest the pointer on a file's row, or press it, and its text is asked for: opening a file
 * is one round trip to `GET /__board/get`, and asked a press early, most of it is over by the time
 * the click lands. `src/board/prefetch.ts` holds the answer for the page to take. Not for the file
 * already open, which has its text, nor an attachment, which is not one.
 */
function ahead(kind: FileKind, name: string, current: boolean) {
  const go = () => {
    if (kind !== "file" && !current) prefetchDoc(kind, name);
  };
  return {
    go,
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(resting);
      resting = window.setTimeout(go, REST);
    },
    onPointerLeave: () => window.clearTimeout(resting),
  };
}

/** A row's half of `ahead` when the press is somebody else's — the tree's, which also drags. */
const hover = ({ onPointerEnter, onPointerLeave }: ReturnType<typeof ahead>) => ({ onPointerEnter, onPointerLeave });

/** A row's half of `ahead` when it is a plain button: resting, and pressing. */
const pressed = (a: ReturnType<typeof ahead>) => ({ ...hover(a), onPointerDown: a.go });

/**
 * What the sidebar can do to the files. Every one is a request to `Shell`, which knows what is
 * open — so an open file follows itself through a rename or a move — and which names next whatever
 * the store settled on: a board, a quiz or a table in its row here, a note in its own title.
 */
export interface SidebarFiles {
  /**
   * A board, a note, a quiz, a table, a task — which is a note that starts with
   * a status — or an event, a note that starts with a start. Resolves `null` once it was made and
   * opened, or the sentence saying why it was not — which the column says under the tree. A locked
   * app answers through the lock's own notice instead, so it resolves `null` too.
   */
  newFile(kind: TextKind | "task" | "event", folder: string): Promise<string | null>;
  /**
   * Upload files from the computer into a folder: each becomes an attachment, listed here
   * like any other file. Resolves to the sentences for any the server — or its upload limits —
   * refused, which the column says under the tree.
   */
  upload(files: readonly File[], folder: string): Promise<string[]>;
  /** Change a note's status or due date, make it a task, or make it a plain note again. */
  task(name: string, change: TaskChange): void;
  /** Move an event, make a note one, or make it a plain note again. */
  event(name: string, change: EventChange): void;
  /**
   * Make a folder a project: its project note, titled after the folder, made in it and
   * opened with the title ready to type — New note's way. Resolves `null` or why it was not made.
   */
  makeProject(folder: string): Promise<string | null>;
  /** Change a project's status or colour, or make its note a plain note again. */
  project(name: string, change: ProjectChange): void;
  /** Make a folder in `parent` (`""` is the top level), then name it in its row. Resolves like `newFile`. */
  newFolder(parent: string): Promise<string | null>;
  /**
   * Call a file something: what a file's name box answers. The title is what the row
   * draws, and the file's name follows it in the background — `Shell` opens whatever it settles on.
   */
  retitle(kind: FileKind, name: string, title: string): void;
  duplicate(kind: FileKind, name: string): void;
  /**
   * Move files and folders to the trash, each folder with everything in it — what every
   * Delete here does, a row's and a selection's. Nothing is asked first: what goes can be taken back,
   * and the window says so with an Undo. Resolves to what could not go, which stays selected.
   */
  trash(things: readonly Thing[]): Promise<Thing[]>;
  move(kind: FileKind, name: string, folder: string): Promise<boolean>;
  /**
   * A folder renamed or moved with everything under it: `to` is the whole new path. Resolves `null`
   * once it has moved, or what to say when it was refused.
   */
  moveFolder(path: string, to: string): Promise<string | null>;
  /** Keep a file in the Favourites section, or take it out. */
  favourite(kind: FileKind, name: string, on: boolean): void;
  /**
   * Move a file to another vault, or with `folder` a folder and everything in it: `to` is the
   * vault's id (opened first when it is only on the recent list). Resolves `null` once it has gone,
   * or what to say when it was refused — a folder whose name that vault already has is not merged.
   */
  transfer(what: { kind: FileKind; name: string } | { folder: string }, to: string): Promise<string | null>;
}

/**
 * The one question the sidebar is asking, if any, and about which row. One at a time and held
 * here rather than per row, so opening a menu closes a half-typed rename rather than leaving two
 * questions on screen — the rule the search's list has had since M27.
 */
type Mode =
  | null
  | { kind: "menu"; key: string; add: boolean; at: { x: number; y: number } }
  | { kind: "rename"; key: string }
  | { kind: "move"; key: string }
  /** Which vault a file or a folder goes to. */
  | { kind: "transfer"; key: string };

/**
 * The question being asked about the selection, if any — apart from `Mode`, which is about
 * one row: the selection's menu, or the folder or the vault it goes to. A delete asks nothing,
 * because what goes can be restored. One question at a time across the two: opening either lets go of the other.
 */
type Bulk = null | { kind: "menu"; at: { x: number; y: number } } | { kind: "move" } | { kind: "transfer" };

/** One thing the sidebar moves to the trash: a file, or a folder with everything in it. */
export type Thing = { kind: FileKind; name: string } | { folder: string };

/**
 * The column down the left: the files as a tree, the ways to make more, and the way to the
 * app's settings. `Shell` owns its state; this draws it.
 *
 * **Its rows are not the search's rows.** The search keeps `data-dag-board` and `.dag-board`, which
 * every spec that finds a board in the list already reads. A second element answering to either would be the namespace
 * hazard `docs/architecture/things-that-will-bite.md` records, so these are `data-dag-sidebar-file` and `.dag-sidebar__row`.
 *
 * Every row is a button, so `typing()` in `useEditor` stands the canvas's keys aside while focus is
 * anywhere in here — which is right, and which means the tree owns its own keys, Escape included.
 *
 * **Every file operation lives here, and only here.** The search dialog carried rename, move,
 * duplicate and delete on four hover icons per row; a control in two places is two places to keep
 * in step, so the search is a search now and the row's `⋯` is where those four went.
 */
export function Sidebar({
  mode: place,
  boards,
  notes = EMPTY,
  folders,
  titles = NO_TITLES,
  ids = NO_TITLES,
  tasks = NO_TASKS,
  projects = NO_PROJECTS,
  events = NO_EVENTS,
  quizzes = EMPTY,
  questions = NO_QUESTIONS,
  tables = EMPTY,
  attachments = EMPTY,
  sizes = NO_SIZES,
  loading = false,
  board,
  note,
  quiz = null,
  table = null,
  file = null,
  tasksOpen = false,
  onTasks,
  calendarOpen = false,
  onCalendar,
  quizzesOpen = false,
  mistakes = 0,
  onQuizzes,
  onPracticeFolder,
  assistantOpen = false,
  onAssistant,
  trashOpen = false,
  onTrash,
  onHome,
  openFolders,
  onFolder,
  shown,
  naming,
  favourites = EMPTY,
  files,
  onOpen,
  onWidth,
  onPointerEnter,
  onPointerLeave,
  onDismiss,
  sheet = false,
}: {
  mode: "docked" | "overlay";
  /**
   * The whole window, on a phone: 44px rows, no key hints nobody there can press,
   * and a close button of its own — there is no page beside it to press instead.
   */
  sheet?: boolean;
  boards: string[];
  notes?: string[];
  folders: string[];
  /** What each file is called, by name — `/__board/list`'s `titles`. */
  titles?: Readonly<Record<string, string>>;
  /** Every listed file's permanent id, by name — what *Copy link* copies a link to. */
  ids?: Readonly<Record<string, string>>;
  /** Which notes are tasks, and their status — `/__board/list`'s `tasks`. */
  tasks?: Readonly<Record<string, Task>>;
  /** Which notes are projects, and their status and colour — `/__board/list`'s `projects`. */
  projects?: Readonly<Record<string, Project>>;
  /** Which notes are events, and when — `/__board/list`'s `events`. */
  events?: Readonly<Record<string, NoteEvent>>;
  /** Every quiz, the third kind of file — `/__board/list`'s `quizzes` — and how many questions each asks. */
  quizzes?: string[];
  questions?: Readonly<Record<string, number>>;
  /** Every table, a fourth kind with a text — `/__board/list`'s `tables`. */
  tables?: string[];
  /** Every attachment — `/__board/list`'s `files` — and how big each is. */
  attachments?: string[];
  sizes?: Readonly<Record<string, number>>;
  /**
   * The list has not answered yet and this browser kept none — an empty tree that is a
   * list on its way, never a vault with nothing in it, so it is not said to be one.
   */
  loading?: boolean;
  board: string | null;
  note: string | null;
  quiz?: string | null;
  table?: string | null;
  file?: string | null;
  /** Whether the Tasks page is what is open, which its entry marks as the current page. */
  tasksOpen?: boolean;
  /** Open the Tasks page. Absent where there is none to open. */
  onTasks?(): void;
  /** Whether the Calendar page is what is open, and the way there. */
  calendarOpen?: boolean;
  onCalendar?(): void;
  /** The same three for the Quizzes page: whether it is open, how many questions are in Mistakes, and the way there. */
  quizzesOpen?: boolean;
  mistakes?: number;
  onQuizzes?(): void;
  /** Every quiz under a folder as one run: the folder's menu offers it when it holds one. */
  onPracticeFolder?(folder: string): void;
  /** Whether the Assistant page is what is open, and the way there. */
  assistantOpen?: boolean;
  onAssistant?(): void;
  /** Whether the Trash page is what is open, and the way there. */
  trashOpen?: boolean;
  onTrash?(): void;
  /** Home: nothing open, the welcome card. What the AnyDag logo in the head does. */
  onHome(): void;
  openFolders: ReadonlySet<string>;
  onFolder(path: string, open: boolean): void;
  /** A folder asked for from outside — focus it and bring it into view, once per `n`. */
  shown: { folder: string; n: number } | null;
  /** A row just made, whose name comes next: put it into the rename box once it is drawn. */
  naming: { key: string; n: number } | null;
  /** `kind:name` each, in the order they were added — the person's, through `PREF_KEYS`. */
  favourites?: readonly string[];
  files: SidebarFiles;
  onOpen(kind: FileKind, name: string): void;
  onWidth(w: number): void;
  onPointerEnter?(): void;
  onPointerLeave?(): void;
  /** Close an overlay: after a row asks the page for a card, and on Escape. */
  onDismiss(): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(null);
  /*
   * Read only: every row still opens, selects, is favourited and has its link copied, and
   * nothing that makes, renames, moves, uploads or deletes is offered. Each place that would write
   * reads the ref as well, so a key or a drag that reaches one is answered with the notice.
   */
  const locked = useLocked();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  /* The New row's menu, and where on the glass it hangs: beside the row, or under it on a sheet. */
  const [making, setMaking] = useState<{ x: number; y: number; below: number; left: number } | null>(null);
  /* Whether the gesture that is ending was a drag, so the click after it does not also open the
     file somebody was only filing away. Cleared when a press starts, never in `onClick`: a drop on
     another row ends on a different element and dispatches no click at all, and a flag waiting for
     one would swallow the next real click — the lesson the search's list learned first. */
  const dragged = useRef(false);
  /*
   * What is selected: row keys, picked with ctrl or ⌘ one at a time and with shift as a
   * run, and acted on together from the bar under the tree, a selected row's menu, or a drag. A plain
   * click is still a click that opens, and lets the selection go. `anchor` is the row a shift-click
   * runs from: the last one clicked, or the open file's.
   */
  const [sel, setSel] = useState<ReadonlySet<string>>(NO_KEYS);
  const anchor = useRef<string | null>(null);
  /*
   * A selection begun by holding a finger on a row, where there is no ctrl and no shift: until it is
   * empty again a tap picks a row or lets it go rather than opening it. `held` is the press that
   * started it, so the tap it ends with — and the context menu a long press brings on Android — are
   * not also a pick or a menu. Cleared when a press starts, the `dragged` rule.
   */
  const [picking, setPicking] = useState(false);
  const held = useRef(false);
  const [bulk, setBulk] = useState<Bulk>(null);
  /* What a bulk action is doing, said in the bar while it runs; and what it could not do, after. */
  const [working, setWorking] = useState<string | null>(null);
  const [bulkProblems, setBulkProblems] = useState<string[]>([]);

  /* Every file of every kind — `everyFile`, so a kind added to `FILE_KINDS` is listed here with no
     line of this changed, and a quiz is not missing from the tree the way it was from `boards + notes`. */
  const entries = useMemo<Entry[]>(
    () =>
      everyFile({ boards, notes, quizzes, tables, files: attachments }).map(({ name, kind }) => ({
        kind,
        name,
        title: titles[name],
      })),
    [boards, notes, quizzes, tables, attachments, titles],
  );
  /* What the server says this build may show — the sync row is a glance at a server that may not be
     in it (`src/features.ts`). Mounted or not, never hidden once drawn: the hook under it asks for
     the status, so its absence here is what keeps a build without the route from polling it. */
  const features = useFeatures();
  const cloud = features?.cloud === true;
  const store = useAttachmentsFolder();
  const all = useMemo(() => tree(entries, folders, store), [entries, folders, store]);
  /* How many listed tasks are not done — the count beside Tasks. */
  const openTasks = useMemo(() => notes.filter((n) => tasks[n] && tasks[n]!.status !== "done").length, [notes, tasks]);
  const lines = useMemo(() => rowsOf(all, openFolders), [all, openFolders]);
  /* Which folders are projects, and whose note makes each one. */
  const owners = useMemo(() => projectFolders(projects), [projects]);
  /* Every folder that exists, the ones only a file's name implies included — what a folder's
     rename or move is checked against before it is sent, so an ordinary slip is answered in the row
     rather than by a 409 the server has to be asked for. */
  const known = useMemo(() => {
    const out = new Set(folders);
    for (const e of entries) for (const a of ancestors(e.name)) out.add(a);
    return out;
  }, [folders, entries]);

  /* The selection as the things a bulk action acts on: anything inside a picked folder goes with it. */
  const chosen = useMemo<Picked>(() => pickedOf(sel, entries), [sel, entries]);
  const chosenCount = pickedCount(chosen);
  /* A selected file deleted in another tab, or a folder an agent moved, is let go of — kept by
     whether it exists, not by whether it is drawn: a row in a folder somebody shut stays selected. */
  useEffect(() => {
    if (!sel.size) return;
    const live = new Set([...entries.map(keyOf), ...[...known].map(folderKey)]);
    const kept = [...sel].filter((k) => live.has(k));
    if (kept.length !== sel.size) setSel(kept.length ? new Set(kept) : NO_KEYS);
  }, [sel, entries, known]);
  useEffect(() => {
    if (!sel.size && bulk) setBulk(null);
    if (!sel.size && picking) setPicking(false);
  }, [sel, bulk, picking]);

  const currentKey = board
    ? keyOf({ kind: "board", name: board })
    : note
      ? keyOf({ kind: "note", name: note })
      : quiz
        ? keyOf({ kind: "quiz", name: quiz })
        : table
          ? keyOf({ kind: "table", name: table })
          : file
            ? keyOf({ kind: "file", name: file })
            : null;
  /* The open file, whichever kind — where the New menu offers to make the next one. */
  const currentName = board ?? note ?? quiz ?? table ?? file;
  const keys = useMemo(() => new Set(lines.map(rowKey)), [lines]);
  /* The favourites that still name something. One renamed elsewhere — by an agent, on disk, on
     another device — names nothing here, and is left undrawn rather than drawn broken; the next
     change to the list lets it go. */
  const favs = useMemo<Entry[]>(() => {
    const present = new Set(entries.map(keyOf));
    return favourites.filter((k) => present.has(k)).map((k) => entries.find((e) => keyOf(e) === k)!);
  }, [favourites, entries]);
  const isFavourite = useCallback((e: Entry) => favourites.includes(keyOf(e)), [favourites]);

  /* The vaults a file or a folder could be moved to: every one on the list but this tab's, and not
     one whose folder is gone. */
  const vaults = useVaults();
  const elsewhere = useMemo(() => (vaults ?? []).filter((v) => v.id !== currentVault() && !v.missing), [vaults]);
  useEffect(() => void loadVaults(), []);
  /* What a move to another vault was refused with, said under the tree until the next one. */
  const [moveProblem, setMoveProblem] = useState<string | null>(null);
  /* Uploads: how many are on their way, and what the last lot was refused with. */
  const [uploading, setUploading] = useState(0);
  const [uploadProblems, setUploadProblems] = useState<string[]>([]);
  /* The last create the server refused, in its own words, shown under the tree. A locked app
     says it through the lock's notice and Unlock instead, so this stays empty there. */
  const [createProblems, setCreateProblems] = useState<string[]>([]);
  /* The folder the picker's files go into: the actions' Upload says the top level, a folder's `+`
     says that folder. Held in a ref because the picker answers after the click that opened it. */
  const pickFor = useRef("");
  const picker = useRef<HTMLInputElement>(null);
  const sendFiles = useCallback(
    (list: readonly File[], folder: string) => {
      if (!list.length) return;
      if (lockedRef.current) return void refuseLocked();
      setUploadProblems([]);
      setUploading((n) => n + list.length);
      void files.upload(list, folder).then((errors) => {
        setUploading((n) => Math.max(0, n - list.length));
        setUploadProblems(errors);
      });
    },
    [files],
  );
  const pickFiles = (folder: string) => {
    pickFor.current = folder;
    picker.current?.click();
  };
  /** Make something and, if the server refused, say its sentence under the tree — never a dead press. */
  const reportMake = useCallback((done: Promise<string | null>) => {
    setCreateProblems([]);
    void done.then((problem) => {
      if (problem) setCreateProblems([problem]);
    });
  }, []);
  /* *Link copied*, said under the tree for a moment after a row's *Copy link*. */
  const [linked, setLinked] = useState<string | null>(null);
  useEffect(() => {
    if (!linked) return;
    const t = setTimeout(() => setLinked(null), 1600);
    return () => clearTimeout(t);
  }, [linked]);
  /** The app's link to a file, by its id: what opens it for anyone signed in here. */
  const copyAppLink = async (e: Entry) => {
    setMoveProblem(null);
    const id = ids[e.name];
    if (id && (await copyText(appLink(id)))) setLinked(keyOf(e));
    else setMoveProblem("The link could not be copied. Try again.");
  };
  /*
   * One row is the tab stop and the arrows move between the rest — the roving focus the search
   * uses, for the same reason: every row is a real button, so Enter and Space already open one and
   * the only thing left to write is which button an arrow reaches. The stop is the open file, or
   * the first row, until somebody focuses another.
   */
  const [stop, setStop] = useState<string | null>(null);
  const stopKey =
    stop && keys.has(stop) ? stop : currentKey && keys.has(currentKey) ? currentKey : lines[0] ? rowKey(lines[0]) : null;

  /* A question about a row that has since gone — deleted in another tab, renamed by an agent — is a
     question about nothing, and is let go. */
  useEffect(() => {
    if (mode && !keys.has(mode.key)) setMode(null);
  }, [mode, keys]);

  /* The open file, brought into view when it changes — but only when it is not already in view.
     Scrolling a row somebody has just clicked to the middle of the list would move it out from
     under their pointer, which a column that is up all day cannot afford the way a dialog could.
     `"center"` when it does scroll, because `"nearest"` leaves it
     flush against the edge with nothing around it.

     **Once per open file.** `lines.length` is a dependency so that the row can be found when the list
     arrives after the file does, and it is also every other file or folder made or removed anywhere
     in the vault — by an agent, the CLI, another tab. Each of those brought the open row back to
     the middle whenever it was out of view, which is the whole time somebody has scrolled away from
     it: the list was pulled back under their hand, and a drag held at the tree's edge, whose glide
     scrolls it a few pixels a frame, was undone as fast as another writer added a row. The row is
     shown the first time it exists for this file, and not again until the open file is another. */
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !row || shownKey.current === currentKey) return;
    shownKey.current = currentKey;
    const a = list.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    if (b.top < a.top || b.bottom > a.bottom) row.scrollIntoView({ block: "center" });
  }, [currentKey, lines.length]);

  /* A row picked up by a long press is dragged, not scrolled past. */
  useEffect(() => {
    const list = listRef.current;
    return list ? holdStill(list) : undefined;
  }, []);

  const rowFor = useCallback(
    (key: string) =>
      listRef.current?.querySelector<HTMLElement>(`[data-dag-sidebar-row][data-dag-sidebar-key="${CSS.escape(key)}"]`) ?? null,
    [],
  );

  /* A folder asked for by name — the toolbar's breadcrumb — is focused and brought into view. */
  useEffect(() => {
    if (!shown) return;
    const row = rowFor(folderKey(shown.folder));
    row?.scrollIntoView({ block: "center" });
    row?.focus();
  }, [shown, rowFor]);

  /* Something just made is named where it is drawn — once its row exists, which is a round trip
     after the file does. `handled` keeps one request from being honoured twice. */
  const handled = useRef(0);
  useEffect(() => {
    if (!naming || naming.n === handled.current || !keys.has(naming.key)) return;
    handled.current = naming.n;
    setMode({ kind: "rename", key: naming.key });
  }, [naming, keys]);

  const rowEls = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-dag-sidebar-row]") ?? []);

  /** Let go of the question and put the focus back on the row it was about. */
  const settle = useCallback(
    (key?: string) => {
      setMode(null);
      if (key) requestAnimationFrame(() => rowFor(key)?.focus());
    },
    [rowFor],
  );

  const openMenu = (line: Row, el: Element | null, add = false, at?: { x: number; y: number }) => {
    const r = el?.getBoundingClientRect();
    const where = at ?? { x: r ? r.left : 0, y: r ? r.bottom + 2 : 0 };
    /* On a row that is part of a selection of two or more, the menu is the selection's. */
    if (!add && sel.size > 1 && sel.has(rowKey(line))) {
      setMode(null);
      return setBulk({ kind: "menu", at: where });
    }
    setBulk(null);
    setMode({ kind: "menu", key: rowKey(line), add, at: at ?? { x: r ? r.left : 0, y: r ? r.bottom + 2 : 0 } });
  };

  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = rowEls();
    const at = els.indexOf(e.target as HTMLElement);
    if (at === -1) return;
    const line = lines.find((r) => rowKey(r) === els[at]?.dataset.dagSidebarKey);
    const go = (i: number) => {
      e.preventDefault();
      els[Math.max(0, Math.min(els.length - 1, i))]?.focus();
    };
    if (line && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
      e.preventDefault();
      return openMenu(line, e.target as HTMLElement);
    }
    /* Shift and an arrow grows the selection a row at a time from where it started; a plain
       arrow moves where the next one would start from. */
    const walk = (i: number) => {
      const to = els[Math.max(0, Math.min(els.length - 1, i))]?.dataset.dagSidebarKey;
      if (to && e.shiftKey) {
        anchor.current ??= els[at]?.dataset.dagSidebarKey ?? null;
        setMode(null);
        setSel(new Set(between(lines.map(rowKey), anchor.current, to)));
      } else if (to) anchor.current = to;
      go(i);
    };
    switch (e.key) {
      case "ArrowDown":
        return walk(at + 1);
      case "ArrowUp":
        return walk(at - 1);
      case "Home":
        return go(0);
      case "End":
        return go(els.length - 1);
      case "F2":
        if (!line) return;
        e.preventDefault();
        if (lockedRef.current) return void refuseLocked();
        return setMode({ kind: "rename", key: rowKey(line) });
      case "ArrowRight":
        if (line?.type !== "folder") return;
        e.preventDefault();
        if (!line.open) onFolder(line.path, true);
        else if (els[at + 1] && lines.find((r) => rowKey(r) === els[at + 1]!.dataset.dagSidebarKey)?.depth === line.depth + 1)
          els[at + 1]!.focus();
        return;
      case "ArrowLeft": {
        if (!line) return;
        e.preventDefault();
        if (line.type === "folder" && line.open) return onFolder(line.path, false);
        const parent = parentOf(whereOf(line));
        if (parent) rowFor(folderKey(parent))?.focus();
        return;
      }
      default:
    }
  };

  /*
   * Escape lets go of the innermost thing: a question in a row first, then the sidebar. An overlay
   * closes; a docked column hands the focus back to the page, so the next key reaches the board
   * rather than a row. Stopped here, because `typing()` means the window's Escape chain never sees
   * a key pressed on a button anyway, and a second handler answering it would be two meanings for
   * one press.
   */
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (mode) return settle(mode.key);
    if (bulk) return setBulk(null);
    if (sel.size) {
      setSel(NO_KEYS);
      return;
    }
    if (place === "overlay") onDismiss();
    const page = document.querySelector<HTMLElement>(".dag-viewport");
    if (page) page.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  };

  const ask = (what: ChromeRequest, tab?: SettingsTab) => {
    askPage(what, tab);
    if (place === "overlay") onDismiss();
  };

  /** Where a folder goes when it is filed into `into`: its own name, under that folder. */
  const filedAt = (path: string, into: string) => (into ? `${into}/${leaf(path)}` : leaf(path));

  /**
   * A click on a row, as far as the selection cares: with ctrl or ⌘ the row joins it or
   * leaves it, with shift every row from the anchor to this one is the selection — with both, they
   * join it. Answers whether it was one of those, so the row does not also open or fold. A plain
   * click lets the selection go and makes this row the anchor.
   */
  const select = (e: ReactMouseEvent, key: string): boolean => {
    const toggle = e.ctrlKey || e.metaKey || (picking && sel.size > 0);
    if (!toggle && !e.shiftKey) {
      if (sel.size) setSel(NO_KEYS);
      anchor.current = key;
      return false;
    }
    setMode(null);
    setBulk(null);
    if (e.shiftKey) {
      const order = lines.map(rowKey);
      const from = anchor.current ?? (currentKey && order.includes(currentKey) ? currentKey : null);
      const run = between(order, from, key);
      setSel((had) => new Set(toggle ? [...had, ...run] : run));
    } else {
      setSel((had) => {
        const next = new Set(had);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next.size ? next : NO_KEYS;
      });
      anchor.current = key;
    }
    return true;
  };

  /**
   * A finger held still on a row (on a phone): the row is picked and the selection is
   * begun, and taps go on picking until it is empty. The same as a right-click with a finger, which
   * Android sends after a long press, so both arrive here and the second changes nothing.
   */
  const hold = (key: string) => {
    held.current = true;
    setMode(null);
    setBulk(null);
    setPicking(true);
    anchor.current = key;
    setSel((had) => (had.has(key) ? had : new Set([...had, key])));
  };

  /** The words for a picked thing in a sentence: a folder by its name, a file by what it is called. */
  const nameOfFolder = (path: string) => `“${leaf(path)}”`;

  /**
   * The selection moved into a folder, one thing at a time, in order, each the way a drag of it alone
   * would go: a folder already in it, or a file, is left where it is; a folder whose name
   * is already taken there is not merged, and is said so under the tree rather than numbered. What
   * moved is no longer selected, and nothing is when everything did.
   */
  const moveChosen = async (into: string) => {
    if (lockedRef.current) return void refuseLocked();
    const p = chosen;
    setBulk(null);
    setBulkProblems([]);
    setWorking(`Moving ${counted(pickedCount(p), ["item", "items"])}…`);
    const missed: string[] = [];
    const left = new Set<string>();
    for (const f of p.folders) {
      if (parentOf(f) === into) continue;
      const dest = filedAt(f, into);
      if (known.has(dest)) {
        missed.push(`${into ? nameOfFolder(into) : "The top level"} already has a folder called ${nameOfFolder(f)}.`);
        left.add(folderKey(f));
      } else {
        const problem = await files.moveFolder(f, dest);
        if (problem) {
          missed.push(problem);
          left.add(folderKey(f));
        }
      }
    }
    for (const e of p.files) {
      if (parentOf(e.name) === into) continue;
      if (!(await files.move(e.kind, e.name, into))) {
        missed.push(`${labelOf(e)} could not be moved.`);
        left.add(keyOf(e));
      }
    }
    setWorking(null);
    setSel(left.size ? left : NO_KEYS);
    setBulkProblems(missed);
  };

  /**
   * One folder moved, however it was asked for — a drag, Move to…, a rename that changes the path
   *. Said under the tree while it runs, since a folder of hundreds of files takes seconds
   * on the document store, and when it is refused the server's own reason is said there: until this
   * a refused move did nothing at all, which read as a drag that had not taken.
   */
  const moveOneFolder = async (from: string, to: string) => {
    setBulkProblems([]);
    setWorking(`Moving ${nameOfFolder(from)}…`);
    const problem = await files.moveFolder(from, to);
    setWorking(null);
    if (problem) setBulkProblems([problem]);
  };

  /** The selection moved to another vault (the transfer), one thing at a time; what was refused stays selected. */
  const transferChosen = async (to: string) => {
    if (lockedRef.current) return void refuseLocked();
    const p = chosen;
    setBulk(null);
    setBulkProblems([]);
    setWorking(`Moving ${counted(pickedCount(p), ["item", "items"])}…`);
    const missed: string[] = [];
    const left = new Set<string>();
    for (const f of p.folders) {
      const problem = await files.transfer({ folder: f }, to);
      if (problem) {
        missed.push(problem);
        left.add(folderKey(f));
      }
    }
    for (const e of p.files) {
      const problem = await files.transfer({ kind: e.kind, name: e.name }, to);
      if (problem) {
        missed.push(problem);
        left.add(keyOf(e));
      }
    }
    setWorking(null);
    setSel(left.size ? left : NO_KEYS);
    setBulkProblems([...new Set(missed)]);
  };

  /**
   * The selection moved to the trash: each folder with everything in it, and each file —
   * at once, since the window offers to take it back. What could not go stays selected and is said
   * under the tree, as a move's refusal is.
   */
  const deleteChosen = async () => {
    if (lockedRef.current) return void refuseLocked();
    const p = chosen;
    setBulk(null);
    setBulkProblems([]);
    setWorking(`Moving ${counted(pickedCount(p), ["item", "items"])} to the trash…`);
    const left = await files.trash([
      ...p.folders.map((folder) => ({ folder })),
      ...p.files.map((e) => ({ kind: e.kind, name: e.name })),
    ]);
    setWorking(null);
    setSel(left.length ? new Set(left.map((t) => ("folder" in t ? folderKey(t.folder) : keyOf(t)))) : NO_KEYS);
    setBulkProblems(left.length ? [`${counted(left.length, ["item", "items"])} could not be moved to the trash.`] : []);
  };

  /**
   * Dragging a row onto a folder: a file into it, or a folder with everything under it — or a file
   * onto the board open beside the column, which places that file's card there.
   *
   * The target comes out of the DOM in one `closest()`, never out of geometry: a folder row means
   * that folder, a file row the folder it is in, and the tree's own empty space the top level —
   * which is why every read of `data-dag-sidebar-drop` tests `=== undefined` rather than
   * truthiness. A shut folder held under the pointer for a moment opens, so a drop can reach
   * somewhere the tree was not showing.
   *
   * **What is dragged follows the pointer, and the list scrolls under it**: a chip with the
   * row's mark and name — or how many things, for a selection — rides beside the cursor, the rows it
   * came from fade where they are, and holding it near the top or the bottom of the tree scrolls the
   * tree, so a folder that is a screen away can be reached without letting go. All three are painted:
   * the chip is an element on `<body>` moved by a transform, and nothing re-renders on a move.
   */
  const onRowPointerDown = (line: Row) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    held.current = false;
    if (e.button !== 0 || (mode && mode.kind !== "menu")) return;
    const rowEl = e.currentTarget;
    if (line.type === "file") ahead(line.entry.kind, line.entry.name, rowKey(line) === currentKey).go();
    const key = rowKey(line);
    const from = whereOf(line);
    const home = parentOf(from);
    /* A selected row picked up with others selected carries all of them: into a folder, or
       onto the canvas as a card for every file in it — not the folders, which have no card, and not
       the board the canvas is. */
    const carried = (g: Picked | null) =>
      (g ? g.files : line.type === "file" ? [line.entry] : []).filter((f) => !(f.kind === "board" && f.name === board));
    let group = sel.has(key) && chosenCount > 1 ? chosen : null;
    let placing = carried(group);
    let to: string | null = null;
    /* Where on the glass a file would land on the canvas, when that is what the pointer is over. */
    let onto: { x: number; y: number } | null = null;
    let spring: { path: string; timer: number } | null = null;
    const clearMarks = () => {
      for (const el of overMarks(listRef.current)) delete el.dataset.dagSidebarOver;
      for (const el of document.querySelectorAll<HTMLElement>("[data-dag-drop-file]")) delete el.dataset.dagDropFile;
    };
    const unspring = () => {
      if (spring) window.clearTimeout(spring.timer);
      spring = null;
    };
    /* The chip, the rows it lifted, where the pointer is, and the frame that scrolls the tree. */
    let ghost: HTMLElement | null = null;
    let lifted: HTMLElement[] = [];
    let at = { x: e.clientX, y: e.clientY };
    let gliding = 0;
    const lift = () => {
      ghost = document.createElement("div");
      ghost.className = "dag-sidebar-ghost";
      ghost.dataset.dagSidebarGhost = "";
      ghost.setAttribute("aria-hidden", "true");
      const mark = group ? null : rowEl.querySelector("svg:not(.dag-sidebar__chev)");
      if (mark) ghost.append(mark.cloneNode(true));
      const label = document.createElement("span");
      label.textContent = group
        ? counted(pickedCount(group), ["item", "items"])
        : (rowEl.querySelector(".dag-sidebar__name")?.textContent ?? leaf(from));
      ghost.append(label);
      document.body.append(ghost);
      const keys = new Set(group ? [...group.folders.map(folderKey), ...group.files.map(keyOf)] : [key]);
      lifted = rowEls().filter((el) => keys.has(el.dataset.dagSidebarKey ?? ""));
      for (const el of lifted) el.dataset.dagSidebarLifted = "";
    };
    const trail = () => {
      if (ghost) ghost.style.transform = `translate(${at.x + GHOST_OFFSET.x}px, ${at.y + GHOST_OFFSET.y}px)`;
    };
    /* A pointer within `GLIDE_EDGE` of the tree's top or bottom scrolls it, faster the closer it is —
       and past the edge at full speed, as a file manager does — then aims again, since what is under
       a still pointer changed. Over the canvas beside the column it does nothing. */
    const glide = () => {
      gliding = 0;
      const list = listRef.current;
      if (!list) return;
      const r = list.getBoundingClientRect();
      if (at.x < r.left || at.x > r.right) return;
      const near = (gap: number) => Math.ceil(GLIDE_SPEED * Math.min(1, 1 - gap / GLIDE_EDGE));
      const step = at.y - r.top < GLIDE_EDGE ? -near(at.y - r.top) : r.bottom - at.y < GLIDE_EDGE ? near(r.bottom - at.y) : 0;
      if (!step) return;
      const was = list.scrollTop;
      list.scrollTop = was + step;
      if (list.scrollTop === was) return;
      aim();
      gliding = requestAnimationFrame(glide);
    };
    const aim = () => {
      clearMarks();
      to = null;
      onto = null;
      const hit = document.elementFromPoint(at.x, at.y);
      /* Off the column and over a board's canvas, a file is a card to place: the one the library's
         *Your notes* places — a task's status, a note's text, a board as a link. Not the board that
         is open, which would be a card of itself. */
      const canvas = placing.length ? hit?.closest<HTMLElement>(".dag-viewport") : null;
      if (canvas && !hit?.closest("[data-dag-sidebar]")) {
        canvas.dataset.dagDropFile = "";
        onto = { x: at.x, y: at.y };
        return;
      }
      const over = hit?.closest<HTMLElement>("[data-dag-sidebar-drop]");
      const shut = over?.dataset.dagSidebarShut;
      if (shut !== undefined && spring?.path !== shut) {
        unspring();
        spring = { path: shut, timer: window.setTimeout(() => onFolder(shut, true), SPRING) };
      } else if (shut === undefined) unspring();
      const target = over?.dataset.dagSidebarDrop;
      if (group) {
        /* Into none of its own folders, and somewhere at least one of them is not already. */
        if (!over || target === undefined || group.folders.some((g) => target === g || target.startsWith(`${g}/`))) return;
        if ([...group.folders, ...group.files.map((f) => f.name)].every((n) => parentOf(n) === target)) return;
        over.dataset.dagSidebarOver = "";
        to = target;
        return;
      }
      if (!over || target === undefined || target === home) return;
      if (line.type === "folder") {
        /* A folder into itself or anything under it would contain itself; onto a folder that
           already holds one of its name would be a merge, which a move is not. */
        if (target === from || target.startsWith(`${from}/`) || known.has(filedAt(from, target))) return;
      }
      over.dataset.dagSidebarOver = "";
      to = target;
    };
    startDrag(
      e,
      {
        onMove(ev, first) {
          /* A locked row is opened and selected, never carried anywhere: the drop says why. */
          if (lockedRef.current) return;
          at = { x: ev.clientX, y: ev.clientY };
          if (first) {
            document.documentElement.dataset.dagSidebarDrag = "";
            setMode(null);
            lift();
          }
          trail();
          aim();
          if (!gliding) gliding = requestAnimationFrame(glide);
        },
        onDrop() {
          if (lockedRef.current) {
            dragged.current = true;
            return void refuseLocked();
          }
          if (onto && placing.length) {
            dragged.current = true;
            const detail: PlaceFile = { files: placing.map((f) => ({ kind: f.kind, name: f.name })), ...onto };
            document.dispatchEvent(new CustomEvent("dag:place-file", { detail }));
            return;
          }
          if (to === null) return;
          dragged.current = true;
          if (group) void moveChosen(to);
          else if (line.type === "folder") void moveOneFolder(from, filedAt(from, to));
          else void files.move(line.entry.kind, from, to);
        },
        /* A finger held still: the row joins the selection, and a move from here
         carries the selection it joined — lifting the finger instead leaves it begun. */
        onHold() {
          hold(key);
          navigator.vibrate?.(10);
          const joined = new Set([...sel, key]);
          group = joined.size > 1 ? pickedOf(joined, entries) : null;
          placing = carried(group);
        },
        onEnd() {
          unspring();
          clearMarks();
          cancelAnimationFrame(gliding);
          ghost?.remove();
          for (const el of lifted) delete el.dataset.dagSidebarLifted;
          delete document.documentElement.dataset.dagSidebarDrag;
        },
      },
      HOLD,
    );
  };

  const searchChord = chordFor("boards");
  const menuLine = mode?.kind === "menu" ? lines.find((r) => rowKey(r) === mode.key) : undefined;

  return (
    <nav
      className="dag-sidebar"
      data-dag-sidebar=""
      data-mode={place}
      data-sheet={sheet ? "" : undefined}
      aria-label="Files and settings"
      onKeyDown={onKey}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {/* The toggle is `Shell`'s and is drawn over this slot, so it stays where it is when the
          column goes — and the mark after it is where the toolbar draws it while the
          column is away, at the same size, so that does not move either. Floating, the column hangs
          under the toolbar, which already carries both, and has no header of its own: the one it
          had held a second toggle beside the first. The mark is the way home: one press from any
          page back to the welcome card, which is what it is in the toolbar too. */}
      {place === "docked" ? (
        <div className="dag-sidebar__head">
          <span className="dag-sidebar-toggle-slot" aria-hidden="true" />
          <button
            type="button"
            className="dag-sidebar__logo"
            data-dag-sidebar-home=""
            aria-label="Home"
            title="Home"
            onClick={onHome}
          >
            <Lockup size={20} />
          </button>
        </div>
      ) : null}

      {/* The vault this tab is in and the way to another — first, as Notion's is,
          because the switcher is what the sidebar is for at its top. On a
          phone it shares its row with the way out, as the sheet has no page beside it to press. */}
      {sheet ? (
        <div className="dag-sidebar__sheethead">
          <VaultSwitcher onSettings={() => ask("settings", "vault")} />
          <button
            type="button"
            className="dag-icon dag-sidebar__close"
            data-dag-sidebar-close=""
            aria-label="Close the sidebar"
            onClick={onDismiss}
          >
            <X size={22} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <VaultSwitcher onSettings={() => ask("settings", "vault")} />
      )}

      <div className="dag-sidebar__acts">
        <button type="button" className="dag-sidebar__act" data-dag-sidebar-search="" onClick={() => ask("search")}>
          <Search {...ICON} aria-hidden="true" />
          <span>Search</span>
          {searchChord && !sheet ? (
            <span className="dag-sidebar__keys" aria-hidden="true">
              {searchChord.split(" ").map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          ) : null}
        </button>
        {onTasks ? (
          <button
            type="button"
            className="dag-sidebar__act"
            data-dag-sidebar-tasks=""
            aria-current={tasksOpen ? "page" : undefined}
            title="Every note that is a task, as a list or a board"
            onClick={onTasks}
          >
            <ListTodo {...ICON} aria-hidden="true" />
            <span>Tasks</span>
            {openTasks ? (
              <span className="dag-sidebar__badge" data-dag-sidebar-tasks-open={openTasks} aria-label={`${openTasks} open`}>
                {openTasks}
              </span>
            ) : null}
          </button>
        ) : null}
        {/* Tasks, events and notes on one timeline, under the page that lists the tasks. */}
        {onCalendar ? (
          <button
            type="button"
            className="dag-sidebar__act"
            data-dag-sidebar-calendar=""
            aria-current={calendarOpen ? "page" : undefined}
            title="Tasks, events and notes on one timeline"
            onClick={onCalendar}
          >
            <CalendarDays {...ICON} aria-hidden="true" />
            <span>Calendar</span>
          </button>
        ) : null}
        {/* Every quiz, and the one set the app makes: the questions still in Mistakes,
            counted here as Tasks counts what is open. */}
        {onQuizzes ? (
          <button
            type="button"
            className="dag-sidebar__act"
            data-dag-sidebar-quizzes=""
            aria-current={quizzesOpen ? "page" : undefined}
            title="Every quiz, and the questions you got wrong"
            onClick={onQuizzes}
          >
            <GraduationCap {...ICON} aria-hidden="true" />
            <span>Quizzes</span>
            {mistakes ? (
              <span
                className="dag-sidebar__badge"
                data-dag-sidebar-quizzes-open={mistakes}
                aria-label={`${mistakes} in Mistakes`}
              >
                {mistakes}
              </span>
            ) : null}
          </button>
        ) : null}
        {/* The chat with the person's own AI about this vault (`space A` opens it as a panel). */}
        {onAssistant ? (
          <button
            type="button"
            className="dag-sidebar__act"
            data-dag-sidebar-assistant=""
            aria-current={assistantOpen ? "page" : undefined}
            title="Ask your AI about this vault, or have it make a change"
            onClick={onAssistant}
          >
            <Sparkles {...ICON} aria-hidden="true" />
            <span>Assistant</span>
          </button>
        ) : null}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-dag-sidebar-upload-input=""
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            sendFiles(list, pickFor.current);
          }}
        />
      </div>

      {favs.length ? (
        <>
          <div className="dag-sidebar__section">
            <h2 id="dag-sidebar-favourites">Favourites</h2>
          </div>
          <div className="dag-sidebar__favs" role="list" aria-labelledby="dag-sidebar-favourites">
            {favs.map((e) => {
              const key = keyOf(e);
              const current = key === currentKey;
              return (
                <div
                  key={key}
                  role="listitem"
                  className={current ? "dag-sidebar__line dag-sidebar__line--on" : "dag-sidebar__line"}
                >
                  <button
                    type="button"
                    className={current ? "dag-sidebar__row dag-sidebar__row--on" : "dag-sidebar__row"}
                    data-dag-sidebar-favourite={e.name}
                    data-dag-kind={e.kind}
                    aria-current={current ? "page" : undefined}
                    title={hintOf(e, questions, sizes)}
                    onClick={() => onOpen(e.kind, e.name)}
                    {...pressed(ahead(e.kind, e.name, current))}
                  >
                    <FileIcon entry={e} task={tasks[e.name]} project={projects[e.name]} event={events[e.name]} />
                    <span className="dag-sidebar__name">{labelOf(e)}</span>
                  </button>
                  <span className="dag-sidebar__tools">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="dag-sidebar__tool"
                      data-dag-sidebar-unfavourite={e.name}
                      aria-label={`Remove ${e.name} from favourites`}
                      title="Remove from favourites"
                      onClick={() => files.favourite(e.kind, e.name, false)}
                    >
                      <StarOff {...SMALL} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="dag-sidebar__section">
        <h2 id="dag-sidebar-files">Files</h2>
        {/* One way to make anything, beside what it makes (the UI review): it was a row
            among the pages above, with a chevron, as though New were somewhere to go. It opens under
            the +, and says where the file will go — the open file's folder, which is where somebody
            working in one wants the next file, with the top level one press away. The folder button
            that made a top-level folder at once looked like a second kind of New and is gone; Folder
            is the menu's row, made where the menu says. */}
        <button
          type="button"
          className="dag-sidebar__tool dag-sidebar__tool--shown dag-sidebar__plus"
          data-dag-sidebar-new=""
          aria-haspopup="menu"
          aria-expanded={making !== null}
          aria-label="New"
          {...lockedAffordance(locked)}
          title={locked ? LOCK_HINT : "New board, note, task, event, quiz, table or folder, or upload files"}
          onClick={(e) => {
            if (locked) return void refuseLocked();
            const r = e.currentTarget.getBoundingClientRect();
            setMaking(making ? null : { x: r.left, y: r.bottom + 4, below: r.bottom + 4, left: r.left });
          }}
        >
          <Plus {...SMALL} aria-hidden="true" />
        </button>
      </div>
      <div
        className="dag-sidebar__tree"
        role="tree"
        aria-multiselectable="true"
        aria-labelledby="dag-sidebar-files"
        ref={listRef}
        onKeyDown={onTreeKey}
        data-dag-sidebar-drop=""
        /* Files dragged in from the computer: onto a folder, into it; onto a file, into the
           folder that file is in; onto the tree's own space, the top level — the same one
           `closest()` a row dragged inside the column reads. Native drag events, because these files
           come from outside the page and a pointer gesture never sees them. */
        onDragOver={(e) => {
          if (!draggedFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const over = (e.target as Element).closest<HTMLElement>("[data-dag-sidebar-drop]");
          for (const el of overMarks(listRef.current)) if (el !== over) delete el.dataset.dagSidebarOver;
          if (over) over.dataset.dagSidebarOver = "";
        }}
        onDragLeave={(e) => {
          if (listRef.current?.contains(e.relatedTarget as Node | null)) return;
          for (const el of overMarks(listRef.current)) delete el.dataset.dagSidebarOver;
        }}
        onDrop={(e) => {
          const list = draggedFiles(e.dataTransfer);
          if (!list) return;
          e.preventDefault();
          for (const el of overMarks(listRef.current)) delete el.dataset.dagSidebarOver;
          const over = (e.target as Element).closest<HTMLElement>("[data-dag-sidebar-drop]");
          sendFiles(list, over?.dataset.dagSidebarDrop ?? "");
        }}
      >
        {lines.length === 0 && loading ? (
          <p className="dag-sidebar__none" role="status" data-dag-sidebar-loading="">
            Loading your files…
          </p>
        ) : lines.length === 0 ? (
          <p className="dag-sidebar__none">Nothing here yet. Make a board, a note, a quiz or a table above.</p>
        ) : null}
        {lines.map((line) => {
          const key = rowKey(line);
          const depth = { "--depth": line.depth } as CSSProperties;
          const name = line.type === "folder" ? line.name : labelOf(line.entry);
          const where = whereOf(line);

          if (mode?.kind === "rename" && mode.key === key && line.type === "file") {
            /* A file's box is its title: what the row says is what is typed over, and the
               name follows it in the background. A `/` is a character of a title, never a folder —
               moving is Move to… and a drag, which say so. */
            return (
              <div key={key} className="dag-sidebar__line dag-sidebar__line--ask" style={depth}>
                <NameBox
                  value={name}
                  label={`New title for ${name}`}
                  check={() => null}
                  onCancel={() => settle(key)}
                  onDone={(v) => {
                    settle(key);
                    files.retitle(line.entry.kind, where, v);
                  }}
                />
              </div>
            );
          }

          if (mode?.kind === "rename" && mode.key === key && line.type === "folder") {
            /* A folder has no title: its name is what it is called, so its box is still a path. */
            const parent = parentOf(where);
            const destOf = (v: string) => (v.includes("/") ? v : parent ? `${parent}/${v}` : v);
            return (
              <div key={key} className="dag-sidebar__line dag-sidebar__line--ask" style={depth}>
                <NameBox
                  value={name}
                  label={`New name for ${where}`}
                  check={(v) => {
                    const dest = destOf(v);
                    if (dest.startsWith(`${where}/`)) return "A folder cannot go inside itself.";
                    if (dest !== where && known.has(dest)) return `${dest} already exists.`;
                    return null;
                  }}
                  onCancel={() => settle(key)}
                  onDone={(v) => {
                    /* A `/` typed says where; without one the folder it is in rides along, because
                       renaming is not moving. */
                    const dest = destOf(v);
                    settle(folderKey(dest));
                    if (dest !== where) void moveOneFolder(where, dest);
                  }}
                />
              </div>
            );
          }

          if (mode?.kind === "transfer" && mode.key === key) {
            /* Every vault but this one, as a real `<select>` — the move's own shape one level up. */
            return (
              <div key={key} className="dag-sidebar__line dag-sidebar__line--ask" style={depth}>
                <select
                  className="dag-sidebar__move"
                  data-dag-sidebar-transfer-to=""
                  autoFocus
                  aria-label={`Move ${where} to another vault`}
                  defaultValue=""
                  onBlur={() => setMode(null)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") settle(key);
                  }}
                  onChange={(e) => {
                    const picked = e.target.value;
                    setMode(null);
                    if (!picked.startsWith("vault:")) return;
                    setMoveProblem(null);
                    const what = line.type === "folder" ? { folder: where } : { kind: line.entry.kind, name: where };
                    void files.transfer(what, picked.slice(6)).then(setMoveProblem);
                  }}
                >
                  <option value="" disabled>
                    Move to vault…
                  </option>
                  {elsewhere.map((v) => (
                    <option key={v.id} value={`vault:${v.id}`}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          if (mode?.kind === "move" && mode.key === key) {
            /* Every folder but this one and whatever is under it — a folder cannot go inside
               itself — and the top level. A real `<select>`, which is the keyboard's way in and one
               Playwright can drive. */
            const here = parentOf(where);
            const choices = [...known]
              .filter((f) => line.type !== "folder" || (f !== where && !f.startsWith(`${where}/`)))
              .sort();
            return (
              <div key={key} className="dag-sidebar__line dag-sidebar__line--ask" style={depth}>
                <select
                  className="dag-sidebar__move"
                  data-dag-sidebar-move-to=""
                  autoFocus
                  aria-label={`Move ${where} to a folder`}
                  defaultValue={here}
                  onBlur={() => setMode(null)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") settle(key);
                  }}
                  onChange={(e) => {
                    const into = e.target.value;
                    setMode(null);
                    if (into === here) return;
                    if (line.type === "folder") {
                      if (!known.has(filedAt(where, into))) void moveOneFolder(where, filedAt(where, into));
                    } else void files.move(line.entry.kind, where, into);
                  }}
                >
                  <option value="">(top level)</option>
                  {choices.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          const common = {
            "data-dag-sidebar-row": "",
            "data-dag-sidebar-key": key,
            role: "treeitem",
            "aria-level": line.depth + 1,
            "aria-setsize": line.size,
            "aria-posinset": line.pos,
            tabIndex: key === stopKey ? 0 : -1,
            "aria-selected": sel.has(key),
            "data-dag-sidebar-picked": sel.has(key) ? "" : undefined,
            onFocus: () => setStop(key),
            onPointerDown: onRowPointerDown(line),
            onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => {
              e.preventDefault();
              /* A long press with a finger is a selection begun, never the row's menu: the `⋯` is that. */
              if ((e.nativeEvent as PointerEvent).pointerType === "touch" || held.current) return hold(key);
              openMenu(line, e.currentTarget, false, { x: e.clientX, y: e.clientY });
            },
            style: depth,
          };
          const tools = (
            <span className="dag-sidebar__tools">
              {line.type === "folder" && !locked ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="dag-sidebar__tool"
                  data-dag-sidebar-add={line.path}
                  aria-label={`New in ${line.path}`}
                  title="New board, note, task, quiz, table or folder here, or upload files"
                  onClick={(e) => openMenu(line, e.currentTarget, true)}
                >
                  <Plus {...SMALL} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                tabIndex={-1}
                className="dag-sidebar__tool"
                data-dag-sidebar-more={where}
                aria-label={`More for ${where}`}
                aria-haspopup="menu"
                title="Rename, move, delete (right-click, or shift+F10)"
                onClick={(e) => openMenu(line, e.currentTarget)}
              >
                <MoreHorizontal {...SMALL} aria-hidden="true" />
              </button>
            </span>
          );

          if (line.type === "folder") {
            /* A folder that is a project wears a kanban folder in its colour; its name is
               still the folder's, because that is what moving and renaming it change. */
            const owner = owners.get(line.path);
            const proj = owner ? projects[owner] : undefined;
            return (
              <div key={key} className="dag-sidebar__line">
                <button
                  type="button"
                  className="dag-sidebar__row dag-sidebar__row--folder"
                  data-dag-sidebar-folder={line.path}
                  data-dag-sidebar-drop={line.path}
                  data-dag-sidebar-shut={line.open ? undefined : line.path}
                  data-dag-sidebar-project={proj?.status}
                  data-dag-sidebar-store={line.path === store ? "" : undefined}
                  aria-expanded={line.open}
                  title={proj && owner ? `${line.path} — the project ${titles[owner] ?? leaf(owner)}` : line.path}
                  onClick={(e) => {
                    if (held.current) return void (held.current = false);
                    if (dragged.current || select(e, key)) return;
                    onFolder(line.path, !line.open);
                  }}
                  {...common}
                >
                  <span className="dag-sidebar__indent" aria-hidden="true" />
                  <ChevronRight {...SMALL} className="dag-sidebar__chev" aria-hidden="true" />
                  {proj ? (
                    <FolderKanban {...SMALL} className="dag-sidebar__project" style={hueVars(proj.hue)} aria-hidden="true" />
                  ) : line.open ? (
                    <FolderOpen {...SMALL} aria-hidden="true" />
                  ) : (
                    <FolderIcon {...SMALL} aria-hidden="true" />
                  )}
                  <span className="dag-sidebar__name">{line.name}</span>
                </button>
                {tools}
                {line.open && line.empty ? (
                  <p
                    className="dag-sidebar__empty"
                    data-dag-sidebar-drop={line.path}
                    style={{ "--depth": line.depth + 1 } as CSSProperties}
                  >
                    Empty
                  </p>
                ) : null}
              </div>
            );
          }
          const { kind } = line.entry;
          const current = key === currentKey;
          return (
            <div key={key} className={current ? "dag-sidebar__line dag-sidebar__line--on" : "dag-sidebar__line"}>
              <button
                type="button"
                className={current ? "dag-sidebar__row dag-sidebar__row--on" : "dag-sidebar__row"}
                data-dag-sidebar-file={where}
                data-dag-kind={kind}
                data-dag-sidebar-task={kind === "note" ? tasks[where]?.status : undefined}
                data-dag-sidebar-event={kind === "note" && events[where] ? events[where].start : undefined}
                data-dag-sidebar-drop={parentOf(where)}
                aria-current={current ? "page" : undefined}
                title={hintOf(line.entry, questions, sizes)}
                onClick={(e) => {
                  if (held.current) return void (held.current = false);
                  if (dragged.current || select(e, key)) return;
                  onOpen(kind, where);
                }}
                {...common}
                {...hover(ahead(kind, where, current))}
              >
                <span className="dag-sidebar__indent" aria-hidden="true" />
                <span className="dag-sidebar__chev" aria-hidden="true" />
                <FileIcon entry={line.entry} task={tasks[where]} project={projects[where]} event={events[where]} />
                <span className="dag-sidebar__name">{name}</span>
              </button>
              {tools}
            </div>
          );
        })}
      </div>

      {/* Under the tree, never above it: a bar appearing above the
          rows would move them under the pointer of a person in the middle of picking them. */}
      {sel.size || working ? (
        <SelectionBar
          count={working ? 0 : chosenCount}
          working={working}
          asking={bulk?.kind === "move" || bulk?.kind === "transfer" ? bulk.kind : null}
          targets={moveTargets(known, chosen)}
          vaults={elsewhere}
          locked={locked}
          onAsk={(what) => {
            if (locked) return void refuseLocked();
            setMode(null);
            setBulkProblems([]);
            if (what === "delete") return void deleteChosen();
            setBulk({ kind: what });
          }}
          onMove={(into) => void moveChosen(into)}
          onTransfer={(to) => void transferChosen(to)}
          onCancel={() => setBulk(null)}
          onClear={() => {
            setBulk(null);
            setSel(NO_KEYS);
          }}
        />
      ) : null}
      {bulkProblems.map((problem) => (
        <p key={problem} className="dag-sidebar__none" role="alert" data-dag-sidebar-bulk-problem="">
          {problem}
        </p>
      ))}
      {linked ? (
        <p className="dag-sidebar__none" role="status" data-dag-sidebar-linked={linked}>
          Link copied
        </p>
      ) : null}
      {moveProblem ? (
        <p className="dag-sidebar__none" role="alert" data-dag-sidebar-transfer-problem="">
          {moveProblem}
        </p>
      ) : null}
      {uploading ? (
        <p className="dag-sidebar__none" role="status" data-dag-sidebar-uploading={uploading}>
          Uploading {uploading === 1 ? "a file" : `${uploading} files`}…
        </p>
      ) : null}
      {uploadProblems.map((problem) => (
        <p key={problem} className="dag-sidebar__none" role="alert" data-dag-sidebar-upload-problem="">
          <Said text={problem} />
        </p>
      ))}
      {createProblems.map((problem) => (
        <p key={problem} className="dag-sidebar__none" role="alert" data-dag-sidebar-create-problem="">
          <Said text={problem} />
        </p>
      ))}

      {making ? (
        <NewMenu
          at={sheet ? { x: making.left, y: making.below } : making}
          here={currentName ? parentOf(currentName) : ""}
          onClose={() => setMaking(null)}
          onPick={(what, folder) => {
            setMaking(null);
            if (what === "upload") return pickFiles(folder);
            if (what === "folder") return reportMake(files.newFolder(folder));
            reportMake(files.newFile(what, folder));
          }}
        />
      ) : null}

      {mode?.kind === "menu" && menuLine ? (
        <RowMenu
          line={menuLine}
          add={mode.add}
          at={mode.at}
          favourite={menuLine.type === "file" && isFavourite(menuLine.entry)}
          task={
            /* A plain note may be made a task; an event may not, since a status would make its start a task's. */
            menuLine.type === "file" && menuLine.entry.kind === "note"
              ? (tasks[menuLine.entry.name] ?? (events[menuLine.entry.name] ? undefined : null))
              : undefined
          }
          event={
            menuLine.type === "file" && menuLine.entry.kind === "note" && !tasks[menuLine.entry.name]
              ? (events[menuLine.entry.name] ?? null)
              : undefined
          }
          project={menuLine.type === "folder" ? (owners.get(menuLine.path) ?? null) : undefined}
          practise={menuLine.type === "folder" && !!onPracticeFolder && quizzes.some((q) => q.startsWith(`${menuLine.path}/`))}
          elsewhere={elsewhere.length > 0}
          locked={locked}
          onClose={() => settle(mode.key)}
          onPick={(what) => {
            const key = mode.key;
            if (locked && !READ_PICKS.has(what)) {
              settle(key);
              return void refuseLocked();
            }
            const where = whereOf(menuLine);
            /* Into the trash at once, a folder with everything in it: nothing is asked,
               because the window offers to take it back — the three questions this asked went with
               the reason for them. */
            if (what === "delete") {
              settle(key);
              const said = menuLine.type === "folder" ? nameOfFolder(where) : `“${labelOf(menuLine.entry)}”`;
              setBulkProblems([]);
              /* A refusal is said under the tree, as a move's is: there is no question left on screen to say it in. */
              void files
                .trash([menuLine.type === "folder" ? { folder: where } : { kind: menuLine.entry.kind, name: where }])
                .then((left) => left.length && setBulkProblems([`${said} could not be moved to the trash.`]));
              return;
            }
            if (what === "download" && menuLine.type === "file") {
              settle(key);
              const a = document.createElement("a");
              a.href = fileUrl({ name: where }, true);
              a.download = downloadName(where, titles[where]);
              a.click();
              return;
            }
            if (what === "upload") {
              settle(key);
              return pickFiles(where);
            }
            if (what === "rename" || what === "move" || what === "transfer") return setMode({ kind: what, key });
            settle(key);
            if (what === "copy-link" && menuLine.type === "file") void copyAppLink(menuLine.entry);
            else if (menuLine.type === "file" && (what === "favourite" || what === "unfavourite"))
              files.favourite(menuLine.entry.kind, where, what === "favourite");
            else if (what === "duplicate" && menuLine.type === "file") files.duplicate(menuLine.entry.kind, where);
            else if (what === "new-board") reportMake(files.newFile("board", where));
            else if (what === "new-note") reportMake(files.newFile("note", where));
            else if (what === "new-task") reportMake(files.newFile("task", where));
            else if (what === "new-event") reportMake(files.newFile("event", where));
            else if (what === "new-quiz") reportMake(files.newFile("quiz", where));
            else if (what === "new-table") reportMake(files.newFile("table", where));
            else if (what === "make-task" || what === "mark-todo") files.task(where, { status: "todo" });
            else if (what === "mark-done") files.task(where, { status: "done" });
            else if (what === "unmake-task") files.task(where, { status: null, due: null, start: null });
            else if (what === "make-event") files.event(where, nextHourEvent());
            else if (what === "unmake-event") files.event(where, { start: null, end: null });
            else if (what === "new-folder") reportMake(files.newFolder(where));
            else if (what === "make-project") reportMake(files.makeProject(where));
            else if (what === "practise" && menuLine.type === "folder") onPracticeFolder?.(where);
            else if (what === "open-project" && menuLine.type === "folder") {
              const owner = owners.get(where);
              if (owner) onOpen("note", owner);
            } else if (what === "unmake-project" && menuLine.type === "folder") {
              const owner = owners.get(where);
              if (owner) files.project(owner, { project: null, hue: null });
            }
          }}
        />
      ) : null}

      {bulk?.kind === "menu" && chosenCount ? (
        <BulkMenu
          at={bulk.at}
          count={chosenCount}
          elsewhere={elsewhere.length > 0}
          onClose={() => setBulk(null)}
          onPick={(what) => {
            if (what === "clear") {
              setBulk(null);
              return setSel(NO_KEYS);
            }
            setBulkProblems([]);
            if (what === "delete") {
              setBulk(null);
              return void deleteChosen();
            }
            setBulk({ kind: what });
          }}
        />
      ) : null}

      <div className="dag-sidebar__foot">
        {/* What was deleted — at the foot, Notion's place for
            it: a thing somebody goes looking for after the fact, never on the way to their work. */}
        {onTrash ? (
          <button
            type="button"
            className="dag-sidebar__act"
            data-dag-sidebar-trash=""
            aria-current={trashOpen ? "page" : undefined}
            title="What was deleted, until it is deleted for good"
            onClick={onTrash}
          >
            <Trash2 {...ICON} aria-hidden="true" />
            <span>Trash</span>
          </button>
        ) : null}
        {cloud ? <SyncRow onOpen={() => ask("settings", "sync")} /> : null}
        {cloud ? <FeedbackRow onFeedback={() => ask("feedback")} /> : null}
        <SettingsRow onSettings={() => ask("settings")} sheet={sheet} />
      </div>

      {place === "docked" ? <Grip onWidth={onWidth} /> : null}
    </nav>
  );
}

/** What the New menu makes: the five kinds with a text, the two notes that start as more, and the two that are not files. */
type Making = TextKind | "task" | "event" | "folder" | "upload";

/** The New menu's rows, in the order a person reaches for them — a board first, as the app is a canvas. */
const MAKES: { what: Making; label: string; icon: LucideIcon; hook?: string }[] = [
  { what: "board", label: "Board", icon: Workflow, hook: "data-dag-sidebar-new-board" },
  { what: "note", label: "Note", icon: FileText, hook: "data-dag-sidebar-new-note" },
  { what: "task", label: "Task", icon: SquareCheckBig, hook: "data-dag-sidebar-new-task" },
  { what: "event", label: "Event", icon: CalendarPlus, hook: "data-dag-sidebar-new-event" },
  { what: "quiz", label: "Quiz", icon: GraduationCap, hook: "data-dag-sidebar-new-quiz" },
  { what: "table", label: "Table", icon: Table2, hook: "data-dag-sidebar-new-table" },
];

/** The vault's attachments folder, as Settings names it, kept current while the sidebar is up. */
function useAttachmentsFolder(): string {
  const read = () => readPref(ATTACHMENTS) || "attachments";
  const [at, setAt] = useState(read);
  useEffect(() => {
    const on = () => setAt(read());
    addEventListener(PREFS_CHANGED, on);
    return () => removeEventListener(PREFS_CHANGED, on);
  }, []);
  return at;
}

/**
 * The New menu: everything the sidebar makes, in one place, and where it will go.
 *
 * **In the open file's folder**, said at the top with the top level one press away: a file made from inside a folder used to land at the top
 * level, far from the work, and nothing said so. With nothing open, or a file at the top level,
 * there is nowhere else to offer and the header says where it goes.
 *
 * The six kinds keep the hooks the six rows they replace had (`data-dag-sidebar-new-board` and the
 * rest), so a check that pressed a row presses the same element one menu deeper.
 */
function NewMenu({
  at,
  here,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  /** The open file's folder, or `""`. */
  here: string;
  onPick(what: Making, folder: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [top, setTop] = useState(false);
  const folder = top ? "" : here;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      /* The row that opened it toggles it itself; everything else outside is "never mind". */
      if (!ref.current?.contains(t) && !t?.closest?.("[data-dag-sidebar-new]")) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      document.querySelector<HTMLElement>("[data-dag-sidebar-new]")?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      className="dag-sidebar__menu dag-sidebar__menu--row dag-sidebar__menu--new"
      role="menu"
      aria-label="New"
      data-dag-sidebar-new-menu=""
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
    >
      <p className="dag-sidebar__menu-where" data-dag-sidebar-new-where={folder}>
        <FolderIcon {...SMALL} aria-hidden="true" />
        <span>
          {folder ? (
            <>
              New in <strong>{leaf(folder)}</strong>
            </>
          ) : (
            "New at the top level"
          )}
        </span>
        {here ? (
          <button
            type="button"
            className="dag-sidebar__menu-switch"
            data-dag-sidebar-new-top=""
            title={top ? here : "Make it at the top level instead"}
            onClick={() => setTop((v) => !v)}
          >
            {top ? `In ${leaf(here)}` : "Top level"}
          </button>
        ) : null}
      </p>
      {MAKES.map(({ what, label, icon: Icon, hook }) => (
        <button
          key={what}
          type="button"
          role="menuitem"
          className="dag-more__item"
          data-dag-sidebar-new-kind={what}
          {...(hook ? { [hook]: "" } : {})}
          onClick={() => onPick(what, folder)}
        >
          <Icon {...ICON} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
      <hr className="dag-vault__rule" />
      <button
        type="button"
        role="menuitem"
        className="dag-more__item"
        data-dag-sidebar-new-kind="folder"
        onClick={() => onPick("folder", folder)}
      >
        <FolderPlus {...ICON} aria-hidden="true" />
        <span>Folder</span>
      </button>
      {/* Any file a person works with: a PDF, a sheet, a deck, a recording. */}
      <button
        type="button"
        role="menuitem"
        className="dag-more__item"
        data-dag-sidebar-new-kind="upload"
        data-dag-sidebar-upload=""
        title="Upload files: PDFs, pictures, documents, sheets, slides, audio, video"
        onClick={() => onPick("upload", folder)}
      >
        <Upload {...ICON} aria-hidden="true" />
        <span>Upload files…</span>
      </button>
    </div>
  );
}

/** What a row's menu may still do while the app is locked: nothing in it changes a file. */
const READ_PICKS: ReadonlySet<Pick> = new Set<Pick>([
  "favourite",
  "unfavourite",
  "copy-link",
  "download",
  "open-project",
  "practise",
]);

type Pick =
  | "rename"
  | "duplicate"
  | "move"
  | "delete"
  | "new-board"
  | "new-note"
  | "new-task"
  | "new-event"
  | "new-quiz"
  | "new-table"
  | "new-folder"
  | "make-task"
  | "mark-done"
  | "mark-todo"
  | "unmake-task"
  | "make-event"
  | "unmake-event"
  | "make-project"
  | "open-project"
  | "unmake-project"
  | "practise"
  | "favourite"
  | "unfavourite"
  | "copy-link"
  | "transfer"
  | "download"
  | "upload";

/**
 * A row's menu: the `⋯`, a right-click, or `shift+F10` — the same menu by all three, because a
 * control that only exists on hover also needs a keyboard route, and a right-click is
 * where a person looks for it first.
 *
 * `position: fixed` where it was asked for, nudged back inside the window, because the tree scrolls
 * and a menu inside the scroller would be clipped at its edge.
 */
function RowMenu({
  line,
  add,
  at,
  favourite,
  task,
  event,
  project,
  practise = false,
  elsewhere,
  locked = false,
  onPick,
  onClose,
}: {
  line: Row;
  /** The folder's `+`: what can be made in it, rather than what can be done to it. */
  add: boolean;
  at: { x: number; y: number };
  /** Whether this file is already a favourite, which decides which of the two the menu offers. */
  favourite: boolean;
  /** A note's task, `null` for a note that is not one, `undefined` for a board or a folder. */
  task?: Task | null;
  /** A note's event, `null` for a plain note that could be one, `undefined` for anything else. */
  event?: NoteEvent | null;
  /** A folder's project note, `null` for a folder that is not a project, `undefined` for a file. */
  project?: string | null;
  /** A folder with a quiz under it: every one of them can be practised as one run. */
  practise?: boolean;
  /** Whether there is another vault to move this to. */
  elsewhere: boolean;
  /** Read only: the rows that change a file are left out, and the menu says why. */
  locked?: boolean;
  onPick(what: Pick): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  const item = (what: Pick, label: string, icon: ReactNode, danger = false) =>
    locked && !READ_PICKS.has(what) ? null : (
      <button
        type="button"
        role="menuitem"
        className={danger ? "dag-more__item dag-sidebar__menu-danger" : "dag-more__item"}
        data-dag-sidebar-menu-item={what}
        onClick={() => onPick(what)}
      >
        {icon}
        <span>{label}</span>
        {what === "rename" ? <kbd>F2</kbd> : null}
      </button>
    );

  return (
    <div
      ref={ref}
      className="dag-sidebar__menu dag-sidebar__menu--row"
      role="menu"
      data-dag-sidebar-menu=""
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
    >
      {add ? (
        <>
          {item("new-board", "New board", <FilePlus2 {...ICON} aria-hidden="true" />)}
          {item("new-note", "New note", <NotebookPen {...ICON} aria-hidden="true" />)}
          {item("new-task", "New task", <SquareCheckBig {...ICON} aria-hidden="true" />)}
          {item("new-event", "New event", <CalendarPlus {...ICON} aria-hidden="true" />)}
          {item("new-quiz", "New quiz", <FileQuestion {...ICON} aria-hidden="true" />)}
          {item("new-table", "New table", <Grid2x2Plus {...ICON} aria-hidden="true" />)}
          {item("new-folder", "New folder", <FolderPlus {...ICON} aria-hidden="true" />)}
          {item("upload", "Upload files…", <Upload {...ICON} aria-hidden="true" />)}
        </>
      ) : (
        <>
          {line.type === "file"
            ? favourite
              ? item("unfavourite", "Remove from favourites", <StarOff {...ICON} aria-hidden="true" />)
              : item("favourite", "Add to favourites", <Star {...ICON} aria-hidden="true" />)
            : null}
          {/* A folder becomes a project by gaining a project note, and stops by its note losing the
              line. The note is where the rest of a project is changed. */}
          {practise ? item("practise", "Practice the quizzes", <GraduationCap {...ICON} aria-hidden="true" />) : null}
          {project === null ? item("make-project", "Make it a project", <FolderKanban {...ICON} aria-hidden="true" />) : null}
          {project ? (
            <>
              {item("open-project", "Open project", <Briefcase {...ICON} aria-hidden="true" />)}
              {item("unmake-project", "Not a project", <CircleSlash {...ICON} aria-hidden="true" />)}
            </>
          ) : null}
          {/* A note's status, from the row, as the Tasks page sets it. */}
          {/* Not on an event, as on the note's own page: a status would make its `start:` a task's, and
              its `end:` a line nothing reads, which "Not a task" then leaves behind. */}
          {task === null && !event ? item("make-task", "Make it a task", <SquareCheckBig {...ICON} aria-hidden="true" />) : null}
          {task ? (
            <>
              {task.status === "done"
                ? item("mark-todo", "Mark as to do", <TaskGlyph status="todo" size={16} />)
                : item("mark-done", "Mark as done", <CircleCheck {...ICON} aria-hidden="true" />)}
              {item("unmake-task", "Not a task", <CircleSlash {...ICON} aria-hidden="true" />)}
            </>
          ) : null}
          {/* And a note's start: made an event at the next hour, as New event makes one. */}
          {event === null ? item("make-event", "Make it an event", <CalendarPlus {...ICON} aria-hidden="true" />) : null}
          {event ? item("unmake-event", "Not an event", <CalendarX2 {...ICON} aria-hidden="true" />) : null}
          {/* The app's link, on every file: it opens for whoever is signed in here. */}
          {line.type === "file" ? item("copy-link", "Copy link", <LinkMark {...ICON} aria-hidden="true" />) : null}
          {/* An attachment is saved as the file it was uploaded as, under what it is called now. */}
          {line.type === "file" && line.entry.kind === "file"
            ? item("download", "Download", <Download {...ICON} aria-hidden="true" />)
            : null}
          {item("rename", "Rename", <Pencil {...ICON} aria-hidden="true" />)}
          {line.type === "file" ? item("duplicate", "Duplicate", <Copy {...ICON} aria-hidden="true" />) : null}
          {item("move", "Move to…", <FolderInput {...ICON} aria-hidden="true" />)}
          {elsewhere ? item("transfer", "Move to vault…", <ArrowRightLeft {...ICON} aria-hidden="true" />) : null}
          {/* Into the trash, a folder with everything in it, and nothing asked. */}
          {item("delete", "Delete", <Trash2 {...ICON} aria-hidden="true" />, true)}
        </>
      )}
      {locked ? (
        <p className="dag-sidebar__menu-locked" data-dag-sidebar-menu-locked="">
          Read only: unlock to change it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The selection's bar, under the tree: how many are selected and the three things that can
 * be done to all of them at once — a folder to move them to, a vault, or a delete — and the way
 * to let them go. A folder or a vault is asked in the bar itself, as a row asks its own, with a
 * real `<select>`; a delete is a modal, because it counts what goes. While a bulk action runs the bar
 * says so, and nothing else can be asked.
 */
function SelectionBar({
  count,
  working,
  asking,
  targets,
  vaults,
  locked = false,
  onAsk,
  onMove,
  onTransfer,
  onCancel,
  onClear,
}: {
  count: number;
  working: string | null;
  asking: "move" | "transfer" | null;
  /** Every folder the selection may go to, `""` the top level — `moveTargets`. */
  targets: readonly string[];
  /** Every open vault but this one. */
  vaults: readonly { id: string; name: string }[];
  /** Read only: a selection is kept and cleared, and nothing is done to it. */
  locked?: boolean;
  onAsk(what: "move" | "transfer" | "delete"): void;
  onMove(into: string): void;
  onTransfer(to: string): void;
  onCancel(): void;
  onClear(): void;
}) {
  const keys = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onCancel();
  };
  if (working)
    return (
      <div className="dag-sidebar__bulk" role="status" data-dag-sidebar-bulk="" data-dag-sidebar-bulk-working="">
        <span className="dag-sidebar__bulk-count">{working}</span>
      </div>
    );
  if (asking === "move")
    return (
      <div className="dag-sidebar__bulk" data-dag-sidebar-bulk={count}>
        <select
          className="dag-sidebar__move"
          data-dag-sidebar-bulk-move-to=""
          autoFocus
          aria-label={`Move ${count} to a folder`}
          defaultValue=""
          onBlur={onCancel}
          onKeyDown={keys}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("to:")) onMove(v.slice(3));
          }}
        >
          <option value="" disabled>
            Move {count} to…
          </option>
          {targets.map((f) => (
            <option key={f || "(top level)"} value={`to:${f}`}>
              {f || "(top level)"}
            </option>
          ))}
        </select>
      </div>
    );
  if (asking === "transfer")
    return (
      <div className="dag-sidebar__bulk" data-dag-sidebar-bulk={count}>
        <select
          className="dag-sidebar__move"
          data-dag-sidebar-bulk-transfer-to=""
          autoFocus
          aria-label={`Move ${count} to another vault`}
          defaultValue=""
          onBlur={onCancel}
          onKeyDown={keys}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("vault:")) onTransfer(v.slice(6));
          }}
        >
          <option value="" disabled>
            Move {count} to vault…
          </option>
          {vaults.map((v) => (
            <option key={v.id} value={`vault:${v.id}`}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
    );
  return (
    <div className="dag-sidebar__bulk" role="toolbar" aria-label={`${count} selected`} data-dag-sidebar-bulk={count}>
      <span className="dag-sidebar__bulk-count">{count} selected</span>
      <span className="dag-sidebar__bulk-acts">
        {locked ? null : (
          <button
            type="button"
            className="dag-sidebar__tool"
            data-dag-sidebar-bulk-act="move"
            aria-label={`Move ${count} to a folder`}
            title="Move to…"
            onClick={() => onAsk("move")}
          >
            <FolderInput {...SMALL} aria-hidden="true" />
          </button>
        )}
        {vaults.length && !locked ? (
          <button
            type="button"
            className="dag-sidebar__tool"
            data-dag-sidebar-bulk-act="transfer"
            aria-label={`Move ${count} to another vault`}
            title="Move to vault…"
            onClick={() => onAsk("transfer")}
          >
            <ArrowRightLeft {...SMALL} aria-hidden="true" />
          </button>
        ) : null}
        {locked ? null : (
          <button
            type="button"
            className="dag-sidebar__tool dag-sidebar__tool--danger"
            data-dag-sidebar-bulk-act="delete"
            aria-label={`Delete ${count}`}
            title="Delete — they go to the trash"
            onClick={() => onAsk("delete")}
          >
            <Trash2 {...SMALL} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="dag-sidebar__tool"
          data-dag-sidebar-bulk-act="clear"
          aria-label="Clear the selection"
          title="Clear the selection (Escape)"
          onClick={onClear}
        >
          <X {...SMALL} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

/**
 * A selected row's menu when two or more are selected: the right-click, the `⋯` and
 * `shift+F10` on any of them, offering what the bar offers. `RowMenu`'s mechanics, and its classes.
 */
function BulkMenu({
  at,
  count,
  elsewhere,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  count: number;
  elsewhere: boolean;
  onPick(what: "move" | "transfer" | "delete" | "clear"): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };
  const item = (what: "move" | "transfer" | "delete" | "clear", label: string, icon: ReactNode, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={danger ? "dag-more__item dag-sidebar__menu-danger" : "dag-more__item"}
      data-dag-sidebar-bulk-item={what}
      onClick={() => onPick(what)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div
      ref={ref}
      className="dag-sidebar__menu dag-sidebar__menu--row"
      role="menu"
      aria-label={`${count} selected`}
      data-dag-sidebar-bulk-menu=""
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
    >
      <p className="dag-sidebar__bulk-head">{count} selected</p>
      {item("move", "Move to…", <FolderInput {...ICON} aria-hidden="true" />)}
      {elsewhere ? item("transfer", "Move to vault…", <ArrowRightLeft {...ICON} aria-hidden="true" />) : null}
      {item("clear", "Clear the selection", <X {...ICON} aria-hidden="true" />)}
      {item("delete", `Delete ${count}`, <Trash2 {...ICON} aria-hidden="true" />, true)}
    </div>
  );
}

/**
 * A name being typed where the row was: a rename, or the name of something just made.
 *
 * Enter commits, Escape and blur abandon — blur because clicking away from a half-typed name
 * plainly means "never mind", and a second control in a 30px row halves the room the name has. The
 * text arrives selected, so typing replaces `untitled` and Escape keeps it. A name that will not do
 * says why as it is typed, so the refusal is read before Enter rather than after it.
 */
function NameBox({
  value,
  label,
  check,
  onDone,
  onCancel,
}: {
  value: string;
  label: string;
  check(v: string): string | null;
  onDone(v: string): void;
  onCancel(): void;
}) {
  const [text, setText] = useState(value);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  const v = text.trim();
  const wrong = v && v !== value ? check(v) : null;
  return (
    <span className="dag-sidebar__namebox">
      <input
        ref={box}
        className="dag-sidebar__name-input"
        data-dag-sidebar-name=""
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        aria-invalid={wrong ? "true" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            if (wrong) return;
            if (v && v !== value) onDone(v);
            else onCancel();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {wrong ? (
        <span className="dag-sidebar__name-why" role="alert" data-dag-sidebar-name-why="">
          {wrong}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Settings, at the foot: the one way to it with the pointer, opening where the last
 * visit left off, as `ctrl+,` does.
 */
/** A linked vault's sync status, one quiet row; nothing at all when it is not linked. */
function SyncRow({ onOpen }: { onOpen(): void }) {
  const status = useSyncStatus();
  if (!status?.linked) return null;
  const Mark = status.state === "syncing" ? RefreshCw : status.state === "idle" && !status.conflicts.length ? Cloud : CloudAlert;
  const words = statusWords(status);
  return (
    <button
      type="button"
      className="dag-sidebar__act dag-sync-row"
      data-dag-sync-row={status.state}
      data-tone={statusTone(status)}
      title={`Sync: ${words}`}
      onClick={onOpen}
    >
      <Mark {...ICON} aria-hidden="true" />
      <span>{words}</span>
    </button>
  );
}

/** Send feedback, above Settings: the card is the page's to draw (`feedback/FeedbackCard.tsx`). */
function FeedbackRow({ onFeedback }: { onFeedback(): void }) {
  return (
    <button
      type="button"
      className="dag-sidebar__act"
      data-dag-feedback-open=""
      title="Tell us what to fix or build"
      onClick={onFeedback}
    >
      <MessageCircleWarning {...ICON} aria-hidden="true" />
      <span>Send feedback</span>
    </button>
  );
}

function SettingsRow({ onSettings, sheet }: { onSettings(): void; sheet: boolean }) {
  return (
    <div className="dag-sidebar__account-wrap">
      <button
        type="button"
        className="dag-sidebar__account"
        data-dag-settings-toggle=""
        aria-label="Settings"
        title={sheet ? "Settings" : "Settings (Ctrl+,)"}
        onClick={onSettings}
      >
        <Settings2 {...ICON} aria-hidden="true" />
        <span className="dag-sidebar__who-name">Settings</span>
      </button>
    </div>
  );
}

/**
 * The right edge, dragged to widen the column. Painted onto the shell for the duration — the
 * inspector's grip, and `Viewport`'s split before it — and only the settled width reaches React and
 * the saved preference. A double-click puts it back.
 */
function Grip({ onWidth }: { onWidth(w: number): void }) {
  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const nav = e.currentTarget.parentElement;
      const shell = nav?.parentElement;
      if (!nav || !shell) return;
      const startX = e.clientX;
      const startW = nav.getBoundingClientRect().width;
      let w = startW;
      shell.setAttribute("data-sidebar-dragging", "");
      const onMove = (ev: PointerEvent) => {
        w = Math.min(dragCap(innerWidth), Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
        shell.style.setProperty("--sidebar-w", `${Math.round(w)}px`);
      };
      const onUp = () => {
        shell.removeAttribute("data-sidebar-dragging");
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        onWidth(w);
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    },
    [onWidth],
  );
  return (
    <div
      className="dag-sidebar__grip"
      data-dag-sidebar-grip=""
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to widen the sidebar, or double-click to reset it"
      onPointerDown={onDown}
      onDoubleClick={() => onWidth(SIDEBAR_W)}
    />
  );
}
