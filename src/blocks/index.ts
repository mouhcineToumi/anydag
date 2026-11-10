/**
 * The block editor, a chunk of its own.
 *
 * BlockNote, TipTap, ProseMirror and Mantine are several hundred kilobytes that nothing on a board
 * uses, so they are a chunk of their own: a board's first paint does not wait for them, and
 * `?snapshot=1` — every visual baseline, and every picture an agent takes — never loads them. A
 * note's page asks for it as it mounts, and draws the note's text read-only until the editor is
 * up (`NoteView`).
 *
 * **Not `React.lazy`.** A lazy component suspends the first time it renders even when its module
 * has long since loaded — a promise's result cannot be read synchronously — and React then holds
 * the boundary's content back until 300 ms after its fallback went up (`FALLBACK_THROTTLE_MS`).
 * Measured in the packaged desktop app, that throttle *was* the slow first open of #120: the
 * editor came up 320 ms after the note's text whether its chunk had been preloaded or not, and a
 * second note, whose lazy had already resolved, took 40 ms. So the module is kept here once it
 * has loaded, and `useBlockEditor` hands it over in the very render that asks for it.
 */
import { useEffect, useState } from "react";

export type { NoteEditor } from "./BlockEditor";

type Editor = typeof import("./BlockEditor").default;

let loaded: Editor | null = null;
let loading: Promise<Editor> | null = null;

/** The editor's chunk, asked for as soon as a note's page is known to be coming; every later call
    is the one already on its way. A failed load is asked for again next time. */
export function preloadEditor(): Promise<Editor> {
  loading ??= import("./BlockEditor").then(
    (m) => (loaded = m.default),
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/**
 * The editor component, or `null` while its chunk is still coming — at once when it has already
 * come. `wanted: false` asks for nothing, which is how a snapshot of a note never loads BlockNote.
 * A chunk that fails to load is thrown from render, for the page's error boundary, as a lazy's was.
 */
export function useBlockEditor(wanted = true): Editor | null {
  const [got, setGot] = useState<{ editor: Editor } | { failed: unknown } | null>(() => (loaded ? { editor: loaded } : null));
  useEffect(() => {
    if (!wanted || got) return;
    let live = true;
    void preloadEditor().then(
      (editor) => live && setGot({ editor }),
      (failed: unknown) => live && setGot({ failed }),
    );
    return () => {
      live = false;
    };
  }, [wanted, got]);
  if (got && "failed" in got) throw got.failed;
  return wanted && got ? got.editor : null;
}
