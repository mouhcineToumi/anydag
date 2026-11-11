import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { FieldEditor } from "@/blocks";

import { QuizMarkdown } from "./QuizMarkdown";

/**
 * One rich field of the quiz form: the field drawn as what it says, until somebody opens it.
 *
 * **One editor at a time.** A quiz of fifty questions has three hundred fields, and three hundred
 * ProseMirror views is a page nobody can scroll. So a field is drawn read-only by `QuizMarkdown` —
 * the renderer the runner and the sheet use, so it looks like what will be asked — and a click, or the
 * keyboard's focus, puts the block editor in its place. Pressing anywhere outside it, or tabbing on,
 * puts the drawing back.
 *
 * **While a field is open its editor's document is the field.** The form redraws from the file on
 * every keystroke; an open field does not take the file's text back (that would be the caret jumping
 * under the person typing), and takes it again when it closes.
 */

/** What every field of one quiz's form shares: where its pictures go, and the editor's colours. */
export interface FieldHost {
  name: string;
  scheme: "light" | "dark";
  upload(file: File): Promise<string>;
  resolve(src: string): string;
}

export const FieldHostContext = createContext<FieldHost | null>(null);

/** What closing a field over: a press or a focus in any of these is still the field's — its menus, its toolbar, an equation's TeX. */
const STILL_OURS = ".dag-blocks, [data-dag-math-field], .bn-ui-container, .mantine-Popover-dropdown, .mantine-Menu-dropdown";

/** Put the caret in a field: its drawing takes the focus, and opening is what focusing it does. */
export function focusField(el: Element | null | undefined): void {
  const view = el?.matches(".dag-quiz__rich-view") ? el : el?.querySelector<HTMLElement>(".dag-quiz__rich-view");
  (view as HTMLElement | null | undefined)?.focus();
}

export interface RichFieldProps {
  md: string;
  variant: "line" | "block";
  label: string;
  placeholder: string;
  onCommit(md: string): void;
  /** Enter in a one-line field. */
  onEnter?(): void;
  readOnly?: boolean;
  /** Open as soon as it is drawn: a new question's prompt. */
  autoFocus?: boolean;
  className?: string;
  attrs?: Record<string, string>;
}

export function RichField({
  md,
  variant,
  label,
  placeholder,
  onCommit,
  onEnter,
  readOnly,
  autoFocus,
  className,
  attrs,
}: RichFieldProps) {
  const host = useContext(FieldHostContext);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /* What was typed while the field was opening, and how its editor takes text once it is there. */
  const typed = useRef("");
  const insert = useRef<((text: string) => void) | null>(null);
  /* The caret put back on the drawing by Escape: that focus is not a person opening the field. */
  const resting = useRef(false);

  /* Layout effects, both: a passive one runs after the browser may already have handed on the next
     key, and the field would open, or start listening, a letter late. */
  useLayoutEffect(() => {
    if (autoFocus && !readOnly) setOpen(true);
  }, [autoFocus, readOnly]);

  /* **Nothing typed while a field opens is lost.** Between the press that opens it and its editor
     holding the caret the focus is nobody's — the page, or the button that added the field — so a
     person who clicks *Add an answer* and types at once would lose the first letters. While the
     field is open, a letter that reaches no editor is the field's: kept until the editor binds, and
     handed to it after. A letter typed into another box (a select, a picker's search) is that box's. */
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const at = document.activeElement;
      if (at?.closest('[contenteditable="true"], input, textarea, select')) return;
      e.preventDefault();
      if (insert.current) insert.current(e.key);
      else typed.current += e.key;
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      typed.current = "";
      insert.current = null;
    };
  }, [open]);
  /* The editor is ready: what came before it goes in now, and anything after goes in as it comes. */
  const bind = (fn: (text: string) => void) => {
    insert.current = fn;
    const got = typed.current;
    typed.current = "";
    if (got) fn(got);
  };
  useEffect(() => {
    if (readOnly) setOpen(false);
  }, [readOnly]);

  useEffect(() => {
    if (!open) return;
    const away = (t: EventTarget | null) => t instanceof Element && !box.current?.contains(t) && !t.closest(STILL_OURS);
    const onDown = (e: PointerEvent) => {
      if (away(e.target)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (away(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [open]);

  const view: ReactNode = (
    <div
      className="dag-quiz__rich-view"
      role="textbox"
      aria-label={label}
      aria-readonly={readOnly ? true : undefined}
      aria-multiline={variant === "block"}
      tabIndex={readOnly ? -1 : 0}
      onFocus={() => {
        if (!readOnly && !resting.current) setOpen(true);
      }}
      /* A field closed with Escape keeps the caret on its drawing: Enter, or a letter, opens it again. */
      onKeyDown={(e) => {
        if (open || readOnly || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Enter") {
          e.preventDefault();
          setOpen(true);
        } else if (e.key.length === 1) {
          e.preventDefault();
          typed.current += e.key;
          setOpen(true);
        }
      }}
      /* A link in the drawing is the field's words, not a way out of the form. */
      onClickCapture={(e) => {
        if ((e.target as Element).closest("a")) e.preventDefault();
      }}
    >
      {md.trim() && host ? (
        <QuizMarkdown name={host.name} md={md} inline={variant === "line"} />
      ) : (
        <span className="dag-quiz__placeholder">{placeholder}</span>
      )}
    </div>
  );

  /* Escape: the drawing again, with the caret on it so Tab goes on from here — a focus that must
     not open it straight back. */
  const close = () => {
    setOpen(false);
    window.setTimeout(() => {
      resting.current = true;
      focusField(box.current);
      resting.current = false;
    });
  };

  return (
    <div
      ref={box}
      className={`dag-quiz__rich dag-quiz__rich--${variant}${className ? ` ${className}` : ""}`}
      data-dag-quiz-field=""
      data-dag-quiz-open-field={open ? "" : undefined}
      onPointerDown={(e) => {
        /* A press on the drawing opens it — `focus` does the rest, and does it for the keyboard too. */
        if (!open && !readOnly && e.button === 0) {
          e.preventDefault();
          setOpen(true);
        }
      }}
      {...attrs}
    >
      {open && host ? (
        <Suspense fallback={view}>
          <FieldEditor
            md={md}
            variant={variant}
            label={label}
            scheme={host.scheme}
            upload={host.upload}
            resolve={host.resolve}
            onChange={onCommit}
            onEnter={onEnter}
            onDone={close}
            bind={bind}
          />
        </Suspense>
      ) : (
        view
      )}
    </div>
  );
}
