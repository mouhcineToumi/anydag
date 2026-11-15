import { Calendar, CalendarDays, CalendarPlus, CircleSlash, Folder, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { createNote, type Made } from "@/board/useBoard";
import type { Spot } from "@/calendar/menu";
import { folderOf, type Project } from "@/note/project";
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES, titleStem, today, withTask, type Priority, type TaskStatus } from "@/note/task";
import { LOCK_HINT, refuseLocked } from "@/settings/lock";

import { Button, IconButton } from "./controls";
import { Dialog } from "./Dialog";
import { ProjectGlyph } from "./ProjectBar";
import { dueText, PRIORITY_KEYS, PriorityMark, TaskGlyph } from "./TaskGlyph";
import { TasksMenu, under, type MenuRow } from "./TasksMenu";

/**
 * Making a task (#311), two ways that write the same file: the **New task row** at the top of the
 * list, for the quick one typed between two others, and the **New task dialog** (`C`, or the top
 * bar's button), for the one with a description. Both carry the same pills — status, priority,
 * project, due date — and both make one `POST /__board/create` with every line already in the
 * frontmatter, so a task is never written twice to be made.
 *
 * A project is where the file goes: choosing one makes the task in that project's folder, which is
 * all a project is (`docs/architecture/tasks-projects-calendar.md`, *Projects*).
 */

/** What a task being made says so far. `project` is the project's note, by name; `null` is none. */
export interface NewTaskDraft {
  title: string;
  status: TaskStatus;
  priority: Priority | null;
  project: string | null;
  due: string | null;
}

/** A project a pill can offer: its note's name, the project, and what it is called. */
export interface ProjectChoice {
  name: string;
  project: Project;
  title: string;
}

export const blankDraft = (project: string | null = null, status: TaskStatus = "todo"): NewTaskDraft => ({
  title: "",
  status,
  priority: null,
  project,
  due: null,
});

/**
 * The text a new task's file starts as: its title, its lines, and the description under them. The
 * title is written as the frontmatter's, which is what the server names the file after.
 */
export function newTaskText(d: NewTaskDraft, description = ""): string {
  const body = description.trim() ? `${description.trim()}\n` : "";
  return withTask(`---\ntitle: ${JSON.stringify(d.title.trim())}\n---\n${body}`, {
    status: d.status,
    ...(d.priority ? { priority: d.priority } : {}),
    ...(d.due ? { due: d.due } : {}),
  });
}

/** Where a new task's file goes: named after its title, in its project's folder or at the top. */
export function newTaskName(d: NewTaskDraft): string {
  const stem = titleStem(d.title) || "untitled";
  const folder = d.project ? folderOf(d.project) : "";
  return folder ? `${folder}/${stem}` : stem;
}

const makeTask = (d: NewTaskDraft, description = ""): Promise<Made> => createNote(newTaskName(d), newTaskText(d, description));

/** `YYYY-MM-DD`, `days` after today here. */
function inDays(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return today(at);
}

type Field = "status" | "priority" | "project" | "due";

/**
 * The four pills a task being made carries. An unset one is dashed and says what it is (*Priority*,
 * *No project*, *Due date*); a set one is solid and says its value. Each opens the same menu its
 * column does on a row, with the same icons. `status` is drawn only where it is asked for: the
 * dialog always, the row only when a group's `+` set one other than To do.
 */
function TaskPills({
  draft,
  onDraft,
  projects,
  hook,
  status = true,
}: {
  draft: NewTaskDraft;
  onDraft(next: NewTaskDraft): void;
  projects: readonly ProjectChoice[];
  /** The attribute prefix the suite finds the pills by: `data-dag-task-<hook>-priority`. */
  hook: "new" | "dialog";
  status?: boolean;
}) {
  const [menu, setMenu] = useState<{ field: Field; at: Spot } | null>(null);
  const date = useRef<HTMLInputElement>(null);
  const project = draft.project ? projects.find((p) => p.name === draft.project) : undefined;
  const open = (field: Field) => (e: { currentTarget: Element }) => setMenu({ field, at: under(e.currentTarget) });
  const set = (change: Partial<NewTaskDraft>) => onDraft({ ...draft, ...change });

  const rows = (field: Field): MenuRow[] => {
    switch (field) {
      case "status":
        return STATUSES.map((s, i) => ({
          key: s,
          label: STATUS_LABEL[s],
          icon: <TaskGlyph status={s} />,
          hint: String(i + 1),
          checked: draft.status === s,
          onPick: () => set({ status: s }),
        }));
      case "priority":
        return PRIORITY_KEYS.map(({ priority, key, label }) => ({
          key: priority ?? "none",
          label,
          icon: <PriorityMark priority={priority ?? undefined} />,
          hint: key,
          checked: draft.priority === priority,
          data: { "data-dag-task-menu-priority": priority ?? "none" },
          onPick: () => set({ priority }),
        }));
      case "project":
        return [
          {
            key: "none",
            label: "No project",
            icon: <CircleSlash size={14} strokeWidth={2} aria-hidden="true" />,
            checked: draft.project === null,
            data: { "data-dag-task-menu-project": "" },
            onPick: () => set({ project: null }),
          },
          ...projects.map((p) => ({
            key: p.name,
            label: p.title,
            icon: <ProjectGlyph project={p.project} />,
            checked: draft.project === p.name,
            data: { "data-dag-task-menu-project": p.name },
            onPick: () => set({ project: p.name }),
          })),
        ];
      case "due": {
        const day = (key: string, label: string, value: string): MenuRow => ({
          key,
          label,
          icon: <Calendar size={14} strokeWidth={2} aria-hidden="true" />,
          hint: dueText(value),
          checked: draft.due === value,
          data: { "data-dag-task-menu-due": key },
          onPick: () => set({ due: value }),
        });
        return [
          day("today", "Today", inDays(0)),
          day("tomorrow", "Tomorrow", inDays(1)),
          day("week", "In a week", inDays(7)),
          {
            key: "pick",
            label: "Pick a date…",
            icon: <CalendarPlus size={14} strokeWidth={2} aria-hidden="true" />,
            data: { "data-dag-task-menu-due": "pick" },
            onPick: () => {
              /* The browser's own picker, which knows the locale and the keyboard; a browser
                 without `showPicker` gets the field focused instead. */
              const el = date.current;
              if (!el) return;
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            },
          },
          ...(draft.due
            ? [
                {
                  key: "none",
                  label: "No due date",
                  icon: <X size={14} strokeWidth={2} aria-hidden="true" />,
                  data: { "data-dag-task-menu-due": "none" },
                  onPick: () => set({ due: null }),
                },
              ]
            : []),
        ];
      }
    }
  };

  const pill = (field: Field, isSet: boolean, icon: ReactNode, label: string, name: string) => (
    <button
      type="button"
      className="dag-tasks-pill"
      data-set={isSet ? "" : undefined}
      {...{ [`data-dag-task-${hook}-${field}`]: pillValue(field) }}
      aria-haspopup="menu"
      aria-label={name}
      onClick={open(field)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const pillValue = (field: Field): string => {
    switch (field) {
      case "status":
        return draft.status;
      case "priority":
        return draft.priority ?? "none";
      case "project":
        return draft.project ?? "";
      case "due":
        return draft.due ?? "";
    }
  };

  return (
    <span className="dag-tasks-pills">
      {status
        ? pill(
            "status",
            true,
            <TaskGlyph status={draft.status} />,
            STATUS_LABEL[draft.status],
            `Status: ${STATUS_LABEL[draft.status]}`,
          )
        : null}
      {pill(
        "priority",
        draft.priority !== null,
        <PriorityMark priority={draft.priority ?? undefined} size={14} />,
        draft.priority ? PRIORITY_LABEL[draft.priority] : "Priority",
        `Priority: ${draft.priority ? PRIORITY_LABEL[draft.priority] : "none"}`,
      )}
      {pill(
        "project",
        project !== undefined,
        project ? <ProjectGlyph project={project.project} /> : <Folder size={14} strokeWidth={2} aria-hidden="true" />,
        project ? project.title : "No project",
        `Project: ${project ? project.title : "none"}`,
      )}
      {pill(
        "due",
        draft.due !== null,
        <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />,
        draft.due ? dueText(draft.due) : "Due date",
        `Due date: ${draft.due ?? "none"}`,
      )}
      <input
        ref={date}
        type="date"
        className="dag-tasks-pills__date"
        tabIndex={-1}
        aria-hidden="true"
        value={draft.due ?? ""}
        onChange={(e) => set({ due: e.target.value || null })}
      />
      {menu ? (
        <TasksMenu
          at={menu.at}
          label={menu.field === "due" ? "Due date" : menu.field[0]!.toUpperCase() + menu.field.slice(1)}
          data={{ [`data-dag-task-${hook}-menu`]: menu.field }}
          onClose={() => setMenu(null)}
          rows={rows(menu.field)}
        />
      ) : null}
    </span>
  );
}

/**
 * The New task row: the first line of the list. `N` puts the caret in it; Enter adds the task and
 * keeps the row open for the next, with the pills as they were; shift+Enter adds it and opens its
 * page; Tab walks to the pills; Escape clears the title and leaves. A create that did not land keeps
 * the title and says why — the server's words, or the top bar's *Read only* pill shaking.
 */
export function NewTaskRow({
  draft,
  onDraft,
  projects,
  locked,
  field,
  onMade,
}: {
  draft: NewTaskDraft;
  onDraft(next: NewTaskDraft): void;
  projects: readonly ProjectChoice[];
  locked: boolean;
  field: RefObject<HTMLInputElement | null>;
  /** A task was made: by name, and whether to open it. */
  onMade(name: string, open: boolean): void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = draft.status;

  const make = async (open: boolean) => {
    if (!draft.title.trim() || busy) return;
    if (locked) {
      refuseLocked();
      setProblem(null);
      return;
    }
    setBusy(true);
    setProblem(null);
    const made = await makeTask(draft);
    setBusy(false);
    if ("error" in made) return setProblem(made.error);
    onDraft({ ...draft, title: "" });
    onMade(made.name, open);
    /* The box was disabled while the create was in flight, which took the caret out of it. */
    requestAnimationFrame(() => field.current?.focus());
  };

  return (
    <div className="dag-tasks-new" data-dag-task-new="">
      <div
        className="dag-tasks-new__row"
        data-dag-readonly-blocked={locked ? "" : undefined}
        title={locked ? LOCK_HINT : undefined}
      >
        <label className="dag-tasks-new__label" data-dag-task-add-row={status}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          <input
            ref={field}
            type="text"
            className="dag-tasks-new__title"
            placeholder="New task"
            aria-label={`New task${status === "todo" ? "" : ` in ${STATUS_LABEL[status]}`}: type a title and press Enter`}
            value={draft.title}
            disabled={busy}
            data-dag-task-add={status}
            onChange={(e) => onDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void make(e.shiftKey);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onDraft({ ...draft, title: "" });
                setProblem(null);
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <TaskPills draft={draft} onDraft={onDraft} projects={projects} hook="new" status={status !== "todo"} />
        <kbd className="dag-tasks-kbd dag-tasks-new__key" aria-hidden="true">
          N
        </kbd>
      </div>
      <p className="dag-tasks-new__hint" aria-hidden="true">
        <span>
          <kbd className="dag-tasks-kbd">Enter</kbd> adds it and keeps the row open
        </span>
        <span>
          <kbd className="dag-tasks-kbd">Shift</kbd> <kbd className="dag-tasks-kbd">Enter</kbd> adds it and opens its page
        </span>
        <span>
          <kbd className="dag-tasks-kbd">Tab</kbd> priority, project, due date
        </span>
        <span>
          <kbd className="dag-tasks-kbd">Esc</kbd> leaves
        </span>
      </p>
      {problem ? (
        <p className="dag-tasks__add-problem" role="alert" data-dag-task-add-problem={status}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The New task dialog: a title, a description, the four pills, and *Keep this open for the next
 * one*. Enter in the title makes it (ctrl+Enter anywhere), *Create and open* opens its page. The
 * description is the note's body, written as it is typed — Markdown, the note's own.
 */
export function NewTaskDialog({
  initial,
  projects,
  onClose,
  onMade,
}: {
  initial: NewTaskDraft;
  projects: readonly ProjectChoice[];
  onClose(): void;
  onMade(name: string, open: boolean): void;
}) {
  const [draft, setDraft] = useState<NewTaskDraft>(initial);
  const [description, setDescription] = useState("");
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const title = useRef<HTMLInputElement>(null);

  useEffect(() => title.current?.focus(), []);

  const make = async (open: boolean) => {
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const made = await makeTask(draft, description);
    setBusy(false);
    if ("error" in made) return setProblem(made.error);
    onMade(made.name, open);
    if (open || !keep) return onClose();
    /* The next one: a clean title and description, and the pills as they were. */
    setDraft((d) => ({ ...d, title: "" }));
    setDescription("");
    requestAnimationFrame(() => title.current?.focus());
  };

  return (
    <Dialog
      scrim={{ "data-dag-task-dialog": "" }}
      onClose={busy ? undefined : onClose}
      className="dag-settings dag-task-dialog"
      aria-label="New task"
      aria-busy={busy || undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void make(false);
        }
      }}
    >
      <header className="dag-task-dialog__head">
        <span>New task</span>
        <span className="dag-toolbar__spacer" />
        <IconButton
          aria-label="Close"
          shortcut="Escape"
          size="sm"
          data-dag-task-dialog-close=""
          disabled={busy}
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="dag-task-dialog__body">
        <input
          ref={title}
          type="text"
          className="dag-task-dialog__title"
          placeholder="Task title"
          aria-label="Title"
          value={draft.title}
          data-dag-task-dialog-title=""
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              void make(e.shiftKey);
            }
          }}
        />
        <textarea
          className="dag-task-dialog__description"
          placeholder="Add a description, or leave it empty for a quick task."
          aria-label="Description"
          rows={3}
          value={description}
          data-dag-task-dialog-description=""
          onChange={(e) => setDescription(e.target.value)}
        />
        <TaskPills draft={draft} onDraft={setDraft} projects={projects} hook="dialog" />
        {problem ? (
          <p className="dag-tasks__add-problem" role="alert" data-dag-task-dialog-problem="">
            {problem}
          </p>
        ) : null}
      </div>
      <footer className="dag-settings__foot dag-task-dialog__foot">
        <label className="dag-task-dialog__keep">
          <input type="checkbox" checked={keep} data-dag-task-dialog-keep="" onChange={(e) => setKeep(e.target.checked)} />
          Keep this open for the next one
        </label>
        <span className="dag-toolbar__spacer" />
        <Button data-dag-task-dialog-open="" disabled={busy || !draft.title.trim()} onClick={() => void make(true)}>
          Create and open
        </Button>
        <Button
          variant="primary"
          data-dag-task-dialog-create=""
          disabled={busy || !draft.title.trim()}
          onClick={() => void make(false)}
        >
          Create task <kbd className="dag-tasks-kbd">Enter</kbd>
        </Button>
      </footer>
    </Dialog>
  );
}
