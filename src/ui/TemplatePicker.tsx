import { CalendarPlus, FileText, LayoutTemplate, SquareCheckBig, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { isLocked, refuseLocked } from "@/settings/lock";

import { Dialog } from "./Dialog";
import { Button } from "./controls";
import { addStarters, readTemplates, type TemplateList, type TemplateMakes } from "./templates";

/** Lucide at one size and weight, stated once — the board browser's. */
const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What each template makes, in a row's mark: a note is a page, a task a check, an event a calendar. */
const MARK: Record<TemplateMakes, { icon: LucideIcon; word: string }> = {
  note: { icon: FileText, word: "Note" },
  task: { icon: SquareCheckBig, word: "Task" },
  event: { icon: CalendarPlus, word: "Event" },
};

/** The folder a template sits in below the templates folder — `meetings` for `Templates/meetings/standup`, or nothing. */
const below = (name: string, folder: string | null): string => {
  const rest = folder && name.startsWith(`${folder}/`) ? name.slice(folder.length + 1) : name;
  return rest.includes("/") ? rest.slice(0, rest.lastIndexOf("/")) : "";
};

/**
 * **New note from template**: a title, and the templates to make it from.
 *
 * A template's `{{title}}` is filled when the note is made and never again, so the title is asked for
 * *here*, before the note exists — the field is first, with the caret in it, and empty is fine: the
 * note then starts *Untitled* and is named on its own page, as New note is. Choosing a template makes
 * the note and opens it; nothing is made until one is chosen.
 *
 * The dialog is the board browser's shape (`dag-browser`, the same rows and the same keys): the
 * field, then the list, with the arrow keys moving between them and Enter in the field making the
 * note when there is only one template to make it from. With no templates it says where they
 * live and offers the three starters — **written only when the button is pressed**, because opening
 * a vault, and this dialog, write nothing.
 *
 * Making the note is `Shell`'s (`onMake`), the way every New makes one: it resolves to the sentence
 * saying why not, which is shown under the list and leaves the dialog up.
 */
export function TemplatePicker({
  folder,
  title: typed,
  onMake,
  onClose,
}: {
  /** Where the note will be made: `""` is the top level. */
  folder: string;
  /** Words already typed, which become the title. */
  title: string;
  onMake(template: string, folder: string, title: string): Promise<string | null>;
  onClose(): void;
}) {
  const [title, setTitle] = useState(typed);
  /* `undefined` while it loads; `null` when the server could not be asked. */
  const [list, setList] = useState<TemplateList | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    void readTemplates().then(setList);
  }, []);
  useEffect(load, [load]);
  useEffect(() => field.current?.focus(), []);

  const make = async (template: string) => {
    if (busy) return;
    if (isLocked()) return void refuseLocked();
    setBusy(true);
    setProblem(null);
    const why = await onMake(template, folder, title.trim());
    setBusy(false);
    if (why) setProblem(why);
  };

  const starters = async () => {
    if (isLocked()) return void refuseLocked();
    setBusy(true);
    const why = await addStarters();
    setBusy(false);
    if (why) setProblem(why);
    else {
      setProblem(null);
      load();
    }
  };

  const buttons = () => Array.from(rows.current?.querySelectorAll<HTMLElement>("[data-dag-template]") ?? []);

  const onField = (e: KeyboardEvent<HTMLInputElement>) => {
    const all = list?.templates ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons()[0]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (all.length === 1) void make(all[0]!.name);
      else buttons()[0]?.focus();
    }
  };

  const onRow = (e: KeyboardEvent<HTMLElement>) => {
    const all = buttons();
    const i = all.indexOf(e.target as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[Math.min(all.length - 1, i + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) field.current?.focus();
      else all[i - 1]?.focus();
    }
  };

  const templates = list?.templates ?? [];

  return (
    <Dialog
      scrim={{ "data-dag-templates": "" }}
      onClose={onClose}
      className="dag-browser dag-templates"
      aria-label="New note from template"
      aria-busy={busy || undefined}
    >
      <div className="dag-panel__search">
        <LayoutTemplate {...ICON} aria-hidden="true" />
        <input
          ref={field}
          type="text"
          className="dag-panel__input"
          data-dag-templates-title=""
          placeholder="Title (optional)"
          aria-label="Title"
          spellCheck={false}
          autoComplete="off"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onField}
        />
        <button
          className="dag-panel__clear"
          data-dag-templates-close=""
          aria-label="Close"
          title="Close (Escape)"
          onClick={onClose}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </div>

      <div className="dag-panel__list" ref={rows} onKeyDown={onRow} role="group" aria-label="Templates">
        {list === undefined ? <p className="dag-panel__empty">reading the templates…</p> : null}
        {list === null ? (
          <p className="dag-panel__empty" role="alert" data-dag-templates-failed="">
            The templates could not be read. Try again.
          </p>
        ) : null}
        {templates.map((t) => {
          const Mark = MARK[t.makes].icon;
          const where = below(t.name, list?.folder ?? null);
          return (
            <div key={t.name} className="dag-board-row">
              <button
                type="button"
                className="dag-board"
                data-dag-template={t.name}
                data-dag-template-makes={t.makes}
                title={t.makes === "note" ? t.name : `${t.name} (makes a ${t.makes})`}
                disabled={busy}
                onClick={() => void make(t.name)}
              >
                <Mark {...ICON} className="dag-board__kind" aria-hidden="true" />
                {t.title}
                {where ? <span className="dag-templates__where"> · {where}</span> : null}
              </button>
            </div>
          );
        })}
        {list && templates.length === 0 ? (
          <div className="dag-templates__none" data-dag-templates-empty="">
            <p className="dag-panel__empty">
              {list.folder
                ? `No notes in ${list.folder}/ yet.`
                : "No templates yet. A template is a note in a folder called Templates, or the folder Settings names."}
            </p>
            <Button size="sm" data-dag-templates-starters="" disabled={busy} onClick={() => void starters()}>
              Add starter templates
            </Button>
          </div>
        ) : null}
        {problem ? (
          <p className="dag-panel__empty dag-templates__problem" role="alert" data-dag-templates-problem="">
            {problem}
          </p>
        ) : null}
      </div>

      <p className="dag-panel__count">
        {folder ? `Made in ${folder}. ` : ""}
        {"{{title}}"}, {"{{date}}"}, {"{{time}}"} and {"{{date:FORMAT}}"} are filled in once, when the note is made.
      </p>
    </Dialog>
  );
}
