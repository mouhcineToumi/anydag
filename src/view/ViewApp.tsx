import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { concerns, onNote, onQuiz } from "@/board/events";
import type { Board } from "@/board/types";
import { assertNever, useBoard, type FileKind } from "@/board/useBoard";
import type { ViewportHandle } from "@/canvas/Viewport";
import { splitNote } from "@/note/format";
import { projectOf } from "@/note/project";
import { eventOf } from "@/note/event";
import { taskOf } from "@/note/task";
import { NoteTitleRead } from "@/ui/NoteTitle";
import { drawnSettled } from "@/render/settled";
import { parseQuiz, askable } from "@/quiz/parse";
import { Runner, Sheet } from "@/ui/quiz/Runner";
import { ProjectLine } from "@/ui/ProjectBar";
import { EventLine } from "@/ui/EventBar";
import { TaskLine } from "@/ui/TaskGlyph";
import { useTheme } from "@/theme/useTheme";
import { Lockup } from "@/ui/Logo";
import { PageBar } from "@/ui/PageBar";
import { ZoomBar } from "@/ui/ZoomBar";

import { Backlinks } from "@/refs/Backlinks";
import { refComponents } from "@/refs/Ref";
import { useIndex } from "@/refs/useIndex";
import { withVault } from "@/vault/current";
import { FileView } from "@/files/FileView";
import { fileUrl } from "@/files/upload";
import { useFiles } from "@/files/useFiles";

import { BoardView } from "./BoardView";
import { NoteMarkdown } from "./NoteRead";
import { usePublishDrawn } from "./drawn";
import { TableFrame } from "./TableRead";
import { useTableText } from "./tableText";

/**
 * `?view=1` — a board or a note, read-only, with **no editor loaded**.
 *
 * What read-only viewing draws with. `Gate` mounts this instead of
 * `App` whenever the query asks for a view, and `App` is a lazy chunk — so `useEditor`, the
 * inspector, the library and BlockNote are never fetched, not merely never mounted.
 * `test/view-graph.test.ts` holds that to the import graph.
 *
 * What to open is `?board=`, `?note=`, `?quiz=`, `?table=`, or `?ref=<id>` — a permanent id, which is
 * the form a reference carries, because a name changes when a person renames it.
 */
export function ViewApp() {
  const query = new URLSearchParams(location.search);
  const ref = query.get("ref");
  const [target, setTarget] = useState<{ kind: FileKind; name: string } | null | "missing">(() => {
    if (ref) return null;
    const table = query.get("table");
    const quiz = query.get("quiz");
    const file = query.get("file");
    const note = query.get("note");
    const board = query.get("board");
    if (file) return { kind: "file", name: file };
    return table
      ? { kind: "table", name: table }
      : quiz
        ? { kind: "quiz", name: quiz }
        : note
          ? { kind: "note", name: note }
          : board
            ? { kind: "board", name: board }
            : "missing";
  });

  useEffect(() => {
    if (!ref) return;
    let live = true;
    void fetch(`/__board/resolve?id=${encodeURIComponent(ref)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { name: string; kind: FileKind }) : null))
      .catch(() => null)
      .then((got) => live && setTarget(got ? { kind: got.kind, name: got.name } : "missing"));
    return () => {
      live = false;
    };
  }, [ref]);

  if (target === null) return <div className="dag-app dag-app--view" />;
  if (target === "missing") return <Missing what={ref ? `nothing has the id \`${ref}\`` : "nothing was named to view"} />;
  switch (target.kind) {
    case "note":
      return <NotePage name={target.name} />;
    case "quiz":
      return <QuizPage name={target.name} />;
    case "board":
      return <BoardPage name={target.name} />;
    case "table":
      return <TablePage name={target.name} />;
    case "file":
      return <FilePage name={target.name} />;
    default:
      return assertNever(target.kind);
  }
}

/**
 * The slim bar across the top: the mark, what is open, and what may be done about it — the
 * backlinks and the way into the editor.
 */
export function Bar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="dag-toolbar dag-view-bar">
      <Lockup size={20} className="dag-toolbar__logo" />
      <span className="dag-toolbar__title dag-view-bar__title" data-dag-view-title="">
        {title}
      </span>
      {children}
    </header>
  );
}

/** What the bar ends with: what links here, and the way back into the editor. */
function OwnerEnd({ id, edit }: { id?: string | null; edit: string }) {
  return (
    <>
      <Backlinks id={id} />
      <a className="dag-view-bar__edit" href={edit} data-dag-view-edit="">
        Open in the editor
      </a>
    </>
  );
}

function Missing({ what }: { what: string }) {
  useTheme(undefined, undefined, true);
  return (
    <div className="dag-app dag-app--view" data-dag-view="missing">
      <p className="dag-view-missing">Nothing to show: {what}.</p>
    </div>
  );
}

function BoardPage({ name }: { name: string }) {
  const { board, error, docId } = useBoard(name);
  if (error) return <Missing what={error} />;
  return (
    <BoardFrame
      board={board}
      bar={
        <Bar title={board?.title ?? name}>
          <OwnerEnd id={docId} edit={withVault(`?board=${encodeURIComponent(name)}`)} />
        </Bar>
      }
    />
  );
}

/**
 * A board drawn read-only, with its bar, its zoom and its pages. It reads through `useBoard`, the
 * same fetch the editor's page makes.
 */
export function BoardFrame({ board, bar }: { board: Board | null; bar: ReactNode }) {
  const query = new URLSearchParams(location.search);
  const [page, setPage] = useState<string | null>(query.get("page"));
  const { theme } = useTheme(query.get("theme") ?? undefined, board?.theme, query.get("snapshot") === "1");
  const viewport = useRef<ViewportHandle>(null);

  const shown = page && board?.pages.some((p) => p.id === page) ? page : board?.pages[0]?.id ?? "page-1";
  return (
    <div className="dag-app dag-app--view" data-dag-view="board">
      {bar}
      <div className="dag-body">
        {board ? (
          <BoardView
            board={board}
            page={shown}
            theme={theme}
            publish
            handleRef={viewport}
            onZoom={(z) => document.dispatchEvent(new CustomEvent("dag:zoom", { detail: z }))}
          />
        ) : null}
        <ZoomBar
          onZoom={(d) => viewport.current?.zoomBy(d)}
          onFit={() => viewport.current?.fit()}
          onActual={() => viewport.current?.actual()}
        />
      </div>
      {board && board.pages.length > 1 ? <PageBar pages={board.pages} page={shown} onPage={setPage} /> : null}
    </div>
  );
}

function NotePage({ name }: { name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useIndex().docs.find((d) => d.kind === "note" && d.name === name)?.id;

  /* Read now and again whenever the note changes — somebody writing it in the editor, an agent
     writing the file — because a view that goes stale is a view nobody can trust. A board's view
     gets this from `useBoard`; a note's page has no hook of its own to borrow it from. */
  useEffect(() => {
    let live = true;
    const read = () =>
      void fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=note`)
        .then(async (r) => {
          const data = (await r.json()) as { text?: string; error?: string };
          if (!live) return;
          if (r.ok) setText(data.text ?? "");
          else setError(data.error ?? `could not load \`${name}\``);
        })
        .catch((e: Error) => live && setError(e.message));
    read();
    const off = onNote((change) => {
      if (!concerns(change, name)) return;
      if (change.sha1 === null) setError(`\`${name}\` was deleted`);
      else read();
    });
    return () => {
      live = false;
      off();
    };
  }, [name]);

  if (error) return <Missing what={error} />;
  const title = text === null ? name : splitNote(text).title ?? name;
  return (
    <NoteFrame
      name={name}
      text={text}
      bar={
        <Bar title={title}>
          <OwnerEnd id={id} edit={withVault(`?note=${encodeURIComponent(name)}`)} />
        </Bar>
      }
    />
  );
}

/**
 * A note drawn read-only, with its bar, as `BoardFrame` is for a board. `text` is
 * `null` until it has arrived. `name` is what its images are relative to.
 */
export function NoteFrame({ name, text, bar }: { name: string; text: string | null; bar: ReactNode }) {
  const query = new URLSearchParams(location.search);
  useTheme(query.get("theme") ?? undefined, undefined, query.get("snapshot") === "1");

  /* The same signal a board raises when it is drawn, so a snapshot of a view waits on one thing. */
  useEffect(() => {
    if (text === null) return;
    /* A reference to a block names it after the `#`; the browser looked for it before the note had
       arrived, so it is looked for again now that it has. */
    const at = decodeURIComponent(location.hash.slice(1));
    if (at) document.getElementById(at)?.scrollIntoView({ block: "start" });
    /* Drawn means its equations too. */
    let live = true;
    void drawnSettled().then(() => {
      if (live) document.documentElement.dataset.dagReady = "1";
    });
    return () => {
      live = false;
      delete document.documentElement.dataset.dagReady;
    };
  }, [text]);

  const note = text === null ? null : splitNote(text);
  /* A task's status and date above its text, read-only. */
  const task = text === null ? undefined : taskOf(text);
  /* And a project's status, the same way. */
  const project = text === null ? undefined : projectOf(text);
  /* And when an event is, in the reader's own zone. */
  const event = text === null ? undefined : eventOf(text);
  return (
    <div className="dag-app dag-app--note dag-app--view" data-dag-view="note">
      {bar}
      <main className="dag-note-view" data-dag-note-view={name}>
        {/* The title at the top of the page, where the editor has its field. */}
        {note ? <NoteTitleRead title={note.title} /> : null}
        {note && project ? <ProjectLine project={project} /> : null}
        {note && task ? <TaskLine task={task} /> : null}
        {note && event ? <EventLine event={event} /> : null}
        {note ? <NoteMarkdown name={name} body={note.body} components={refComponents()} /> : null}
      </main>
    </div>
  );
}

/** The read-only attachment: what `/__board/files` says it is, drawn by `FileFrame`. */
function FilePage({ name }: { name: string }) {
  const files = useFiles();
  const found = files.files.find((f) => f.name === name);
  if (files.loaded && !found) return <Missing what={`there is no file \`${name}\``} />;
  const title = found?.title ?? name.slice(name.lastIndexOf("/") + 1);
  return (
    <FileFrame
      name={name}
      title={title}
      bytes={found?.bytes}
      url={found ? fileUrl({ name }) : null}
      download={fileUrl({ name }, true)}
      bar={
        <Bar title={title}>
          <OwnerEnd id={found?.id} edit={withVault(`?file=${encodeURIComponent(name)}`)} />
        </Bar>
      }
    />
  );
}

/** The read-only table: the text from the page's one cache, kept current off the feed, drawn by `TableFrame`. */
function TablePage({ name }: { name: string }) {
  const text = useTableText(name);
  const id = useIndex().docs.find((d) => d.kind === "table" && d.name === name)?.id;
  if (text === null) return <Missing what={`no table \`${name}\``} />;
  const title = text === undefined ? name : splitNote(text).title ?? name;
  return (
    <TableFrame
      name={name}
      text={text ?? null}
      bar={
        <Bar title={title}>
          <OwnerEnd id={id} edit={withVault(`?table=${encodeURIComponent(name)}`)} />
        </Bar>
      }
    />
  );
}

/**
 * An attachment drawn read-only, as `NoteFrame` is for a note. `url`
 * is `null` until the file is known to be there: a picture pointed at a name that is not is a 404 on
 * the console.
 */
export function FileFrame({
  name,
  title,
  bytes,
  url,
  download,
  bar,
}: {
  name: string;
  title: string;
  bytes?: number | null;
  url: string | null;
  download: string;
  bar: ReactNode;
}) {
  const query = new URLSearchParams(location.search);
  useTheme(query.get("theme") ?? undefined, undefined, query.get("snapshot") === "1");
  return (
    <div className="dag-app dag-app--file dag-app--view" data-dag-view="file">
      {bar}
      {url ? <FileView name={name} title={title} bytes={bytes} url={url} download={download} /> : null}
    </div>
  );
}

/** The read-only quiz: the text, kept current off the feed, drawn by `QuizFrame`. */
function QuizPage({ name }: { name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useIndex().docs.find((d) => d.kind === "quiz" && d.name === name)?.id;
  useEffect(() => {
    let live = true;
    const read = () =>
      void fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=quiz`)
        .then(async (r) => {
          const data = (await r.json()) as { text?: string; error?: string };
          if (!live) return;
          if (r.ok) setText(data.text ?? "");
          else setError(data.error ?? `could not load \`${name}\``);
        })
        .catch((e: Error) => live && setError(e.message));
    read();
    const off = onQuiz((change) => {
      if (!concerns(change, name)) return;
      if (change.sha1 === null) setError(`\`${name}\` was deleted`);
      else read();
    });
    return () => {
      live = false;
      off();
    };
  }, [name]);

  if (error) return <Missing what={error} />;
  const title = text === null ? name : splitNote(text).title ?? name;
  return (
    <QuizFrame
      name={name}
      text={text}
      bar={
        <Bar title={title}>
          <OwnerEnd id={id} edit={withVault(`?quiz=${encodeURIComponent(name)}`)} />
        </Bar>
      }
    />
  );
}

/**
 * A quiz drawn read-only, as `NoteFrame` is for a note.
 *
 * **Read-only is taking it, with nothing recorded.** On `?view=1` the quiz is a
 * run with no `record`, so whoever is looking can answer every question and see how they did,
 * and nothing is kept — there is no practice record for a read-only view, and a person's
 * Mistakes are theirs.
 * Under `?snapshot=1` it is the sheet, every question with its answers showing: a picture of a quiz
 * is a fact about the file, and a run frozen on its first question is a picture of nothing.
 */
export function QuizFrame({ name, text, bar }: { name: string; text: string | null; bar: ReactNode }) {
  const query = new URLSearchParams(location.search);
  const snapshot = query.get("snapshot") === "1";
  useTheme(query.get("theme") ?? undefined, undefined, snapshot);

  /* Ready once drawn: its equations and the boards embedded in it. */
  const root = useRef<HTMLDivElement>(null);
  usePublishDrawn(root, text, { enabled: text !== null });

  const quiz = useMemo(() => (text === null ? null : parseQuiz(text)), [text]);
  const title = text === null ? name : splitNote(text).title ?? name;
  const questions = useMemo(
    () =>
      quiz
        ? quiz.questions.filter(askable).map((question) => ({ quiz: { name, title, description: quiz.description, shuffle: quiz.shuffle }, question }))
        : [],
    [quiz, name, title],
  );
  return (
    <div className="dag-app dag-app--quiz dag-app--view" data-dag-view="quiz" ref={root}>
      {bar}
      {quiz === null ? null : snapshot ? (
        <div className="dag-quiz-page">
          <Sheet name={name} title={title} description={quiz.description} questions={quiz.questions} />
        </div>
      ) : (
        <Runner questions={questions} title={title} empty="This quiz has no question that can be asked yet." />
      )}
    </div>
  );
}
