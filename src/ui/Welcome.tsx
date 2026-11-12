import {
  CalendarPlus,
  FileText,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  LibraryBig,
  LockOpen,
  MoreHorizontal,
  Paperclip,
  Search,
  Sparkles,
  SquareCheckBig,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { everyFile, type BoardTree, type FileKind, type TextKind } from "@/board/useBoard";
import { chordFor } from "@/edit/bindings";
import { overdue, today } from "@/note/task";
import { lockedAffordance, refuseLocked, setLocked } from "@/settings/lock";

import { Logo } from "./Logo";
import { readRecent } from "./recents";
import { leaf } from "./tree";
import { CreateVaultForm, OpenFolderForm, RecentVaults, pickFolder, enterPath } from "./Vaults";

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What Home can start: the five text kinds, and the two that are notes with a line in them. */
export type StartKind = TextKind | "task" | "event";

/** What one recent file is called in its row — a `Record`, so a sixth kind is a type error here. */
const KIND_WORD: Readonly<Record<FileKind, string>> = {
  board: "Board",
  note: "Note",
  quiz: "Quiz",
  table: "Table",
  file: "File",
};

const KIND_ICON: Readonly<Record<FileKind, LucideIcon>> = {
  board: Workflow,
  note: FileText,
  quiz: GraduationCap,
  table: Table2,
  file: Paperclip,
};

/** The ways to start, in the order a person reaches for them. `lead` is the one the card points at. */
type StartTile = { kind: StartKind; label: string; icon: LucideIcon; key?: string; lead?: boolean };

const STARTS: StartTile[] = [
  { kind: "board", label: "Board", key: "B", icon: Workflow, lead: true },
  { kind: "note", label: "Note", key: "N", icon: FileText },
  { kind: "task", label: "Task", key: "T", icon: SquareCheckBig },
];

/** The kinds behind *More…* — the ones a first card does not put in front of somebody. */
const MORE_STARTS: StartTile[] = [
  { kind: "event", label: "Event", icon: CalendarPlus },
  { kind: "quiz", label: "Quiz", icon: GraduationCap },
  { kind: "table", label: "Table", icon: Table2 },
];

/** The day a due date is still "soon" — a week from today, written as a task writes one. */
function weekFrom(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 7);
  return at.toISOString().slice(0, 10);
}

/** Whether a key press landed in something somebody types into, where Home's letters are text. */
function typingHere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * What a person sees before they have opened anything: the ways to start, then what they were
 * doing and what is nearly due.
 *
 * **The app used to open a board nobody asked for.** `boardName` was `?board=` *or the first board
 * in the list*, so a cold load landed on whichever file sorted first — somebody else's reference
 * fixture as often as not — and the only signal that this was an accident rather than a choice was
 * that you did not recognise it. The fallback is `null` now: no `?board=` is honestly no board, and
 * this card is what stands in its place.
 *
 * **It has three parts and no more**: the ways to start (Board, Note, Task, and *More…* for the
 * rest), the five files this browser opened last, and the tasks due within a week. The lists are
 * read from what the page already has — the sidebar's own `/__board/list` answer and, for the
 * recents, a key this browser keeps per vault — so opening a vault still writes no byte of it.
 *
 * **An empty vault gets its own card.** The same *Nothing open* over a folder of two hundred files
 * and a folder of none said the same thing in both, and the sidebar's *Nothing here yet* line was a
 * second set of instructions a few pixels away. Here the title says the vault is empty, every kind
 * is a tile, and Search is not offered because it can find nothing.
 *
 * **The tiles carry the keys that do the same thing**, and this card is the only place those bare
 * letters are live: no board, no text box, no dialog. A press elsewhere is text, and an open dialog
 * — Settings, the search, the shortcut sheet — keeps its keys.
 *
 * The canvas underneath stays live — `pointer-events` is off on the layer and back on for the card
 * — so the paper can still be panned and zoomed behind it. It is an invitation, not a gate.
 *
 * **Locked, the card says so and offers Unlock in place.** The read-only state is a sentence, every
 * starting tile wears the lock's disabled style and the hover that names the chord, and a press
 * says why rather than doing nothing.
 */
export function Welcome({
  locked = false,
  list,
  onStart,
  onOpenFile,
  onOpen,
}: {
  /** The app is read-only: say so, unlock in place, and leave the writes visibly unavailable. */
  locked?: boolean;
  /** What the vault holds, so *empty* means empty and the lists can name what they show. */
  list: BoardTree;
  onStart(kind: StartKind): void;
  onOpenFile(kind: FileKind, name: string): void;
  onOpen(): void;
}) {
  const blocked = lockedAffordance(locked);
  const open = chordFor("boards");
  const [more, setMore] = useState(false);
  const [stored] = useState(readRecent);

  const files = useMemo(() => everyFile(list), [list]);
  const empty = list.loaded && files.length === 0 && list.folders.length === 0;

  /* A file somebody deleted or moved is not a row: a name that is not in the list opens nothing. */
  const recent = useMemo(() => {
    const known = new Set(files.map((file) => `${file.kind}:${file.name}`));
    return stored.filter((file) => known.has(`${file.kind}:${file.name}`));
  }, [files, stored]);

  /* What is due by the end of the coming week, soonest first. A task past its date is still due —
     it is the first thing the list should say — so the window has no lower bound but "not done". */
  const due = useMemo(() => {
    if (!list.loaded) return [];
    const end = weekFrom(today());
    return Object.entries(list.tasks)
      .filter(([, task]) => task.status !== "done" && task.due !== undefined && task.due <= end)
      .map(([name, task]) => ({ name, task, title: list.titles[name] ?? leaf(name) }))
      .sort(
        (a, b) =>
          (a.task.due ?? "").localeCompare(b.task.due ?? "") || a.title.localeCompare(b.title, undefined, { numeric: true }),
      );
  }, [list]);

  const start = (kind: StartKind) => (locked ? refuseLocked() : onStart(kind));

  /* The keys the tiles name. Registered once for as long as Home is on screen; a dialog owns its
     own keys while it is open, and a box somebody types into is text. */
  const acts = useRef({ start, onOpen, setMore, empty, more });
  acts.current = { start, onOpen, setMore, empty, more };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (typingHere(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === "m" && !acts.current.empty) {
        e.preventDefault();
        acts.current.setMore((was) => !was);
        return;
      }
      const kind = key === "b" ? "board" : key === "n" ? "note" : key === "t" ? "task" : null;
      if (!kind) return;
      e.preventDefault();
      acts.current.start(kind);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="dag-welcome__layer" data-dag-welcome="">
      <section
        className={empty ? "dag-welcome dag-welcome--home dag-welcome--vault-empty" : "dag-welcome dag-welcome--home"}
        aria-label={empty ? "This vault is empty" : "Nothing open"}
        data-dag-welcome-empty={empty ? "" : undefined}
      >
        <Logo size={28} />
        <h1 className="dag-welcome__title">{empty ? "This vault is empty" : "Nothing open"}</h1>
        <p className="dag-welcome__hint" data-dag-welcome-locked={locked ? "" : undefined}>
          {locked
            ? empty
              ? "Read only: unlock to make a board, a note, a task, an event, a quiz or a table."
              : "Read only: nothing here can be changed until you unlock."
            : empty
              ? "Make a board, a note, a task, an event, a quiz or a table to begin."
              : "Start something new, or open something you have already made."}
        </p>

        {locked ? (
          <button
            type="button"
            className="dag-welcome__act dag-welcome__act--go dag-welcome__unlock"
            data-dag-welcome-unlock=""
            onClick={() => setLocked(false)}
          >
            <LockOpen {...ICON} aria-hidden="true" />
            <span>Unlock</span>
          </button>
        ) : null}

        <div className="dag-welcome__acts dag-welcome__acts--home">
          {(empty ? [...STARTS, ...MORE_STARTS.map((other) => ({ ...other, key: "" }))] : STARTS).map(
            ({ kind, label, key, icon: Icon, lead }) => (
              <button
                key={kind}
                type="button"
                className={
                  lead
                    ? "dag-welcome__act dag-welcome__act--tile dag-welcome__act--go"
                    : "dag-welcome__act dag-welcome__act--tile"
                }
                data-dag-welcome-new={kind === "board" ? "" : undefined}
                data-dag-welcome-note={kind === "note" ? "" : undefined}
                data-dag-welcome-task={kind === "task" ? "" : undefined}
                data-dag-welcome-start={kind}
                {...blocked}
                onClick={() => start(kind)}
              >
                <Icon {...ICON} aria-hidden="true" />
                <span>{label}</span>
                {key ? <kbd>{key}</kbd> : null}
              </button>
            ),
          )}
          {!empty ? (
            <button
              type="button"
              className="dag-welcome__act dag-welcome__act--tile"
              data-dag-welcome-more=""
              aria-expanded={more}
              title={more ? "Fewer kinds" : "Every kind of file"}
              onClick={() => setMore((was) => !was)}
            >
              <MoreHorizontal {...ICON} aria-hidden="true" />
              <span>More…</span>
              <kbd>M</kbd>
            </button>
          ) : null}
          {more && !empty
            ? MORE_STARTS.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  className="dag-welcome__act dag-welcome__act--tile"
                  data-dag-welcome-start={kind}
                  {...blocked}
                  onClick={() => start(kind)}
                >
                  <Icon {...ICON} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))
            : null}
          {!empty ? (
            <button
              type="button"
              className="dag-welcome__act dag-welcome__act--tile"
              data-dag-welcome-open=""
              title={open ? `Search (${open})` : "Search"}
              onClick={onOpen}
            >
              <Search {...ICON} aria-hidden="true" />
              <span>Search</span>
              {open ? <kbd>{open}</kbd> : null}
            </button>
          ) : null}
        </div>

        {recent.length && !empty ? (
          <section className="dag-welcome__section" data-dag-home-recent="">
            <h2 className="dag-welcome__sectiontitle">Recent</h2>
            <div className="dag-welcome__rows">
              {recent.map((file) => {
                const Icon = KIND_ICON[file.kind];
                return (
                  <button
                    key={`${file.kind}:${file.name}`}
                    type="button"
                    className="dag-welcome__row"
                    data-dag-home-recent-item={file.name}
                    data-dag-home-recent-kind={file.kind}
                    onClick={() => onOpenFile(file.kind, file.name)}
                  >
                    <Icon {...ICON} aria-hidden="true" />
                    <span className="dag-welcome__rowtitle">{list.titles[file.name] ?? leaf(file.name)}</span>
                    <span className="dag-welcome__rowmeta">{KIND_WORD[file.kind]}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {due.length && !empty ? (
          <section className="dag-welcome__section" data-dag-home-due="">
            <h2 className="dag-welcome__sectiontitle">Due soon</h2>
            <div className="dag-welcome__rows">
              {due.map(({ name, task, title }) => (
                <button
                  key={name}
                  type="button"
                  className="dag-welcome__row"
                  data-dag-home-due-item={name}
                  onClick={() => onOpenFile("note", name)}
                >
                  <SquareCheckBig {...ICON} aria-hidden="true" />
                  <span className="dag-welcome__rowtitle">{title}</span>
                  <span className="dag-welcome__rowmeta">
                    {task.due === today() ? "Due today" : overdue(task) ? "Overdue" : `Due ${task.due}`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}

/**
 * A board with nothing on it yet: the three ways a board begins, where the board is.
 *
 * **A new board used to arrive with a sentence already on it** — an `md` item saying to double-click
 * or press `space L` — shown at 205%, because a fit of one small note fills the screen. So the first
 * thing anybody did to a board they had just made was find that note and delete it. The file is empty
 * now and this card says the same thing without being in it: a note, the library, or a diagram
 * described in words. It goes the moment anything is on the page, and it is never in a snapshot.
 *
 * `Welcome`'s layer: `pointer-events` off, and back on for the card, so a double-click on the paper
 * around it still makes a note — the gesture the first button names.
 *
 * Locked, the card stays where it was and says why nothing can land on the board, with Unlock in
 * place. Hiding it left a locked empty board with no explanation at all, which is the same broken
 * page the lock exists to prevent.
 */
export function EmptyBoard({
  locked = false,
  onNote,
  onLibrary,
  onPrompt,
}: {
  locked?: boolean;
  onNote(): void;
  onLibrary(): void;
  onPrompt(): void;
}) {
  const chord = (c: "note" | "library" | "prompt") => chordFor(c);
  const blocked = lockedAffordance(locked);
  const acts: { key: string; label: string; hint: string; icon: typeof FileText; go(): void; lead?: boolean }[] = [
    { key: "note", label: "A note", hint: chord("note") ?? "Space N", icon: FileText, go: onNote },
    { key: "library", label: "The library", hint: chord("library") ?? "Space L", icon: LibraryBig, go: onLibrary },
    { key: "prompt", label: "Describe a diagram", hint: chord("prompt") ?? "Space P", icon: Sparkles, go: onPrompt, lead: true },
  ];
  return (
    <div className="dag-welcome__layer" data-dag-empty-board="">
      <section className="dag-welcome dag-welcome--empty" aria-label="An empty board">
        <p className="dag-welcome__hint">
          {locked
            ? "Read only: unlock to add a note, open the library, or describe a diagram."
            : "An empty board. Double-click anywhere for a note, or start with"}
        </p>
        <div className="dag-welcome__acts">
          {locked ? (
            <button
              type="button"
              className="dag-welcome__act dag-welcome__act--go"
              data-dag-empty-board-unlock=""
              onClick={() => setLocked(false)}
            >
              <LockOpen {...ICON} aria-hidden="true" />
              <span>Unlock</span>
            </button>
          ) : null}
          {acts.map(({ key, label, hint, icon: Icon, go, lead }) => (
            <button
              key={key}
              type="button"
              className={
                lead ? "dag-welcome__act dag-welcome__act--tile dag-welcome__act--go" : "dag-welcome__act dag-welcome__act--tile"
              }
              data-dag-empty-board-act={key}
              {...blocked}
              onClick={() => (locked ? refuseLocked() : go())}
            >
              <Icon {...ICON} aria-hidden="true" />
              <span>{label}</span>
              <kbd>{hint}</kbd>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * What a person sees when no vault is open: the three ways to get one —
 * a folder to open, a folder to make, or one from the recent list. There is no canvas behind it,
 * because every request a canvas makes is about a vault; this is the whole page.
 *
 * **The card says which half it is showing**: *Create a vault* over the create form, *Open a vault*
 * over the chooser and the open form. It used to keep the open title while the create form was up,
 * so the form a person had just asked for sat under a heading for the other one.
 *
 * Opening asks the desktop shell's folder dialog when there is one, and otherwise for a path typed
 * in a field. **Neither ever removes a folder**: a vault is a folder the person already owns.
 */
export function NoVault() {
  const [asking, setAsking] = useState<"open" | "create" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    setProblem(null);
    const picked = await pickFolder();
    if (picked === undefined) return setAsking("open");
    if (picked === null) return;
    try {
      await enterPath(picked);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That did not work.");
    }
  }

  return (
    <div className="dag-novault" data-dag-novault="">
      <section className="dag-welcome" aria-label="No vault open">
        <Logo size={28} />
        <h1 className="dag-welcome__title">{asking === "create" ? "Create a vault" : "Open a vault"}</h1>
        <p className="dag-welcome__hint">
          {asking === "create"
            ? "Give it a name and say which folder it lives in. A vault is that folder — its boards, notes and files."
            : "A vault is a folder of boards, notes and files. Open one you have, or start a new one."}
        </p>
        {asking === "open" ? (
          <OpenFolderForm onCancel={() => setAsking(null)} />
        ) : asking === "create" ? (
          <CreateVaultForm onCancel={() => setAsking(null)} />
        ) : (
          <div className="dag-welcome__acts">
            <button
              type="button"
              className="dag-welcome__act dag-welcome__act--go"
              data-dag-welcome-open-folder=""
              onClick={() => void open()}
            >
              <FolderOpen {...ICON} aria-hidden="true" />
              <span>Open folder…</span>
            </button>
            <button
              type="button"
              className="dag-welcome__act"
              data-dag-welcome-create-vault=""
              onClick={() => setAsking("create")}
            >
              <FolderPlus {...ICON} aria-hidden="true" />
              <span>Create vault…</span>
            </button>
          </div>
        )}
        {problem ? (
          <p className="dag-vault__problem" role="alert" data-dag-vault-problem="">
            {problem}
          </p>
        ) : null}
        <RecentVaults />
      </section>
    </div>
  );
}
