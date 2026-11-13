import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CODES } from "../dsl/codes";
import { concerns, onBoard, onBoards, onFile, onNote, onQuiz, onTable, type BoardChange } from "./events";
import { GUESSED, guessed, shown, tick } from "./guess";
import { refresher } from "./refresher";
import type { SavedComponent } from "./library/saved";
import { parseBoard } from "./parseBoard";
import { openDoc } from "./prefetch";
import { FILE_LIST, readPref, writeLocal } from "../settings/prefs";
import type { PatchOp } from "./patch";
import type { Board } from "./types";
import type { EventChange, NoteEvent } from "../note/event";
import { UNTITLED } from "../note/format";
import type { Project, ProjectChange } from "../note/project";
import type { Task, TaskChange, TaskStatus } from "../note/task";
import { blankTable } from "../table/write";

/**
 * One board, kept in step with the store.
 *
 * The first load is a fetch; every load after it is prompted by the change feed (`events.ts`).
 * Parsing is on the client rather than the server so the same code produces the items the renderer
 * draws and the diagnostics it shows — a server-side parse would need the errors sent over the wire
 * in a shape that is another thing to keep in sync.
 *
 * `patch` and `put` are the way back. Everything else here is one-directional — the file is the
 * truth and the page follows it — but a person editing on the canvas has to be able to write, and
 * the file has another writer in Claude. The version the client last saw travels with every write;
 * a write against a version that has moved is refused, and the refusal carries the text that
 * replaced it.
 */

/** What the page says when a write never reached the server — the sentence `UploadNotice` draws. */
const UNREACHABLE = "The AnyDag server did not answer, so that change was not saved.";

/** A version of the file: the text and the sha1 the server knows it by. */
interface Version {
  text: string;
  base: string;
}

/** What a write did: the version it was applied to, and the one it produced. */
interface Write {
  before: Version;
  after: Version;
}

/**
 * Why a page has no document to draw.
 *
 * **The reason is not the message.** `missing` is a 404 (or the change feed watching a file go),
 * `unreachable` is a `fetch` that rejected with no answer, and `unreadable` is every other answer or
 * failure — a 5xx, an error body, or text that did not become the kind's document. The page draws a
 * different sentence and a different set of actions for each (`src/ui/FileProblem.tsx`), and the raw
 * message and code stay under a disclosure.
 */
export interface LoadProblem {
  reason: "missing" | "unreachable" | "unreadable";
  /** The server's message or the exception's, for the bug-report disclosure. Never the sentence shown. */
  message?: string;
  /** A diagnostic code, where one exists — `EB_UNREADABLE` for a board. */
  code?: string;
  /** The file's text, when the bytes arrived and reading them as this kind failed. */
  text?: string;
}

export interface BoardHandle {
  board: Board | null;
  /** The sentence a board page used to draw. Kept for the read-only view's plain `Missing` card. */
  error: string | null;
  /** Why the board could not be loaded, for a page that offers what to do about it. */
  problem: LoadProblem | null;
  /** Ask for the board again — the unreachable state's *Try again*. */
  reload(): void;
  /** Change items. Resolves to what was written, or `null` when the edit could not be applied. */
  patch(ops: PatchOp[]): Promise<Write | null>;
  /** Replace the whole file — the undo path. Same contract as `patch`. */
  put(text: string): Promise<Write | null>;
  /** The version this client currently holds, or `null` before the first load. */
  current(): Version | null;
  /**
   * The board's permanent id — the store's, never the file's — or `null` before the
   * first load. What an export carries and what a reference to this board names.
   */
  docId: string | null;
}

export function useBoard(name: string | null): BoardHandle {
  const [board, setBoard] = useState<Board | null>(null);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  /* A version of the load, so *Try again* asks the same question again rather than waiting for a
     change on the feed that a dead server will never send. */
  const [attempt, setAttempt] = useState(0);
  /* A ref, not state: a write must read the version as of the moment it is called, and a value
     captured in a render closure is one HMR push out of date exactly when it matters. */
  const held = useRef<Version | null>(null);

  const adopt = useCallback((boardName: string, v: Version) => {
    try {
      const parsed = parseBoard(boardName, v.text);
      held.current = v;
      setBoard(parsed);
      setProblem(null);
    } catch (e) {
      /* The bytes arrived and the board could not become one: unreadable, and *Open as text* has
         something to show. A defect in the parser must not be reported as a dead server. */
      held.current = v;
      setBoard(null);
      setProblem({
        reason: "unreadable",
        message: e instanceof Error ? e.message : String(e),
        code: CODES.EB_UNREADABLE,
        text: v.text,
      });
    }
  }, []);

  useEffect(() => {
    setDocId(null);
    if (!name) {
      setBoard(null);
      setProblem(null);
      held.current = null;
      return;
    }
    let live = true;
    setProblem(null);

    /* Opening is the one read a prefetch may answer; the feed's refetch below never is. */
    openDoc("board", name)
      .then(async (r) => {
        let data: { text?: string; base?: string; error?: string; id?: string };
        try {
          data = (await r.json()) as typeof data;
        } catch (e) {
          if (live)
            setProblem({
              reason: "unreadable",
              message: e instanceof Error ? e.message : String(e),
              code: CODES.EB_UNREADABLE,
            });
          return;
        }
        if (!live) return;
        setDocId(data.id ?? null);
        if (!r.ok) {
          /* A 404 is the page's one honest "there is no such file"; every other answer is the
             server failing to read it. `!r.ok` without a 404 used to be drawn as the same
             `EB_UNREADABLE` card as a dead server, which is how a network error and a missing file
             came to say the same thing. */
          setProblem({
            reason: r.status === 404 ? "missing" : "unreadable",
            message: data.error ?? `the server answered ${r.status}`,
            ...(r.status === 404 ? {} : { code: CODES.EB_UNREADABLE }),
          });
          setBoard(null);
          return;
        }
        adopt(name, { text: data.text ?? "", base: data.base ?? "" });
      })
      .catch((e: Error) =>
        live ? setProblem({ reason: "unreachable", message: e.message, code: CODES.EB_UNREADABLE }) : undefined,
      );

    return () => {
      live = false;
    };
  }, [name, adopt, attempt]);

  useEffect(() => {
    if (!name) return;
    let live = true;
    const off = onBoard((change) => {
      if (!concerns(change, name)) return;
      if (change.sha1 === null) {
        setProblem({ reason: "missing", message: `\`${name}\` was deleted` });
        held.current = null;
        return;
      }
      /* The version this client already holds — its own write, echoed back by the feed — is not a
         change, and re-parsing it would churn every memo on the page. This is the whole reason the
         sha1 travels rather than only the name. */
      if (held.current && held.current.base === change.sha1) return;
      /* The text is not on the feed, so somebody else's write is one fetch away. That is a round
         trip a person never waits for — their own edits come back on the write's own response —
         and it is what keeps every tab from being sent every board's bytes on every change. */
      void fetch(`/__board/get?name=${encodeURIComponent(name)}`)
        .then(async (r) => {
          const data = (await r.json()) as { text?: string; base?: string };
          if (!live || !r.ok) return;
          setProblem(null);
          adopt(name, { text: data.text ?? "", base: data.base ?? "" });
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      off();
    };
  }, [name, adopt]);

  /*
   * One write, one retry, then yield.
   *
   * A 409 means the file moved — almost always because Claude rewrote the board while an edit was
   * in flight. The response carries what replaced it, so the retry is against real content rather
   * than a guess. A second 409 means writes are landing faster than this loop can follow, and the
   * right thing is to drop the edit: the file is the document, the person can see what it says.
   *
   * `retry` is false for a whole-text put: putting an old snapshot over a file that has moved is
   * precisely the thing a base check exists to refuse.
   *
   * **A server that cannot be reached is a refusal too.** `fetch` rejects rather than answering, and
   * every caller fires and forgets (`void commit(…)`, a nudge, a drag's release), so the rejection
   * was unhandled and the drag's painted position was never taken back. `post` resolves `null` for
   * it, the write resolves `null` like any that did not land, and the person is told through the
   * notice a refused drop already uses. Only the `fetch` is guarded: a bug in `adopt` is not an
   * unreachable server and must not be worded as one.
   */
  const write = useCallback(
    async (route: string, payload: object, retry: boolean): Promise<Write | null> => {
      if (!name) return null;
      const post = async (against: Version | null): Promise<Response | null> => {
        try {
          return await fetch(`/__board/${route}?name=${encodeURIComponent(name)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ base: against?.base, ...payload }),
          });
        } catch {
          document.dispatchEvent(new CustomEvent("dag:upload-problem", { detail: UNREACHABLE }));
          return null;
        }
      };

      let before = held.current;
      let r = await post(before);
      if (!r) return null;
      if (r.status === 409) {
        const stale = (await r.json()) as { base?: string; text?: string };
        if (stale.text !== undefined) adopt(name, { text: stale.text, base: stale.base ?? "" });
        if (!retry) return null;
        /* The retry is against what the server said, and that is what the edit is recorded
           against — an undo must put *that* back, not the version this client held before. */
        before = held.current;
        r = await post(before);
        if (!r) return null;
      }
      if (!r.ok || !before) return null;
      const done = (await r.json()) as { base?: string; text?: string };
      const after = { text: done.text ?? "", base: done.base ?? "" };
      /* The result, straight from the server, rather than three or four frames later by way of
         the watcher: an edit should look done the moment it is. */
      if (done.text !== undefined) adopt(name, after);
      return { before, after };
    },
    [name, adopt],
  );

  const patch = useCallback(
    (ops: PatchOp[]): Promise<Write | null> => (ops.length === 0 ? Promise.resolve(null) : write("patch", { ops }, true)),
    [write],
  );
  const put = useCallback((text: string): Promise<Write | null> => write("put", { text }, false), [write]);
  const current = useCallback(() => held.current, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    board,
    error: problem ? (problem.message ?? "the file could not be loaded") : null,
    problem,
    reload,
    patch,
    put,
    current,
    docId,
  };
}

/** What the list draws: every board, every note, and every folder — the empty ones included. */
export interface BoardTree {
  /**
   * Whether this is an answer at all — the server's, or the last one this browser kept —
   * rather than nothing yet. An empty tree that is not loaded is a list on its way, never an account
   * with nothing in it, and the sidebar says which.
   */
  loaded: boolean;
  /**
   * Whether the server has answered since the page loaded. A kept list is how the account looked the
   * last time this browser asked, and a name in it may have moved since: what resolves an id to a
   * name off the list asks for a fresh one.
   */
  fresh: boolean;
  boards: string[];
  folders: string[];
  /** A note is a second kind of file, listed and foldered with the boards. */
  notes: string[];
  /**
   * What each file is called, by name, when its frontmatter gives it a `title:`. The
   * title is what a person named it and what every row draws; the name is the technical half — a
   * path, a URL — and is only what is shown for a file nobody titled.
   */
  titles: Readonly<Record<string, string>>;
  /**
   * Which notes are tasks, by name, and what their status and due date are — a task is a
   * note whose frontmatter has a `status:`. What the sidebar's glyph and the Tasks page draw.
   */
  tasks: Readonly<Record<string, Task>>;
  /**
   * Which notes are projects, by name, and their status and colour — a project is a note
   * whose frontmatter has a `project:`, and the folder it is in is the project. `projectFolders`
   * turns this into which folder is whose.
   */
  projects: Readonly<Record<string, Project>>;
  /**
   * Which notes are events, by name, and when — an event is a note whose frontmatter has a
   * `start:` and no `status:`. What the sidebar's glyph and the calendar draw.
   */
  events: Readonly<Record<string, NoteEvent>>;
  /**
   * When each file was made, by name — an instant in UTC, the store's record beside the id and never a
   * line in the file. The day the calendar puts a note on.
   */
  created: Readonly<Record<string, string>>;
  /** Every listed file's permanent id, by name — what a row dropped on a board embeds. */
  ids: Readonly<Record<string, string>>;
  /** A quiz is the third kind of file, listed and foldered with the other two. */
  quizzes: string[];
  /** How many questions each quiz asks, by name — the gallery's and a row's count. */
  questions: Readonly<Record<string, number>>;
  /** A table is the fourth text kind, listed and foldered with the rest. */
  tables: string[];
  /**
   * Every attachment — the one kind that is not a text, whose name
   * carries its extension: `specs/q3-report.pdf`. Its title is in `titles` with every other kind's.
   */
  files: string[];
  /** Every attachment's size in bytes, by name. */
  sizes: Readonly<Record<string, number>>;
}

const NO_BOARDS: BoardTree = {
  loaded: false,
  fresh: false,
  boards: [],
  folders: [],
  notes: [],
  titles: {},
  tasks: {},
  projects: {},
  events: {},
  created: {},
  ids: {},
  quizzes: [],
  questions: {},
  tables: [],
  files: [],
  sizes: {},
};

/** The lists of names a tree holds, one per kind — what `namesOf` and `everyFile` read. */
export type KindLists = Pick<BoardTree, "boards" | "notes" | "quizzes" | "tables" | "files">;

/** The names of one kind of file in a tree. The one place a kind picks its list. */
function namesOf(tree: KindLists, kind: FileKind): string[] {
  switch (kind) {
    case "board":
      return tree.boards;
    case "note":
      return tree.notes;
    case "quiz":
      return tree.quizzes;
    case "table":
      return tree.tables;
    case "file":
      return tree.files;
    default:
      return assertNever(kind);
  }
}

/** Every file in a tree with its kind, boards first — what a list of "everything" walks. */
export const everyFile = (tree: KindLists): { name: string; kind: FileKind }[] =>
  FILE_KINDS.flatMap((kind) => namesOf(tree, kind).map((name) => ({ name, kind })));

const sameTask = (a: Task | undefined, b: Task | undefined): boolean =>
  a?.status === b?.status && a?.due === b?.due && a?.start === b?.start;
const sameEvent = (a: NoteEvent | undefined, b: NoteEvent | undefined): boolean => a?.start === b?.start && a?.end === b?.end;
const sameProject = (a: Project | undefined, b: Project | undefined): boolean => a?.status === b?.status && a?.hue === b?.hue;

/** A listing as the server sent it, or as this browser kept it, with every field it lacks made empty. */
function treeOf(d: Partial<BoardTree>, fresh: boolean): BoardTree {
  return {
    loaded: true,
    fresh,
    boards: d.boards ?? [],
    folders: d.folders ?? [],
    notes: d.notes ?? [],
    titles: d.titles ?? {},
    tasks: d.tasks ?? {},
    projects: d.projects ?? {},
    events: d.events ?? {},
    created: d.created ?? {},
    ids: d.ids ?? {},
    quizzes: d.quizzes ?? [],
    questions: d.questions ?? {},
    tables: d.tables ?? [],
    files: d.files ?? [],
    sizes: d.sizes ?? {},
  };
}

/**
 * The list this browser last fetched for `who` in this workspace, or nothing.
 *
 * A refresh used to start the sidebar from an empty tree and wait for `/__board/list` — the whole
 * account, which on a document store of nine hundred notes was seconds — so every page load drew
 * "nothing here" first. Now it draws what it had, and the fetch replaces it. Read through `readPref`,
 * so a snapshot reads none of it and a workspace reads its own.
 */
function keptTree(who: string | null): BoardTree | null {
  if (!who) return null;
  const raw = readPref(FILE_LIST);
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw) as { who?: unknown; tree?: unknown };
    if (kept.who !== who || !kept.tree || typeof kept.tree !== "object") return null;
    return treeOf(kept.tree as Partial<BoardTree>, false);
  } catch {
    return null;
  }
}

/** Keep a fetched list for the next page load, without the two flags that say how it was got. */
function keepTree(who: string, tree: BoardTree): void {
  const { loaded: _loaded, fresh: _fresh, ...rest } = tree;
  writeLocal(FILE_LIST, JSON.stringify({ who, tree: rest }));
}

/**
 * The listing, and how the last ask for it went. `failed` is a third state beside the tree's own
 * *loaded* and *empty*: the server could not be asked, so what is drawn is either a list from before
 * or nothing at all — never "Nothing here yet".
 */
export interface BoardList {
  tree: BoardTree;
  /** The last ask for the listing did not answer — a 500, or no server at all. */
  failed: boolean;
  /** Ask again now, without waiting for the retry timer: the failed state's *Try again*. */
  retry(): void;
}

/**
 * Every file and folder in this tab's workspace, kept in step with the change feed. `who` is the
 * signed-in account's uid: what a kept list must have been fetched for to be drawn.
 */
export function useBoardList(who: string | null = null): BoardList {
  const [tree, setTree] = useState<BoardTree>(() => keptTree(who) ?? NO_BOARDS);
  /* Whether the most recent ask did not answer. Cleared by the first answer that does, so a retry
     that succeeds takes the message away with the tree it brought back. */
  const [failed, setFailed] = useState(false);
  /* The live `load`, so *Try again* reaches the `refresher` this effect made rather than starting a
     second one. A ref because the effect runs once and the button outlives nothing. */
  const askNow = useRef<() => void>(() => undefined);
  const held = useRef(tree);
  held.current = tree;
  /* When the list held was asked for, on `guess.ts`'s clock, and a count that moves whenever a guess
     is made or let go: what is drawn is the list with every guess still standing on top. */
  const [stamp, setStamp] = useState(0);
  const [guesses, setGuesses] = useState(0);
  useEffect(() => {
    const redraw = () => setGuesses((n) => n + 1);
    addEventListener(GUESSED, redraw);
    return () => removeEventListener(GUESSED, redraw);
  }, []);
  /* What the server said, kept for the next page load — and kept again after a change to a row in
     place, which asks the server nothing, so the next load does not draw an old title. **At most one
     wait after the first change, never after the last**: a timer that restarts on every change never
     fires while somebody else is writing — an agent at work, the e2e suite's other workers — which is
     `useIndex`'s rule and was found here the same way. It keeps whatever the list is when it fires. */
  const keeping = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!who || !tree.fresh || keeping.current) return;
    keeping.current = setTimeout(() => {
      keeping.current = null;
      keepTree(who, held.current);
    }, 1000);
  }, [who, tree]);
  useEffect(
    () => () => {
      if (keeping.current) clearTimeout(keeping.current);
    },
    [],
  );
  useEffect(() => {
    let live = true;
    /* **One request out at a time, and one more behind it at most** — however many changes arrive
       meanwhile, the one queued answers them all, the way `useIndex` coalesces. A list asked once
       per change fills the browser's six connections under a burst, and a note's own fetch queued
       behind them reaches the server after a rename has moved the file and answers 404. **A list
       that did not arrive is asked for again on its own**, and an answer that is not a list is not
       drawn as one: an error's body read as a listing was an empty sidebar, and a failure waited for
       the next change, which after the Assistant's last write never came (#123). */
    const lister = refresher(async () => {
      const asked = tick();
      let d: BoardTree;
      try {
        const r = await fetch("/__board/list");
        if (!r.ok) {
          if (live) setFailed(true);
          return false;
        }
        d = (await r.json()) as BoardTree;
      } catch {
        /* A server that is not there rejects rather than answering; both are the same to a person
           waiting for rows, and both are retried by the refresher under this. Only the ask is
           guarded, so a bug in `treeOf` is not worded as a dead server. */
        if (live) setFailed(true);
        return false;
      }
      if (!live) return true;
      setTree(treeOf(d, true));
      setStamp(asked);
      shown(asked);
      setFailed(false);
      return true;
    });
    const load = (): void => void lister.ask();
    askNow.current = load;
    load();
    /* A file appearing or going away is a change to the list, and so is one whose title moved
 — a title is in the text, so an agent's edit or the sidebar's rename changes what a
       row says. The change says what the file is called now, so **a file the list already has is
       redrawn in place**: a note being typed in is a change every quarter-second, and asking for
       the whole list each time is what the coalescing above was the first half of fixing. A name the
       list does not have, a file that went, or a server too old to say, is a cue to ask again.
       `dag:boards` is the half that carries no file at all: a folder made or removed, or a link
       switched on or off. */
    const changed = (kind: FileKind) => (change: BoardChange) => {
      /* A resume names no file; the list is asked for again by `onBoards` beside it. */
      if (change.resume) return;
      const t = held.current;
      const listed = namesOf(t, kind).includes(change.name);
      if (change.sha1 === null || !listed || change.title === undefined) return load();
      /* A note's change says whether it is a task, and a server that does not say is one to ask. */
      if (kind === "note" && change.task === undefined) return load();
      /* And whether it is a project, for the same reason. */
      if (kind === "note" && change.project === undefined) return load();
      /* And whether it is an event, for the same reason. */
      if (kind === "note" && change.event === undefined) return load();
      /* And a quiz's how many questions it asks, for the same reason. */
      if (kind === "quiz" && typeof change.questions !== "number") return load();
      const title = change.title ?? undefined;
      const task = kind === "note" ? (change.task ?? undefined) : undefined;
      const project = kind === "note" ? (change.project ?? undefined) : undefined;
      const event = kind === "note" ? (change.event ?? undefined) : undefined;
      const asks = kind === "quiz" ? (change.questions as number) : undefined;
      if (
        t.titles[change.name] === title &&
        sameTask(t.tasks[change.name], task) &&
        sameProject(t.projects[change.name], project) &&
        sameEvent(t.events[change.name], event) &&
        t.questions[change.name] === asks
      )
        return;
      setTree((was) => {
        const titles = { ...was.titles };
        if (title === undefined) delete titles[change.name];
        else titles[change.name] = title;
        const tasks = { ...was.tasks };
        if (task === undefined) delete tasks[change.name];
        else tasks[change.name] = task;
        const projects = { ...was.projects };
        if (project === undefined) delete projects[change.name];
        else projects[change.name] = project;
        const events = { ...was.events };
        if (event === undefined) delete events[change.name];
        else events[change.name] = event;
        const questions = { ...was.questions };
        if (asks === undefined) delete questions[change.name];
        else questions[change.name] = asks;
        return { ...was, titles, tasks, projects, events, questions };
      });
      /* A list already on its way was asked before this change, and would put the old title back. */
      lister.stale();
    };
    const offBoard = onBoard(changed("board"));
    const offNote = onNote(changed("note"));
    const offQuiz = onQuiz(changed("quiz"));
    const offTable = onTable(changed("table"));
    /* An attachment's change is its bytes or its title; its size is only in a listing. */
    const offFile = onFile((change) => (change.sha1 === null ? load() : changed("file")(change)));
    const offTree = onBoards(() => void load());
    return () => {
      live = false;
      lister.cancel();
      offBoard();
      offNote();
      offQuiz();
      offTable();
      offFile();
      offTree();
    };
  }, []);
  /* `guesses` is not read: it is what makes a guess made or let go redraw the list. */
  const drawn = useMemo(() => guessed(tree, stamp), [tree, stamp, guesses]);
  const retry = useCallback(() => askNow.current(), []);
  return useMemo(() => ({ tree: drawn, failed, retry }), [drawn, failed, retry]);
}

/**
 * The components a person has saved, kept in step with `boards/components/`.
 *
 * Same shape as `useBoardList` and for the same reason: a new file is an `add` on the watcher,
 * which pushes a board event, and that is the cue to ask again. So saving a component on one board
 * makes it appear in the panel of every open board without a reload.
 */
export function useSavedComponents(): SavedComponent[] {
  const [saved, setSaved] = useState<SavedComponent[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/__board/components")
        .then((r) => r.json() as Promise<{ components: SavedComponent[] }>)
        .then((d) => live && setSaved(d.components ?? []))
        .catch(() => undefined);
    void load();
    /* Only a component changing changes the palette. This asked again on every board
       write — a drag's commit, a keystroke in the panel, another tab, an agent — and the route read
       every document in the account to answer, then re-rendered the board page with an array equal
       to the last. Both change feeds name a saved component by its path, `components/<name>`. */
    const off = onBoard((c) => {
      if (c.resume || c.name.startsWith("components/")) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return saved;
}

/**
 * The board file itself: made, renamed, copied, removed.
 *
 * Plain functions rather than a hook, because none of them holds state — the board list is already
 * kept in step by the change feed, so the only thing a caller needs back is the name the server settled
 * on. A create answers the name or **why not**, and the rest resolve `null` (or `false`) on refusal
 * rather than throwing: these are reached from a click, and there is nothing useful to do with an
 * exception in an event handler.
 *
 * The server owns uniqueness. Asking for `plan` twice gives `plan` and then `plan-2`, and it is the
 * *returned* name a caller must open — guessing it is how you end up looking at the wrong board.
 */
/**
 * What one board route answered: the body it returned, or the sentence saying why it refused.
 *
 * **The reason travels rather than a bare `null`.** A create the server refused was
 * indistinguishable from one that worked and said nothing, so the sidebar could not tell a person
 * why the row they expected never arrived.
 */
export type BoardCall<T> = { ok: true; data: T } | { ok: false; error: string };

/** What the server says when it refuses without wording it: its own answer wins when it has one. */
const refused = (status: number): string =>
  status >= 500 ? "The server could not do that. Try again." : "The server refused that. Try again.";

export async function boardCall<T extends object = Record<string, unknown>>(
  route: string,
  payload: object,
): Promise<BoardCall<T>> {
  try {
    const r = await fetch(`/__board/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await r.json().catch(() => ({}))) as T & { error?: string };
    /* A 4xx is a refusal in the server's own words; a 5xx is a failure, and its body is not a sentence for a person. */
    if (!r.ok)
      return {
        ok: false,
        error: r.status < 500 && typeof body.error === "string" && body.error ? body.error : refused(r.status),
      };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "The server did not answer. Try again." };
  }
}

/** The name a route settled on, for the operations that only say whether they landed. */
const nameFrom = async (route: string, payload: object): Promise<string | null> => {
  const done = await boardCall<{ name?: string }>(route, payload);
  return done.ok ? (done.data.name ?? null) : null;
};

/** What a create answers: the name it landed at, or the sentence saying why it did not. */
export type Made = { name: string } | { error: string };

const made = async (route: string, payload: object): Promise<Made> => {
  const done = await boardCall<{ name?: string }>(route, payload);
  if (!done.ok) return { error: done.error };
  if (!done.data.name) return { error: "The server did not say what it made. Try again." };
  return { name: done.data.name };
};

/**
 * What a board starts as.
 *
 * One note, not an empty file. An empty board never reports a measured size for anything, so
 * `data-dag-ready` would never fire on it — a trap for the snapshot script rather than for the
 * person — and a blank sheet with no visible way in is a worse greeting than a sentence.
 *
 * The chord is written out rather than read from `BINDINGS`: this layer may not import
 * `src/edit/`, and it may not use an `@/` alias at all, because the local server imports it
 * verbatim. So it is a string that has to be kept true by hand, and it was not — for a while it
 * said `L`, which is a bare letter that has not opened the library since, printed on the first
 * thing anybody sees on a board they just made. If the leader moves again,
 * this sentence is the fourth reader of that table and the only one nothing checks.
 */
const newBoardText = (title: string): string =>
  `---\ntitle: ${JSON.stringify(title)}\n---\n\n\`\`\`md {#intro}\n# ${title}\n\nDouble-click the paper for a note, or press \`space L\` for the component library.\n\`\`\`\n`;

/**
 * What a new file is called until somebody names it. A *title*: the file is made under
 * the name `untitled`, numbered if taken, and that name is the technical half nobody has to see.
 */
export { UNTITLED };

/** A title as a frontmatter scalar: *Untitled* plain, anything else quoted for YAML. */
const titleScalar = (title: string): string => (title === UNTITLED ? UNTITLED : JSON.stringify(title));

/**
 * What a board made from the sidebar starts as: **titled `Untitled`, and empty.**
 *
 * The title is the line `/retitle` answers the name question on, so the file starts with
 * it. It used to start with a note too — "double-click the paper for a note, or press `space L`" —
 * which the page then drew at 205%, the fit of one small card, and which the first thing anybody did
 * was delete. The page says it now, in a card that is not in the file (`EmptyBoard`); an
 * empty page is ready the moment it is parsed, so nothing waits on an item that is not there.
 *
 * A title is passed by the search, which makes what somebody typed: the server files the text
 * under that title, the way `/create` files every text that carries one.
 */
export const blankBoardText = (title: string = UNTITLED): string => `---\ntitle: ${titleScalar(title)}\n---\n`;

/** What a note made from the sidebar starts as: its title, and an empty page under it. */
export const blankNoteText = (title: string = UNTITLED): string => `---\ntitle: ${titleScalar(title)}\n---\n`;

/**
 * What a task made from the sidebar or the Tasks page starts as: a note, titled *Untitled*
 * like any other, with a status — which is the whole of what makes it a task. A column's own `+`
 * starts it in that column.
 */
export const blankTaskText = (status: TaskStatus = "todo", title: string = UNTITLED): string =>
  `---\ntitle: ${titleScalar(title)}\nstatus: ${status}\n---\n`;

/**
 * What an event made from the sidebar or the calendar starts as: a note titled as asked —
 * *Untitled* from the sidebar, which names it in its title field — with a `start:` and an `end:`, the
 * whole of what makes it an event. The times are written with their offset (`timeOf`); a date alone
 * is all day.
 */
export const blankEventText = (start: string, end?: string, title: string = UNTITLED): string =>
  `---\ntitle: ${titleScalar(title)}\nstart: ${start}\n${end ? `end: ${end}\n` : ""}---\n`;

export const createBoard = async (name: string, text?: string): Promise<Made> =>
  made("create", { name, text: text ?? newBoardText(name) });

/**
 * The kinds of file a name can be. Every call below takes one, and a board is what it means when
 * none is said — which is every caller written before notes existed.
 *
 * **Four kinds, and a site that picks between them switches on all four** — ending in
 * `assertNever`, so a fifth fails the typecheck wherever it is not handled — which is how the table
 * found every one of them. The quiz found about
 * forty places written as `kind === "note" ? … : board`, each of which would have opened a quiz as
 * a board and said nothing.
 */
export type FileKind = "board" | "note" | "quiz" | "table" | "file";

export const FILE_KINDS: readonly FileKind[] = ["board", "note", "quiz", "table", "file"];

/**
 * The kinds that are a text — everything but an attachment, which is bytes somebody
 * uploaded. What a route that reads or writes a document's text can be asked about.
 */
export type TextKind = Exclude<FileKind, "file">;

/** The exhaustive end of a `switch` over a union: a case left out is a type error here. */
export function assertNever(x: never): never {
  throw new Error(`unhandled kind \`${String(x)}\``);
}

/** What a note starts as: its own name as a heading, so the first thing on the page says what it is. */
const newNoteText = (name: string): string => `# ${name.slice(name.lastIndexOf("/") + 1)}\n`;

export const createNote = async (name: string, text?: string): Promise<Made> =>
  made("create", { name, text: text ?? newNoteText(name), kind: "note" });

/** What a quiz made from the sidebar or the Quizzes page starts as: a title and no questions yet. */
export const blankQuizText = (title: string = UNTITLED): string => `---\ntitle: ${titleScalar(title)}\n---\n`;

export const createQuiz = async (name: string, text?: string): Promise<Made> =>
  made("create", { name, text: text ?? blankQuizText(), kind: "quiz" });

/**
 * What a table made from the sidebar starts as: titled *Untitled*, one tab with two text
 * columns and three empty rows — somewhere to click and type. `src/table/write.ts` says so, where
 * every other writer of the format is.
 */
export const blankTableText = (title: string = UNTITLED): string => blankTable(titleScalar(title));

const createTable = async (name: string, text?: string): Promise<Made> =>
  made("create", { name, text: text ?? blankTableText(), kind: "table" });

/** Make a file of any kind with a text, as the sidebar's New does. An attachment is uploaded, never made. */
export function createFile(kind: TextKind, name: string, text?: string): Promise<Made> {
  switch (kind) {
    case "board":
      return createBoard(name, text);
    case "note":
      return createNote(name, text);
    case "quiz":
      return createQuiz(name, text);
    case "table":
      return createTable(name, text);
    default:
      return assertNever(kind);
  }
}

const renameBoard = (name: string, to: string, kind: FileKind = "board"): Promise<string | null> =>
  nameFrom("rename", { name, to, kind });

/**
 * Call a file something: its `title:` is set, and — with `follow`, which is what the
 * sidebar asks — its name follows as a stem in the background, so a URL and a path an agent reads
 * still say roughly what the person called it. Resolves to the name the file has afterwards, which
 * is the one to open.
 */
export const retitleFile = (name: string, title: string, kind: FileKind = "board", follow = true): Promise<string | null> =>
  nameFrom("retitle", { name, title, kind, follow });

/**
 * Change a note's status or due date, make it a task, or make it a plain note again: the
 * `status:` and `due:` lines of its frontmatter and nothing else, through `POST /__board/task`. A
 * key left out stays as it is and `null` takes it out. Resolves to the task the note is now — `null`
 * for a plain note — or `undefined` when the write was refused.
 */
export const setTask = async (name: string, change: TaskChange): Promise<Task | null | undefined> => {
  const done = await boardCall<{ task?: Task | null }>("task", { name, ...change });
  return done.ok ? (done.data.task ?? null) : undefined;
};

/**
 * Move an event, make a note one, or make it a plain note again: the `start:` and `end:`
 * lines and nothing else, through `POST /__board/event` — `setTask`'s shape. Resolves to the event the
 * note is now, `null` for a plain note, or `undefined` when the write was refused.
 */
export const setEvent = async (name: string, change: EventChange): Promise<NoteEvent | null | undefined> => {
  const done = await boardCall<{ event?: NoteEvent | null }>("event", { name, ...change });
  return done.ok ? (done.data.event ?? null) : undefined;
};

/**
 * Change a project's status or colour, or make its note a plain note again: the
 * `project:` and `hue:` lines and nothing else, through `POST /__board/project` — `setTask`'s shape.
 * The route names the status `status`, the page's `Project` does too, and the file says `project:`.
 */
export const setProject = async (name: string, change: ProjectChange): Promise<Project | null | undefined> => {
  const body: Record<string, unknown> = { name };
  if ("project" in change) body.status = change.project ?? null;
  if ("hue" in change) body.hue = change.hue ?? null;
  const done = await boardCall<{ project?: Project | null }>("project", body);
  return done.ok ? (done.data.project ?? null) : undefined;
};

export const duplicateBoard = (name: string, to?: string, kind: FileKind = "board"): Promise<string | null> =>
  nameFrom("duplicate", { name, to, kind });

/**
 * One thing in the trash, as every trash route says it: a file somebody deleted, or a
 * folder with what it `holds`. `expires` is when it goes for good — the trash's days after
 * `deleted`.
 */
export interface TrashEntry {
  id: string;
  name: string;
  kind: FileKind | "folder";
  title: string | null;
  deleted: string;
  expires: string;
  /** The document's own id, for a file — what a reference to it names. */
  doc: string | null;
  /** For a folder, every file and folder that went with it, the folder itself included. */
  holds: { boards: string[]; notes: string[]; quizzes: string[]; tables: string[]; files: string[]; folders: string[] } | null;
}

/**
 * Move a file to the trash — what Delete does. Resolves to the entry it made, which is what
 * an Undo restores, or `null` when it was refused.
 */
export const deleteBoard = async (name: string, kind: FileKind = "board"): Promise<TrashEntry | null> => {
  const done = await boardCall<{ trash?: TrashEntry }>("delete", { name, kind });
  return done.ok ? (done.data.trash ?? null) : null;
};

/**
 * Folders.
 *
 * A folder is a directory, and a board's name carries the one it is in — so **moving** a board
 * between folders is a rename and nothing more. The two calls that are not a rename are the two a
 * name cannot express: a folder that exists with nothing in it yet, and getting rid of one.
 *
 * `dag:boards` is dispatched on the window after each: chokidar reports a new directory as `addDir`
 * on every filesystem this has been tried on, but a directory created and populated in one burst
 * is exactly the case that can be missed, and a folder that does not appear until the next reload
 * reads as a button that did nothing.
 */
const toldTheList = <T>(v: T): T => (dispatchEvent(new CustomEvent("dag:boards")), v);

/**
 * Make a folder. Resolves the path it landed at, or **what the server said when it refused** — a
 * name it will not take, a directory the vault cannot write — which the sidebar says under the
 * tree. The list is told only when something was made: a refusal changes nothing to redraw.
 */
export const createFolder = async (name: string): Promise<{ folder: string } | { error: string }> => {
  const done = await boardCall<{ folder?: string }>("mkdir", { name });
  if (!done.ok) return { error: done.error };
  if (!done.data.folder) return { error: "The server did not say what it made. Try again." };
  return toldTheList({ folder: done.data.folder });
};

/** What removing a folder took with it, as the server saw it at that moment. */
export interface RemovedFolder {
  folder: string;
  boards: string[];
  notes: string[];
  /** Absent from a server that predates quizzes. */
  quizzes?: string[];
  /** Absent from a server that predates tables. */
  tables?: string[];
  /** And attachments, absent from a server that predates them. */
  files?: string[];
  /** The folder itself and every folder under it. */
  folders: string[];
  /** The trash entry it all went into: one, for the folder and everything in it. */
  trash?: TrashEntry;
}

/**
 * Move a folder to the trash: an empty one, or with `recursive` the folder and everything in it, as
 * one entry. `null` when it was refused. The answer lists what went, which is what the
 * caller lets go of: its own tree is one round trip stale, and a second writer may have put something
 * in the folder since.
 */
export const deleteFolder = async (name: string, recursive = false): Promise<RemovedFolder | null> => {
  const done = await boardCall<RemovedFolder>("rmdir", recursive ? { name, recursive: true } : { name });
  return done.ok ? toldTheList(done.data) : null;
};

/**
 * Rename or move a folder with everything in it: `to` is the whole new path. The one
 * operation `/mvdir` is, rather than a rename per file that could stop halfway. Resolves the path it
 * landed at, or what the server said when it refused — a folder too big for one move says how big
 *, and saying nothing is how a refused move looked like a drag that did not take.
 */
export const moveFolder = async (name: string, to: string): Promise<{ folder: string } | { error: string }> => {
  try {
    const r = await fetch("/__board/mvdir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, to }),
    });
    const body = (await r.json().catch(() => ({}))) as { folder?: string; error?: string };
    if (r.ok && body.folder) return toldTheList({ folder: body.folder });
    return { error: r.status < 500 && body.error ? body.error : "The folder could not be moved. Try again." };
  } catch {
    return { error: "The folder could not be moved. Check the connection and try again." };
  }
};

/** Move a board into a folder, or out to the top level with `""` — a rename of its full name. */
export const moveBoard = async (name: string, folder: string, kind: FileKind = "board"): Promise<string | null> => {
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  return renameBoard(name, folder ? `${folder}/${leaf}` : leaf, kind);
};
