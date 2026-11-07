import { useEffect, useRef, useState } from "react";

import { ChevronDown, CircleCheck, CircleDot, CirclePause, FolderKanban, ListTodo, Palette, X, type LucideIcon } from "lucide-react";

import { HUE_ORDER, type Hue } from "@/dsl/ir";
import { PROJECT_LABEL, PROJECT_STATUSES, type Project, type ProjectChange, type ProjectStatus } from "@/note/project";
import { STATUS_LABEL, STATUSES, type TaskStatus } from "@/note/task";
import { hueVars } from "@/render/hue";

import { TaskGlyph } from "./TaskGlyph";

/**
 * A project's marks: the bar on its own page, the line on a read-only
 * one, and the chip a task row names its project with.
 *
 * A project is a note with a `project:`, and the folder it is in is the project — so everything
 * here reads a note's frontmatter or the listing's names, and nothing stores a membership.
 */

const STATUS_ICON = { active: CircleDot, paused: CirclePause, done: CircleCheck } satisfies Record<ProjectStatus, LucideIcon>;

/** What a project holds, as far as the project's page needs to say: its tasks, counted by status. */
export interface ProjectMembers {
  /** How many tasks under the project's folder are in each status. */
  counts: Readonly<Record<TaskStatus, number>>;
  /**
   * Why this note holds nothing, when it does not: at the top level it has no folder, and in a
   * folder another project note already owns it holds nothing of its own. `undefined` when it is
   * the folder's project.
   */
  why?: string;
  /** Open the Tasks page filtered to this project. */
  onTasks?(): void;
  /** Open the calendar filtered to this project. */
  onCalendar?(): void;
}

/** The project's colour as a small mark — the folder glyph, tinted, on the chrome's colour rule. */
export function ProjectGlyph({ project, size = 14 }: { project: Project; size?: number }) {
  return <FolderKanban size={size} strokeWidth={2} className="dag-project-glyph" style={hueVars(project.hue)} aria-hidden="true" />;
}

/**
 * The bar under a project's title: its status as three choices, its colour, what it holds and the
 * way to its tasks, and the way back to being a plain note. The task bar's shape, one level up.
 */
export function ProjectBar({
  project,
  members,
  onChange,
  editable,
}: {
  project: Project;
  members?: ProjectMembers;
  onChange(change: ProjectChange): void;
  editable: boolean;
}) {
  const total = members ? STATUSES.reduce((n, s) => n + members.counts[s], 0) : 0;
  return (
    <div className="dag-taskbar dag-projectbar dag-facts" data-dag-projectbar={project.status}>
      <span className="dag-facts__label">
        <ProjectGlyph project={project} />
        Status
      </span>
      <span className="dag-facts__value">
        <span className="dag-taskbar__status" role="radiogroup" aria-label="Project status">
          {PROJECT_STATUSES.map((status) => {
            const Icon = STATUS_ICON[status];
            return (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={project.status === status}
                className="dag-taskbar__choice"
                data-dag-projectbar-status={status}
                disabled={!editable}
                onClick={() => onChange({ project: status })}
              >
                <Icon size={14} strokeWidth={2} aria-hidden="true" />
                <span>{PROJECT_LABEL[status]}</span>
              </button>
            );
          })}
        </span>
      </span>
      <span className="dag-facts__label">
        <Palette size={14} strokeWidth={2} aria-hidden="true" />
        Colour
      </span>
      <span className="dag-facts__value">
        <HuePicker hue={project.hue} editable={editable} onChange={(hue) => onChange({ hue })} />
      </span>
      {members ? (
        <>
          <span className="dag-facts__label">
            <ListTodo size={14} strokeWidth={2} aria-hidden="true" />
            Tasks
          </span>
          <span className="dag-facts__value">
            {members.why ? (
              <span className="dag-projectbar__why" data-dag-projectbar-why="">
                {members.why}
              </span>
            ) : (
              <span className="dag-projectbar__counts" data-dag-projectbar-counts={total}>
                {total === 0
                  ? "No tasks in it yet"
                  : STATUSES.filter((s) => members.counts[s] > 0).map((s) => (
                      <span key={s} className="dag-projectbar__count" data-dag-projectbar-count={s}>
                        <TaskGlyph status={s} />
                        {members.counts[s]} {STATUS_LABEL[s].toLowerCase()}
                      </span>
                    ))}
              </span>
            )}
            {members.onTasks && !members.why ? (
              <button type="button" className="dag-projectbar__tasks" data-dag-projectbar-tasks="" onClick={members.onTasks}>
                Open tasks
              </button>
            ) : null}
            {members.onCalendar && !members.why ? (
              <button type="button" className="dag-projectbar__tasks" data-dag-projectbar-calendar="" onClick={members.onCalendar}>
                Open calendar
              </button>
            ) : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** A project's status on a page that cannot change it: `?view=1`, a share link, a snapshot, the PDF. */
export function ProjectLine({ project }: { project: Project }) {
  return (
    <p className="dag-taskbar dag-taskbar--read" data-dag-projectline={project.status}>
      <ProjectGlyph project={project} />
      <span>Project</span>
      <span aria-hidden="true">·</span>
      <span>{PROJECT_LABEL[project.status]}</span>
    </p>
  );
}

/** The project a task belongs to, on its row: the glyph in its colour and its title. */
export function ProjectChip({ project, title }: { project: Project; title: string }) {
  return (
    <span className="dag-project-chip" data-dag-project-chip={title} style={hueVars(project.hue)} title={`In the project ${title}`}>
      <ProjectGlyph project={project} size={12} />
      <span>{title}</span>
    </span>
  );
}

/**
 * The project's colour as one swatch that opens the ten — ten coloured dots in a row read as a
 * decision still to be made, on a page that has already made it. The choices are the radiogroup
 * they always were, only behind the swatch, and the way to take the colour off is with them.
 */
function HuePicker({ hue, editable, onChange }: { hue: Hue | undefined; editable: boolean; onChange(hue: Hue | null): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  const choose = (next: Hue | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <span
      ref={box}
      className="dag-projectbar__picker"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          box.current?.querySelector<HTMLElement>("[data-dag-projectbar-colour]")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="dag-projectbar__swatch"
        data-dag-projectbar-colour={hue ?? ""}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!editable}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dag-projectbar__dot" style={hueVars(hue)} data-none={hue ? undefined : ""} aria-hidden="true" />
        <span>{hue ? hue.charAt(0).toUpperCase() + hue.slice(1) : "None"}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <span className="dag-projectbar__hues" role="radiogroup" aria-label="Project colour">
          {HUE_ORDER.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={hue === h}
              aria-label={h}
              title={h}
              className="dag-projectbar__hue"
              data-dag-projectbar-hue={h}
              style={hueVars(h)}
              onClick={() => choose(h)}
            />
          ))}
          {hue ? (
            <button
              type="button"
              className="dag-taskbar__clear dag-projectbar__clear"
              data-dag-projectbar-clear-hue=""
              aria-label="Take the colour off"
              title="No colour"
              onClick={() => choose(null)}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
