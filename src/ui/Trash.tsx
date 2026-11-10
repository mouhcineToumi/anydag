import { Check, FileText, Folder, GraduationCap, RotateCcw, Table2, Trash2, Workflow, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { onTrash } from "@/board/events";
import type { FileKind, TrashEntry } from "@/board/useBoard";
import { FileIcon as AttachmentIcon } from "@/files/FileIcon";
import { lockedAffordance, refuseLocked, setLocked, useLocked } from "@/settings/lock";

import { daysLeft, deleteForever, emptyTrash, readTrash, restoreFromTrash, type TrashList } from "./trashApi";
import { counted, leaf, parentOf } from "./tree";

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SMALL = { ...ICON, size: 14 } as const;

/* An attachment wears its type's own mark (`AttachmentIcon`), as it does in the sidebar. */
const KIND_ICON = { board: Workflow, note: FileText, quiz: GraduationCap, table: Table2 } satisfies Record<
  Exclude<FileKind, "file">,
  LucideIcon
>;

const KIND_WORD: Record<FileKind | "folder", string> = {
  board: "Board",
  note: "Note",
  quiz: "Quiz",
  table: "Table",
  file: "File",
  folder: "Folder",
};

const DAY = 86_400_000;

/** When it was deleted, as a person says it: today, yesterday, 3 days ago. */
function ago(deleted: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(deleted)) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** How long it has, as a person says it. */
function left(expires: string): string {
  const n = daysLeft(expires);
  return n === 0 ? "goes for good today" : `${counted(n, ["day", "days"])} left`;
}

/**
 * The entries under one heading per day they were deleted on — *Today*, *Yesterday*, *3 days ago* —
 * in the order they came, which is newest first. Every row of a day said the same two dates; the
 * heading says them once.
 */
function byDay(entries: TrashEntry[]): [string, TrashEntry[]][] {
  const days = new Map<string, TrashEntry[]>();
  for (const e of entries) {
    const day = ago(e.deleted);
    const run = days.get(day);
    if (run) run.push(e);
    else days.set(day, [e]);
  }
  return [...days];
}

/** What it is called: a file's title, or the last part of its name; a folder by its name. */
const nameOf = (e: TrashEntry): string => (e.kind === "folder" ? leaf(e.name) : (e.title ?? leaf(e.name)));

/** What a folder held, counted: `3 files and 1 folder`. */
function holding(e: TrashEntry): string {
  if (!e.holds) return "";
  const files = [e.holds.boards, e.holds.notes, e.holds.quizzes, e.holds.tables, e.holds.files].reduce((n, l) => n + l.length, 0);
  const folders = Math.max(0, e.holds.folders.length - 1);
  const parts = [files ? counted(files, ["file", "files"]) : "", folders ? counted(folders, ["folder", "folders"]) : ""].filter(
    Boolean,
  );
  return parts.length ? parts.join(" and ") : "Empty";
}

function Mark({ entry }: { entry: TrashEntry }) {
  if (entry.kind === "folder") return <Folder {...SMALL} aria-hidden="true" />;
  if (entry.kind === "file") return <AttachmentIcon name={entry.name} {...SMALL} />;
  const Icon = KIND_ICON[entry.kind];
  return <Icon {...SMALL} aria-hidden="true" />;
}

/**
 * The Trash page, `?trash=1`: everything somebody deleted, newest first,
 * with how long each has before it goes for good, and the three things done to it — Restore, Delete
 * forever, Empty trash. The last two ask in place, Delete forever in its row and Empty trash under
 * the bar, because they are the only deletes left that cannot be taken back.
 *
 * It hears `dag:trash`, which the change feed sends when the trash changes anywhere — another tab,
 * the CLI, an agent — so it never offers to restore what somebody already has.
 */
export function TrashView({ onOpen }: { onOpen(kind: FileKind, name: string): void }) {
  const [list, setList] = useState<TrashList | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  /* The one question being asked: delete this entry for good, or empty the whole trash. */
  const [asking, setAsking] = useState<string | "empty" | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /* What was just put back, and where — said at the top with a way to open it; or what went wrong. */
  const [said, setSaid] = useState<{ back?: TrashEntry; problem?: string } | null>(null);
  /* Read only: the trash is listed and filtered, and nothing in it is restored or deleted. */
  const locked = useLocked();

  const load = useCallback(async () => {
    const got = await readTrash();
    if (got) setList(got);
    setFailed(!got);
  }, []);

  useEffect(() => {
    void load();
    return onTrash(() => void load());
  }, [load]);

  const shown = useMemo(() => {
    const entries = list?.entries ?? [];
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return entries;
    return entries.filter((e) => {
      const hay = `${e.title ?? ""} ${e.name}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [list, filter]);

  const working = (id: string, on: boolean) =>
    setBusy((had) => {
      const next = new Set(had);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const restore = async (e: TrashEntry) => {
    working(e.id, true);
    const back = await restoreFromTrash(e.id);
    working(e.id, false);
    if (typeof back === "string") setSaid({ problem: back });
    else {
      setSaid({ back });
      /* The list hears it through the feed too; told here so a row the person pressed goes now. */
      setList((had) => (had ? { ...had, entries: had.entries.filter((x) => x.id !== e.id) } : had));
      dispatchEvent(new CustomEvent("dag:boards"));
    }
  };

  const forget = async (e: TrashEntry) => {
    setAsking(null);
    working(e.id, true);
    const problem = await deleteForever(e.id);
    working(e.id, false);
    if (problem) setSaid({ problem });
    else setList((had) => (had ? { ...had, entries: had.entries.filter((x) => x.id !== e.id) } : had));
  };

  const empty = async () => {
    setAsking(null);
    working("empty", true);
    const problem = await emptyTrash();
    working("empty", false);
    if (problem) setSaid({ problem });
    else {
      setSaid(null);
      setList((had) => (had ? { ...had, entries: [] } : had));
    }
  };

  const days = list?.days;
  const count = list?.entries.length ?? 0;

  return (
    <main className="dag-trash" data-dag-trash="">
      <div className="dag-trash__bar">
        <input
          className="dag-trash__filter"
          type="search"
          placeholder="Filter the trash"
          aria-label="Filter the trash"
          data-dag-trash-filter=""
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {count ? (
          <button
            type="button"
            className="dag-trash__empty"
            data-dag-trash-empty=""
            {...lockedAffordance(locked)}
            disabled={!locked && busy.has("empty")}
            onClick={() => (locked ? refuseLocked() : setAsking("empty"))}
          >
            <Trash2 {...SMALL} aria-hidden="true" />
            Empty trash
          </button>
        ) : null}
      </div>

      {days ? (
        <p className="dag-trash__intro" data-dag-trash-days={days}>
          Deleted items go for good after {counted(days, ["day", "days"])}.
        </p>
      ) : null}

      {locked && count ? (
        <p className="dag-trash__said" data-dag-trash-locked="">
          Read only: unlock to restore or delete anything here.{" "}
          <button type="button" className="dag-trash__link" data-dag-trash-unlock="" onClick={() => setLocked(false)}>
            Unlock
          </button>
        </p>
      ) : null}

      {asking === "empty" && !locked ? (
        <div className="dag-trash__ask" role="alertdialog" aria-label="Empty the trash" data-dag-trash-empty-ask="">
          <span>Delete the {counted(count, ["item", "items"])} in the trash for good? This cannot be undone.</span>
          <button
            type="button"
            className="dag-trash__danger"
            data-dag-trash-empty-confirm=""
            autoFocus
            onClick={() => void empty()}
          >
            Delete for good
          </button>
          <button type="button" className="dag-trash__plain" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {said?.back ? (
        <p className="dag-trash__said" role="status" data-dag-trash-restored={said.back.name}>
          Restored “{nameOf(said.back)}”{parentOf(said.back.name) ? ` to ${parentOf(said.back.name)}` : ""}.
          {said.back.kind !== "folder" ? (
            <button
              type="button"
              className="dag-trash__link"
              data-dag-trash-open=""
              onClick={() => onOpen(said.back!.kind as FileKind, said.back!.name)}
            >
              Open it
            </button>
          ) : null}
        </p>
      ) : null}
      {said?.problem ? (
        <p className="dag-trash__said dag-trash__said--problem" role="alert" data-dag-trash-problem="">
          {said.problem}
        </p>
      ) : null}

      {failed && !list ? (
        <p className="dag-trash__none" role="alert">
          The trash could not be read. Try again in a moment.
        </p>
      ) : list && !count ? (
        <p className="dag-trash__none" data-dag-trash-none="">
          Nothing in the trash.
        </p>
      ) : list && !shown.length ? (
        <p className="dag-trash__none">Nothing in the trash matches “{filter.trim()}”.</p>
      ) : (
        <div className="dag-trash__days">
          {byDay(shown).map(([day, entries]) => (
            <section key={day} className="dag-trash__day" data-dag-trash-day={day}>
              <h3 className="dag-trash__heading">
                <span>{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                <span className="dag-trash__left">{left(entries[0]!.expires)}</span>
              </h3>
              <ul className="dag-trash__rows" aria-label={`Deleted ${day}`}>
                {entries.map((e) => {
                  const where = parentOf(e.name);
                  const what = e.kind === "folder" ? holding(e) : KIND_WORD[e.kind];
                  const pending = busy.has(e.id);
                  return (
                    <li
                      key={e.id}
                      className="dag-trash__row"
                      data-dag-trash-entry={e.name}
                      data-dag-trash-id={e.id}
                      data-dag-trash-kind={e.kind}
                    >
                      <span className="dag-trash__mark">
                        <Mark entry={e} />
                      </span>
                      <span className="dag-trash__what">
                        <span className="dag-trash__title" title={e.name}>
                          {nameOf(e)}
                        </span>
                        <span className="dag-trash__meta">
                          {what}
                          {where ? ` · in ${where}` : ""}
                        </span>
                      </span>
                      {locked ? (
                        <span className="dag-trash__acts">
                          <button
                            type="button"
                            className="dag-trash__plain"
                            data-dag-trash-restore=""
                            {...lockedAffordance(true)}
                            onClick={() => refuseLocked()}
                          >
                            <RotateCcw {...SMALL} aria-hidden="true" />
                            Restore
                          </button>
                          <button
                            type="button"
                            className="dag-icon dag-trash__forget"
                            data-dag-trash-forget=""
                            aria-label={`Delete ${nameOf(e)} for good`}
                            {...lockedAffordance(true)}
                            onClick={() => refuseLocked()}
                          >
                            <Trash2 {...SMALL} aria-hidden="true" />
                          </button>
                        </span>
                      ) : asking === e.id ? (
                        <span
                          className="dag-trash__ask dag-trash__ask--row"
                          role="alertdialog"
                          aria-label={`Delete ${nameOf(e)} for good`}
                        >
                          <span>Delete for good?</span>
                          <button
                            type="button"
                            className="dag-icon dag-trash__danger"
                            data-dag-trash-forget-confirm=""
                            aria-label={`Delete ${nameOf(e)} for good`}
                            autoFocus
                            onClick={() => void forget(e)}
                          >
                            <Check {...SMALL} aria-hidden="true" />
                          </button>
                          <button type="button" className="dag-icon" aria-label="Keep it" onClick={() => setAsking(null)}>
                            <X {...SMALL} aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <span className="dag-trash__acts">
                          <button
                            type="button"
                            className="dag-trash__plain"
                            data-dag-trash-restore=""
                            disabled={pending}
                            onClick={() => void restore(e)}
                          >
                            <RotateCcw {...SMALL} aria-hidden="true" />
                            Restore
                          </button>
                          <button
                            type="button"
                            className="dag-icon dag-trash__forget"
                            data-dag-trash-forget=""
                            aria-label={`Delete ${nameOf(e)} for good`}
                            title="Delete for good"
                            disabled={pending}
                            onClick={() => setAsking(e.id)}
                          >
                            <Trash2 {...SMALL} aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
