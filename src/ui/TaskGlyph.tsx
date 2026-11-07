import { Circle, CircleCheck, Contrast } from "lucide-react";

import { nextStatus, overdue, STATUS_LABEL, today, type Task, type TaskStatus } from "@/note/task";

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
 * The status as a button that moves the task on — to do, in progress, done, and back to the start —
 * or as the glyph alone where nothing may change it (`onStatus` absent).
 *
 * The press is stopped, because every place this sits is inside something else a press means:
 * a row that opens the task, a card on a board that selects the item and would start a drag.
 */
export function StatusButton({
  status,
  onStatus,
  size = 14,
}: {
  status: TaskStatus;
  onStatus?(next: TaskStatus): void;
  size?: number;
}) {
  if (!onStatus) {
    return (
      <span className="dag-task-status" data-dag-task-status={status} title={STATUS_LABEL[status]}>
        <TaskGlyph status={status} size={size} />
      </span>
    );
  }
  const next = nextStatus(status);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <button
      type="button"
      className="dag-task-status"
      data-dag-task-status={status}
      aria-label={`${STATUS_LABEL[status]}: mark as ${STATUS_LABEL[next].toLowerCase()}`}
      title={`${STATUS_LABEL[status]} — click for ${STATUS_LABEL[next].toLowerCase()}`}
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

const FORMAT_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const FORMAT_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A due date as a person reads it: *Today*, *Tomorrow*, *Yesterday*, *Oct 3*, or *Oct 3, 2027*
 * when it is not this year. Read in UTC because the date is a calendar day, not an instant: in any
 * other zone `2026-10-03` at midnight is sometimes the second.
 */
function dueText(due: string, now: string = today()): string {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const at = new Date(day(due));
  return due.slice(0, 4) === now.slice(0, 4) ? FORMAT_DAY.format(at) : FORMAT_YEAR.format(at);
}

/** The due date, marked when it has passed and the task is not done. Nothing when there is none. */
export function DueLabel({ task }: { task: Task }) {
  if (!task.due) return null;
  const late = overdue(task);
  return (
    <span
      className="dag-task-due"
      data-dag-task-due={task.due}
      data-overdue={late ? "" : undefined}
      title={late ? `Overdue: due ${task.due}` : `Due ${task.due}`}
    >
      {dueText(task.due)}
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
