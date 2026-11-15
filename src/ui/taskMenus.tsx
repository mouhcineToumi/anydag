import { Calendar, CalendarPlus, CircleSlash, X } from "lucide-react";

import type { Project } from "@/note/project";
import { STATUS_LABEL, STATUSES, today, type Priority, type TaskStatus } from "@/note/task";

import { ProjectGlyph } from "./ProjectBar";
import { dueText, PRIORITY_KEYS, PriorityMark, TaskGlyph } from "./TaskGlyph";
import type { MenuRow } from "./TasksMenu";

/**
 * The rows of a task's four menus — status, priority, project, due date — written once, because a
 * row on the Tasks page, a pill of a task being made and a line of a task's own page all open the
 * same ones (#311). Each value carries the icon its column draws, and the keys the menu answers.
 */

/** A project a menu can offer: its note's name, the project, and what it is called. */
export interface ProjectChoice {
  name: string;
  project: Project;
  title: string;
}

export const statusRows = (now: TaskStatus | null, pick: (s: TaskStatus) => void): MenuRow[] =>
  STATUSES.map((s, i) => ({
    key: s,
    label: STATUS_LABEL[s],
    icon: <TaskGlyph status={s} />,
    hint: String(i + 1),
    checked: now === s,
    data: { "data-dag-task-menu-status": s },
    onPick: () => pick(s),
  }));

export const priorityRows = (now: Priority | null, pick: (p: Priority | null) => void): MenuRow[] =>
  PRIORITY_KEYS.map(({ priority, key, label }) => ({
    key: priority ?? "none",
    label,
    icon: <PriorityMark priority={priority ?? undefined} />,
    hint: key,
    checked: now === priority,
    data: { "data-dag-task-menu-priority": priority ?? "none" },
    onPick: () => pick(priority),
  }));

export const projectRows = (
  choices: readonly ProjectChoice[],
  now: string | null,
  pick: (name: string | null) => void,
): MenuRow[] => [
  {
    key: "none",
    label: "No project",
    icon: <CircleSlash size={14} strokeWidth={2} aria-hidden="true" />,
    checked: now === null,
    data: { "data-dag-task-menu-project": "" },
    onPick: () => pick(null),
  },
  ...choices.map(
    (p): MenuRow => ({
      key: p.name,
      label: p.title,
      icon: <ProjectGlyph project={p.project} />,
      checked: now === p.name,
      data: { "data-dag-task-menu-project": p.name },
      onPick: () => pick(p.name),
    }),
  ),
];

/** `YYYY-MM-DD`, `days` after today here. */
function inDays(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return today(at);
}

/**
 * A date's menu: today, tomorrow, a week on, the browser's own picker (`pickDate`, which knows the
 * locale and the keyboard), and — once there is one — no date.
 */
export const dueRows = (now: string | null, pick: (day: string | null) => void, pickDate: () => void): MenuRow[] => {
  const day = (key: string, label: string, value: string): MenuRow => ({
    key,
    label,
    icon: <Calendar size={14} strokeWidth={2} aria-hidden="true" />,
    hint: dueText(value),
    checked: now === value,
    data: { "data-dag-task-menu-due": key },
    onPick: () => pick(value),
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
      onPick: pickDate,
    },
    ...(now
      ? [
          {
            key: "none",
            label: "No date",
            icon: <X size={14} strokeWidth={2} aria-hidden="true" />,
            data: { "data-dag-task-menu-due": "none" },
            onPick: () => pick(null),
          },
        ]
      : []),
  ];
};

/** Open the browser's own date picker on `el`, or focus it where there is no `showPicker`. */
export function showDatePicker(el: HTMLInputElement | null): void {
  if (!el) return;
  try {
    el.showPicker();
  } catch {
    el.focus();
  }
}
