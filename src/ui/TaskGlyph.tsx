import { Circle, CircleCheck, Contrast } from "lucide-react";

import { locale } from "@/locale";
import { overdue, STATUS_LABEL, today, toggledStatus, type Task, type TaskStatus } from "@/note/task";

/**
 * How a task's status and due date are drawn, wherever one is: a row in the sidebar, the
 * Tasks page, the bar on a task's own page, and a card on a board.
 *
 * No colour here, and no length: `.dag-task-glyph[data-status]` in `chrome.css` gives each status
 * the theme's own — muted, the warning hue, the success hue — and an overdue date the danger text.
 * It imports nothing but Lucide and `src/note/task.ts`, because a card on a board is drawn by
 * `src/refs/` in the read-only view too, and that page must not reach the editor.
 */

const GLYPH = { todo: Circle, "in-progress": Contrast, done: CircleCheck } as const;

export function TaskGlyph({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const G = GLYPH[status];
  return (
    <G
      size={size}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="dag-task-glyph"
      data-status={status}
      aria-hidden="true"
    />
  );
}

/**
 * The status as the task's checkbox (#311): a click on a task that is not done marks it done, and
 * on a done one marks it to do again — or the glyph alone where nothing may change it (`onStatus`
 * absent). It is a `role="checkbox"`, checked when done and mixed while in progress, so a screen
 * reader hears what a sighted person sees. In progress is one step further away: a row's menu, the
 * task's own page.
 *
 * The press is stopped, because every place this sits is inside something else a press means:
 * a row that opens the task, a card on a board that selects the item and would start a drag.
 */
export function StatusButton({
  status,
  onStatus,
  size = 14,
  label,
}: {
  status: TaskStatus;
  onStatus?(next: TaskStatus): void;
  size?: number;
  /** What the task is called, so the checkbox is named after it. */
  label?: string;
}) {
  if (!onStatus) {
    return (
      <span className="dag-task-status" data-dag-task-status={status} title={STATUS_LABEL[status]}>
        <TaskGlyph status={status} size={size} />
      </span>
    );
  }
  const next = toggledStatus(status);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const what = next === "done" ? "Mark as done" : "Mark as not done";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === "done" ? true : status === "in-progress" ? "mixed" : false}
      className="dag-task-status"
      data-dag-task-status={status}
      aria-label={label ? `${label}: ${STATUS_LABEL[status].toLowerCase()}` : STATUS_LABEL[status]}
      title={`${STATUS_LABEL[status]}: ${what.toLowerCase()}`}
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onStatus(next);
      }}
    >
      <TaskGlyph status={status} size={size} />
    </button>
  );
}

/* Made once per locale: a list of a hundred dates would otherwise build a formatter for each. */
const formats = new Map<string, Intl.DateTimeFormat>();
function format(kind: "week" | "day" | "year"): Intl.DateTimeFormat {
  const key = `${locale() ?? ""}|${kind}`;
  let f = formats.get(key);
  if (!f) {
    const parts: Intl.DateTimeFormatOptions =
      kind === "week"
        ? { weekday: "short", month: "short", day: "numeric" }
        : kind === "day"
          ? { month: "short", day: "numeric" }
          : { month: "short", day: "numeric", year: "numeric" };
    formats.set(key, (f = new Intl.DateTimeFormat(locale(), { ...parts, timeZone: "UTC" })));
  }
  return f;
}

/**
 * A due date as a person reads it, in their locale: *Today*, *Tomorrow*, *Yesterday*; the weekday
 * and the day within a week either side (*Thu 12 Nov*), the day alone further off (*25 Nov*), and
 * the year when it is not this one. Read in UTC because the date is a calendar day, not an instant:
 * in any other zone `2026-10-03` at midnight is sometimes the second.
 */
export function dueText(due: string, now: string = today()): string {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const at = new Date(day(due));
  if (due.slice(0, 4) !== now.slice(0, 4)) return format("year").format(at);
  return format(Math.abs(diff) < 7 ? "week" : "day").format(at);
}

/**
 * The due date: bold in the danger text when it has passed and the task is not done, bold ink when
 * it is today and not done, and plain otherwise — a done task's date says when and nothing more.
 * Nothing when there is none.
 */
export function DueLabel({ task }: { task: Task }) {
  if (!task.due) return null;
  const now = today();
  const late = overdue(task, now);
  const soon = !late && task.status !== "done" && task.due === now;
  return (
    <span
      className="dag-task-due"
      data-dag-task-due={task.due}
      data-overdue={late ? "" : undefined}
      data-today={soon ? "" : undefined}
      title={late ? `Overdue: due ${task.due}` : `Due ${task.due}`}
    >
      {dueText(task.due, now)}
    </span>
  );
}

/**
 * A task's status and date, read-only, above its text wherever it is drawn with nothing to change
 * it with: `?view=1`, a share link, `?snapshot=1`, and the PDF. The bar on the task's own page is
 * the editable twin, in `NoteView`.
 */
export function TaskLine({ task }: { task: Task }) {
  return (
    <p className="dag-taskbar dag-taskbar--read" data-dag-taskline={task.status}>
      <TaskGlyph status={task.status} />
      <span>{STATUS_LABEL[task.status]}</span>
      {task.due ? (
        <>
          <span aria-hidden="true">·</span>
          <span>due</span>
          <DueLabel task={task} />
        </>
      ) : null}
    </p>
  );
}
