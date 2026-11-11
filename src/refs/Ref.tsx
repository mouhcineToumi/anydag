/**
 * A reference, drawn.
 *
 * Two shapes, both read out of Markdown by `react-markdown` wherever this app draws Markdown
 * read-only: a `[Title](dag:<id>)` link, which shows the target's **live** title and goes to it, and
 * an `![Title](dag:<id>)` embed, which draws the target itself — a board, through the read-only
 * renderer, or a note, as a card. **On a board it draws none of that**: every document
 * placed there is `PlacedCard`, one fixed size, its name and a button that opens it.
 *
 * Nothing here knows a name. A reference holds an id, the index says what that id is called now,
 * and following one goes to `?ref=<id>`, which the page resolves — so renaming or moving a target
 * breaks nothing and changes the title everywhere at once.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { defaultUrlTransform, type Components } from "react-markdown";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  Download,
  File as FileGlyph,
  FileQuestion,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Play,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { assertNever, setTask, useBoard, type FileKind } from "@/board/useBoard";
import { useLocked } from "@/settings/lock";
import { whenWords } from "@/calendar/model";
import type { NoteEvent } from "@/note/event";
import { splitNote } from "@/note/format";
import { PROJECT_LABEL, type Project } from "@/note/project";
import { STATUS_LABEL, type Task, type TaskStatus } from "@/note/task";
import { CodePre, MathCode } from "@/render/CodeBlock";
import { useTheme } from "@/theme/useTheme";
import { BoardView } from "@/view/BoardView";
import { NoteMarkdown } from "@/view/NoteRead";
import { FileIcon } from "@/files/FileIcon";
import { FilePreview } from "@/files/Preview";
import { downloadName, fileWhat, isPicture, previewOf } from "@/files/types";
import { fileUrl } from "@/files/upload";
import { TableCard } from "@/view/TableRead";
import { useTableText } from "@/view/tableText";
import { ProjectGlyph } from "@/ui/ProjectBar";
import { DueLabel, StatusButton, TaskGlyph } from "@/ui/TaskGlyph";
import { usePractice } from "@/ui/quiz/practice";
import { withVault } from "@/vault/current";

import { parseDagUrl } from "./extract";
import { RefLink, WikiLink } from "./RefLink";
import { follow } from "./follow";
import { parseWikiUrl, resolveWiki, wikiLabel, wikilinksIn } from "./wikilinks";
import { hrefFor, titleOf, useIndex } from "./useIndex";

/** Whether the image being drawn is a paragraph of its own — the only place a block may go. */
const OnItsOwn = createContext(false);

/** What each kind of document wears on a card. A `Record`, so a sixth kind is a type error here. */
const DOC_ICON = { board: LayoutDashboard, note: FileText, quiz: GraduationCap, table: Table2, file: FileGlyph } satisfies Record<
  FileKind,
  LucideIcon
>;

/** A card standing for a document that is not drawn inline — a board inside a board, or one too deep. */
function RefCard({ id, fallback }: { id: string; fallback: string }) {
  const doc = useIndex().byId.get(id);
  const Icon = DOC_ICON[doc?.kind ?? "board"];
  return (
    <a className="dag-embed dag-embed--card" href={hrefFor(id)} data-dag-embed={id}>
      {doc?.task ? (
        <TaskGlyph status={doc.task.status} />
      ) : doc?.kind === "file" ? (
        <FileIcon name={doc.name} size={14} strokeWidth={2} />
      ) : (
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
      )}
      <span>{doc ? titleOf(doc) : fallback || "A missing document"}</span>
    </a>
  );
}

/** A board, drawn read-only in a box, pannable and zoomable — a plain wheel still scrolls the page. */
function EmbeddedBoard({ id, name }: { id: string; name: string }) {
  const { board, error } = useBoard(name);
  const query = new URLSearchParams(location.search);
  const { theme } = useTheme(query.get("theme") ?? undefined, query.get("snapshot") === "1");
  /* `data-dag-embed-ready` once every item has its size — or once there is nothing more coming,
     which a board that would not load is. A note printed to PDF waits on it: a board
     drawn half-way is a PDF of empty frames. */
  const [drawn, setDrawn] = useState(false);
  return (
    <div
      className="dag-embed dag-embed--board"
      data-dag-embed={id}
      data-dag-embed-kind="board"
      data-dag-embed-ready={drawn || error ? "" : undefined}
    >
      <a className="dag-embed__title" href={hrefFor(id)}>
        <LayoutDashboard size={14} strokeWidth={2} aria-hidden="true" />
        {board?.title ?? name.slice(name.lastIndexOf("/") + 1)}
      </a>
      <div className="dag-embed__canvas">
        {board ? <BoardView board={board} theme={theme} scrollThrough onReady={setDrawn} /> : null}
      </div>
    </div>
  );
}

/** A note, drawn read-only as a card. Its own embeds stop here as cards: a note holding itself would never finish. */
function EmbeddedNote({ id, name }: { id: string; name: string }) {
  /* `undefined` while it is being asked for, `null` when the answer was that there is nothing. */
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=note`)
      .then(async (r) => (r.ok ? ((await r.json()) as { text: string }).text : null))
      .catch(() => null)
      .then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [name]);
  const note = text == null ? null : splitNote(text);
  return (
    <div
      className="dag-embed dag-embed--note"
      data-dag-embed={id}
      data-dag-embed-kind="note"
      data-dag-embed-ready={text === undefined ? undefined : ""}
    >
      <a className="dag-embed__title" href={hrefFor(id)}>
        <FileText size={14} strokeWidth={2} aria-hidden="true" />
        {note?.title ?? name.slice(name.lastIndexOf("/") + 1)}
      </a>
      {note ? <NoteMarkdown name={name} body={note.body} components={refComponents({ depth: 1, boards: false })} /> : null}
    </div>
  );
}

/**
 * A task, embedded — on a board as the `md` card the library or a sidebar row places, or in a note
 *. Its title, its status as a button and its due date: the
 * button changes the file itself, so ticking a task off on a board ticks it off everywhere.
 *
 * The new status shows at once and is replaced by what the server wrote; the index is a wait behind
 * the change feed, so without that the card would sit on the old status for the better part of a
 * second after it was pressed. `live` is false wherever nothing may change the file — `?view=1`, a
 * snapshot — where the button is drawn as the glyph it would have been.
 */
function TaskCard({
  id,
  name,
  title,
  task,
  href,
  live: may,
}: {
  id: string;
  name: string;
  title: string;
  task: Task;
  href: string;
  live: boolean;
}) {
  const [shown, onStatus] = useLiveTask(name, task);
  /* The lock is a hook rather than part of `live`, which is read once: a card on a board is
     inside a memoised item, and a hook is what reaches it when the lock is switched. */
  const live = may && !useLocked();
  return (
    <div
      className="dag-embed dag-embed--task"
      data-dag-embed={id}
      data-dag-embed-kind="task"
      data-dag-embed-task={shown.status}
      data-dag-embed-ready=""
    >
      <StatusButton status={shown.status} onStatus={live ? (next) => void onStatus(next) : undefined} size={16} />
      <div className="dag-embed__task">
        <a className="dag-embed__title" href={href}>
          {title}
        </a>
        <span className="dag-embed__task-meta">
          {STATUS_LABEL[shown.status]}
          {shown.due ? (
            <>
              <span aria-hidden="true"> · </span>
              <DueLabel task={shown} />
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/**
 * A task's status as a card shows it: the new one at once when its button is pressed, then what the
 * server wrote, and whatever the index says when it says something new — another writer, or this
 * card's own write arriving. `undefined` in, `undefined` out, for a card that is not a task's.
 */
function useLiveTask<T extends Task | undefined>(name: string, task: T): [T, (next: TaskStatus) => void] {
  const [shown, setShown] = useState<T>(task);
  useEffect(() => setShown(task), [task?.status, task?.due]);
  const onStatus = (next: TaskStatus) => {
    const was = shown;
    if (!was) return;
    setShown({ ...was, status: next });
    void setTask(name, { status: next }).then((got) => {
      if (got === undefined) setShown(was);
      else if (got) setShown(got as T);
    });
  };
  return [shown, onStatus];
}

/**
 * A note, a task or a board placed on a board. **One size, whatever it holds**: the kind's
 * mark, the title on one line, a line under it saying what it is, and a button that opens it. The
 * whole of a long note drawn onto the canvas was the problem this fixed — a card that grew with
 * its text, pushed the board around, and was a page of prose nobody placed there to read — and a
 * card that is only its name is what the sidebar row that placed it already was.
 *
 * The title is not a link, as it is everywhere else a reference is drawn: on the canvas a press on
 * a card is how the item is selected and moved, and a press that ends where it began is a click —
 * so a linked title would leave the board whenever somebody only meant to pick the card up. The open
 * button is the one way out, and it stops the press before the item sees it, as a task's status
 * button does, so leaving does not select anything on the way. It is a real link, so a
 * modifier-click opens it in a tab of its own.
 *
 * A quiz is not one of these: its own card (`QuizCard`) is already one line and carries
 * Practice, which is the thing a quiz on a board is there for.
 */
function PlacedCard({
  id,
  kind,
  name,
  title,
  task,
  project,
  event,
  href,
  live: may,
}: {
  id: string;
  kind: "board" | "note";
  name: string;
  title: string;
  task?: Task;
  /** A project's note says it is one, and its status, where a note says *Note*. */
  project?: Project;
  /** An event's says *Event* and when, in the reader's zone. */
  event?: NoteEvent;
  href: string;
  live: boolean;
}) {
  const [shown, onStatus] = useLiveTask(name, task);
  /* TaskCard's rule: the lock is heard through a hook, past the memo of the item this card is in. */
  const live = may && !useLocked();
  const what = project ? "project" : shown ? "task" : event ? "event" : kind;
  const Icon = kind === "note" ? FileText : LayoutDashboard;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div
      className="dag-embed dag-embed--placed"
      data-dag-embed={id}
      data-dag-embed-kind={what}
      data-dag-embed-placed=""
      data-dag-embed-task={shown?.status}
      data-dag-embed-ready=""
    >
      <span className="dag-embed__mark">
        {project ? (
          <ProjectGlyph project={project} size={16} />
        ) : shown ? (
          <StatusButton status={shown.status} onStatus={live ? onStatus : undefined} size={16} />
        ) : event ? (
          <CalendarClock size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </span>
      <span className="dag-embed__text">
        <span className="dag-embed__name" title={title}>
          {title}
        </span>
        <span className="dag-embed__what">
          {project ? (
            `Project · ${PROJECT_LABEL[project.status]}`
          ) : shown ? (
            <>
              {STATUS_LABEL[shown.status]}
              {shown.due ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <DueLabel task={shown} />
                </>
              ) : null}
            </>
          ) : event ? (
            `Event · ${whenWords(event)}`
          ) : kind === "note" ? (
            "Note"
          ) : (
            "Board"
          )}
        </span>
      </span>
      <a
        className="dag-embed__open"
        href={href}
        data-dag-embed-open=""
        aria-label={`Open ${title}`}
        title={`Open this ${what}`}
        onPointerDown={stop}
        onDoubleClick={stop}
      >
        <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
      </a>
    </div>
  );
}

/**
 * A quiz, embedded — on a board as the card a sidebar row or the library places, or in a note.
 * Its title, how many questions it asks, how many of them are in the person's
 * Mistakes, and **Practice**, which opens its run.
 *
 * `live` is false wherever there is no person to practise as — `?view=1`, a snapshot —
 * where the count is left out and Practice opens what the link opens, which is the run with nothing
 * recorded. The count is the page's one copy of Mistakes (`usePractice`), so ten cards on a board are
 * one request, and nothing else on the canvas re-renders when an answer lands.
 */
function QuizCard({
  id,
  title,
  questions,
  href,
  practice,
  live,
}: {
  id: string;
  title: string;
  questions?: number | null;
  href: string;
  practice: string;
  live: boolean;
}) {
  const mistakes = usePractice(live)?.counts[id] ?? 0;
  return (
    <div className="dag-embed dag-embed--quiz" data-dag-embed={id} data-dag-embed-kind="quiz" data-dag-embed-ready="">
      <GraduationCap size={16} strokeWidth={2} aria-hidden="true" className="dag-embed__quiz-mark" />
      <div className="dag-embed__quiz">
        <a className="dag-embed__title" href={href}>
          {title}
        </a>
        <span className="dag-embed__quiz-meta">
          {typeof questions === "number" ? `${questions} ${questions === 1 ? "question" : "questions"}` : "Quiz"}
          {live && mistakes ? <span className="dag-embed__quiz-mistakes"> · {mistakes} in Mistakes</span> : null}
        </span>
      </div>
      <a className="dag-embed__quiz-practice" href={practice} data-dag-embed-practice="">
        <Play size={12} strokeWidth={2} aria-hidden="true" />
        {live ? "Practice" : "Take the quiz"}
      </a>
    </div>
  );
}

/** A table the editor's page draws — a card on a board or an embed in a note — read through the one cache. */
function OwnTableCard({ id, name, title, part, rows }: { id: string; name: string; title: string; part?: string; rows: number }) {
  const text = useTableText(name);
  return (
    <TableCard
      id={id}
      title={title}
      text={text}
      tab={part ? part.split("/")[0] : undefined}
      href={hrefFor(id, part)}
      rows={rows}
    />
  );
}

/**
 * The same card for a target the index has not named yet, or never will: the words the author wrote
 * and nothing to open. One height with the card it stands in for, so a board does not move under it
 * when the index answers — and a card whose document was deleted says so rather than going blank.
 */
function PlacedMissing({ id, fallback, gone }: { id: string; fallback: string; gone: boolean }) {
  return (
    <div
      className="dag-embed dag-embed--placed"
      data-dag-embed={id}
      data-dag-embed-placed=""
      data-dag-embed-missing={gone ? "" : undefined}
      data-dag-embed-ready={gone ? "" : undefined}
    >
      <span className="dag-embed__mark">
        <FileQuestion size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="dag-embed__text">
        <span className="dag-embed__name">{fallback || "A document"}</span>
        <span className="dag-embed__what">{gone ? "Nothing has this id any more" : "\u00a0"}</span>
      </span>
    </div>
  );
}

/**
 * An attachment, embedded — in a note, or on a board as the `md` card a drop or a sidebar
 * row places. **A picture is drawn**, in a note and on a board alike: that is what somebody putting
 * a picture there meant. **Anything else is a card** — its type's mark, its title, what it is and
 * how big — with a download, a way to its own page when there is one, and, in a note, **Preview**,
 * which opens the file right there: a PDF's pages, a recording's player, a text's words. On a board
 * it is the one fixed-size card every placed document is, so a board does not grow a PDF
 * viewer in the middle of a diagram; its open button is the preview.
 *
 * `url` and `download` are the caller's to say where the bytes are; `open` is absent for a file
 * with no page of its own to open.
 */
function FileEmbed({
  id,
  name,
  title,
  bytes,
  url,
  download,
  open,
  placed,
}: {
  id: string;
  name: string;
  title: string;
  bytes?: number | null;
  url: string;
  download: string;
  open?: string;
  placed: boolean;
}) {
  const [drawn, setDrawn] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  if (isPicture(name))
    return (
      <figure
        className="dag-embed dag-embed--picture"
        data-dag-embed={id}
        data-dag-embed-kind="file"
        data-dag-embed-ready={drawn ? "" : undefined}
      >
        <img src={url} alt={title} data-dag-embed-picture="" onLoad={() => setDrawn(true)} onError={() => setDrawn(true)} />
      </figure>
    );
  const canPreview = !placed && previewOf(name) !== null;
  return (
    <div
      className={placed ? "dag-embed dag-embed--placed dag-embed--file" : "dag-embed dag-embed--file"}
      data-dag-embed={id}
      data-dag-embed-kind="file"
      data-dag-embed-placed={placed ? "" : undefined}
      data-dag-embed-ready=""
    >
      <div className="dag-embed__filerow">
        <span className="dag-embed__mark">
          <FileIcon name={name} size={16} strokeWidth={2} />
        </span>
        <span className="dag-embed__text">
          <span className="dag-embed__name" title={title}>
            {title}
          </span>
          <span className="dag-embed__what">{fileWhat(name, bytes)}</span>
        </span>
        {canPreview ? (
          <button
            type="button"
            className="dag-embed__open"
            data-dag-embed-preview=""
            aria-expanded={previewing}
            aria-label={previewing ? `Close the preview of ${title}` : `Preview ${title}`}
            title={previewing ? "Close the preview" : "Preview"}
            onPointerDown={stop}
            onClick={() => setPreviewing((v) => !v)}
          >
            <ChevronDown
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              className={previewing ? "dag-embed__chev--open" : undefined}
            />
          </button>
        ) : null}
        <a
          className="dag-embed__open"
          href={download}
          download={downloadName(name, title)}
          data-dag-embed-download=""
          aria-label={`Download ${title}`}
          title="Download"
          onPointerDown={stop}
          onDoubleClick={stop}
        >
          <Download size={16} strokeWidth={2} aria-hidden="true" />
        </a>
        {open ? (
          <a
            className="dag-embed__open"
            href={open}
            data-dag-embed-open=""
            aria-label={`Open ${title}`}
            title="Open this file"
            onPointerDown={stop}
            onDoubleClick={stop}
          >
            <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {previewing ? (
        <div className="dag-embed__preview" data-dag-embed-previewing="">
          <FilePreview name={name} title={title} bytes={bytes} url={url} download={download} />
        </div>
      ) : null}
    </div>
  );
}

/** Where a quiz's own run is, for the person who owns it. */
const runHref = (name: string): string => withVault(`/?quiz=${encodeURIComponent(name)}&run=1`);

/** Whether this page may change a file from inside an embed: not the read-only view, and not a picture. */
function mayWrite(): boolean {
  const q = new URLSearchParams(location.search);
  return q.get("view") !== "1" && q.get("snapshot") !== "1";
}

interface EmbedProps {
  id: string;
  /** What the embed names after its `#`: a tab of a table, or an item or a block. */
  part?: string;
  fallback: string;
  depth: number;
  boards: boolean;
  /** On a board: every document is the one fixed-size card that opens it, never its text. */
  placed?: boolean;
}

/** An `![…](dag:…)`: the target drawn, or a card where drawing it is not allowed. */
function RefEmbed({ id, part, fallback, depth, boards, placed }: EmbedProps) {
  const index = useIndex();
  const doc = index.byId.get(id);
  /* In the middle of a line an embed is a card: a drawing is a block, and a paragraph cannot hold one. */
  const own = useContext(OnItsOwn);
  if (!doc && placed && own && depth === 0) return <PlacedMissing id={id} fallback={fallback} gone={index.loaded} />;
  if (!doc || depth > 0 || !own) return <RefCard id={id} fallback={fallback} />;
  switch (doc.kind) {
    case "file":
      return (
        <FileEmbed
          id={id}
          name={doc.name}
          title={titleOf(doc)}
          bytes={doc.bytes}
          url={fileUrl({ id })}
          download={fileUrl({ id }, true)}
          open={hrefFor(id)}
          placed={placed ?? false}
        />
      );
    case "note":
      /* On a board, the card that names it and opens it — a task's with its status. */
      if (placed)
        return (
          <PlacedCard
            id={id}
            kind="note"
            name={doc.name}
            title={titleOf(doc)}
            task={doc.task ?? undefined}
            project={doc.project ?? undefined}
            event={doc.event ?? undefined}
            href={hrefFor(id)}
            live={mayWrite()}
          />
        );
      if (doc.task)
        return <TaskCard id={id} name={doc.name} title={titleOf(doc)} task={doc.task} href={hrefFor(id)} live={mayWrite()} />;
      return <EmbeddedNote id={id} name={doc.name} />;
    case "quiz": {
      const live = mayWrite();
      return (
        <QuizCard
          id={id}
          title={titleOf(doc)}
          questions={doc.questions}
          href={hrefFor(id)}
          practice={live ? runHref(doc.name) : withVault(`/?quiz=${encodeURIComponent(doc.name)}&view=1`)}
          live={live}
        />
      );
    }
    case "board":
      if (placed) return <PlacedCard id={id} kind="board" name={doc.name} title={titleOf(doc)} href={hrefFor(id)} live={false} />;
      return boards ? <EmbeddedBoard id={id} name={doc.name} /> : <RefCard id={id} fallback={fallback} />;
    case "table":
      /* A live view of its data: a board's card shows a handful of rows, a note's more. */
      return <OwnTableCard id={id} name={doc.name} title={titleOf(doc)} part={part} rows={placed ? 10 : 20} />;
    default:
      return assertNever(doc.kind);
  }
}

/**
 * `react-markdown`'s URL filter, letting `dag:` through. Its default empties any protocol it does not
 * know — safely, since `javascript:` is one — and so turned every reference into a link to nowhere
 * and every embed into a broken image. `dag:` is ours and names an id, never code.
 */
export const urlTransform = (url: string): string => (parseDagUrl(url) || parseWikiUrl(url) ? url : defaultUrlTransform(url));

/** `![[…]]`: what it names, resolved by name now, and drawn as `![…](dag:…)` would be. */
function WikiEmbed({ target, part, fallback, depth, boards, placed }: Omit<EmbedProps, "id"> & { target: string }) {
  const index = useIndex();
  const doc = resolveWiki(target, index.docs);
  if (!doc) {
    return (
      <span className="dag-embed dag-embed--card dag-embed--missing" data-dag-wiki-target={target}>
        {index.loaded ? `Nothing in this vault is called ${target}` : fallback}
      </span>
    );
  }
  return <RefEmbed id={doc.id} part={part} fallback={fallback} depth={depth} boards={boards} placed={placed} />;
}

/**
 * The `a` and `img` a `react-markdown` needs to draw references, and its `pre`, a code block, and
 * its `code`, which is where an inline equation arrives.
 * `boards` says whether a board may be drawn inline: in a note yes, on a board no — a viewport inside
 * a viewport pans two things at once. Every other link and image is drawn exactly as it was.
 *
 * **One object per set of options, for the page's life.** These are component *types* to React, so a
 * fresh `p` and `img` on every render unmounted every embed under them and mounted it again — an
 * embedded board back to loading, its `data-dag-embed-ready` gone. The PDF's sheet calls this as it
 * renders, and a re-render between "every embed is drawn" and `print()` printed a board as an empty
 * frame, one run in eight.
 */
const made = new Map<string, Components>();

export function refComponents({
  depth = 0,
  boards = true,
  placed = false,
}: {
  depth?: number;
  boards?: boolean;
  placed?: boolean;
} = {}): Components {
  const key = `${depth}|${boards}|${placed}`;
  let got = made.get(key);
  if (!got) made.set(key, (got = makeRefComponents(depth, boards, placed)));
  return got;
}

function makeRefComponents(depth: number, boards: boolean, placed: boolean): Components {
  return {
    /* Not a reference, but every read-only Markdown is drawn through this object, so a code block's
       language and its copy button are here once rather than in each caller. */
    pre: CodePre,
    /* An inline equation is a `<code>` to react-markdown; every other one is drawn as it was. */
    code: MathCode,
    /* An embed is a block, and react-markdown puts an image on its own line inside a `<p>` — which
       cannot hold a `<div>`, and React says so on the console. A paragraph that is nothing but one
       `dag:` image is therefore drawn as the block it is. */
    p: ({ node, children, ...rest }) => {
      const only = node?.children.length === 1 ? node.children[0] : undefined;
      const src =
        only?.type === "element" && only.tagName === "img" && typeof only.properties?.src === "string"
          ? only.properties.src
          : null;
      const embed = src !== null && (parseDagUrl(src) || parseWikiUrl(src));
      if (!embed) return <p {...rest}>{children}</p>;
      return (
        <div className="dag-embed-block">
          <OnItsOwn.Provider value={true}>{children}</OnItsOwn.Provider>
        </div>
      );
    },
    a: ({ node: _node, href, children, ...rest }) => {
      const hit = href ? parseDagUrl(href) : null;
      const wiki = !hit && href ? parseWikiUrl(href) : null;
      if (wiki)
        return (
          <WikiLink target={wiki.target} part={wiki.part}>
            {children}
          </WikiLink>
        );
      if (!hit)
        return (
          <a href={href} {...rest}>
            {children}
          </a>
        );
      return <RefLink id={hit.id} part={hit.part} fallback={children} />;
    },
    img: ({ node: _node, src, alt, ...rest }) => {
      const hit = typeof src === "string" ? parseDagUrl(src) : null;
      const wiki = !hit && typeof src === "string" ? parseWikiUrl(src) : null;
      if (wiki)
        return (
          <WikiEmbed target={wiki.target} part={wiki.part} fallback={alt ?? ""} depth={depth} boards={boards} placed={placed} />
        );
      if (!hit) return <img src={src} alt={alt} {...rest} />;
      return <RefEmbed id={hit.id} part={hit.part} fallback={alt ?? ""} depth={depth} boards={boards} placed={placed} />;
    },
  };
}

/**
 * A reference inside the note editor: the live title as a chip, which goes to its target on a click.
 * The editor holds the node as atomic inline content, so this is what is drawn in its place.
 */
export function RefChip({ href, title }: { href: string; title: string }) {
  const wiki = parseWikiUrl(href);
  if (wiki) return <WikiChip target={wiki.target} part={wiki.part} raw={title} />;
  return <DagChip href={href} title={title} />;
}

/** A `[[wikilink]]` in the editor: the words it was written with, and a click that follows it by name. */
function WikiChip({ target, part, raw }: { target: string; part?: string; raw: string }) {
  const index = useIndex();
  const doc = target ? resolveWiki(target, index.docs) : undefined;
  const [w] = wikilinksIn(raw);
  const to = doc ? hrefFor(doc.id, part) : undefined;
  return (
    <a
      className={index.loaded && target && !doc ? "dag-ref dag-ref--missing dag-ref--wiki" : "dag-ref dag-ref--wiki"}
      href={to}
      data-dag-ref={doc?.id}
      data-dag-wiki-target={target}
      title={doc ? doc.name : `Nothing in this vault is called ${target}`}
      onClick={(e) => {
        e.preventDefault();
        if (to) location.assign(to);
      }}
    >
      {w ? wikiLabel(w) : raw}
    </a>
  );
}

function DagChip({ href, title }: { href: string; title: string }) {
  const index = useIndex();
  const hit = parseDagUrl(href);
  const doc = hit ? index.byId.get(hit.id) : undefined;
  const missing = !hit || (index.loaded && !doc);
  const to = hit && !missing ? hrefFor(hit.id, hit.part) : undefined;
  return (
    <a
      className={missing ? "dag-ref dag-ref--missing" : "dag-ref"}
      href={to}
      data-dag-ref={hit?.id}
      title={missing ? "Nothing has this id any more" : doc?.name}
      onClick={(e) => {
        e.preventDefault();
        if (to) follow(to);
      }}
    >
      {doc ? titleOf(doc) : title}
    </a>
  );
}

/** An embed inside the note editor: exactly what the read-only view draws for the same line. */
export function RefBlock({ href, title }: { href: string; title: string }) {
  const wiki = parseWikiUrl(href);
  if (wiki) {
    const [w] = wikilinksIn(title);
    return (
      <OnItsOwn.Provider value={true}>
        <WikiEmbed target={wiki.target} part={wiki.part} fallback={w?.alias ?? wiki.target} depth={0} boards />
      </OnItsOwn.Provider>
    );
  }
  const hit = parseDagUrl(href);
  if (!hit) return <span className="dag-embed dag-embed--card">{title}</span>;
  return (
    <OnItsOwn.Provider value={true}>
      <RefEmbed id={hit.id} part={hit.part} fallback={title} depth={0} boards />
    </OnItsOwn.Provider>
  );
}
