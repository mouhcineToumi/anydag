import { CalendarPlus, FilePlus2, Pencil, Play, SquareCheckBig, CircleSlash, CalendarX2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { contentBounds, placeItems } from "@/board/flow";
import { isDiagramType, isLinkType } from "@/board/types";
import { fileCard, noteCard, toBlueprint, type Component } from "@/board/library";
import type { Draft, DraftDiagnostic } from "@/edit/generate";
import {
  blankBoardText,
  blankNoteText,
  createBoard,
  createNote,
  createQuiz,
  retitleFile,
  useBoard,
  everyFile,
  useBoardList,
  useSavedComponents,
  type BoardTree,
  type FileKind,
} from "@/board/useBoard";
import { Viewport, type Tool, type ViewportHandle } from "@/canvas/Viewport";
import { CODES } from "@/dsl/codes";
import { BoardEdges } from "@/render/BoardEdges";
import { growable } from "@/edit/build";
import { Inspector } from "@/edit/Inspector";
import { Library } from "@/edit/Library";
import { NodeHandles } from "@/edit/NodeHandles";
import { Rename } from "@/edit/Rename";
import { RewriteDialog } from "@/edit/RewriteDialog";
import { proposedItem } from "@/edit/rewrite";
import { SelectionBar, type RewriteRun } from "@/edit/SelectionBar";
import { Shortcuts } from "@/edit/Shortcuts";
import { WhichKey } from "@/edit/WhichKey";
import { Settings, useSettingsOpen } from "@/settings/Settings";
import { useSettings } from "@/settings/useSettings";
import { typing, useEditor } from "@/edit/useEditor";
import { ErrorItem } from "@/render/ErrorItem";
import { Item } from "@/render/Item";
import { THEME_NAMES, paperTheme, useTheme } from "@/theme/useTheme";
import { BoardBrowser } from "@/ui/BoardBrowser";
import { ExportButton, NOTE_EXPORTS, QUIZ_EXPORTS, boardExports, exportRows } from "@/ui/Export";
import { Shell, useSidebar } from "@/ui/Shell";
import type { SettingsTab } from "@/settings/tabs";
import type { ChromeAsk } from "@/ui/chrome";
import type { PlaceFile } from "@/ui/Sidebar";
import { NoteView, type NoteHandle } from "@/ui/NoteView";
import type { ProjectMembers } from "@/ui/ProjectBar";
import { nameWhenOpened } from "@/ui/NoteTitle";
import { LayoutToggle, NO_PROJECT, TasksView, type ProjectFilter, type TasksLayout } from "@/ui/Tasks";
import { EmptyBoard, Welcome } from "@/ui/Welcome";
import { CALENDAR_VIEW, LIBRARY, TASKS_VIEW, readFlag, readPref, writeFlag, writeLocal } from "@/settings/prefs";
import { MAX_DAYS, VIEWS, type CalView } from "@/calendar/model";
import { useCalendarHidden, useWeekStart } from "@/calendar/usePrefs";
import { CalendarView } from "@/ui/Calendar";
import { dayOf, eventOf, nextHourEvent, type NoteEvent } from "@/note/event";
import { Dock } from "@/ui/Dock";
import { PageBar } from "@/ui/PageBar";
import { ZoomBar } from "@/ui/ZoomBar";
import { listProblems, type Problem } from "@/ui/problemList";
import { Problems } from "@/ui/Problems";
import { Toolbar } from "@/ui/Toolbar";
import type { MoreItem } from "@/ui/PageMore";
import { useGroups, useMeasures, usePublishReady, useSolo } from "@/view/drawing";
import { usePublishDrawn } from "@/view/drawn";
import { Backlinks } from "@/refs/Backlinks";
import { fileStem, saveFile } from "@/export/save";
import { printAs } from "@/export/print";
import { splitNote } from "@/note/format";
import { folderOf, projectFolders, projectOf, within, type Project } from "@/note/project";
import { STATUSES, taskOf, titleStem, type Task, type TaskStatus } from "@/note/task";
import { folderLabel, folderOfRun, folderQuizzes } from "@/quiz/folder";
import { askable, parseQuiz, type Question } from "@/quiz/parse";
import { stampIds } from "@/quiz/write";
import { sealId } from "@/board/envelope";
import { QuizEditor } from "@/ui/quiz/Editor";
import { QuizzesView, type QuizzesRun } from "@/ui/quiz/Gallery";
import { TrashView } from "@/ui/Trash";
import { AssistantView } from "@/assistant/Page";
import { toggleAssistant } from "@/assistant/panelState";
import { answer, flush as flushAnswers, readPractice, usePractice } from "@/ui/quiz/practice";
import { Runner, Sheet, type RunQuestion } from "@/ui/quiz/Runner";
import { useQuizFile } from "@/ui/quiz/useQuizFile";
import { TablePage } from "@/ui/table/TablePage";
import { NotePrint } from "@/view/NotePrint";
import { leaf } from "@/ui/tree";
import { useIndex } from "@/refs/useIndex";
import { clearTarget, setTarget, useTarget } from "@/refs/target";
import { FOLLOW } from "@/refs/follow";
import { useAccount } from "@/auth/useAuth";
import { FileView } from "@/files/FileView";
import { fileUrl } from "@/files/upload";
import { useFiles } from "@/files/useFiles";
import { isPicture } from "@/files/types";
import { UploadNotice } from "@/files/UploadNotice";
import { saveWithFiles } from "@/files/exportBundle";
import { placedWidth } from "@/edit/image";
import { readSettings } from "@/settings/store";
import { refuseLocked, useLocked } from "@/settings/lock";
import { track } from "@/telemetry/client";

/* The library's open state lives in `settings/prefs.ts`, which is the one place that knows what
   the whole set of preferences is — because since accounts, the whole set is what follows a person
   to another browser. The board list's used to be beside it and is not a preference any more: it
   is a dialog now, and nothing remembers whether a dialog was open. */

/**
 * `?board=` picks the file, `?page=` the page, `?theme=` the look, `?snapshot=1` strips the chrome —
 * and `?note=` picks a note instead of a board, which is a different page altogether.
 */
function useQuery() {
  const [q, setQ] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const onPop = () => setQ(new URLSearchParams(location.search));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  /* One key, or several in one go. Several matters: opening a board sets `board` and clears
     `page` together, and two `replaceState` calls would leave the URL holding the new board
     beside the old board's page for a render — which is exactly the state this is here to avoid. */
  const set = useCallback((key: string | Record<string, string | null>, value?: string | null) => {
    const next = new URLSearchParams(location.search);
    const pairs = typeof key === "string" ? { [key]: value ?? null } : key;
    for (const [k, v] of Object.entries(pairs)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    /* The hash survives: it is the block or the item a reference named (`dag:<id>#^para`). */
    history.replaceState(null, "", `${location.pathname}?${next}${location.hash}`);
    setQ(next);
  }, []);
  /* A new place to be, as a new entry in the history: what following a reference is, so the
     browser's Back returns to the document that named it, as it did when following one loaded a page.
     Everything else the page does replaces the entry it is on. */
  const go = useCallback((next: URLSearchParams) => {
    history.pushState(null, "", `${location.pathname}?${next}`);
    setQ(new URLSearchParams(next));
  }, []);
  return [q, set, go] as const;
}

/** Which file an id is, off the list — only a list the server has answered since the page loaded. */
function whose(list: BoardTree, id: string): { kind: FileKind; name: string } | null {
  if (!list.fresh) return null;
  for (const { kind, name } of everyFile(list)) if (list.ids[name] === id) return { kind, name };
  return null;
}

/**
 * Follow a reference here rather than by loading the page again: a plain click on a link
 * to `?ref=<id>` in this workspace, or `follow()` asked by a link that navigates by hand. The target
 * is opened straight off the list when the list knows the id, and through `?ref=` — resolved by the
 * effect in `App` — when it does not; either way as a new history entry. A click with a modifier,
 * a link to another workspace or to the read-only view, is left to the browser.
 */
function useFollowing(list: BoardTree, go: (next: URLSearchParams) => void) {
  const held = useRef(list);
  held.current = list;
  useEffect(() => {
    const take = (href: string): boolean => {
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        return false;
      }
      const id = url.searchParams.get("ref");
      if (!id || url.origin !== location.origin || url.pathname !== location.pathname) return false;
      if (url.searchParams.get("view") === "1") return false;
      const here = new URLSearchParams(location.search);
      if ((url.searchParams.get("ws") ?? "") !== (here.get("ws") ?? "")) return false;
      const next = new URLSearchParams(here);
      const hit = whose(held.current, id);
      for (const [k, v] of Object.entries(pageQuery(hit?.kind ?? "board", hit?.name ?? null))) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      if (hit) next.delete("ref");
      else next.set("ref", id);
      go(next);
      /* The part it names — a block, an item — is the hash, which whoever opens the document reads. */
      const part = url.hash.slice(1);
      setTarget(part ? decodeURIComponent(part) : null);
      return true;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (take(a.href)) e.preventDefault();
    };
    const onFollow = (e: Event) => {
      if (take((e as CustomEvent<string>).detail)) e.preventDefault();
    };
    document.addEventListener("click", onClick);
    document.addEventListener(FOLLOW, onFollow);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener(FOLLOW, onFollow);
    };
  }, [go]);
}

/** The eight on a group's dashed box — the same compass `Item` hands its own. */
const GROUP_HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
/** The four sides a link can be pulled from, in the order `Item` draws them. */
const CONNECT_SIDES = ["n", "s", "e", "w"] as const;

type SetQuery = ReturnType<typeof useQuery>[1];

/**
 * The query that opens one file of any kind: its own key set, and every other page's cleared.
 *
 * One function where there were five copies of `kind === "note" ? {note} : {board}` — and a third
 * kind sent through any of them would have opened a quiz as a board. The keys it clears
 * are every page this app has: a board, a note, a quiz, and the two pages that list them.
 */
export function pageQuery(kind: FileKind, target: string | null): Record<string, string | null> {
  return {
    board: null,
    note: null,
    quiz: null,
    table: null,
    tab: null,
    file: null,
    tasks: null,
    project: null,
    quizzes: null,
    run: null,
    page: null,
    calendar: null,
    date: null,
    days: null,
    trash: null,
    chat: null,
    [kind]: target,
  };
}

/**
 * A board or a note, and never both on one screen.
 *
 * **A note is a second page, not a mode of this one**. The board page is a
 * canvas: a viewport, an editor that owns every key on the window, a page strip, a dock. A note has
 * none of those, and nothing crosses between the two — so the note page is
 * its own component tree and the canvas does not learn a note exists. In particular `useEditor`'s
 * window key handler and paste listener are simply not mounted under a note, which is what keeps
 * `Delete`, `space` and ctrl+V inside the text a person is typing.
 *
 * `?note=` and `?board=` are exclusive: opening either clears the other.
 */
export function App() {
  const [query, setQuery, go] = useQuery();
  /* `?tasks=1` is the third page, and `?quizzes=1` and `?quiz=` the fourth and fifth
: each exclusive with the others, as the first two are with each other. */
  const tasks = query.get("tasks") === "1";
  /* `?calendar=` is the Calendar page — `month`, `week`, `days`, or `1` for the view this
     browser used last — exclusive with the rest as they are with each other. */
  const calendar = !tasks && !!query.get("calendar");
  const quizzes = !tasks && !calendar && query.get("quizzes") === "1";
  /* `?trash=1` is the Trash page, exclusive with the rest. */
  const trash = !tasks && !calendar && !quizzes && query.get("trash") === "1";
  /* `?chat=` is the Assistant page: a chat's id, `new`, or `1` for the newest —
     a page with no canvas, exclusive with the rest as they are with each other. */
  const assistant = !tasks && !calendar && !quizzes && !trash && !!query.get("chat");
  const listing = tasks || calendar || quizzes || trash || assistant;
  const quiz = listing ? null : query.get("quiz");
  /* `?table=` is a table's page, `&tab=` the tab it shows. */
  const table = listing || quiz ? null : query.get("table");
  /* `?file=` is an attachment's own page, exclusive with the rest. */
  const file = listing || quiz || table ? null : query.get("file");
  const note = listing || quiz || table || file ? null : query.get("note");
  const board = listing || quiz || table || file || note ? null : query.get("board");
  /* One subscription to the list for the whole window, not one per page — the sidebar lives above
     both pages and reads the same answer the search and the feedback card do. */
  const list = useBoardList(useAccount()?.uid ?? null);
  useFollowing(list, go);
  const open = useCallback((kind: FileKind, target: string | null) => setQuery(pageQuery(kind, target)), [setQuery]);
  const openTasks = useCallback(() => setQuery({ ...pageQuery("board", null), tasks: "1" }), [setQuery]);
  const openCalendar = useCallback(() => setQuery({ ...pageQuery("board", null), calendar: "1" }), [setQuery]);
  const openTrash = useCallback(() => setQuery({ ...pageQuery("board", null), trash: "1" }), [setQuery]);
  /* The Assistant page, on a chat; `1` is the newest one the vault has. */
  const openAssistantPage = useCallback(
    (chat?: string | null) => setQuery({ ...pageQuery("board", null), chat: chat ?? "1" }),
    [setQuery],
  );
  /* The Quizzes page, or — with `run: "mistakes"` — the Mistakes run it starts, or with `folder:<path>`
     every quiz in a folder as one run. */
  const openQuizzes = useCallback(
    (run?: QuizzesRun) => setQuery({ ...pageQuery("board", null), quizzes: "1", run: run ?? null }),
    [setQuery],
  );
  const ref = query.get("ref");

  /* `?ref=<id>` is how a reference is followed: an id, never a name, so a link survives
     the target being renamed or moved. It is resolved once and replaced by the name it stands for
     now, which is what every other part of the page already reads. */
  useEffect(() => {
    if (!ref) return;
    let live = true;
    /* The list already knows most ids — but a list kept from an earlier visit may name a file that has
       moved since, so only one the server has answered on this page load is asked. */
    const known = whose(list, ref);
    if (known) {
      setQuery({ ref: null, ...pageQuery(known.kind, known.name) });
      return;
    }
    void fetch(`/__board/resolve?id=${encodeURIComponent(ref)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { name: string; kind: FileKind }) : null))
      .catch(() => null)
      .then((got) => {
        if (!live) return;
        setQuery(got ? { ref: null, ...pageQuery(got.kind, got.name) } : { ref: null });
      });
    return () => {
      live = false;
    };
    /* Once per `ref`, off the list as it was then: a list arriving later does not ask again. */
  }, [ref, setQuery]);

  /* While a reference is being resolved the page draws nothing — but the sidebar stays, where the
     whole window used to go blank for the round trip. */
  const page = ref ? null : tasks ? (
    <TasksApp query={query} setQuery={setQuery} list={list} open={open} />
  ) : calendar ? (
    <CalendarApp query={query} setQuery={setQuery} list={list} open={open} />
  ) : quizzes ? (
    <QuizzesApp query={query} setQuery={setQuery} list={list} open={open} openQuizzes={openQuizzes} />
  ) : trash ? (
    <TrashApp query={query} setQuery={setQuery} list={list} open={open} />
  ) : assistant ? (
    <AssistantApp query={query} setQuery={setQuery} list={list} open={open} />
  ) : quiz ? (
    <QuizApp name={quiz} query={query} setQuery={setQuery} list={list} open={open} openQuizzes={openQuizzes} />
  ) : table ? (
    <TableApp name={table} query={query} setQuery={setQuery} list={list} open={open} />
  ) : file ? (
    <FileApp name={file} query={query} setQuery={setQuery} list={list} open={open} />
  ) : note ? (
    <NoteApp name={note} query={query} setQuery={setQuery} list={list} />
  ) : (
    <BoardApp query={query} setQuery={setQuery} list={list} />
  );
  /* A snapshot is a picture of a board, and a picture of a board is a fact about the file: no
     sidebar, and not even the shell around the page, so the 45 baselines see exactly the `.dag-app`
     they always have. */
  if (query.get("snapshot") === "1") return page;
  return (
    <Shell
      boards={list.boards}
      notes={list.notes}
      folders={list.folders}
      titles={list.titles}
      ids={list.ids}
      tasks={list.tasks}
      projects={list.projects}
      events={list.events}
      quizzes={list.quizzes}
      questions={list.questions}
      tables={list.tables}
      attachments={list.files}
      sizes={list.sizes}
      loading={!list.loaded}
      board={board}
      note={note}
      quiz={quiz}
      table={table}
      file={file}
      tasksOpen={tasks}
      openTasks={openTasks}
      calendarOpen={calendar}
      openCalendar={openCalendar}
      quizzesOpen={quizzes}
      openQuizzes={openQuizzes}
      trashOpen={trash}
      openTrash={openTrash}
      assistantOpen={assistant}
      openAssistant={openAssistantPage}
      open={open}
    >
      {page}
    </Shell>
  );
}

/**
 * The sidebar asking this page for a card it draws — the search, Settings or Send feedback.
 *
 * The cards stay rendered by the page because the page is what knows the theme and the board; the
 * sidebar is above both pages and knows neither. So it asks with a document event, the way
 * `dag:tidy` reaches the page from a script. `dag:chrome` and not `dag:settings`, which is the
 * settings-changed event: one name meaning two things is the hazard `docs/architecture/things-that-will-bite.md` records.
 */
function useChromeRequests(on: { search(): void; settings(tab?: SettingsTab): void }) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const listen = (e: Event) => {
      const ask = (e as CustomEvent<ChromeAsk>).detail;
      if (ask?.what === "settings") ref.current.settings(ask.tab);
      else if (ask?.what === "search") ref.current.search();
    };
    document.addEventListener("dag:chrome", listen);
    return () => document.removeEventListener("dag:chrome", listen);
  }, []);
}

/**
 * The keys a page with no canvas answers — a note, the Tasks page: `ctrl+,` for Settings, and
 * `space O` for the search while the caret is not in a text, where a space is a space. `useEditor`
 * owns every key on a board and is not mounted on these pages, so this is the whole of what they
 * hear. It was the note page's own until the Tasks page needed the same two.
 */
function usePageKeys(snapshot: boolean, on: { settings(): void; search(): void }) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    if (snapshot) return;
    let leader = false;
    const onKey = (e: KeyboardEvent) => {
      /* `ctrl+,` before the typing test: a modifier chord is not a character, and Settings is what
         every editor binds it to — here, while the caret is in the note, as on a board. */
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ",") {
        e.preventDefault();
        ref.current.settings();
        return;
      }
      if (typing(e.target)) {
        leader = false;
        return;
      }
      if (e.key === " " && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        leader = !leader;
        return;
      }
      if (leader && e.key.toLowerCase() === "o") {
        e.preventDefault();
        ref.current.search();
      } else if (leader && e.key.toLowerCase() === "a") {
        e.preventDefault();
        toggleAssistant();
      }
      leader = false;
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [snapshot]);
}

function readLayout(): TasksLayout {
  return readPref(TASKS_VIEW) === "board" ? "board" : "list";
}

/**
 * What every page without a canvas carries: the cards the sidebar asks a page for — the search,
 * Settings and Send feedback — and the two keys such a page answers. The Tasks page's first, then
 * the two quiz pages'; one copy, where a third page would otherwise have made three.
 */
function usePageChrome({
  query,
  setQuery,
  list,
  open,
  quiz = null,
  table = null,
  file = null,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
  /** The quiz or the table that is open, which the search marks as where you are. */
  quiz?: string | null;
  table?: string | null;
  /** And the attachment. */
  file?: string | null;
}): { themeName: string; openBrowser(): void; cards: ReactNode } {
  const snapshot = query.get("snapshot") === "1";
  const { name: themeName, setName: setTheme } = useTheme(query.get("theme") ?? undefined, undefined, snapshot);
  const [browsing, setBrowsing] = useState(false);
  const settings = useSettingsOpen();
  useChromeRequests({ search: () => setBrowsing(true), settings: settings.show });
  usePageKeys(snapshot, { settings: settings.toggle, search: () => setBrowsing(true) });
  const chooseTheme = useCallback(
    (n: string) => {
      setTheme(n);
      if (query.get("theme")) setQuery("theme", null);
    },
    [setTheme, query, setQuery],
  );
  const cards = snapshot ? null : (
    <>
      {browsing ? (
        <BoardBrowser
          boards={list.boards}
          notes={list.notes}
          quizzes={list.quizzes}
          tables={list.tables}
          files={list.files}
          folders={list.folders}
          titles={list.titles}
          board={null}
          note={null}
          quiz={quiz}
          table={table}
          file={file}
          onOpen={open}
          onOpenAt={(kind, target, part) => {
            setTarget(part ?? null);
            open(kind, target);
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
      {settings.open ? (
        <Settings
          themes={THEME_NAMES}
          themeName={themeName}
          onTheme={chooseTheme}
          boardName={null}
          list={list}
          tab={settings.open.tab}
          onClose={settings.close}
        />
      ) : null}
    </>
  );
  return { themeName, openBrowser: () => setBrowsing(true), cards };
}

/**
 * The Tasks page: every note that is a task, as a list or a board — `?tasks=1`.
 *
 * A third page beside the note and the board, for the note page's reason: nothing on it is a
 * canvas, so `useEditor` is not mounted and owns no key here. It carries the cards the sidebar asks
 * a page for — the search, Settings, Send feedback — as the note page does, and opening a task from
 * it is opening that note.
 */
function TasksApp({
  query,
  setQuery,
  list,
  open,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const locked = useLocked() && !snapshot;
  const [layout, setLayout] = useState<TasksLayout>(readLayout);
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open });

  const chooseLayout = useCallback((next: TasksLayout) => {
    setLayout(next);
    writeLocal(TASKS_VIEW, next);
  }, []);

  /* `project=` is the id of the project's note, so a link to a project's tasks survives
     the project being renamed or moved; the page turns it into the name it is listed under now. */
  const wanted = query.get("project");
  const scope = useMemo<ProjectFilter>(() => {
    if (!wanted) return { kind: "all" };
    if (wanted === NO_PROJECT) return { kind: "none" };
    const name = Object.keys(list.ids).find((n) => list.ids[n] === wanted);
    return name ? { kind: "project", name } : { kind: "all" };
  }, [wanted, list.ids]);
  const chooseScope = useCallback(
    (next: ProjectFilter) =>
      setQuery("project", next.kind === "all" ? null : next.kind === "none" ? NO_PROJECT : (list.ids[next.name] ?? null)),
    [setQuery, list.ids],
  );

  return (
    <div className="dag-app dag-app--tasks" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar boardName={null} title="Tasks" onBoards={openBrowser}>
          <LayoutToggle layout={layout} onLayout={chooseLayout} />
        </Toolbar>
      )}
      <TasksView
        list={list}
        layout={layout}
        onOpen={(name) => open("note", name)}
        scope={scope}
        onScope={chooseScope}
        locked={locked}
      />
      {cards}
    </div>
  );
}

/**
 * The Trash page: everything deleted, until it is deleted for good — `?trash=1`. A page
 * without a canvas, for the Tasks page's reason; restoring a file puts it back in the sidebar, and
 * "Open it" opens it.
 */
function TrashApp({
  query,
  setQuery,
  list,
  open,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open });
  return (
    <div className="dag-app dag-app--trash" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && <Toolbar boardName={null} title="Trash" onBoards={openBrowser} />}
      <TrashView onOpen={open} />
      {cards}
    </div>
  );
}

/**
 * The Assistant page: the chat with the person's own AI, its history and the
 * changes it made — `?chat=<id>`. A page without a canvas, for the Tasks page's reason: `useEditor`
 * is not mounted and owns no key here, so the composer's Enter and Escape are the composer's.
 */
function AssistantApp({
  query,
  setQuery,
  list,
  open,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open });
  return (
    <div className="dag-app dag-app--assistant" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && <Toolbar boardName={null} title="Assistant" onBoards={openBrowser} />}
      {/* A snapshot is a picture of a board; there is no chat in it. */}
      {!snapshot && <AssistantView raw={query.get("chat")} onChat={(id) => setQuery("chat", id ?? "new")} onOpen={open} />}
      {cards}
    </div>
  );
}

/** Which view a bare `?calendar=1` opens, and how many days a run is — this browser's last (`CALENDAR_VIEW`). */
function readCalendarView(): { view: CalView; days: number } {
  try {
    const raw = JSON.parse(readPref(CALENDAR_VIEW) ?? "{}") as { view?: unknown; days?: unknown };
    const view = (VIEWS as readonly unknown[]).includes(raw.view) ? (raw.view as CalView) : "month";
    const days = typeof raw.days === "number" && raw.days >= 1 && raw.days <= MAX_DAYS ? Math.round(raw.days) : 3;
    return { view, days };
  } catch {
    return { view: "month", days: 3 };
  }
}

/**
 * The Calendar page: tasks, events and notes on one timeline — `?calendar=`, whose value is
 * the view (`month`, `week`, `days`; `1` is this browser's last), with the day and the count beside
 * it (`date=`, `days=`) so a reload and a link land where they were, and `project=` the Tasks page's
 * filter, by the project note's id. **Not `view=`**, which is the read-only page's key: one name
 * meaning two things is the hazard `docs/architecture/things-that-will-bite.md` records.
 *
 * A page without a canvas, for the Tasks page's reason. **What it shows and where a week starts are
 * the account's** (`CALENDAR_HIDE`, `WEEK_START`), read through `usePref` so the
 * Settings card moving one redraws the page under it.
 */
function CalendarApp({
  query,
  setQuery,
  list,
  open,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const locked = useLocked() && !snapshot;
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open });
  const [last] = useState(readCalendarView);
  const rawView = query.get("calendar");
  const view: CalView = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as CalView) : last.view;
  const rawDays = Number(query.get("days"));
  const count = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(MAX_DAYS, Math.round(rawDays)) : last.days;
  const rawDate = query.get("date");
  const day = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : dayOf(new Date());

  const [weekStart] = useWeekStart();
  const [hidden, onHidden] = useCalendarHidden();

  const onGo = useCallback(
    (next: { view?: CalView; day?: string | null; count?: number }) => {
      const v = next.view ?? view;
      const n = next.count ?? count;
      writeLocal(CALENDAR_VIEW, JSON.stringify({ view: v, days: n }));
      setQuery({
        calendar: v,
        days: v === "days" ? String(n) : null,
        ...(next.day !== undefined ? { date: next.day } : {}),
      });
    },
    [view, count, setQuery],
  );

  /* `project=` is the project note's id, as on the Tasks page. */
  const wanted = query.get("project");
  const scope = useMemo<ProjectFilter>(() => {
    if (!wanted) return { kind: "all" };
    if (wanted === NO_PROJECT) return { kind: "none" };
    const name = Object.keys(list.ids).find((n) => list.ids[n] === wanted);
    return name ? { kind: "project", name } : { kind: "all" };
  }, [wanted, list.ids]);
  const chooseScope = useCallback(
    (next: ProjectFilter) =>
      setQuery("project", next.kind === "all" ? null : next.kind === "none" ? NO_PROJECT : (list.ids[next.name] ?? null)),
    [setQuery, list.ids],
  );

  return (
    <div className="dag-app dag-app--calendar" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && <Toolbar boardName={null} title="Calendar" onBoards={openBrowser} />}
      <CalendarView
        list={list}
        view={view}
        day={day}
        count={count}
        weekStart={weekStart}
        hidden={hidden}
        onHidden={onHidden}
        scope={scope}
        onScope={chooseScope}
        onGo={onGo}
        onOpen={(name) => open("note", name)}
        locked={locked}
      />
      {cards}
    </div>
  );
}

/** A quiz's text when it is typed into the Quizzes page: its title and nothing else yet. */
const quizText = (title: string): string => `---\ntitle: ${JSON.stringify(title)}\n---\n`;

/**
 * The Quizzes page: every quiz as a card with Mistakes first — `?quizzes=1` — and the
 * Mistakes run it starts, `?quizzes=1&run=mistakes`.
 */
function QuizzesApp({
  query,
  setQuery,
  list,
  open,
  openQuizzes,
}: {
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
  openQuizzes(run?: QuizzesRun): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const running = query.get("run") === "mistakes";
  const folder = folderOfRun(query.get("run"));
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open });
  const practice = usePractice(!snapshot);
  const locked = useLocked() && !snapshot;
  const create = useCallback(
    async (title: string) => {
      const made = await createQuiz(titleStem(title), quizText(title));
      if ("name" in made) open("quiz", made.name);
    },
    [open],
  );
  return (
    <div className="dag-app dag-app--quizzes" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar
          boardName={null}
          title={running ? "Mistakes" : folder !== null ? folderLabel(folder) : "Quizzes"}
          onBoards={openBrowser}
        />
      )}
      {running ? (
        <MistakesRun list={list} onExit={() => openQuizzes()} />
      ) : folder !== null ? (
        <FolderRun
          key={folder}
          folder={folder}
          list={list}
          locked={locked}
          onExit={() => openQuizzes()}
          onMistakes={() => openQuizzes("mistakes")}
        />
      ) : (
        <QuizzesView
          list={list}
          practice={practice}
          onOpen={(name) => open("quiz", name)}
          onPractice={(name) => setQuery({ ...pageQuery("quiz", name), run: "1" })}
          onMistakes={() => openQuizzes("mistakes")}
          onPracticeFolder={(f) => openQuizzes(`folder:${f}`)}
          onCreate={locked ? undefined : (title) => void create(title)}
        />
      )}
      {cards}
    </div>
  );
}

/**
 * The Mistakes run: every question in Mistakes, from every quiz, in the order the server asks them
 * (streak, then longest since last seen).
 *
 * **Read once when the run starts, and again only on Again.** The pool moves under every answer —
 * that is what practising does to it — and a run that followed it would restart itself after each
 * one. What the run asks is fetched here: the pool names quizzes by id, the list turns ids into
 * names, and only the quizzes the pool names are read.
 */
function MistakesRun({ list, onExit }: { list: BoardTree; onExit(): void }) {
  const [questions, setQuestions] = useState<RunQuestion[] | null>(null);
  const [graduate, setGraduateState] = useState(2);
  const ids = useRef(list.ids);
  ids.current = list.ids;
  const titles = useRef(list.titles);
  titles.current = list.titles;
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      await flushAnswers();
      const p = await readPractice();
      if (!p) return setQuestions([]);
      setGraduateState(p.graduate);
      if (p.pool.length === 0) return setQuestions([]);
      const byId = Object.fromEntries(Object.entries(ids.current).map(([name, id]) => [id, name]));
      /* The list not in yet: wait for it, rather than decide every question's quiz has gone. */
      if (Object.keys(byId).length === 0) return;
      const wanted = [...new Set(p.pool.map((e) => e.quiz))].filter((id) => byId[id]);
      const quizzes = new Map<
        string,
        { name: string; description: string; shuffle: boolean; questions: Map<string, Question> }
      >();
      await Promise.all(
        wanted.map(async (id) => {
          const name = byId[id]!;
          const r = await fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=quiz`).catch(() => null);
          if (!r?.ok) return;
          const { text } = (await r.json()) as { text: string };
          const parsed = parseQuiz(text);
          quizzes.set(id, {
            name,
            description: parsed.description,
            shuffle: parsed.shuffle,
            questions: new Map(parsed.questions.flatMap((q) => (q.id ? [[q.id, q] as const] : []))),
          });
        }),
      );
      setQuestions(
        p.pool.flatMap((e) => {
          const quiz = quizzes.get(e.quiz);
          const question = quiz?.questions.get(e.question);
          if (!quiz || !question || !askable(question)) return [];
          return [
            {
              quiz: {
                name: quiz.name,
                title: titles.current[quiz.name],
                id: e.quiz,
                description: quiz.description,
                shuffle: quiz.shuffle,
              },
              question,
            },
          ];
        }),
      );
    } finally {
      loading.current = false;
    }
  }, []);

  /* Until the first answer, every time the list changes: the list arrives after the page does. */
  useEffect(() => {
    if (questions === null) void load();
  }, [list.ids, questions, load]);

  if (questions === null) return <div className="dag-run dag-run--loading" data-dag-run="loading" />;
  return (
    <Runner
      questions={questions}
      title="Mistakes"
      showSource
      record={(q, correct) =>
        q.quiz.id && q.question.id && answer({ quiz: q.quiz.id, question: q.question.id, correct, run: "mistakes" })
      }
      /* Back to loading first, so the last run's score is not what shows while the pool is asked again. */
      onAgain={() => setQuestions(null)}
      onExit={onExit}
      exitLabel="Back to the quizzes"
      empty={`Nothing in Mistakes. A question you get wrong comes here, and leaves once you get it right ${graduate} ${
        graduate === 1 ? "time" : "times in a row"
      } here.`}
      after={(wrong, right) =>
        wrong
          ? `${right} right and ${wrong} still to practice.`
          : `All ${right} right. Each one leaves Mistakes once it has been right ${graduate} ${graduate === 1 ? "time" : "times in a row"}.`
      }
    />
  );
}

/**
 * Every quiz in a folder as one run: `?quizzes=1&run=folder:<path>`, the quizzes under it in
 * the sidebar's order (`folderQuizzes`) and each one's questions in its own order, every answer
 * recorded against its own quiz as an ordinary run — so Mistakes and each quiz's count stay right.
 *
 * **Read once when the run starts**, as the Mistakes run is; Again asks the same questions with the
 * options drawn afresh. A quiz whose questions have no id yet is stamped first, a write per quiz, as
 * Practice does before a quiz's own run — and not while the app is locked, when the
 * questions that have none are still asked and not recorded.
 */
function FolderRun({
  folder,
  list,
  locked,
  onExit,
  onMistakes,
}: {
  folder: string;
  list: BoardTree;
  locked: boolean;
  onExit(): void;
  onMistakes(): void;
}) {
  const [questions, setQuestions] = useState<RunQuestion[] | null>(null);
  const names = folderQuizzes(list.quizzes, list.titles, folder);
  const key = names.join("\n");
  const latest = useRef(list);
  latest.current = list;

  useEffect(() => {
    /* The server's list not in yet: wait for it rather than read a kept one, whose names may have
       moved, or decide the folder is empty. Read once: `key` is what the folder held then. */
    if (questions !== null || !latest.current.fresh) return;
    let live = true;
    void (async () => {
      const { titles, ids } = latest.current;
      const read = await Promise.all(
        names.map(async (name) => {
          const r = await fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=quiz`).catch(() => null);
          if (!r?.ok) return null;
          let { text, base } = (await r.json()) as { text: string; base: string };
          if (!locked && parseQuiz(text).questions.some((q) => askable(q) && q.id === undefined)) {
            const stamped = stampIds(text).text;
            const put = await fetch(`/__board/put?name=${encodeURIComponent(name)}&kind=quiz`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: stamped, base }),
            }).catch(() => null);
            if (put?.ok) text = stamped;
          }
          const quiz = parseQuiz(text);
          return quiz.questions.filter(askable).map((question) => ({
            quiz: { name, title: titles[name], id: ids[name], description: quiz.description, shuffle: quiz.shuffle },
            question,
          }));
        }),
      );
      if (live) setQuestions(read.flatMap((q) => q ?? []));
    })();
    return () => {
      live = false;
    };
  }, [key, list.fresh, questions, locked]);

  if (questions === null) return <div className="dag-run dag-run--loading" data-dag-run="loading" />;
  return (
    <Runner
      questions={questions}
      title={folderLabel(folder)}
      showSource
      record={(q, correct) =>
        q.quiz.id && q.question.id && answer({ quiz: q.quiz.id, question: q.question.id, correct, run: "quiz" })
      }
      onMistakes={() => void flushAnswers().then(onMistakes)}
      onExit={onExit}
      exitLabel="Back to the quizzes"
      empty={
        names.length
          ? "No quiz in this folder has a question that can be asked yet. Each needs a prompt and options, one of them ticked, or a model answer."
          : "There is no quiz in this folder."
      }
      after={(wrong) =>
        wrong ? `${wrong} ${wrong === 1 ? "question" : "questions"} went into Mistakes.` : "Nothing went into Mistakes."
      }
    />
  );
}

/**
 * A quiz's own page: the form that edits it, and the run that practises it — `?quiz=`,
 * and `&run=1` for the run. A snapshot is the sheet, every question with its answers.
 */
function QuizApp({
  name,
  query,
  setQuery,
  list,
  open,
  openQuizzes,
}: {
  name: string;
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
  openQuizzes(run?: QuizzesRun): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const running = !snapshot && query.get("run") === "1";
  const locked = useLocked() && !snapshot;
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open, quiz: name });
  const file = useQuizFile(name);
  const quiz = useMemo(() => parseQuiz(file.text), [file.text]);
  /* A snapshot is ready once the sheet is drawn, boards embedded in it included. */
  const sheet = useRef<HTMLDivElement>(null);
  usePublishDrawn(sheet, file.text, { enabled: snapshot && file.state.status === "ready" });
  const target = useTarget();
  const title = list.titles[name] ?? splitNote(file.text).title ?? leaf(name);
  const id = list.ids[name];
  const askableCount = quiz.questions.filter(askable).length;

  /* What a run asks is what the quiz said when it started: another writer's edit mid-run must not
     move the question somebody is answering. Started again, it reads the file again. */
  const [runFrom, setRunFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!running) setRunFrom(null);
    else if (runFrom === null && file.state.status === "ready") setRunFrom(file.text);
  }, [running, runFrom, file.state.status, file.text]);
  const runQuestions = useMemo<RunQuestion[]>(() => {
    if (runFrom === null) return [];
    const { description, questions, shuffle } = parseQuiz(runFrom);
    return questions.filter(askable).map((question) => ({ quiz: { name, title, id, description, shuffle }, question }));
  }, [runFrom, name, title, id]);

  /* A run records against every question's id, so a question with none gets one first — in one
     write, before the first answer. */
  const practise = useCallback(async () => {
    /* Locked, the stamp is a write and is skipped: the run still asks every question, and
       records the ones that already have an id — practising changes no file. */
    if (!locked && quiz.questions.some((q) => askable(q) && q.id === undefined)) {
      file.change(stampIds(file.text).text);
      await file.flush();
    }
    setQuery("run", "1");
  }, [quiz, file, setQuery, locked]);

  const exportQuiz = useCallback(
    async (_kind: "md") => {
      await file.flush();
      saveFile(`${fileStem(name)}.quiz.md`, id ? sealId(file.text, id) : file.text, "text/markdown");
    },
    [file, name, id],
  );

  let body: ReactNode;
  if (file.state.status === "loading") body = <div className="dag-quiz dag-quiz--loading" />;
  else if (file.state.status === "missing")
    body = (
      <div className="dag-quiz" data-dag-quiz-missing="">
        <p className="dag-quiz__empty">This quiz is not here any more.</p>
        <button type="button" className="dag-quiz__add" onClick={() => openQuizzes()}>
          Go to the quizzes
        </button>
      </div>
    );
  else if (snapshot)
    body = (
      <div className="dag-quiz-page" ref={sheet}>
        <Sheet name={name} title={title} description={quiz.description} questions={quiz.questions} />
      </div>
    );
  else if (locked && !running)
    /* Locked: the sheet a snapshot draws — every question with its answer marked — rather
       than a form of fields that would each refuse. Practice is still there. */
    body = (
      <div className="dag-quiz-page" data-dag-quiz-locked="">
        <Sheet name={name} title={title} description={quiz.description} questions={quiz.questions} />
      </div>
    );
  else if (running)
    body =
      runFrom === null ? (
        <div className="dag-run dag-run--loading" data-dag-run="loading" />
      ) : (
        <Runner
          questions={runQuestions}
          title={title}
          record={(q, correct) => id && q.question.id && answer({ quiz: id, question: q.question.id, correct, run: "quiz" })}
          onMistakes={() => void flushAnswers().then(() => openQuizzes("mistakes"))}
          onExit={() => setQuery("run", null)}
          empty="This quiz has no question that can be asked yet. Each needs a prompt and at least two options, one of them ticked."
          after={(wrong) =>
            wrong ? `${wrong} ${wrong === 1 ? "question" : "questions"} went into Mistakes.` : "Nothing went into Mistakes."
          }
        />
      );
  else
    body = (
      <QuizEditor text={file.text} onChange={file.change} target={target} onTargetShown={clearTarget}>
        <span
          className="dag-quiz__status"
          data-dag-quiz-saving={file.state.status === "ready" && file.state.saving ? "" : undefined}
        >
          {file.state.status === "ready" && file.state.failed
            ? "Not saved yet. Trying again."
            : askableCount < quiz.questions.length
              ? `${quiz.questions.length - askableCount} of ${quiz.questions.length} cannot be practiced until fixed`
              : ""}
        </span>
      </QuizEditor>
    );

  return (
    <div className="dag-app dag-app--quiz" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar
          boardName={name}
          title={title}
          kind="quiz"
          onBoards={openBrowser}
          more={id ? exportRows(QUIZ_EXPORTS, exportQuiz) : []}
        >
          <Backlinks id={id} />
          {file.state.status === "ready" ? (
            running ? (
              <button type="button" className="dag-toolbar__practice" data-dag-quiz-edit="" onClick={() => setQuery("run", null)}>
                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                <span>Edit</span>
              </button>
            ) : (
              <button
                type="button"
                className="dag-toolbar__practice"
                data-dag-quiz-practice=""
                disabled={askableCount === 0}
                title={
                  askableCount === 0
                    ? "Add a question with a prompt and a correct option first"
                    : "Answer the questions, one at a time"
                }
                onClick={() => void practise()}
              >
                <Play size={14} strokeWidth={2} aria-hidden="true" />
                <span>Practice</span>
              </button>
            )
          ) : null}
          {id ? <ExportButton key={name} what="quiz" options={QUIZ_EXPORTS} onExport={exportQuiz} /> : null}
        </Toolbar>
      )}
      {file.state.status === "conflict" ? (
        <div className="dag-quiz__conflict" role="alert" data-dag-quiz-conflict="">
          <span>Somebody changed the same questions while you were editing.</span>
          <button type="button" data-dag-quiz-keep="" onClick={file.keepMine}>
            Keep mine
          </button>
          <button type="button" data-dag-quiz-theirs="" onClick={file.useTheirs}>
            Use theirs
          </button>
        </div>
      ) : null}
      {body}
      {cards}
    </div>
  );
}

/**
 * An attachment's own page, `?file=<name>`: its title, which is where it is renamed, and
 * the file drawn — a picture, a PDF through pdf.js, audio, video, text, or a card to save it from.
 * The toolbar carries where it is used (its backlinks), Download and Share.
 *
 * It knows the file exists before it draws a byte of it, off `/__board/files`: a picture or a
 * player pointed at a name that has gone is a 404 on the console.
 */
function FileApp({
  name,
  query,
  setQuery,
  list,
  open,
}: {
  name: string;
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const locked = useLocked() && !snapshot;
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open, file: name });
  const files = useFiles();
  const sidebar = useSidebar();
  const found = files.files.find((f) => f.name === name);
  const title = found?.title ?? list.titles[name] ?? leaf(name);
  const id = found?.id ?? list.ids[name];
  /* A new title moves the file to the title's stem, extension kept — and this page with it. */
  const retitle = useCallback(
    async (next: string) => {
      const made = await retitleFile(name, next, "file");
      if (!made) return false;
      if (made !== name) {
        sidebar?.renamed("file", name, made);
        setQuery({ file: made });
      }
      return true;
    },
    [name, sidebar, setQuery],
  );
  return (
    <div className="dag-app dag-app--file" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar boardName={name} title={title} kind="file" onBoards={openBrowser}>
          <Backlinks id={id} />
        </Toolbar>
      )}
      {!files.loaded ? (
        <main className="dag-file" data-dag-file-view="loading" />
      ) : found ? (
        <FileView
          key={name}
          name={name}
          title={title}
          bytes={found.bytes}
          url={fileUrl({ name })}
          download={fileUrl({ name }, true)}
          /* Renaming is a change to the file, so a locked page draws its title as text. */
          onRetitle={snapshot || locked ? undefined : retitle}
        />
      ) : (
        <main className="dag-file" data-dag-file-missing="" data-dag-ready="">
          <p className="dag-file__none">This file is not here any more.</p>
        </main>
      )}
      {cards}
    </div>
  );
}

/**
 * A table's own page: the grid over one tab, and the tabs along the bottom — `?table=`,
 * and `&tab=` for the tab. A snapshot is every tab, one after another. The page itself is
 * `src/ui/table/TablePage.tsx`; this is where it meets the address and the cards every page carries.
 */
function TableApp({
  name,
  query,
  setQuery,
  list,
  open,
}: {
  name: string;
  query: URLSearchParams;
  setQuery: SetQuery;
  list: BoardTree;
  open(kind: FileKind, name: string | null): void;
}) {
  const snapshot = query.get("snapshot") === "1";
  const { openBrowser, cards } = usePageChrome({ query, setQuery, list, open, table: name });
  const onTab = useCallback((tab: string | null) => setQuery("tab", tab), [setQuery]);
  return (
    <TablePage
      key={name}
      name={name}
      list={list}
      tab={query.get("tab")}
      onTab={onTab}
      onBrowse={openBrowser}
      onOpenTables={openBrowser}
      snapshot={snapshot}
    >
      {cards}
    </TablePage>
  );
}

/**
 * The note page: the toolbar, the note, and the board list.
 *
 * `space O` opens the list here too — while the caret is not in the text, where a space is a space.
 * It is the one chord a note page has, because it is the one thing a person on a note needs from
 * the board page's vocabulary: somewhere else to go.
 */
function NoteApp({ name, query, setQuery, list }: { name: string; query: URLSearchParams; setQuery: SetQuery; list: BoardTree }) {
  const snapshot = query.get("snapshot") === "1";
  const { theme, name: themeName, setName: setTheme } = useTheme(query.get("theme") ?? undefined, undefined, snapshot);
  const { boards, folders, notes } = list;
  const [title, setTitle] = useState<string | undefined>(undefined);
  /* Whether the note is a task, as the page holds it — `undefined` for a plain note. */
  const [task, setTaskState] = useState<Task | undefined>(undefined);
  /* And whether it is a project, which is what the bar under the title counts for. */
  const [project, setProjectState] = useState<Project | undefined>(undefined);
  /* And whether it is an event, which takes the place of *Make it a task* in the top bar. */
  const [event, setEventState] = useState<NoteEvent | undefined>(undefined);
  const noteId = useIndex().docs.find((d) => d.kind === "note" && d.name === name)?.id;
  /*
   * What the project holds, off the listing: every task under its folder, nested projects' too.
   * The listing is one round trip behind the page, so a note made a project a moment ago may not
   * be in `projects` yet — it is taken to own its folder unless another note already does.
   */
  const members = useMemo<ProjectMembers | undefined>(() => {
    if (!project) return undefined;
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    const folder = folderOf(name);
    if (!folder) return { counts, why: "A project is the folder its note is in. Move this note into a folder to make it one." };
    const owner = projectFolders(list.projects).get(folder);
    if (owner && owner !== name) return { counts, why: `${list.titles[owner] ?? leaf(owner)} is this folder's project already.` };
    for (const [n, t] of Object.entries(list.tasks)) if (within(n, folder)) counts[t.status]++;
    const id = list.ids[name];
    return {
      counts,
      onTasks: id ? () => setQuery({ ...pageQuery("board", null), tasks: "1", project: id }) : undefined,
      onCalendar: id ? () => setQuery({ ...pageQuery("board", null), calendar: "1", project: id }) : undefined,
    };
  }, [project, name, list.projects, list.titles, list.tasks, list.ids, setQuery]);
  const sidebar = useSidebar();

  /*
   * **A title written on the page moves the file, and the page stays up**. `NoteView` is
   * keyed so that opening another note is a fresh page — but a rename it made itself is the same
   * note under a new name, with a caret in it, so the key it was mounted under is kept when the
   * name it moves to is the one it said. Any other change of name is another note, or this one
   * renamed from somewhere else, and remounts as it always has.
   */
  const renamedTo = useRef<string | null>(null);
  const [mounted, setMounted] = useState({ name, key: name });
  if (mounted.name !== name) setMounted({ name, key: renamedTo.current === name ? mounted.key : name });
  const renamed = useCallback(
    (from: string, to: string) => {
      /* The favourites follow, as they do for a rename made in the sidebar. */
      sidebar?.renamed("note", from, to);
      /* Read off the address, not a closure: a note left before its rename answered is not followed. */
      if (new URLSearchParams(location.search).get("note") !== from) return;
      renamedTo.current = to;
      setQuery({ note: to });
    },
    [sidebar, setQuery],
  );
  const [browsing, setBrowsing] = useState(false);
  const openBrowser = useCallback(() => setBrowsing(true), []);
  const closeBrowser = useCallback(() => setBrowsing(false), []);
  /* Settings and Send feedback, which a note could not reach until the sidebar: the note
     page has no dock, and the dock's `⋯` was the only door to either. */
  const settings = useSettingsOpen();
  useChromeRequests({ search: openBrowser, settings: settings.show });

  /*
   * Export. The note's text comes from the page showing it, which knows what is
   * on screen and what is still waiting to be saved; a PDF is that text set out for paper by
   * `NotePrint` and printed once everything in it has arrived. `ready` is what to do then: print, on
   * this page; hand the page back to whoever asked, for `dag:export` below.
   */
  const noteHandle = useRef<NoteHandle | null>(null);
  const [printing, setPrinting] = useState<{
    title?: string;
    task?: Task;
    project?: Project;
    event?: NoteEvent;
    body: string;
    ready(): void;
  } | null>(null);
  const noteText = useCallback(async () => {
    const text = await noteHandle.current?.text();
    if (text == null) throw new Error("the note has not loaded yet");
    return text;
  }, []);
  const exportNote = useCallback(
    async (kind: "pdf" | "md") => {
      const text = await noteText();
      /* With the attachments and pictures it names beside it, in a zip, when it names any. */
      if (kind === "md") return saveWithFiles(name, `${fileStem(name)}.note.md`, text);
      const { title: heading, body } = splitNote(text);
      await new Promise<void>((resolve) =>
        setPrinting({
          title: heading,
          task: taskOf(text),
          project: projectOf(text),
          event: eventOf(text),
          body,
          ready: () => {
            printAs(heading ?? leaf(name));
            setPrinting(null);
            resolve();
          },
        }),
      );
    },
    [name, noteText],
  );

  /* Another note opened while a sheet was waiting to be drawn takes the sheet away: it is the old
     note's text, and printing it under the new one's name would be a PDF of the wrong file. The
     button is keyed on the name for the same reason, so it does not stay "Exporting…" for ever. */
  useEffect(() => () => setPrinting(null), [name]);

  /* `dag:export` with `kind: "pdf"` sets the note out for paper and answers with its title once it is
     drawn, leaving it up — the board page's event, and for its reason: `anydag note export --format
     pdf` drives this page under `?snapshot=1`, where there is no menu, and prints it itself. */
  useEffect(() => {
    const onExport = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; reply?: (v: string) => void; fail?: (why: string) => void } | null>).detail;
      if (!d?.reply || d.kind !== "pdf") return;
      const { reply, fail } = d;
      noteText().then(
        (text) => {
          const { title: heading, body } = splitNote(text);
          setPrinting({
            title: heading,
            task: taskOf(text),
            project: projectOf(text),
            event: eventOf(text),
            body,
            ready: () => reply(heading ?? leaf(name)),
          });
        },
        (why: unknown) => fail?.(why instanceof Error ? why.message : String(why)),
      );
    };
    document.addEventListener("dag:export", onExport);
    return () => document.removeEventListener("dag:export", onExport);
  }, [name, noteText]);

  const chooseTheme = useCallback(
    (n: string) => {
      setTheme(n);
      if (query.get("theme")) setQuery("theme", null);
    },
    [setTheme, query, setQuery],
  );

  const open = useCallback((kind: FileKind, target: string | null) => setQuery(pageQuery(kind, target)), [setQuery]);

  usePageKeys(snapshot, { settings: settings.toggle, search: () => setBrowsing(true) });
  const locked = useLocked() && !snapshot;
  /* A row that changes the file is greyed while locked, rather than gone: the menu still
     says what unlocking gives back. */
  const writes = (row: MoreItem): MoreItem => (locked ? { ...row, disabled: true } : row);

  return (
    <div className="dag-app dag-app--note" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar
          boardName={name}
          title={title}
          kind="note"
          onBoards={openBrowser}
          more={
            /* Once the index has it, which is when it is known to exist. A plain note becomes a task
               or an event here — the `⋯`, where two labelled buttons would take the room the
               note's own title needs. */
            noteId
              ? [
                  ...(!task && !project && !event
                    ? [
                        writes({
                          key: "make-task",
                          label: "Make it a task",
                          icon: SquareCheckBig,
                          hook: "data-dag-note-make-task",
                          title: "Give this note a status, and it is listed on the Tasks page",
                          onSelect: () => noteHandle.current?.task({ status: "todo" }),
                        }),
                        writes({
                          key: "make-event",
                          label: "Make it an event",
                          icon: CalendarPlus,
                          hook: "data-dag-note-make-event",
                          title: "Give this note a start and an end, and it is drawn on the calendar",
                          onSelect: () => noteHandle.current?.event(nextHourEvent()),
                        }),
                      ]
                    : []),
                  /* And the way back from each: a row in the properties list said *Not a task* in
                     the colour of a value, beside the values. */
                  ...(task
                    ? [
                        writes({
                          key: "untask",
                          label: "Not a task",
                          icon: CircleSlash,
                          hook: "data-dag-taskbar-untask",
                          split: true,
                          onSelect: () => noteHandle.current?.task({ status: null, due: null, start: null }),
                        }),
                      ]
                    : []),
                  ...(event
                    ? [
                        writes({
                          key: "unevent",
                          label: "Not an event",
                          icon: CalendarX2,
                          hook: "data-dag-eventbar-unevent",
                          split: true,
                          onSelect: () => noteHandle.current?.event({ start: null, end: null }),
                        }),
                      ]
                    : []),
                  ...(project
                    ? [
                        writes({
                          key: "unproject",
                          label: "Not a project",
                          icon: CircleSlash,
                          hook: "data-dag-projectbar-unproject",
                          split: true,
                          onSelect: () => noteHandle.current?.project({ project: null, hue: null }),
                        }),
                      ]
                    : []),
                  ...exportRows(NOTE_EXPORTS, exportNote),
                ]
              : []
          }
        >
          <Backlinks id={noteId} />
          {noteId ? <ExportButton key={name} what="note" options={NOTE_EXPORTS} onExport={exportNote} /> : null}
        </Toolbar>
      )}
      <NoteView
        key={mounted.key}
        name={name}
        scheme={theme.color.scheme === "dark" ? "dark" : "light"}
        snapshot={snapshot}
        locked={locked}
        onTitle={setTitle}
        onTask={setTaskState}
        onProject={setProjectState}
        onEvent={setEventState}
        members={members}
        onRenamed={renamed}
        handle={noteHandle}
      />
      {printing ? (
        <NotePrint
          name={name}
          title={printing.title}
          task={printing.task}
          project={printing.project}
          event={printing.event}
          body={printing.body}
          theme={paperTheme(theme)}
          onReady={printing.ready}
        />
      ) : null}
      {browsing && !snapshot ? (
        <BoardBrowser
          boards={boards}
          notes={notes}
          folders={folders}
          titles={list.titles}
          board={null}
          note={name}
          quizzes={list.quizzes}
          files={list.files}
          onOpen={open}
          onOpenAt={(kind, target, part) => {
            /* The part goes into the hash first, so the page that opens finds it there — and the
               note already open, which does not reopen, hears it through `dag:target`. */
            setTarget(part ?? null);
            if (kind !== "note" || target !== name) open(kind, target);
          }}
          onClose={closeBrowser}
        />
      ) : null}
      {settings.open && !snapshot ? (
        <Settings
          themes={THEME_NAMES}
          themeName={themeName}
          onTheme={chooseTheme}
          boardName={null}
          list={list}
          tab={settings.open.tab}
          onClose={settings.close}
        />
      ) : null}
    </div>
  );
}

function BoardApp({ query, setQuery, list }: { query: URLSearchParams; setQuery: SetQuery; list: BoardTree }) {
  const { boards, folders, notes } = list;
  const sidebar = useSidebar();
  const saved = useSavedComponents();
  const savedComponents = useMemo(() => saved.map(toBlueprint), [saved]);

  /*
   * No `?board=` is no board.
   *
   * It used to fall back to `boards[0]` — so a cold load opened whichever file sorted first,
   * usually somebody's reference fixture, and the only clue that this was an accident rather than
   * a choice was not recognising it. `Welcome` is what stands here now: an empty board, and the
   * two ways on. Every link, script and Playwright check already carries `?board=`, so nothing
   * that meant to open something is affected.
   */
  const boardName = query.get("board");
  const handle = useBoard(boardName);
  const { board, error } = handle;

  /* A board opened, for the logs when somebody said yes: its size and how many of each diagram it
     holds — counts, never a name. Once per board per page load; `track` does nothing on a snapshot. */
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!board || !boardName || counted.current === boardName) return;
    counted.current = boardName;
    const kinds: Record<string, number> = {};
    let diagrams = 0;
    for (const it of board.items) {
      if (!isDiagramType(it.type)) continue;
      diagrams++;
      kinds[it.type] = (kinds[it.type] ?? 0) + 1;
    }
    track("board.open", { items: board.items.length, diagrams, pages: board.pages.length, ...kinds });
  }, [board, boardName]);

  /* Opening a *different* board lands on its first page. The page id is the previous document's
     — `page-2` on a board that has one page is a blank canvas with no tab selected — so the two
     keys move together, in one `replaceState`. Renaming the open board is not this: it is the
     same document under a new name, and the page it was on is still the page it is on. */
  const openBoard = useCallback((name: string | null) => setQuery(pageQuery("board", name)), [setQuery]);
  const openNote = useCallback((name: string | null) => setQuery(pageQuery("note", name)), [setQuery]);
  /* What an import just made, of whatever kind its name said (`importKind`). */
  const openImported = useCallback((made: string, kind: FileKind = "board") => setQuery(pageQuery(kind, made)), [setQuery]);

  /* Declared before the theme, which now needs it: a snapshot reads no stored preference. */
  const snapshot = query.get("snapshot") === "1";
  /* Read only: the selection, the keys that read and a pan stay; everything that writes is
     not drawn, and `useEditor` refuses it underneath. A snapshot is read-only already. */
  const locked = useLocked() && !snapshot;
  const { theme, name: themeName, setName: setTheme } = useTheme(query.get("theme") ?? undefined, board?.theme, snapshot);

  /* Whether the board browser is up. Plain state and nothing more: a dialog somebody opened for
     the two seconds it takes to switch boards is not a preference, which is exactly what `SIDEBAR`
     was and why that key went with the column it remembered. */
  const [browsing, setBrowsing] = useState(false);
  const openBrowser = useCallback(() => setBrowsing(true), []);
  const closeBrowser = useCallback(() => setBrowsing(false), []);
  const toggleBrowser = useCallback(() => setBrowsing((v) => !v), []);

  /* The library too. Closed until asked for: a board is read more often than it is built. */
  const [library, setLibrary] = useState(() => readFlag(LIBRARY, false));
  const showLibrary = useCallback((open: boolean) => {
    setLibrary(open);
    writeFlag(LIBRARY, open);
  }, []);
  const toggleLibrary = useCallback(() => setLibrary((v) => (writeFlag(LIBRARY, !v), !v)), []);

  const [help, setHelp] = useState(false);
  const toggleHelp = useCallback(() => setHelp((v) => !v), []);
  const closeHelp = useCallback(() => setHelp(false), []);

  /* What the app does, as opposed to what a board says. Not in the query string: a preference is
     not part of what a shared `?board=…` link means, which is the same argument the theme makes. */
  const settings = useSettingsOpen();

  /* Sending a report. Plain state beside Settings, for the same reason and with one more: there is
     nowhere else it could live. A draft is not a preference and it is not part of a board, and
     nothing stores one — closing this card is the end of what was written in it. */
  useChromeRequests({ search: openBrowser, settings: settings.show });

  /* Choosing a theme now is choosing: a `?theme=` in the URL outranks the stored preference, so a
     pick made while one is present would be recorded and then ignored. */
  const chooseTheme = useCallback(
    (n: string) => {
      setTheme(n);
      if (query.get("theme")) setQuery("theme", null);
    },
    [setTheme, query, setQuery],
  );

  /* A `?page=` the board does not have is not a page. `openBoard` clears the key on every switch,
     but it cannot answer for a link somebody shared — `?board=x&page=page-9` — or for the round
     trip where the query has moved on and `board` is still the previous file. Falling back to the
     first page is what both of those want, and it is what the tabs already draw as selected. */
  const asked = query.get("page");
  const page = asked && board?.pages.some((p) => p.id === asked) ? asked : (board?.pages[0]?.id ?? "page-1");
  const viewport = useRef<ViewportHandle>(null);
  const body = useRef<HTMLDivElement>(null);

  /* Items that size themselves report back here, and diagrams where their nodes sit — see
     `src/view/drawing.ts`, which the read-only view shares. */
  const { sizes, nodeBoxes, onMeasure } = useMeasures();

  const laidOut = useMemo(() => (board ? placeItems(board, page, sizes) : new Map()), [board, page, sizes]);

  /* Selection, gestures, the clipboard, undo: everything a person does to the items. `places` is
     the flow's answer with the gesture in progress on top, until the file agrees. */
  const editor = useEditor({
    board,
    page,
    laidOut,
    handle,
    viewport,
    grid: theme.metric.grid,
    enabled: !snapshot,
    locked,
    onLibrary: toggleLibrary,
    onLibraryOpen: () => showLibrary(true),
    onHelp: toggleHelp,
    onBoards: toggleBrowser,
    onSettings: settings.toggle,
    onOpenBoard: openImported,
    onOpenPage: (p) => setQuery("page", p),
  });
  const { places, selected, editing, ctl } = editor;

  /*
   * A sidebar row let go over this canvas: its card, placed where the pointer was — the
   * same card the library's *Your notes* places, through the same `place`, so a task lands as its
   * status and a note as its text. Read off the list for the id and the title the card is made of;
   * a file the list does not know yet has no id to point at, and nothing is placed.
   */
  const listRef = useRef(list);
  listRef.current = list;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const gridOf = useRef(theme.metric.grid);
  gridOf.current = theme.metric.grid;
  useEffect(() => {
    if (snapshot) return;
    const onPlace = (e: Event) => {
      const d = (e as CustomEvent<PlaceFile>).detail;
      if (!d) return;
      if (locked) return void refuseLocked();
      const known = listRef.current;
      const ed = editorRef.current;
      const at = ed.toBoard(d.x, d.y);
      /* An attachment lands as a picture drawn from it, at the width the placement rule gives its
         pixels, or as the card anything else is. The picture is measured first; one that
         will not load lands at the card's width rather than not at all. */
      const card = async (f: { kind: FileKind; name: string }): Promise<Component | null> => {
        const id = known.ids[f.name];
        if (!id || (f.kind === "board" && f.name === boardName)) return null;
        if (f.kind !== "file")
          return noteCard({ id, name: f.name, title: known.titles[f.name], task: known.tasks[f.name], kind: f.kind });
        const land = (w?: number) => fileCard({ id, name: f.name, title: known.titles[f.name] }, w);
        if (!isPicture(f.name)) return land();
        const img = new Image();
        img.src = fileUrl({ id });
        return img
          .decode()
          .then(() => land(placedWidth(img.naturalWidth, devicePixelRatio, readSettings().paste, gridOf.current)))
          .catch(() => land());
      };
      /* Several — a selection let go here — go down together in one write, in a row. */
      void Promise.all(d.files.map(card)).then((made) => {
        const all = made.filter((c): c is Component => c !== null);
        if (all.length === 1) ed.place(all[0]!, at);
        else ed.placeAll(all, at);
      });
    };
    document.addEventListener("dag:place-file", onPlace);
    return () => document.removeEventListener("dag:place-file", onPlace);
  }, [snapshot, boardName, locked]);

  const bounds = useMemo(() => contentBounds(places), [places]);

  /*
   * The rewrite preview, and the request that produced it.
   *
   * Nothing about a rewrite is editor state: the gesture is a call to `ctl.rewrite`, and nothing
   * touches the file before the answer is accepted. So the answer is held
   * here, and the preview is *the substitution below* — the item the canvas draws is a shallow
   * copy with the draft's body, and the parse, the ELK layout and the render run on it exactly as
   * they run on anything else. A discarded or aborted rewrite leaves the file as it was, because
   * the file was never part of the mechanism.
   */
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{ id: string; draft: Draft; lost: string[]; unparsed: boolean } | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; detail?: DraftDiagnostic[] } | null>(null);
  /* The item a request or a refusal is about, so the toolbar can stand beside it after the
     selection has moved on. */
  const [runFor, setRunFor] = useState<string | null>(null);
  /* The dialog a change is described in, which item it is about, and what has been typed into it.
     The text outlives the dialog so "Try again" reopens it as it was left; it belongs to one item,
     and opening the dialog on another starts empty. */
  const [asking, setAsking] = useState(false);
  const [askFor, setAskFor] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const rewriteCtl = useRef<AbortController | null>(null);
  /* Nothing of a rewrite is committed until Accept, so the request and its answer go with the page. */
  useEffect(() => () => rewriteCtl.current?.abort(), []);

  const onRewrite = useCallback(
    (ids: string[], text: string) => {
      if (ids.length === 0) return;
      /* A second submit cancels the first: the server cancels the model call when the client goes
         away (`res.on("close")`), and only one answer can stand on an item. */
      rewriteCtl.current?.abort();
      const cancel = new AbortController();
      rewriteCtl.current = cancel;
      setPreview(null);
      setRefusal(null);
      setRunFor(ids[0]!);
      setPending(true);
      editor.ctl
        .rewrite(ids, text, cancel.signal)
        .then((out) => {
          if (cancel.signal.aborted) return;
          if (out.reason === "multi")
            return setRefusal({ message: "A rewrite takes one diagram at a time. Select just the one to change." });
          if (out.reason === "not-diagram")
            return setRefusal({ message: "This item has no diagram DSL to rewrite: notes, images and links are not diagrams." });
          if (out.reason === "missing")
            return setRefusal({
              message: "That item is gone. It was deleted, or the board changed while the model was thinking.",
            });
          if (!out.ok || !out.draft) {
            return setRefusal({
              message: out.error ?? "The model's answer still has problems.",
              detail: out.diagnostics.length ? out.diagnostics : undefined,
            });
          }
          setPreview({ id: ids[0]!, draft: out.draft, lost: out.lost, unparsed: out.unparsed });
        })
        .catch((e: Error) => {
          if (cancel.signal.aborted) return;
          setRefusal({ message: e.message });
        })
        .finally(() => {
          if (rewriteCtl.current === cancel) {
            rewriteCtl.current = null;
            setPending(false);
          }
        });
    },
    [editor.ctl],
  );

  /* Accept can be refused, and the proposal has to survive that. `applyRewrite` answers `false`
     when the item has gone or the write was refused against a version that moved — the same case
     `generateFor` degrades for a prompt card rather than leaving it sitting on "Drawing…".
     Clearing the preview on the way out would take the answer with it and say nothing: the person
     presses Accept, watches the drawing revert to what it was, and has no way back to a draft that
     took seconds and a paid call to get. So the proposal stands, the refusal is shown beside it,
     and Accept is still there to try again. */
  const onAccept = useCallback(() => {
    if (!preview) return;
    void editor.ctl.applyRewrite(preview.id, preview.draft).then((done) => {
      if (done) {
        /* Both, or a refusal from the attempt before would outlive the proposal it was about and
           the bar would fall back to showing it over a rewrite that has just landed. */
        setPreview(null);
        setRefusal(null);
        /* What was asked for has landed; the next change starts from nothing. */
        setAskText("");
      } else setRefusal({ message: "The board changed while the model was answering, so the change was not saved. Try again." });
    });
  }, [preview, editor.ctl]);

  const onDiscard = useCallback(() => {
    rewriteCtl.current?.abort();
    setPreview(null);
    setRefusal(null);
    setPending(false);
  }, []);

  /* The toolbar's ✨, and "Try again" after a refusal: the dialog opens on the one diagram the run
     was about, or else the one selected, with the text left in it if it is the same item. */
  const onAsk = useCallback(() => {
    const target = refusal ? runFor : selected.size === 1 ? [...selected][0]! : null;
    if (!target) return;
    setRefusal(null);
    if (target !== askFor) {
      setAskFor(target);
      setAskText("");
    }
    setAsking(true);
  }, [refusal, runFor, selected, askFor]);

  const onSendAsk = useCallback(() => {
    if (!askFor || !askText.trim()) return;
    setAsking(false);
    onRewrite([askFor], askText.trim());
  }, [askFor, askText, onRewrite]);

  /* Escape lets go of the rewrite wherever focus is. The bar owns its own Escape — the settings
     card's idiom, and the one that works while a person is typing in the field, because the
     editor's key chain leaves a focused INPUT alone — but it only sees keys that pass through it.
     Focus may be anywhere: on the paper after a click away, on a chip, on the viewport. So a
     window listener stands beside it while anything is held. The editor's own chain is registered
     first and keeps its slice (it cannot be preempted, only accompanied), so a press with the
     focus on the body clears what the chain says plus the rewrite; in the field, only the rewrite.
     `onDiscard` is idempotent, so the two handlers overlapping costs nothing. */
  useEffect(() => {
    /* The dialog's Escape is the dialog's: it closes the card and must not reach a run as well. */
    if ((!preview && !refusal && !pending) || asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onDiscard();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [preview, refusal, pending, asking, onDiscard]);

  /* What the bar shows: a standing proposal first, then a refusal, then a request in flight. */
  const barRun: RewriteRun = preview
    ? { phase: "preview", ...preview, failed: refusal?.message }
    : refusal
      ? { phase: "refused", id: runFor ?? undefined, message: refusal.message, detail: refusal.detail }
      : pending
        ? { phase: "running", id: runFor ?? undefined }
        : { phase: "idle" };

  /*
   * What is on the paper — which is not everything in the file.
   *
   * An `edges` fence is an item so that the panel, the patcher, undo and the clipboard can all
   * reach it, and it draws nothing. Leaving it in here would be quietly fatal rather than merely
   * wrong: `ready` below waits for every one of these to report a measured size, and an item that
   * never renders never reports one, so `data-dag-ready` would never fire — hanging every Playwright
   * check and `snapshot.mjs` on any board that holds a link.
   *
   * **The preview's item is substituted here.** A shallow copy with the draft's body, and its type
   * when the person asked for another kind of diagram — `proposedItem` in `src/edit/rewrite.ts`,
   * beside `rewriteOps`, so the preview and what Accept writes are one rule. The model's own fence
   * attributes are overlaid only at Accept. Everything downstream — `DiagramItem`'s parse,
   * the ELK layout, the render — runs on it exactly as it runs on anything else, because `Item`
   * takes a `BoardItem` and the copy is one; that is the whole mechanism, and no component knows
   * it is drawing a proposal. It is **not a commit**: `board` is untouched, the file is untouched,
   * and Accept is the only thing that writes.
   *
   * Not under `?snapshot=1`: a screenshot is a fact about the file, and the proposal is not in it.
   * `hash` is rebuilt over the body, the same recipe `parseBoard` uses, so the layout cache misses
   * rather than handing back the old drawing's answer.
   */
  const items = useMemo(() => {
    if (!board) return [];
    const shown = preview && !snapshot ? preview : null;
    return board.items
      .filter((it) => it.page === page && !it.hidden && !isLinkType(it.type))
      .map((it) => {
        if (!shown || shown.id !== it.id || !isDiagramType(it.type)) return it;
        return proposedItem(it, shown.draft);
      });
  }, [board, page, preview, snapshot]);

  /*
   * `data-dag-ready` means *finished*, and the bar is higher than it looks.
   *
   * An item gets a placeholder box the moment it is parsed, so "every item has a position" is true
   * long before any diagram has been through ELK — a snapshot taken then catches a board of empty
   * frames. The real signal is that every item has reported its own measured size, which for a
   * diagram happens only once its layout comes back.
   */
  /* `board !== null` is what says the file has loaded; the sizes are what say it has been drawn.
     An empty *page* is legitimately finished the moment it is parsed — there is nothing on it to
     wait for — and requiring an item meant a page a person had just added never became ready and
     `snapshot.mjs` sat on it until it timed out. */
  const ready = board !== null && items.every((it) => sizes.has(it.id));
  usePublishReady(true, ready, sizes, bounds);

  /*
   * A link to one item — a search result, or a reference written `dag:<id>#<item>` —
   * opens the board **on that item**: its page, the view framed on it, and it selected, which is
   * the one highlight the canvas already has. Waits for `ready`, because a box measured before the
   * diagram has been through ELK is a placeholder, and framing a placeholder frames the wrong place.
   *
   * `board.name` is checked against the query because the board is one round trip stale across a
   * switch: for a render it is still the previous file, and an item id like `md-1` is on most of
   * them. The part is let go once shown, or if this board has no such item — see `refs/target.ts`.
   */
  const target = useTarget();
  const selectItems = editor.select;
  useEffect(() => {
    if (!target || snapshot) return;
    /* A board that is not there has no item to show, and a part left waiting would be found by
       whichever board is opened next. */
    if (!boardName || error) return clearTarget();
    if (!board || board.name !== boardName) return;
    const it = board.items.find((x) => x.id === target);
    if (!it || it.hidden || isLinkType(it.type)) return clearTarget();
    if (it.page !== page) return setQuery("page", it.page);
    const box = ready ? places.get(it.id) : undefined;
    if (!box) return;
    viewport.current?.show(box);
    selectItems([it.id]);
    clearTarget();
  }, [target, snapshot, board, boardName, error, page, ready, places, selectItems, setQuery]);

  /*
   * The standing rewrite proposal is marked on the item it would replace — painted, not rendered.
   *
   * `Item` is memoised and `data-dag-item` is the only hook on its box; threading the mark down as
   * a prop would re-render every diagram on the board whenever a model's answer landed, the exact
   * thing the memo exists to prevent. The same paint-not-render split as the pick ring, and the
   * same ref trick: re-applying an attribute the element already carries is a no-op on the DOM.
   *
   * The effect has **no dependency list**, for the same reason the pick ring's repaint does not:
   * the draft's diagram reaches the DOM only once its parse and its layout have come back, several
   * renders after the preview state changed, with nothing about the preview in a dependency to
   * name that moment. One `querySelector` per render is cheaper than inventing a signal from
   * inside a memoised, asynchronously laid out subtree. A snapshot never carries the attribute:
   * a picture of a board is a fact about the file, and the proposal is not in it.
   */
  const proposed = useRef<Element | null>(null);
  useEffect(() => {
    const el = !snapshot && preview ? document.querySelector(`[data-dag-item="${CSS.escape(preview.id)}"]`) : null;
    if (proposed.current === el) return;
    proposed.current?.removeAttribute("data-dag-proposed");
    proposed.current = el;
    el?.setAttribute("data-dag-proposed", "");
  });
  useEffect(() => {
    /* A preview outlives the board it was asked on: switching boards drops it, the way undo's
       stack does — an answer to a question nobody is asking any more is not worth a card. */
    proposed.current?.removeAttribute("data-dag-proposed");
    proposed.current = null;
    setPreview(null);
    setRefusal(null);
    setPending(false);
  }, [board?.name]);

  /*
   * Where the canvas actually is, painted onto `.dag-body` as `--canvas-x` and `--canvas-w`.
   *
   * The dock, the selection bar, the problems dock, the which-key strip and the zoom cluster are
   * all absolutely positioned inside `.dag-body` — which is right, because it keeps them out of the
   * flex tree and leaves `.dag-viewport`'s `flex: 1; min-width: 0` contract alone. What was wrong
   * is what they were positioned *against*: `.dag-body` spans the board list and the panels too, so
   * `left: 50%` centred them on the window rather than on the drawing, and `right: 12px` put the
   * zoom cluster **on top of** the library whenever it was open. With the list open on a 1600px
   * screen the dock sat 116px left of the board's middle, and the selection bar — which grew a
   * rewrite field and never shrinks — reached 944px, ran off both ends of a narrower
   * window and covered the board list's search box.
   *
   * So the two numbers are published and the five rules read them. Painted rather than rendered,
   * the way `data-zoom` and `data-pan` are: a ResizeObserver touches one element's style, where
   * React state would re-render every child of `App` — and `Item` is memoised precisely so that
   * does not happen. The names carry no `--dag-` prefix on purpose: that prefix is a *theme token*
   * and `check-theme.mjs` reads it literally, so this would demand a key in all three themes for
   * something no theme has an opinion about. `--inspector-w` is the same argument, already made.
   */
  useEffect(() => {
    const el = body.current;
    const canvas = el?.querySelector<HTMLElement>(".dag-viewport");
    if (!el || !canvas) return;
    const paint = () => {
      el.style.setProperty("--canvas-x", `${canvas.offsetLeft}px`);
      el.style.setProperty("--canvas-w", `${canvas.offsetWidth}px`);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    ro.observe(el);
    return () => ro.disconnect();
  }, [snapshot]);

  /* Toolbar actions hand focus back to the board, so the shortcut typed next reaches it rather
     than the button that was just clicked. */
  const focusBoard = () => viewport.current?.focus();
  const onTool = (t: Tool) => (editor.setTool(t), focusBoard());
  const onUndo = () => (editor.undo(), focusBoard());
  const onRedo = () => (editor.redo(), focusBoard());
  const onTidy = () => (void editor.tidy(), focusBoard());
  const onKeep = () => (void editor.saveAsComponent(), focusBoard());
  /* A prompt card is made from the chrome, so there is no pointer position to honour: `editor.add`
     puts its centre in the middle of the view. Not `focusBoard()` after: a fresh prompt card takes
     the caret, and pulling focus back to the board would take it straight off the thing the press
     just made. */
  const onPrompt = () => editor.add("prompt");

  /* The panel is an editor, so the lock takes it with everything else that writes. */
  const editingItem = editing && !snapshot && !locked ? (board?.items.find((it) => it.id === editing) ?? null) : null;

  /*
   * Everything wrong with the board, for the dock at the bottom and the panel beside it.
   *
   * Not on the canvas. The board's own errors used to be a red card hung above the content and a
   * diagram's replaced the diagram, and neither could be put away; a picture of a board is now only
   * the picture. Nothing is computed under `?snapshot=1`, where there is no chrome to show it in —
   * the agent reads the same answer from `/__board/diagnostics`, which asks `diagnoseBoard` too.
   */
  const problems = useMemo(() => (board && !snapshot ? listProblems(board) : []), [board, snapshot]);
  const {
    problems: { show: problemsShow },
    export: { scale: exportScale },
  } = useSettings();
  const editingProblems = useMemo(
    () => (editingItem ? problems.filter((p) => p.item === editingItem.id) : []),
    [problems, editingItem],
  );

  /*
   * "Show me" on a problem that lives on another page.
   *
   * The page has to change first and the panel open second: selecting an item that is not on the
   * page being shown is undone by the effect that keeps `selected` naming things on the paper. So
   * the request waits here until the page it names is the page drawn, and is then handed over.
   */
  const [showing, setShowing] = useState<Problem | null>(null);
  const showProblem = useCallback(
    (p: Problem) => {
      if (!p.item) return;
      if (p.page && p.page !== page) setQuery("page", p.page);
      setShowing(p);
    },
    [page, setQuery],
  );
  const { openAt } = editor;
  useEffect(() => {
    if (!showing || !board) return;
    if (showing.page && showing.page !== page) return;
    const it = board.items.find((x) => x.id === showing.item);
    setShowing(null);
    if (!it) return;
    /* A diagnostic's line is the board file's; the panel counts lines of the body. */
    openAt(it.id, Math.max(1, showing.line - it.line));
  }, [showing, page, board, openAt]);

  const selectedItems = useMemo(() => items.filter((it) => selected.has(it.id)), [items, selected]);

  /*
   * The picked card's box, in board coordinates.
   *
   * `nodeBoxes` is already here — a board link needs it to end on a card rather than on the frame —
   * and it is in the item's own coordinates, so adding the item's placement is the whole
   * conversion. This is what lets the connect and `+` handles be positioned over one card inside a
   * diagram without `Item` (memoised, and deliberately ignorant of layouts) having to know
   * anything: the same argument, and the same place, as the dashed box around a selected group.
   */
  const pickedNode = editor.pickedNode;
  const pickedBox = useMemo(() => {
    if (!pickedNode) return null;
    const place = places.get(pickedNode.item);
    const inner = nodeBoxes.get(pickedNode.item)?.[pickedNode.node];
    if (!place || !inner) return null;
    return { x: place.x + inner.x, y: place.y + inner.y, w: inner.w, h: inner.h };
  }, [pickedNode, places, nodeBoxes]);

  /* Whether the pick *takes over* the item's own handles, which is `growable()`: a picked card
     wears four dots and four plusses in exactly the dialects that have an edge to write, and a
     picked series has none — so a chart keeps the item's, or a picked series would leave the chart
     with no way to be resized or linked without letting go of the pick first. */
  /* The items that are one node and nothing else, so a link naming one lands on the node. */
  const solo = useSolo(items, nodeBoxes);

  const pickedType = pickedNode ? (items.find((it) => it.id === pickedNode.item)?.type ?? "") : "";
  const handedOver = pickedNode !== null && growable(pickedType);

  /* Every group on the page and the items in it — what a link may name. */
  const groups = useGroups(items);

  /* One dashed box per group in the selection, around every member. Derived from the selection,
     which is state, so this is a render rather than a paint — and it is one div per group. */
  const groupBoxes = useMemo(() => {
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const seen = new Set<string>();
    for (const it of selectedItems) {
      if (!it.group || seen.has(it.group)) continue;
      seen.add(it.group);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const m of items) {
        if (m.group !== it.group) continue;
        const p = places.get(m.id);
        if (!p) continue;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + p.w);
        y1 = Math.max(y1, p.y + p.h);
      }
      if (x0 < Infinity) out.push({ id: it.group, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    return out;
  }, [selectedItems, items, places]);

  /*
   * The one group whose handles are up: exactly one group in the selection, and nothing selected
   * that is not in it.
   *
   * `solo` for an item is `selected.size === 1`; the same idea has to be spelled differently here
   * because a group is never one item. A mixed selection gets no handles rather than the group's,
   * since a link drawn from it would silently leave the loose items out — the same refusal
   * `Item` makes by showing nothing while several things are selected.
   */
  const soloGroup = useMemo(() => {
    if (groupBoxes.length !== 1 || pickedNode) return null;
    const only = groupBoxes[0]!.id;
    return selectedItems.every((it) => it.group === only) ? only : null;
  }, [groupBoxes, selectedItems, pickedNode]);

  /*
   * And the group whose box can be pulled to resize it: that same one group, with **every
   * member of it selected** and more than one of them. The connect handles are up for a member picked
   * out of its group too — a link from there still names the group — but a resize there would be
   * two sets of eight squares, the member's and the group's, with nothing to say which is which.
   */
  const resizableGroup = useMemo(() => {
    if (!soloGroup) return null;
    const members = groups.get(soloGroup) ?? [];
    return members.length > 1 && members.every((id) => selected.has(id)) ? soloGroup : null;
  }, [soloGroup, groups, selected]);

  return (
    <div className="dag-app" data-snapshot={snapshot ? "1" : undefined}>
      {!snapshot && (
        <Toolbar
          boardName={boardName}
          title={board?.title}
          kind={boardName ? "board" : undefined}
          onBoards={openBrowser}
          more={
            boardName && board
              ? [
                  /* A one-page board draws no tab strip, so a second page is made from here; once
                     there are two, the strip's own `+` does it. */
                  ...(board.pages.length === 1 && editor.enabled && !locked
                    ? [
                        {
                          key: "add-page",
                          label: "Add a page",
                          icon: FilePlus2,
                          hook: "data-dag-page-add",
                          onSelect: () => editor.pages.add(),
                        },
                      ]
                    : []),
                  ...exportRows(boardExports(exportScale), async (kind) => {
                    await editor.exportAs(kind);
                    focusBoard();
                  }),
                ]
              : []
          }
        >
          <Backlinks id={handle.docId} />
          {boardName && board ? (
            <ExportButton
              what="board"
              options={boardExports(exportScale)}
              onExport={async (kind) => {
                await editor.exportAs(kind);
                focusBoard();
              }}
            />
          ) : null}
        </Toolbar>
      )}
      <div className="dag-body" ref={body}>
        <Viewport
          content={bounds}
          handleRef={viewport}
          /* The zoom figure goes out as an event rather than into state here: as `App` state it
             would re-render every child on every wheel step, which is the cost `data-zoom` was
             painted rather than rendered to avoid. Only `ZoomBar` listens. */
          onZoom={(z) => document.dispatchEvent(new CustomEvent("dag:zoom", { detail: z }))}
          tool={snapshot ? "hand" : locked && editor.tool === "pen" ? "select" : editor.tool}
          onMarquee={snapshot ? undefined : editor.onMarquee}
          onInk={snapshot || locked ? undefined : editor.onInk}
          onPaperClick={snapshot ? undefined : editor.onPaperClick}
          /* A double-click on the paper is how a note begins, so a locked one says why it did not. */
          onPaperDoubleClick={snapshot ? undefined : locked ? () => refuseLocked() : editor.onPaperDoubleClick}
        >
          {error ? (
            <div className="dag-item" style={{ transform: "translate(0px, 0px)", width: 520 }}>
              <ErrorItem title={boardName ?? "board"} messages={[{ line: 0, code: CODES.EB_UNREADABLE, message: error }]} />
            </div>
          ) : null}

          {groupBoxes.map((g) => (
            <div
              key={g.id}
              className="dag-groupbox"
              data-dag-groupbox={g.id}
              style={{ transform: `translate(${g.x - 8}px, ${g.y - 8}px)`, width: g.w + 16, height: g.h + 16 }}
            >
              {/* Handles on the group, the half a person actually presses.
                  An item's own are gated on `solo` — `selected.size === 1` — and `withGroups`
                  guarantees a grouped item is never the sole selection, so before this no member
                  of a group could ever show one: there was no way to start a link from a drawing
                  somebody had just grouped, at all.

                  The box handed to `connect` is the bare union rather than this padded box, so
                  the line starts where the routed link will end up. An item's handles sit 30px
                  outside their box in the same way and for the same reason. */}
              {ctl && !locked && resizableGroup === g.id
                ? GROUP_HANDLES.map((dir) => (
                    <div
                      key={dir}
                      className="dag-handle"
                      data-dag-group-handle={dir}
                      title="Drag to resize everything in the group together"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        ctl.resizeGroup(g.id, e, e.currentTarget.parentElement as HTMLElement, dir);
                      }}
                    />
                  ))
                : null}
              {ctl && !locked && soloGroup === g.id
                ? CONNECT_SIDES.map((side) => (
                    <div
                      key={side}
                      className="dag-connect-handle"
                      data-dag-connect={side}
                      data-dag-group-connect={g.id}
                      title="Drag to link this group to something"
                      onPointerDown={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        ctl.connect(g.id, e, el, side, { group: true, box: { x: g.x, y: g.y, w: g.w, h: g.h } });
                      }}
                    />
                  ))
                : null}
            </div>
          ))}

          {items.map((it) => {
            const place = places.get(it.id);
            if (!place) return null;
            return (
              <Item
                key={it.id}
                item={it}
                place={place}
                boardName={board!.name}
                theme={theme}
                onMeasure={onMeasure}
                ctl={snapshot ? undefined : ctl}
                locked={locked}
                selected={selected.has(it.id)}
                solo={selected.size === 1 && selected.has(it.id)}
                picked={handedOver && pickedNode?.item === it.id}
              />
            );
          })}

          {/* The standing rewrite proposal is marked on the item it would replace. Painted after
              the render, like the pick ring: `Item` is memoised and renders `data-dag-item` alone,
              and a per-item prop would re-render every diagram on the board when an answer lands.
              The effect has no dependency list, for the same reason the pick ring's does not — the
              item carrying the attribute may itself only reach the DOM several renders later, once
              the draft's layout has come back. Styled in chrome.css off `data-dag-proposed`. */}

          {/* The handles on a picked card, and the box you type a new name into. Both live here
              rather than inside `Item` because both need a *layout's* answer — where one card sits
              inside its diagram — and `Item` is memoised and knows nothing about layouts. In the
              layer, so they pan and zoom with the board without arithmetic of their own. */}
          {!snapshot && !locked && pickedNode && pickedBox ? (
            <NodeHandles ctl={ctl} item={pickedNode.item} type={pickedType} node={pickedNode.node} box={pickedBox} />
          ) : null}
          {!snapshot && editor.renaming ? (
            <Rename
              key={`${editor.renaming.item}:${editor.renaming.id}`}
              renaming={editor.renaming}
              toBoard={editor.toBoard}
              onCommit={editor.commitRename}
              onCancel={editor.cancelRename}
            />
          ) : null}

          {/*
           * Above the items, not under them, which is the opposite of how a diagram stacks its own
           * edges. A frame paints an opaque `paper` background, so a link that ends on a card
           * *inside* one was drawn and then covered — it appeared to stop dead at an edge nobody
           * can see. Over the top is safe here in a way it would not be inside a diagram: the board
           * router already has every item as an obstacle, so a link never crosses a card it has no
           * business with, and the only thing it draws over is the empty padding of the frame it
           * was asked to enter.
           */}
          {board && board.links.length > 0 ? (
            <BoardEdges
              links={board.links}
              boxes={places}
              nodeBoxes={nodeBoxes}
              solo={solo}
              groups={groups}
              theme={theme}
              onPick={snapshot ? undefined : editor.pickLink}
              picked={editor.pickedLink}
              onBend={snapshot || locked || !ctl ? undefined : ctl.bendLink}
              onStraighten={snapshot || locked || !ctl ? undefined : ctl.straightenLink}
            />
          ) : null}
        </Viewport>

        {/* Locked, the bar is one item's Export: a count over several things it can do nothing to is noise. */}
        {!snapshot && ((locked ? selectedItems.length === 1 : selectedItems.length >= 1) || barRun.phase !== "idle") ? (
          <SelectionBar
            editor={editor}
            items={selectedItems}
            boardName={board?.name ?? ""}
            run={barRun}
            locked={locked}
            onAsk={onAsk}
            onAccept={onAccept}
            onDiscard={onDiscard}
          />
        ) : null}
        {asking && askFor && !snapshot && !locked ? (
          <RewriteDialog
            subject={board?.items.find((it) => it.id === askFor)?.title}
            text={askText}
            onText={setAskText}
            onSend={onSendAsk}
            onClose={() => setAsking(false)}
          />
        ) : null}
        {/* The chrome that used to be the toolbar. Siblings of the viewport rather than anything
            wrapping it, which is what keeps `.dag-viewport`'s `flex: 1; min-width: 0` contract —
            and what `SelectionBar` above does too. Both are inside `.dag-body`, so the
            page tabs underneath it are cleared without either of them knowing PageBar exists. */}
        {!snapshot && (
          <Dock
            edit={
              /* Every tool on it makes or changes something, so a locked board has no dock; the
                 select and hand tools are still `space V` and `space H`, and the zoom is its own bar. */
              board && !locked
                ? {
                    tool: editor.tool,
                    onTool,
                    canUndo: editor.canUndo,
                    canRedo: editor.canRedo,
                    onUndo,
                    onRedo,
                    library,
                    onLibrary: showLibrary,
                    onPrompt,
                    onLinks: () => {
                      focusBoard();
                      editor.links();
                    },
                    onTidy,
                    onKeep,
                    onHelp: toggleHelp,
                    onImport: (files) => {
                      focusBoard();
                      void editor.importFiles(files);
                    },
                  }
                : undefined
            }
          />
        )}
        {!snapshot && boardName && (
          <ZoomBar
            onZoom={(d) => viewport.current?.zoomBy(d)}
            onFit={() => viewport.current?.fit()}
            onActual={() => viewport.current?.actual()}
          />
        )}
        {!snapshot ? <UploadNotice /> : null}
        {/* Keyed on the board, so what it has already shown somebody starts over with the file. */}
        {!snapshot && board ? (
          <Problems
            key={board.name}
            problems={problems}
            show={problemsShow}
            editing={editing}
            pageName={(id) => (board.pages.length > 1 ? board.pages.find((p) => p.id === id)?.name : undefined)}
            /* "Show" opens the item's source in the panel, which is an editor. */
            onShow={locked ? () => refuseLocked() : showProblem}
          />
        ) : null}
        {help && !snapshot ? <Shortcuts onClose={closeHelp} /> : null}
        {editor.chord && !snapshot ? <WhichKey /> : null}
        {browsing && !snapshot ? (
          <BoardBrowser
            boards={boards}
            notes={notes}
            folders={folders}
            titles={list.titles}
            board={boardName}
            quizzes={list.quizzes}
            files={list.files}
            onOpen={(kind, target) => setQuery(pageQuery(kind, target))}
            onOpenAt={(kind, target, part) => {
              /* The part goes into the hash first, so the page that opens finds it there — and the
                 board already open, which does not reopen, hears it through `dag:target`. */
              setTarget(part ?? null);
              if (kind !== "board" || target !== boardName) setQuery(pageQuery(kind, target));
            }}
            onClose={closeBrowser}
          />
        ) : null}
        {/* A page with nothing on it yet — a new board, or a page just added — and the three
            ways one begins, where the board is. Gone the moment anything lands. */}
        {!snapshot && !locked && boardName && board && items.length === 0 && !library ? (
          <EmptyBoard
            onNote={() => editor.add("md", viewport.current?.center())}
            onLibrary={() => showLibrary(true)}
            onPrompt={onPrompt}
          />
        ) : null}
        {/* Nothing open, so there is nothing to draw on and nothing to photograph: a snapshot of a
            board that is not there is a picture of this card, which is never what was asked for. */}
        {!snapshot && !boardName ? (
          <Welcome
            /* The sidebar's own way to begin a file — made, opened, and named where it is drawn —
               so the welcome card and New board are one gesture rather than two that drift. */
            onCreate={() =>
              locked
                ? refuseLocked()
                : sidebar
                  ? sidebar.create("board")
                  : void createBoard("untitled", blankBoardText()).then((made) => "name" in made && openBoard(made.name))
            }
            onWrite={() =>
              locked
                ? refuseLocked()
                : sidebar
                  ? sidebar.create("note")
                  : void createNote("untitled", blankNoteText()).then((made) => {
                      if ("error" in made) return;
                      /* Named in its own title, as one made from the sidebar is. */
                      nameWhenOpened(made.name);
                      openNote(made.name);
                    })
            }
            onOpen={openBrowser}
          />
        ) : null}
        {/* Never under `?snapshot=1`: a picture of a board is a fact about the board, and this is
            a dialog that would be in it. The same rule the settings card and the dock follow. */}
        {settings.open && !snapshot ? (
          <Settings
            themes={THEME_NAMES}
            themeName={themeName}
            onTheme={chooseTheme}
            boardName={board?.name ?? null}
            list={list}
            tab={settings.open.tab}
            onClose={settings.close}
          />
        ) : null}

        {editingItem && board ? (
          <Inspector
            item={editingItem}
            editor={editor}
            boardName={board.name}
            pages={board.pages}
            boardLinks={board.links}
            problems={editingProblems}
          />
        ) : null}
        {library && board && !snapshot && !locked ? (
          <Library editor={editor} saved={savedComponents} onClose={() => showLibrary(false)} />
        ) : null}
      </div>

      {/* Under the whole body — the board list and the inspector included — the way a spreadsheet
          puts its sheet tabs. Only once there are two: a strip holding one tab says nothing, and a
          one-page board makes its second page from the top bar's `⋯`. */}
      {!snapshot && board && board.pages.length > 1 ? (
        <PageBar
          pages={board.pages}
          page={page}
          onPage={(p) => setQuery("page", p)}
          edit={editor.enabled && !locked ? editor.pages : undefined}
        />
      ) : null}
    </div>
  );
}
