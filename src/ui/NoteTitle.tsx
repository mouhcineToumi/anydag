import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";

import { UNTITLED } from "@/board/useBoard";
import { cleanTitle, TITLE_MAX } from "@/note/format";

/**
 * A note's title, at the top of its page, Notion's page title.
 *
 * It is the `title:` line of the frontmatter and nothing else, and that line is what
 * the note is called everywhere: the sidebar's row, a reference's tag, the toolbar. So committing it
 * is `/retitle` with `follow`, the same call the sidebar's rename makes, and the file's name follows
 * the title as a stem. The page does that itself (`NoteView`'s `retitle`), because it holds the text
 * the rename moves and must not be an outside writer to itself.
 *
 * **`Untitled` is shown as nothing**, with *Untitled* as the placeholder. It is what a new note is
 * called until somebody names it (`UNTITLED`), and a field that holds the word looks
 * answered; a grey placeholder in an empty field is what asks for one. A
 * note with no `title:` at all is untitled too, and reads the same way.
 *
 * A `<textarea>` rather than an `<input>` because a long title wraps, as a heading does, and never
 * `contentEditable`: this codebase keeps one copy of any text. It holds one line: Enter and a
 * pasted newline end it, and Enter goes on into the text below, which is where somebody who has
 * just named a note is going next.
 */

/** A note just made, whose page puts the caret in its title when it opens rather than naming its sidebar row. */
let naming: string | null = null;

/** Ask the note about to open under `name` to put the caret in its title. */
export function nameWhenOpened(name: string): void {
  naming = name;
}

/** Whether the note opening under `name` was asked to be named, once. */
export function takeNaming(name: string): boolean {
  if (naming !== name) return false;
  naming = null;
  return true;
}

/** What the field shows for a title: the words, or nothing for a note nobody has named. */
const shownOf = (title: string | undefined): string => (title === undefined || title === UNTITLED ? "" : title);

export function NoteTitle({
  title,
  editable,
  field,
  onCommit,
  onNext,
}: {
  /** The title the file has, as the page last read it. */
  title: string | undefined;
  editable: boolean;
  field?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Write it. Resolves to whether it was written; the field goes back to the file's title when not. */
  onCommit(title: string): Promise<boolean>;
  /** On into the text: Enter on a new line at its top (`newLine`), the arrow down off the end onto its first. */
  onNext(newLine: boolean): void;
}) {
  const shown = shownOf(title);
  const [draft, setDraft] = useState(shown);
  /* The file's title, for a commit that finishes after it has moved on. */
  const current = useRef(shown);
  current.current = shown;
  const focused = useRef(false);
  /* Escape takes the draft back and leaves the field; the blur that follows must not write. */
  const cancelled = useRef(false);
  const own = useRef<HTMLTextAreaElement | null>(null);

  /* Somebody else named it — the sidebar, an agent — while nobody was typing here: show that. */
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  /* `field-sizing: content` grows the field with what it holds; a browser without it is given the
     height by hand, once per change, which is the same answer read off `scrollHeight`. */
  useLayoutEffect(() => {
    const el = own.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commit = async (value: string) => {
    /* One line, single spaces, no ends, capped: `clean_title`'s rule, so what is compared is what the api would write. */
    const next = cleanTitle(value) ?? "";
    if (next === current.current) {
      setDraft(current.current);
      return;
    }
    /* Emptied is untitled again — the word a new note has, and the one that shows as the placeholder. */
    const ok = await onCommit(next || UNTITLED);
    if (!ok && !focused.current) setDraft(current.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      onNext(true);
      /* A page whose text is not up yet has nowhere to go on to, and the name is still written. */
      if (document.activeElement === el) el.blur();
      return;
    }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      e.preventDefault();
      onNext(false);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      setDraft(current.current);
      el.blur();
    }
  };

  return (
    <textarea
      ref={(el) => {
        own.current = el;
        if (field) field.current = el;
      }}
      className="dag-note-title"
      data-dag-note-title=""
      aria-label="Title"
      placeholder={UNTITLED}
      rows={1}
      maxLength={TITLE_MAX}
      spellCheck
      value={draft}
      readOnly={!editable}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\r?\n/g, " "))}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        focused.current = false;
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (editable) void commit(e.currentTarget.value);
      }}
    />
  );
}

/**
 * The title drawn read-only, where nothing may change it — `?view=1`, `?snapshot=1`:
 * the same place and the same type as the field, so a picture of a note is laid out as the page is.
 * Nothing at all for a note with no `title:`, whose name is in the bar above; *Untitled* muted for
 * one nobody has named yet, which is what the file says.
 */
export function NoteTitleRead({ title }: { title: string | undefined }) {
  if (title === undefined) return null;
  return (
    <h1
      className="dag-note-title dag-note-title--read"
      data-dag-note-title-read=""
      data-untitled={title === UNTITLED ? "" : undefined}
    >
      {title}
    </h1>
  );
}
