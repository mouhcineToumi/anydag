import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { refComponents } from "@/refs/Ref";
import { applyTheme } from "@/theme/applyTheme";
import type { Theme } from "@/theme/contract";
import type { NoteEvent } from "@/note/event";
import type { Project } from "@/note/project";
import type { Task } from "@/note/task";
import { ProjectLine } from "@/ui/ProjectBar";
import { EventLine } from "@/ui/EventBar";
import { TaskLine } from "@/ui/TaskGlyph";

import { drawn, READY_WITHIN } from "./drawn";
import { NoteMarkdown } from "./NoteRead";

/**
 * A note set out for paper — what "Note as PDF" prints, and what `anydag note export
 * --format pdf` photographs.
 *
 * **The file, not the editor.** It is the read-only drawing `?view=1` and `?snapshot=1` already make
 * of a note — `react-markdown` over the text, the same embeds and references — because a PDF is a
 * fact about the note and BlockNote's DOM is an editor's: side handles, placeholders, a caret. The
 * frontmatter's title goes at the top when there is one, as it is at the top of the page on screen
 * — set here rather than taken from there, because that one is a text box.
 *
 * It is a portal on `<body>`, beside the app rather than inside it, so the print stylesheet can take
 * everything else off the page with one rule — `html[data-dag-printing] body > :not(.dag-print)` —
 * and leave this alone. The attribute is set only while this is mounted, so ctrl+P anywhere else in
 * the app prints what it always printed.
 *
 * On screen it is laid out and never seen: `visibility: hidden` behind everything, at the width the
 * page will have, so an embedded board is fitted to the width it will be printed at. Hidden rather
 * than `display: none`, which would lay nothing out and leave an embed nothing to fit.
 *
 * **`onReady` means drawn**, the bar `data-dag-ready` holds a board to: the fonts, every picture, and
 * every embed — a board once each of its items has reported its size, a note once its text arrived.
 * A picture of a note taken before its images land is a PDF with holes in it. It gives up waiting
 * after `READY_WITHIN` and prints what there is, because a print that never comes is worse than one
 * with a gap where a broken image was.
 */

export function NotePrint({
  name,
  title,
  task,
  project,
  event,
  body,
  theme,
  onReady,
}: {
  name: string;
  /** The frontmatter's `title:`, set as the page's heading when there is one. */
  title?: string;
  /** Its status and due date when the note is a task, set under the heading. */
  task?: Task;
  /** Its status when the note is a project, set under the heading beside a task's. */
  project?: Project;
  /** When it is, when the note is an event. */
  event?: NoteEvent;
  /** The Markdown after the frontmatter. */
  body: string;
  /** Always a light one — `paperTheme()` — scoped to this element, so the app behind keeps its own. */
  theme: Theme;
  onReady(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  /* Before paint, so nothing is ever drawn here in the screen's theme. `applyTheme` takes an element
     for exactly this: the variables land on this one and everything inside inherits them. */
  useLayoutEffect(() => {
    if (root.current) applyTheme(theme, root.current);
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.dagPrinting = "";
    return () => {
      delete document.documentElement.dataset.dagPrinting;
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let live = true;
    const gaveUp = new Promise<void>((r) => setTimeout(r, READY_WITHIN));
    void Promise.race([drawn(el), gaveUp]).then(() => {
      if (live) ready.current();
    });
    return () => {
      live = false;
    };
  }, []);

  return createPortal(
    <div ref={root} className="dag-print" data-dag-print={name}>
      {title ? <h1 className="dag-print__title">{title}</h1> : null}
      {project ? <ProjectLine project={project} /> : null}
      {task ? <TaskLine task={task} /> : null}
      {event ? <EventLine event={event} /> : null}
      <NoteMarkdown name={name} body={body} components={refComponents()} />
    </div>,
    document.body,
  );
}
