import { Calendar, CalendarDays, ChevronDown, Folder, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import type { Spot } from "@/calendar/menu";
import { PRIORITY_LABEL, STATUS_LABEL, overdue, type Task, type TaskChange, type TaskFacts } from "@/note/task";
import { LinkedFrom } from "@/refs/Backlinks";

import { ProjectChip, ProjectGlyph } from "./ProjectBar";
import { dueText, PriorityMark, TaskGlyph } from "./TaskGlyph";
import { dueRows, priorityRows, projectRows, showDatePicker, statusRows, type ProjectChoice } from "./taskMenus";
import { TasksMenu, under, type MenuRow } from "./TasksMenu";
import { changedWords, dueDistance } from "./taskModel";

/**
 * A task's properties on its own page (#311), two ways: **a panel beside the text** — status,
 * priority, project, the two dates, then what the listing knows (check items, when it changed),
 * then what links here — or, folded by the top bar's panel button or by a window too narrow for it,
 * **one line of pills above the text**, the New task dialog's. Both write through the note's own
 * save (`changeTask` in `NoteView`), except the project: choosing another moves the file into that
 * project's folder, which is all being in a project is.
 */

export interface TaskProps {
  task: Task;
  editable: boolean;
  onChange(change: TaskChange): void;
  /** The projects a task can be in, and the one it is in now, by its note's name. */
  projects: readonly ProjectChoice[];
  project: string | null;
  onProject(name: string | null): void;
  /** What the listing knows beside the frontmatter: check items, when the file changed. */
  facts?: TaskFacts;
  /** The note's id, for what links here. */
  id?: string | null;
}

type Field = "status" | "priority" | "project" | "due" | "start";

/** The menu a property opens, and the date inputs *Pick a date…* opens the browser's picker on. */
function useMenus({ task, onChange, projects, project, onProject }: TaskProps) {
  const [menu, setMenu] = useState<{ field: Field; at: Spot } | null>(null);
  const dates = { due: useRef<HTMLInputElement>(null), start: useRef<HTMLInputElement>(null) };
  const rows = (field: Field): MenuRow[] => {
    switch (field) {
      case "status":
        return statusRows(task.status, (status) => status !== task.status && onChange({ status }));
      case "priority":
        return priorityRows(task.priority ?? null, (priority) => priority !== (task.priority ?? null) && onChange({ priority }));
      case "project":
        return projectRows(projects, project, (name) => name !== project && onProject(name));
      case "due":
        return dueRows(
          task.due ?? null,
          (due) => onChange({ due }),
          () => showDatePicker(dates.due.current),
        );
      case "start":
        return dueRows(
          task.start ?? null,
          (start) => onChange({ start }),
          () => showDatePicker(dates.start.current),
        );
    }
  };
  const open = (field: Field) => (e: { currentTarget: Element }) => setMenu({ field, at: under(e.currentTarget) });
  const element = menu ? (
    <TasksMenu
      at={menu.at}
      label={{ status: "Status", priority: "Priority", project: "Project", due: "Due date", start: "Start date" }[menu.field]}
      data={{ "data-dag-taskbar-menu": menu.field }}
      onClose={() => setMenu(null)}
      rows={rows(menu.field)}
    />
  ) : null;
  /* Out of sight, and there for *Pick a date…* to open the browser's own picker on. */
  const pickers = (["due", "start"] as const).map((f) => (
    <input
      key={f}
      ref={dates[f]}
      type="date"
      className="dag-tasks-pills__date"
      tabIndex={-1}
      aria-hidden="true"
      value={task[f] ?? ""}
      onChange={(e) => onChange({ [f]: e.target.value || null })}
    />
  ));
  return { open, element, pickers };
}

/** The panel beside a task's text. */
export function TaskPanel(props: TaskProps) {
  const { task, editable, onChange, projects, project, facts, id } = props;
  const { open, element } = useMenus(props);
  const chosen = project ? projects.find((p) => p.name === project) : undefined;
  const late = overdue(task);
  const pick = (field: Field, value: string, children: ReactNode, label: string) => (
    <button
      type="button"
      className="dag-taskpanel__pick"
      {...{ [`data-dag-taskbar-${field}`]: value }}
      aria-haspopup="menu"
      aria-label={label}
      disabled={!editable}
      onClick={open(field)}
    >
      {children}
      <ChevronDown size={12} strokeWidth={2} className="dag-taskpanel__chevron" aria-hidden="true" />
    </button>
  );
  return (
    <aside className="dag-taskpanel" data-dag-taskbar={task.status} aria-label="Properties">
      <h2 className="dag-taskpanel__head">Properties</h2>
      <div className="dag-taskpanel__grid">
        <span className="dag-taskpanel__label">Status</span>
        <span className="dag-taskpanel__value">
          {pick(
            "status",
            task.status,
            <>
              <TaskGlyph status={task.status} />
              {STATUS_LABEL[task.status]}
            </>,
            `Status: ${STATUS_LABEL[task.status]}`,
          )}
        </span>
        <span className="dag-taskpanel__label">Priority</span>
        <span className="dag-taskpanel__value">
          {pick(
            "priority",
            task.priority ?? "none",
            <>
              <PriorityMark priority={task.priority} size={14} />
              {task.priority ? PRIORITY_LABEL[task.priority] : <span className="dag-taskpanel__none">None</span>}
            </>,
            `Priority: ${task.priority ? PRIORITY_LABEL[task.priority] : "none"}`,
          )}
        </span>
        <span className="dag-taskpanel__label">Project</span>
        <span className="dag-taskpanel__value">
          {pick(
            "project",
            project ?? "",
            chosen ? (
              <ProjectChip project={chosen.project} title={chosen.title} />
            ) : (
              <span className="dag-taskpanel__none">None</span>
            ),
            `Project: ${chosen ? chosen.title : "none"}`,
          )}
        </span>
        <span className="dag-taskpanel__label">Starts</span>
        <span className="dag-taskpanel__value dag-facts__value">
          <DateField
            value={task.start}
            max={task.due}
            editable={editable}
            hook="data-dag-taskbar-start"
            label="Start date"
            onChange={(start) => onChange({ start })}
          />
        </span>
        <span className="dag-taskpanel__label">Due</span>
        <span className="dag-taskpanel__value dag-facts__value">
          <DateField
            value={task.due}
            min={task.start}
            editable={editable}
            hook="data-dag-taskbar-due"
            label="Due date"
            late={late}
            onChange={(due) => onChange({ due })}
          />
          {task.due ? (
            <>
              <span className="dag-taskpanel__distance" data-late={late ? "" : undefined} data-dag-taskbar-distance="">
                {dueDistance(task.due, task.status)}
              </span>
              <button
                type="button"
                className="dag-taskbar__clear"
                data-dag-taskbar-clear-due=""
                aria-label="Take the due date off"
                disabled={!editable}
                onClick={() => onChange({ due: null })}
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </span>
      </div>
      <hr className="dag-taskpanel__rule" />
      <div className="dag-taskpanel__grid">
        <span className="dag-taskpanel__label">Check items</span>
        <span
          className="dag-taskpanel__value"
          data-dag-taskbar-items={facts?.items ? `${facts.items.done}/${facts.items.total}` : ""}
        >
          {facts?.items ? (
            <>
              <span className="dag-tasks__bar-track" aria-hidden="true">
                <span className="dag-tasks__bar-fill" style={{ width: `${(facts.items.done / facts.items.total) * 100}%` }} />
              </span>
              {facts.items.done} of {facts.items.total}
            </>
          ) : (
            <span className="dag-taskpanel__none">None</span>
          )}
        </span>
        <span className="dag-taskpanel__label">Changed</span>
        <span className="dag-taskpanel__value dag-taskpanel__muted">
          {facts?.changed ? (
            <span title={new Date(facts.changed).toLocaleString()}>{changedWords(facts.changed)}</span>
          ) : (
            "just now"
          )}
        </span>
      </div>
      {id ? (
        <>
          <hr className="dag-taskpanel__rule" />
          <LinkedFrom id={id} />
        </>
      ) : null}
      {element}
    </aside>
  );
}

/** The same properties folded into one line of pills above the text. */
export function TaskPropsLine(props: TaskProps) {
  const { task, editable, projects, project } = props;
  const { open, element, pickers } = useMenus(props);
  const chosen = project ? projects.find((p) => p.name === project) : undefined;
  const late = overdue(task);
  const pill = (field: Field, value: string, isSet: boolean, children: ReactNode, label: string, extra?: object) => (
    <button
      type="button"
      className="dag-tasks-pill"
      data-set={isSet ? "" : undefined}
      {...{ [`data-dag-taskbar-${field}`]: value }}
      {...extra}
      aria-haspopup="menu"
      aria-label={label}
      disabled={!editable}
      onClick={open(field)}
    >
      {children}
    </button>
  );
  return (
    <div className="dag-taskline-pills dag-tasks-pills" data-dag-taskbar={task.status}>
      {pill(
        "status",
        task.status,
        true,
        <>
          <TaskGlyph status={task.status} />
          <span>{STATUS_LABEL[task.status]}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
        </>,
        `Status: ${STATUS_LABEL[task.status]}`,
      )}
      {pill(
        "priority",
        task.priority ?? "none",
        !!task.priority,
        <>
          <PriorityMark priority={task.priority} size={14} />
          <span>{task.priority ? PRIORITY_LABEL[task.priority] : "Priority"}</span>
        </>,
        `Priority: ${task.priority ? PRIORITY_LABEL[task.priority] : "none"}`,
      )}
      {pill(
        "project",
        project ?? "",
        !!chosen,
        <>
          {chosen ? <ProjectGlyph project={chosen.project} /> : <Folder size={14} strokeWidth={2} aria-hidden="true" />}
          <span>{chosen ? chosen.title : "No project"}</span>
        </>,
        `Project: ${chosen ? chosen.title : "none"}`,
      )}
      {task.start
        ? pill(
            "start",
            task.start,
            true,
            <>
              <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
              <span>Starts {dueText(task.start)}</span>
            </>,
            `Start date: ${task.start}`,
          )
        : null}
      {pill(
        "due",
        task.due ?? "",
        !!task.due,
        <>
          <Calendar size={14} strokeWidth={2} aria-hidden="true" />
          <span>{task.due ? dueText(task.due) : "Due date"}</span>
          {task.due && dueDistance(task.due, task.status) ? (
            <span className="dag-taskpanel__distance">{dueDistance(task.due, task.status)}</span>
          ) : null}
        </>,
        `Due date: ${task.due ?? "none"}`,
        { "data-late": late ? "" : undefined },
      )}
      {pickers}
      {element}
    </div>
  );
}

/**
 * A date in a properties list: the browser's own date input, which knows the person's locale
 * and keyboard — but an empty one says *Empty*, as Notion's does, rather than `mm/dd/yyyy` in the
 * colour of a value. An overdue one is marked in the input itself.
 */
function DateField({
  value,
  max,
  min,
  editable,
  hook,
  label,
  late,
  onChange,
}: {
  value?: string | null;
  max?: string;
  min?: string;
  editable: boolean;
  hook: string;
  label: string;
  late?: boolean;
  onChange(next: string | null): void;
}) {
  return (
    <span className={value ? "dag-facts__date" : "dag-facts__date dag-facts__date--empty"} data-late={late ? "" : undefined}>
      <input
        type="date"
        value={value ?? ""}
        max={max}
        min={min}
        disabled={!editable}
        aria-label={label}
        title={late ? "Overdue" : undefined}
        {...{ [hook]: "" }}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {value ? null : (
        <span className="dag-facts__empty" aria-hidden="true">
          Empty
        </span>
      )}
    </span>
  );
}
