/**
 * The block editor, loaded when a note is opened and not before.
 *
 * BlockNote, TipTap, ProseMirror and Mantine are several hundred kilobytes that nothing on a board
 * uses, so they are a chunk of their own: a board's first paint does not wait for them, and
 * `?snapshot=1` — every visual baseline, and every picture an agent takes — never loads them.
 */
import { lazy } from "react";

export type { NoteEditor } from "./BlockEditor";

/** The editor's chunk, asked for as soon as a note's page is known to be coming; `lazy`
    then resolves the module already on its way rather than asking for it after the note has loaded. */
export const preloadEditor = () => import("./BlockEditor");

export const BlockEditor = lazy(preloadEditor);
