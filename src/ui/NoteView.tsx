import { Calendar, CalendarDays, X } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { BlockEditor, type NoteEditor } from "@/blocks";
import { concerns, onNote } from "@/board/events";
import { openDoc } from "@/board/prefetch";
import { retitleFile } from "@/board/useBoard";
import { joinNote, pageTitle, splitNote } from "@/note/format";
import { blockAt, load, plan, saved, settle, type Loaded, type NoteBlock } from "@/note/markdown";
import { anchorsOf } from "@/note/anchors";
import { eventOf, withEvent, type EventChange, type NoteEvent } from "@/note/event";
import { clearTarget, useTarget } from "@/refs/target";
import { merge3 } from "@/note/merge";
import { projectOf, withProject, type Project, type ProjectChange } from "@/note/project";
import { STATUS_LABEL, STATUSES, taskOf, withTask, type Task, type TaskChange, overdue } from "@/note/task";
import { NoteMarkdown, resolverFor } from "@/view/NoteRead";
import { refComponents } from "@/refs/Ref";
import { useIndex } from "@/refs/useIndex";
import { drawnSettled } from "@/render/settled";
import { Said } from "@/files/Said";
import { uploadFiles } from "@/files/upload";
import { refuseLocked } from "@/settings/lock";
import { typing } from "@/edit/useEditor";

import { EventBar, EventLine } from "./EventBar";
import { NoteTitle, NoteTitleRead, takeNaming } from "./NoteTitle";
import { ProjectBar, ProjectLine, type ProjectMembers } from "./ProjectBar";
import { TaskGlyph, TaskLine } from "./TaskGlyph";

/** A quarter of a second after the last change, as the panel and the prompt card write theirs. */
const WRITE_AFTER_MS = 250;

/** What the server holds, as far as this page knows: the whole text, its sha1, and its frontmatter. */
interface Held {
  text: string;
  base: string;
  front: string;
}

interface Opened {
  blocks: NoteBlock[];
  loaded: Loaded;
  /** Bumped by every open, so "take theirs" remounts the editor rather than patching it. */
  seq: number;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "missing" }
  | { kind: "deleted" }
  /** `retrying`: a timer is set and the same text will go again without anybody typing. `title`:
      what failed was naming the note, not a save of its text. */
  | { kind: "failed"; retrying: boolean; title?: boolean }
  /** Both writers changed the same lines. What the other one wrote, kept until the person decides. */
  | { kind: "conflict"; theirs: Held; mine: string };

const q = (name: string) => `name=${encodeURIComponent(name)}&kind=note`;

/** `opening` is the read that opens the note, which a prefetch may answer; every other is asked now. */
async function fetchNote(name: string, opening = false): Promise<{ text: string; base: string } | null> {
  const r = await (opening ? openDoc("note", name) : fetch(`/__board/get?${q(name)}`));
  if (!r.ok) return null;
  return (await r.json()) as { text: string; base: string };
}

/**
 * `retry` is whether the same request could succeed later without anybody doing anything: the
 * network, or a 5xx — which is what the dev proxy answers while the api restarts. A 4xx other than
 * a 409 is an answer about the request, and sending it again gets the same one.
 */
type Put = { ok: true; base: string } | { ok: false; conflict?: { text: string; base: string }; retry?: boolean };

/**
 * How long a save that failed waits before it goes again, doubling from the first to the last. The
 * first version waited for the next keystroke, so a save lost to an api restart stayed lost for as
 * long as the person had stopped typing — which, at the end of a note, is for good.
 */
const RETRY_FIRST_MS = 1_000;
const RETRY_LAST_MS = 15_000;

/**
 * The most a `keepalive` request may carry. Chromium refuses a larger one outright — the `fetch`
 * rejects before anything is sent — so a keepalive save of a big note is not a slower save, it is
 * no save at all. The first version sent every save that way, and every note over this size
 * silently stopped saving: the notice said so, above the fold of a page scrolled to where the
 * person was typing.
 */
const KEEPALIVE_MAX = 60_000;

async function putNote(name: string, text: string, base: string, leaving = false): Promise<Put> {
  try {
    const body = JSON.stringify({ text, base });
    const r = await fetch(`/__board/put?${q(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      /* A save fired as the page goes away has to outlive it, which is what `keepalive` is for —
         and only then, and only while it fits (see `KEEPALIVE_MAX`). A bigger one is sent as an
         ordinary request and may not arrive; the quarter-second debounce is what keeps that
         window small. */
      keepalive: leaving && new Blob([body]).size < KEEPALIVE_MAX,
    });
    if (r.status === 409) return { ok: false, conflict: (await r.json()) as { text: string; base: string } };
    if (!r.ok) return { ok: false, retry: r.status >= 500 };
    return { ok: true, base: ((await r.json()) as { base: string }).base };
  } catch {
    return { ok: false, retry: true };
  }
}

/** What the page around a note may ask of it — the Export menu, which saves the note. */
export interface NoteHandle {
  /**
   * The note's whole text, frontmatter and all, as it is on screen: anything waiting to be saved is
   * sent first, so the file and the export agree whenever the save can land, and the editor's blocks
   * are what is read, so a save that could not land still exports what the person was looking at.
   * `null` before the note has loaded.
   */
  text(): Promise<string | null>;
  /**
   * Make this note a task, change its status or due date, or make it a note again — the
   * frontmatter's two lines, written through the note's own save rather than the route, so the page
   * is never an outside writer to itself.
   */
  task(change: TaskChange): void;
  /** The same for a project's two lines, `project:` and `hue:`. */
  project(change: ProjectChange): void;
  /** And for an event's, `start:` and `end:`. */
  event(change: EventChange): void;
}

/**
 * A note, full-window, in the block editor.
 *
 * **The file is the document, and there is exactly one way a byte of it changes here**: the editor's
 * blocks go through `save()` — which writes back the loaded bytes of every block nobody touched —
 * and the result is `put` against the sha1 this page last saw. Opening, reading, scrolling and
 * selecting write nothing, because a save that produces the text already held is not sent.
 *
 * Two writers, as on a board, and no lock:
 *
 * - **An outside write while nothing is pending** is adopted block by block (`plan()`): the blocks
 *   whose bytes did not change keep their identity, so the caret stays where it was while an agent
 *   rewrites some other paragraph. It goes in outside the undo history, so ctrl+Z never takes back
 *   what the other writer wrote.
 * - **A save that meets a text which has moved** is merged line by line against the text both
 *   started from (`merge3`), written, and adopted. Only when both changed the same lines does the
 *   page ask, and until it is answered it keeps the person's text on screen.
 *
 * Under `?snapshot=1` there is no editor at all: the note is drawn read-only through
 * `react-markdown`, the renderer every board's text already uses, so a picture of a note is a fact
 * about the file.
 */
export function NoteView({
  name,
  scheme,
  snapshot,
  locked = false,
  onTitle,
  onTask,
  onProject,
  onEvent,
  members,
  onRenamed,
  handle,
}: {
  name: string;
  scheme: "light" | "dark";
  snapshot: boolean;
  /**
   * The app is locked: the note is drawn in its editor, read-only — the same page, so the
   * place somebody was reading stays put when they lock or unlock — and every change refuses.
   */
  locked?: boolean;
  onTitle(title: string | undefined): void;
  /**
   * The title this page wrote moved the file: it is `to` now. The page holding it keeps
   * the editor it has — the text did not change but for one line — so whoever renders this must
   * not remount it on the new name. See `NoteApp`.
   */
  onRenamed?(from: string, to: string): void;
  /** Whether the note is a task, and what its status and due date are, whenever that changes. */
  onTask?(task: Task | undefined): void;
  /** Whether the note is a project, and its status and colour, whenever that changes. */
  onProject?(project: Project | undefined): void;
  /** Whether the note is an event, and when, whenever that changes. */
  onEvent?(event: NoteEvent | undefined): void;
  /** What the project holds, when the note is one — read off the listing by the page around it. */
  members?: ProjectMembers;
  handle?: MutableRefObject<NoteHandle | null>;
}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  /* Read by the writers below at the moment they would write: the bars are disabled while locked,
     and this is the floor under them — the top bar's `⋯` reaches the same writers. */
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [opened, setOpened] = useState<Opened | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /* What makes this note a task, read off the frontmatter the page holds — so it is what the file
     says, and it moves the moment the bar is pressed rather than a round trip later. */
  const [task, setTaskState] = useState<Task | undefined>(undefined);
  const onTaskRef = useRef(onTask);
  onTaskRef.current = onTask;
  const tell = useCallback((next: Task | undefined) => {
    setTaskState(next);
    onTaskRef.current?.(next);
  }, []);
  /* And what makes it a project, off the same frontmatter for the same reason. */
  const [project, setProjectState] = useState<Project | undefined>(undefined);
  const onProjectRef = useRef(onProject);
  onProjectRef.current = onProject;
  const tellProject = useCallback((next: Project | undefined) => {
    setProjectState(next);
    onProjectRef.current?.(next);
  }, []);
  /* And what makes it an event, off the same frontmatter for the same reason. */
  const [event, setEventState] = useState<NoteEvent | undefined>(undefined);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const tellEvent = useCallback((next: NoteEvent | undefined) => {
    setEventState(next);
    onEventRef.current?.(next);
  }, []);
  /* The title the file has, for the field at the top of the page and for the toolbar. */
  const [title, setTitleState] = useState<string | undefined>(undefined);
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const named = useCallback((next: string | undefined) => {
    setTitleState(next);
    onTitleRef.current(next);
  }, []);
  const onRenamedRef = useRef(onRenamed);
  onRenamedRef.current = onRenamed;

  /*
   * **The name the file has now**, which is the prop until this page renames it. Every
   * request reads this rather than the prop, because a title written here moves the file under an
   * editor that stays mounted: a save queued behind the rename, an image uploaded after it, and the
   * editor's own image resolver — handed to BlockNote once, when it was made — all have to reach
   * the file where it is, not where it was when the closure was made.
   */
  const nameRef = useRef(name);
  /* The name this page is moving the file away from, while it does: what the change feed says about
     that name is this page's own doing, and the file going from it is not the note being deleted. */
  const movingFrom = useRef<string | null>(null);
  const titleField = useRef<HTMLTextAreaElement | null>(null);

  const editor = useRef<NoteEditor | null>(null);
  const loaded = useRef<Loaded | null>(null);
  const held = useRef<Held | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef<Promise<void> | null>(null);
  /** The wait before the next retry of a failed save; back to the first on any save that lands. */
  const backoff = useRef(RETRY_FIRST_MS);
  /** `flush` as of the last render, for the retry timer — a callback cannot name itself. */
  const again = useRef<(leaving?: boolean) => Promise<void>>(async () => {});
  const applying = useRef(false);
  const seq = useRef(0);

  const resolve = useCallback((src: string) => resolverFor(nameRef.current)(src), []);
  /* This note's permanent id, which the reference picker leaves out of its own list. */
  const self = useIndex().docs.find((d) => d.kind === "note" && d.name === name)?.id ?? null;

  /** Take a text as the one the editor opens with — a first open, or "take theirs". */
  const openText = useCallback(
    (text: string, base: string) => {
      const f = splitNote(text);
      const { blocks, loaded: l } = load(f.body);
      held.current = { text, base, front: f.front };
      loaded.current = l;
      editor.current = null;
      setReady(false);
      setBody(f.body);
      setOpened({ blocks, loaded: l, seq: ++seq.current });
      named(pageTitle(nameRef.current, f.title));
      tell(taskOf(f.front));
      tellProject(projectOf(f.front));
      tellEvent(eventOf(f.front));
    },
    [named, tell, tellProject, tellEvent],
  );

  useEffect(() => {
    /* This page renamed the file it holds, and already holds it under the new name: there is
       nothing to fetch, and opening it again would throw the editor — and the caret — away. */
    if (held.current && nameRef.current === name) return;
    nameRef.current = name;
    let live = true;
    setStatus({ kind: "loading" });
    setOpened(null);
    void fetchNote(name, true).then((got) => {
      if (!live) return;
      if (!got) return setStatus({ kind: "missing" });
      openText(got.text, got.base);
      setStatus({ kind: "ready" });
    });
    return () => {
      live = false;
    };
  }, [name, openText]);

  /** Put a text the other writer made into the open editor, block by block. */
  const adopt = useCallback(
    (text: string, base: string) => {
      const ed = editor.current;
      const l = loaded.current;
      if (!ed || !l) return;
      const f = splitNote(text);
      const next = plan(l, ed.document(), f.body);
      /* Held first, so a change event the edit itself raises finds nothing to save. */
      held.current = { text, base, front: f.front };
      applying.current = true;
      try {
        ed.apply(next.steps);
      } finally {
        applying.current = false;
      }
      loaded.current = settle(next.loaded, ed.document());
      setBody(f.body);
      named(pageTitle(nameRef.current, f.title));
      tell(taskOf(f.front));
      tellProject(projectOf(f.front));
      tellEvent(eventOf(f.front));
    },
    [named, tell, tellProject, tellEvent],
  );

  /* One write at a time: a second one against the base the first is about to move is a 409 by construction. */
  const serial = useCallback((run: () => Promise<void>): Promise<void> => {
    const next = (writing.current ?? Promise.resolve()).then(run);
    /* Cleared by the promise it was set to, or the outside-write listener would see a save in
       flight for ever and never adopt anything again. */
    const tracked: Promise<void> = next.finally(() => {
      if (writing.current === tracked) writing.current = null;
    });
    writing.current = tracked;
    return next;
  }, []);

  const flush = useCallback(
    (leaving = false): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const run = async () => {
        const ed = editor.current;
        const l = loaded.current;
        const h = held.current;
        /* Read when the save runs, not when it was asked for: a title written in between moved the file. */
        const name = nameRef.current;
        if (!ed || !l || !h) return;
        const next = saved(l, ed.document());
        const text = joinNote(h.front, next.body);
        if (text === h.text) return;
        /* A save that failed with nothing wrong with it goes again on its own, on the same timer a
         keystroke sets — so typing in the meantime simply brings it forward, and the outside-write
         listener, which holds off while that timer is set, holds off for a retry too. Not while
         leaving: the page is gone, and whatever `keepalive` could carry has been sent. */
        const failed = (p: Put) => {
          const retry = !p.ok && p.retry === true && !leaving;
          setStatus({ kind: "failed", retrying: retry });
          if (!retry || timer.current) return;
          const wait = backoff.current;
          backoff.current = Math.min(wait * 2, RETRY_LAST_MS);
          timer.current = setTimeout(() => void again.current(false), wait);
        };
        const put = await putNote(name, text, h.base, leaving);
        if (put.ok) {
          backoff.current = RETRY_FIRST_MS;
          /* The frontmatter the page holds *now*, not the one this save started from: a bar pressed
           while the save was out rewrote `held.front` and queued a save of its own, and putting the
           old front back here made that save find nothing to write — the second of two quick changes
           to an event's time was dropped, and so was a task's. */
          held.current = { ...h, text, base: put.base, front: held.current?.front ?? h.front };
          /* What was just written is the file now, so it is what the next save and the next outside
           write are measured against — unless the person has typed since, in which case the map
           of this save still describes the blocks that were saved and the next save rewrites the
           rest. */
          loaded.current = next.loaded;
          /* A save that lands takes back the notice an earlier failure left. */
          setStatus((st) => (st.kind === "failed" ? { kind: "ready" } : st));
          return;
        }
        if (!put.conflict) return failed(put);
        const theirs = put.conflict;
        /* The editor holds ours, and this map describes ours: measured against it, the blocks the
         person wrote are unchanged in the merge and keep their place, and the caret with them. */
        loaded.current = next.loaded;
        const merged = merge3(h.text, text, theirs.text);
        if (merged === null) {
          setStatus({ kind: "conflict", theirs: { ...theirs, front: splitNote(theirs.text).front }, mine: text });
          return;
        }
        const second = await putNote(name, merged, theirs.base);
        /* Retried from the top: `held` still names the base before theirs, so the next attempt meets
         the same 409 and merges again, against whatever the file holds by then. */
        if (!second.ok) return failed(second);
        backoff.current = RETRY_FIRST_MS;
        adopt(merged, second.base);
      };
      return serial(run);
    },
    [serial, adopt],
  );
  again.current = flush;

  /**
   * Name the note: `/retitle` with `follow`, the sidebar's own call, so the `title:` line
   * is written and the file's name follows it in one store step. The page makes it rather than the
   * field calling the route, because the page holds the text the route rewrites — anything waiting
   * to be saved goes first, the rename waits its turn behind any save in flight, and what it wrote
   * is held here, so the next save is measured against it rather than meeting it as a 409.
   *
   * The editor stays up across it: the body is untouched and the caret with it. Something typed
   * while the call is out stays pending, and is saved into the renamed file once the rename has
   * landed. Only a body somebody *else* changed in the meantime goes the long way — adopted, or met
   * as a 409 and merged, like any other outside write.
   */
  const retitle = useCallback(
    async (next: string): Promise<boolean> => {
      if (lockedRef.current) return refuseLocked();
      await flush(false);
      let ok = false;
      await serial(async () => {
        const from = nameRef.current;
        if (!held.current) return;
        movingFrom.current = from;
        try {
          const to = await retitleFile(from, next, "note", true);
          if (!to) return;
          nameRef.current = to;
          const got = await fetchNote(to);
          const h = held.current;
          const f = got ? splitNote(got.text) : null;
          if (got && f && h && f.body === h.text.slice(h.front.length)) {
            /* Only the frontmatter moved, which the editor never holds: the text is taken as it
               is, and the span map still describes the body, so a save pending from typing in the
               meantime is written against the renamed file rather than meeting it as a 409. That
               matters most on a note that had no frontmatter — the block the rename adds sits right
               against the first line, and a line merge cannot tell that from somebody typing there. */
            held.current = { text: got.text, base: got.base, front: f.front };
            named(pageTitle(nameRef.current, f.title));
            tell(taskOf(f.front));
            tellProject(projectOf(f.front));
            tellEvent(eventOf(f.front));
          } else if (got && !timer.current && editor.current) adopt(got.text, got.base);
          else named(next);
          ok = true;
          if (to !== from) onRenamedRef.current?.(from, to);
        } finally {
          movingFrom.current = null;
        }
      });
      setStatus((st) =>
        ok ? (st.kind === "failed" && st.title ? { kind: "ready" } : st) : { kind: "failed", retrying: false, title: true },
      );
      return ok;
    },
    [flush, serial, adopt, named, tell, tellProject, tellEvent],
  );

  /**
   * The task's lines changed from this page: the frontmatter the page holds is rewritten and the note
   * saved at once, through the one path a byte of it changes by here. A write that meets a moved text
   * is merged by `flush` like any other — these are lines of the frontmatter, and a person typing is
   * typing in the body.
   */
  const changeTask = useCallback(
    (change: TaskChange) => {
      if (lockedRef.current) return void refuseLocked();
      const h = held.current;
      if (!h) return;
      const front = withTask(h.front, change);
      if (front === h.front) return;
      held.current = { ...h, front };
      tell(taskOf(front));
      /* A status on an event makes it a task, so an event's bar gives way to the task's. */
      tellEvent(eventOf(front));
      void flush(false);
    },
    [flush, tell, tellEvent],
  );

  /** A project's lines changed from this page: `changeTask`'s path, for `project:` and `hue:`. */
  const changeProject = useCallback(
    (change: ProjectChange) => {
      if (lockedRef.current) return void refuseLocked();
      const h = held.current;
      if (!h) return;
      const front = withProject(h.front, change);
      if (front === h.front) return;
      held.current = { ...h, front };
      tellProject(projectOf(front));
      void flush(false);
    },
    [flush, tellProject],
  );

  /** An event's lines changed from this page: `changeTask`'s path, for `start:` and `end:`. */
  const changeEvent = useCallback(
    (change: EventChange) => {
      if (lockedRef.current) return void refuseLocked();
      const h = held.current;
      if (!h) return;
      const front = withEvent(h.front, change);
      if (front === h.front) return;
      held.current = { ...h, front };
      tellEvent(eventOf(front));
      void flush(false);
    },
    [flush, tellEvent],
  );

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      task: changeTask,
      project: changeProject,
      event: changeEvent,
      text: async () => {
        await flush(false);
        const h = held.current;
        const ed = editor.current;
        const l = loaded.current;
        if (!h) return null;
        return ed && l ? joinNote(h.front, saved(l, ed.document()).body) : h.text;
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, flush, changeTask, changeProject, changeEvent]);

  const onChange = useCallback(() => {
    if (applying.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(false), WRITE_AFTER_MS);
  }, [flush]);

  /* Whatever is pending goes when the page does, or when another note is opened in its place. */
  useEffect(() => {
    const away = () => void flush(true);
    addEventListener("pagehide", away);
    return () => {
      removeEventListener("pagehide", away);
      void flush(true);
    };
  }, [flush]);

  /* The other writer. Its own echo is dropped by sha1, as `useBoard` drops a board's. */
  useEffect(() => {
    if (snapshot) return;
    return onNote((change) => {
      if (!concerns(change, nameRef.current) || change.name === movingFrom.current) return;
      if (change.sha1 === null) return setStatus({ kind: "deleted" });
      if (change.sha1 === held.current?.base) return;
      /* A save is on its way; it will meet this change as a 409 and merge it. */
      if (timer.current || writing.current) return;
      void fetchNote(nameRef.current).then((got) => {
        if (!got || got.base === held.current?.base) return;
        if (timer.current || writing.current) return;
        adopt(got.text, got.base);
      });
    });
  }, [name, snapshot, adopt]);

  const onReady = useCallback((ed: NoteEditor) => {
    editor.current = ed;
    if (loaded.current) loaded.current = settle(loaded.current, ed.document());
    setReady(true);
  }, []);

  const upload = useCallback(async (file: File): Promise<string> => {
    const dataUrl = await new Promise<string>((ok, fail) => {
      const reader = new FileReader();
      reader.onload = () => ok(String(reader.result));
      reader.onerror = () => fail(reader.error);
      reader.readAsDataURL(file);
    });
    const r = await fetch(`/__board/upload?${q(nameRef.current)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    if (!r.ok) throw new Error(`the image was refused (${r.status})`);
    return ((await r.json()) as { src: string }).src;
  }, []);

  /*
   * Typing at a locked note. The editor is read-only, so it takes no caret and the keys go
   * to the page; a letter, Backspace, Delete or Enter aimed at the note is somebody trying to write,
   * and is answered with the notice rather than with nothing. Looked at after every listener has had
   * the key, so `space O` — which the page's own keys take — is not mistaken for typing.
   */
  useEffect(() => {
    if (!locked || snapshot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Delete" && e.key !== "Enter") return;
      if (e.target instanceof Element && e.target.closest("[data-dag-settings],[role='dialog'],[data-dag-sidebar]")) return;
      setTimeout(() => {
        if (!e.defaultPrevented) refuseLocked();
      });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [locked, snapshot]);
  /* A file dropped on a locked note is not kept, and not opened by the browser in place of the app. */
  const refuseFiles = useCallback(async () => {
    refuseLocked();
    return [];
  }, []);

  /* What an upload was refused with, said above the note until the next one. */
  const [attachProblems, setAttachProblems] = useState<string[]>([]);
  /* Files dropped on the note, or picked from its slash menu, kept as attachments in the note's own
     folder — so a note and what it embeds move together when the folder does. */
  const attach = useCallback(async (files: readonly File[]) => {
    const name = nameRef.current;
    const folder = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    const { done, errors } = await uploadFiles(files, folder);
    setAttachProblems(errors);
    return [...done.map((f) => ({ id: f.id, title: f.title ?? f.name })), ...errors.map((error) => ({ error }))];
  }, []);

  const keepMine = useCallback(async () => {
    if (status.kind !== "conflict") return;
    const put = await putNote(nameRef.current, status.mine, status.theirs.base);
    if (!put.ok) return setStatus({ kind: "failed", retrying: false });
    /* Reopened on what was just written, so the span map and the next save start from the file as it now is. */
    openText(status.mine, put.base);
    setStatus({ kind: "ready" });
  }, [status, openText]);

  const takeTheirs = useCallback(() => {
    if (status.kind !== "conflict") return;
    openText(status.theirs.text, status.theirs.base);
    setStatus({ kind: "ready" });
  }, [status, openText]);

  const done = snapshot ? body !== null : ready;

  /* A note just made from the sidebar or the welcome card is named here, in its own title, rather
     than in its sidebar row — once, when it opens. */
  useEffect(() => {
    if (!opened || snapshot) return;
    if (takeNaming(nameRef.current)) titleField.current?.focus();
  }, [opened, snapshot]);

  /*
   * A link to one block — a search result, or a reference to a `^anchor` — opens the note
   * with the caret on that block, once the editor holds it. An anchor is found where it is written
   * now, since blocks move; a line (`L12`, the file's, frontmatter counted) is what a result names a
   * block nothing has anchored yet by, and the corpus it came from is at most one change old.
   */
  const target = useTarget();
  useEffect(() => {
    if (!ready || !target || snapshot) return;
    const ed = editor.current;
    const l = loaded.current;
    const h = held.current;
    if (ed && l && h && body !== null) {
      const lead = h.front.split("\n").length - 1;
      const line = target.startsWith("^")
        ? anchorsOf(body).find((a) => a.id === target.slice(1))?.line
        : /^L\d+$/.test(target)
          ? Number(target.slice(1)) - lead
          : undefined;
      const id = line !== undefined ? blockAt(l, Math.max(1, line)) : null;
      if (id) ed.reveal(id);
    }
    clearTarget();
  }, [ready, target, snapshot, body]);

  /* The same signal a board raises when it is finished, on the same element, so `snapshot.mjs` and
     the suite wait for a note exactly as they wait for a board: the text loaded and the editor up. */
  useEffect(() => {
    if (!done) return;
    /* And its equations drawn by KaTeX, in the editor as on the read-only page. */
    let live = true;
    void drawnSettled().then(() => {
      if (live) document.documentElement.dataset.dagReady = "1";
    });
    return () => {
      live = false;
      delete document.documentElement.dataset.dagReady;
    };
  }, [done]);

  return (
    <main className="dag-note-view" data-dag-note-view={name} data-dag-ready={done ? "" : undefined}>
      {status.kind === "missing" ? (
        <p className="dag-note-view__notice" role="status">
          There is no note called {name}.
        </p>
      ) : null}
      {status.kind === "deleted" ? (
        <p className="dag-note-view__notice" role="status" data-dag-note-deleted="">
          This note was deleted. What is on screen is not saved anywhere.
        </p>
      ) : null}
      {status.kind === "failed" ? (
        <p className="dag-note-view__notice" role="alert" data-dag-note-failed="">
          {status.title
            ? "The title could not be saved. The note keeps the name it had."
            : status.retrying
              ? "Your last change is not saved yet. The server did not answer, so it will be tried again in a moment."
              : "Your last change could not be saved. It will be tried again with the next one."}
        </p>
      ) : null}
      {attachProblems.map((problem) => (
        <p key={problem} className="dag-note-view__notice" role="alert" data-dag-note-upload-problem="">
          <Said text={problem} />
        </p>
      ))}
      {status.kind === "conflict" ? (
        <div className="dag-note-view__notice dag-note-view__notice--ask" role="alert" data-dag-note-conflict="">
          <span>This note was changed somewhere else, in the same place you were writing.</span>
          <button type="button" data-dag-note-keep="" onClick={() => void keepMine()}>
            Keep mine
          </button>
          <button type="button" data-dag-note-theirs="" onClick={takeTheirs}>
            Use theirs
          </button>
        </div>
      ) : null}

      {snapshot ? (
        body !== null ? (
          <>
            <NoteTitleRead title={title} />
            {project ? <ProjectLine project={project} /> : null}
            {task ? <TaskLine task={task} /> : null}
            {event ? <EventLine event={event} /> : null}
            <NoteMarkdown name={name} body={body} components={refComponents()} />
          </>
        ) : null
      ) : opened ? (
        <div className="dag-note-view__page">
          <NoteTitle
            title={title}
            editable={!locked && status.kind !== "conflict" && status.kind !== "deleted"}
            locked={locked}
            field={titleField}
            onCommit={retitle}
            onNext={(newLine) => editor.current?.focusStart(newLine)}
          />
          {project ? (
            <ProjectBar
              project={project}
              members={members}
              onChange={changeProject}
              editable={!locked && ready && status.kind !== "conflict"}
            />
          ) : null}
          {task ? <TaskBar task={task} onChange={changeTask} editable={!locked && ready && status.kind !== "conflict"} /> : null}
          {event ? (
            <EventBar event={event} onChange={changeEvent} editable={!locked && ready && status.kind !== "conflict"} />
          ) : null}
          <Suspense fallback={null}>
            <BlockEditor
              key={opened.seq}
              initial={opened.blocks}
              onReady={onReady}
              onChange={onChange}
              upload={upload}
              attach={locked ? refuseFiles : attach}
              resolve={resolve}
              scheme={scheme}
              self={self}
              editable={!locked && status.kind !== "conflict"}
            />
          </Suspense>
        </div>
      ) : null}
    </main>
  );
}

/**
 * The bar at the top of a task's own page: its status as three choices, its due date, and
 * the way back to being a plain note. Notion's properties, cut to the two a task has.
 *
 * A radiogroup rather than the list's click-to-move-on button, because here there is room to show
 * all three and a person on the page has come to set one, not to step through them. The date is the
 * browser's own date input, which is the one that already knows the person's locale and keyboard.
 */
function TaskBar({ task, onChange, editable }: { task: Task; onChange(change: TaskChange): void; editable: boolean }) {
  return (
    <div className="dag-taskbar dag-facts" data-dag-taskbar={task.status}>
      <span className="dag-facts__label">
        <TaskGlyph status={task.status} />
        Status
      </span>
      <span className="dag-facts__value">
        <span className="dag-taskbar__status" role="radiogroup" aria-label="Status">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={task.status === status}
              className="dag-taskbar__choice"
              data-dag-taskbar-status={status}
              disabled={!editable}
              onClick={() => onChange({ status })}
            >
              <TaskGlyph status={status} />
              <span>{STATUS_LABEL[status]}</span>
            </button>
          ))}
        </span>
      </span>
      {/* The day it begins: the calendar spans a task from here to its due date. */}
      <span className="dag-facts__label">
        <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
        Starts
      </span>
      <span className="dag-facts__value">
        <DateField
          value={task.start}
          max={task.due}
          editable={editable}
          hook="data-dag-taskbar-start"
          label="Start date"
          onChange={(start) => onChange({ start })}
        />
      </span>
      <span className="dag-facts__label">
        <Calendar size={14} strokeWidth={2} aria-hidden="true" />
        Due
      </span>
      <span className="dag-facts__value">
        <DateField
          value={task.due}
          editable={editable}
          hook="data-dag-taskbar-due"
          label="Due date"
          late={overdue(task)}
          onChange={(due) => onChange({ due })}
        />
        {task.due ? (
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
        ) : null}
      </span>
    </div>
  );
}

/**
 * A date in a properties list: the browser's own date input, which knows the person's locale
 * and keyboard — but an empty one says *Empty*, as Notion's does, rather than `mm/dd/yyyy` in the
 * colour of a value. The date is not repeated beside it in other words, as it was; an overdue one is
 * marked in the input itself.
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
