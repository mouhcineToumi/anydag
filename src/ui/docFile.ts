import { useEffect, useMemo, useState } from "react";

import { concerns, onQuiz, onTable } from "@/board/events";
import { openDoc } from "@/board/prefetch";
import type { LoadProblem } from "@/board/useBoard";
import { merge3 } from "@/note/merge";

/**
 * A quiz's or a table's text as its page holds it, and the writes that keep the file in step
 * (one controller for both kinds whose page is a form over
 * the text rather than an editor holding blocks).
 *
 * **The note's contract, one kind over** (`NoteView.tsx`): a save is a `put` against the sha1 last
 * seen, a quarter of a second after the last change; a save that meets a moved text is merged line
 * by line against the text both started from, which succeeds whenever the two edited different
 * lines, and otherwise the page asks — *Keep mine* or *Use theirs* — and writes nothing until it is
 * answered. An outside write with nothing pending is adopted. A save that failed for no reason of its
 * own — a network error, a 5xx — goes again on a backoff; a 4xx other than a 409 is an answer about
 * the request and waits for the next change.
 *
 * Simpler than a note's in one way that matters: there is no editor holding blocks, so adopting an
 * outside write is replacing a string, and the form redraws from it.
 *
 * **A controller per name, not a tangle of callbacks.** A save schedules a retry and a retry is a
 * save; written as `useCallback`s the two refer to each other through a ref somebody forgets to keep
 * current. `DocFileController` is a plain object whose methods can call each other, made once per
 * name, and the hook is only its lifecycle and its state.
 */

/** The kinds whose page edits the whole text through this — a note has its own, with an editor in it. */
export type DocFileKind = "quiz" | "table";

type DocFileState =
  | { status: "loading" }
  | { status: "problem"; problem: LoadProblem }
  | { status: "ready"; text: string; saving: boolean; failed: boolean }
  | { status: "conflict"; text: string; theirs: string };

const SAVE_MS = 250;
const RETRY_FIRST_MS = 1_000;
const RETRY_LAST_MS = 15_000;
/** `keepalive`'s ceiling, the note's: a larger request is refused before it is sent. */
const KEEPALIVE_MAX = 60_000;

const q = (kind: DocFileKind, name: string) => `name=${encodeURIComponent(name)}&kind=${kind}`;

type Put = { ok: true; base: string } | { ok: false; conflict?: { text: string; base: string }; retry?: boolean };

async function putDoc(kind: DocFileKind, name: string, text: string, base: string, leaving = false): Promise<Put> {
  try {
    const body = JSON.stringify({ text, base });
    const r = await fetch(`/__board/put?${q(kind, name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: leaving && new Blob([body]).size < KEEPALIVE_MAX,
    });
    if (r.status === 409) return { ok: false, conflict: (await r.json()) as { text: string; base: string } };
    if (!r.ok) return { ok: false, retry: r.status >= 500 };
    return { ok: true, base: ((await r.json()) as { base: string }).base };
  } catch {
    return { ok: false, retry: true };
  }
}

class DocFileController {
  /** What the page holds, what the server last said it holds, and the sha1 of that. */
  mine = "";
  saved = "";
  base = "";
  pending = false;
  live = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = RETRY_FIRST_MS;
  private writing: Promise<boolean> | null = null;
  private conflicted = false;

  constructor(
    readonly kind: DocFileKind,
    readonly name: string,
    private readonly set: (s: DocFileState) => void,
  ) {}

  private show(failed = false): void {
    if (!this.live || this.conflicted) return;
    this.set({ status: "ready", text: this.mine, saving: this.pending, failed });
  }

  /** `opening` is the read that opens the file, which a prefetch may answer; the feed's never is. */
  async load(opening = false): Promise<void> {
    const fail = (problem: LoadProblem) => {
      if (this.live && !this.pending) this.set({ status: "problem", problem });
    };
    try {
      const r = await (opening ? openDoc(this.kind, this.name) : fetch(`/__board/get?${q(this.kind, this.name)}`));
      if (r.status === 404) return fail({ reason: "missing" });
      if (!r.ok) {
        /* Every other answer is the server failing to read the file. The body's sentence, when
           there is one, is for the Details disclosure; the page owns the words a person reads. */
        let message = `the server answered ${r.status}`;
        try {
          const body = (await r.json()) as { error?: string };
          if (typeof body.error === "string" && body.error) message = body.error;
        } catch {
          /* A non-JSON refusal is still an answer; the status is the fact that was learned. */
        }
        return fail({ reason: "unreadable", message });
      }
      let got: { text: string; base: string };
      try {
        got = (await r.json()) as { text: string; base: string };
      } catch (e) {
        return fail({ reason: "unreadable", message: e instanceof Error ? e.message : String(e) });
      }
      if (!this.live || this.pending) return;
      this.mine = this.saved = got.text;
      this.base = got.base;
      this.show();
    } catch (e) {
      /* A fetch that rejected is a server that did not answer, not a file that is missing. */
      fail({ reason: "unreachable", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Ask again for a file whose read got no answer — *Try again*. */
  retry(): void {
    if (this.live) void this.load(false);
  }

  change(next: string): void {
    if (next === this.mine) return;
    this.mine = next;
    this.pending = true;
    this.show();
    this.schedule(SAVE_MS);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  /** One write in flight at a time, the next waiting behind it. */
  run(leaving = false): Promise<boolean> {
    const next = (this.writing ?? Promise.resolve(true)).then(() => this.save(leaving));
    this.writing = next;
    void next.finally(() => {
      if (this.writing === next) this.writing = null;
    });
    return next;
  }

  private conflict(text: string, theirs: { text: string; base: string }): false {
    this.saved = theirs.text;
    this.base = theirs.base;
    this.conflicted = true;
    if (this.live) this.set({ status: "conflict", text, theirs: theirs.text });
    return false;
  }

  private async save(leaving: boolean): Promise<boolean> {
    if (!this.pending || this.conflicted) return !this.pending;
    const text = this.mine;
    let sent = text;
    let result = await putDoc(this.kind, this.name, sent, this.base, leaving);
    if (!result.ok && result.conflict) {
      const theirs = result.conflict;
      const merged = merge3(this.saved, text, theirs.text);
      if (merged === null) return this.conflict(text, theirs);
      this.saved = theirs.text;
      this.base = theirs.base;
      sent = merged;
      /* Typed into while the request was out: fold that onto the merge rather than drop it. */
      this.mine = this.mine === text ? merged : (merge3(text, this.mine, merged) ?? this.mine);
      result = await putDoc(this.kind, this.name, sent, this.base, leaving);
      if (!result.ok && result.conflict) return this.conflict(this.mine, result.conflict);
    }
    if (result.ok) {
      this.saved = sent;
      this.base = result.base;
      this.pending = this.mine !== sent;
      this.backoff = RETRY_FIRST_MS;
      this.show();
      if (this.pending && !leaving && this.live && !this.timer) this.schedule(SAVE_MS);
      return !this.pending;
    }
    if (result.retry && !leaving && this.live) {
      this.schedule(this.backoff);
      this.backoff = Math.min(this.backoff * 2, RETRY_LAST_MS);
      this.show(true);
    }
    return false;
  }

  /** Save now, and resolve once the file holds what is on screen. */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return this.writing ? this.writing : true;
    return this.run();
  }

  keepMine(): void {
    this.conflicted = false;
    this.pending = true;
    this.show();
    void this.run();
  }

  useTheirs(): void {
    this.conflicted = false;
    this.mine = this.saved;
    this.pending = false;
    this.show();
  }

  /** An outside write reached the feed: adopt it when nothing of ours is waiting. */
  outside(sha1: string | null): void {
    if (sha1 === null) {
      if (!this.pending && this.live) this.set({ status: "problem", problem: { reason: "missing" } });
      return;
    }
    if (sha1 === this.base || this.pending || this.timer) return;
    void this.load();
  }

  leave(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) void this.run(true);
  }
}

export interface DocFile {
  state: DocFileState;
  /** The text now, whatever the save is doing. `""` before it has loaded. */
  text: string;
  /** A new text, from the form or from Source. Saved on a debounce. */
  change(next: string): void;
  /** Save now and resolve once the file holds what is on screen — a run stamping its ids needs that. */
  flush(): Promise<boolean>;
  keepMine(): void;
  useTheirs(): void;
  /** Ask for the file again after a read that got no answer. */
  retry(): void;
}

export function useDocFile(kind: DocFileKind, name: string): DocFile {
  const [state, setState] = useState<DocFileState>({ status: "loading" });
  const file = useMemo(() => new DocFileController(kind, name, setState), [kind, name]);

  useEffect(() => {
    file.live = true;
    setState({ status: "loading" });
    void file.load(true);
    const off = (kind === "quiz" ? onQuiz : onTable)((c) => {
      if (concerns(c, file.name)) file.outside(c.sha1);
    });
    const leave = () => file.leave();
    addEventListener("pagehide", leave);
    return () => {
      off();
      removeEventListener("pagehide", leave);
      file.leave();
      file.live = false;
    };
  }, [file]);

  return useMemo(
    () => ({
      state,
      text: state.status === "ready" || state.status === "conflict" ? state.text : "",
      change: (next: string) => file.change(next),
      flush: () => file.flush(),
      keepMine: () => file.keepMine(),
      useTheirs: () => file.useTheirs(),
      retry: () => file.retry(),
    }),
    [state, file],
  );
}
