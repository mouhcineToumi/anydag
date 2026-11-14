import { useSyncExternalStore } from "react";

import { boardCall, type Made } from "@/board/useBoard";

/**
 * Note templates, from the page: the list the picker draws, the starters it offers when there are none,
 * and the picker's own open state.
 *
 * The picker is asked for from five places that share no parent — the sidebar's New menu and its row
 * menu, the search card, the leader chord on a board and the one on every other page — so, like the
 * Assistant's panel (`assistant/panelState.ts`), its open state is a small store and `Shell` draws the
 * dialog. It is **not remembered across a reload**: a dialog that opens by itself on a cold load is
 * something nobody asked for, and a remembered key would be a preference the closed set refuses.
 */

/** What a template makes — a note, or a task or an event by the line its frontmatter carries. */
export type TemplateMakes = "note" | "task" | "event";

interface TemplateRow {
  name: string;
  title: string;
  makes: TemplateMakes;
}

export interface TemplateList {
  /** The templates folder, or `null` when the vault has none (Settings names none and `Templates` is not there). */
  folder: string | null;
  templates: TemplateRow[];
}

/** The templates in the vault's templates folder, or `null` when the server could not be asked. */
export async function readTemplates(): Promise<TemplateList | null> {
  try {
    const r = await fetch("/__board/templates");
    return r.ok ? ((await r.json()) as TemplateList) : null;
  } catch {
    return null;
  }
}

/**
 * Write the starter templates — a meeting, a day, an ADR — **because the person pressed the button**.
 * Resolves to the sentence saying why it could not.
 */
export async function addStarters(): Promise<string | null> {
  const done = await boardCall("templates/starters", {});
  return done.ok ? null : done.error;
}

/**
 * Make a note from a template, its variables filled in once, in `folder` (`""` is the top level).
 * `title` is what `{{title}}` says and what the file is called; empty, the note starts *Untitled*.
 */
export async function createFromTemplate(template: string, folder: string, title: string): Promise<Made> {
  const done = await boardCall<{ name?: string }>("from-template", { template, folder, title });
  if (!done.ok) return { error: done.error };
  if (!done.data.name) return { error: "The server did not say what it made. Try again." };
  return { name: done.data.name };
}

/* -- the picker's open state --------------------------------------------------------------- */

interface Asked {
  open: boolean;
  /** The folder the note will be made in; `null` is the open file's own — what a chord, which knows no folder, asks for. */
  folder: string | null;
  /** Words already typed, which become the title — the search card's miss. */
  title: string;
}

let state: Asked = { open: false, folder: null, title: "" };
const listeners = new Set<() => void>();

const set = (next: Asked) => {
  state = next;
  for (const l of listeners) l();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useTemplatePicker = (): Asked =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

/**
 * Ask for the picker: *New note from template*, in `folder` — the open file's folder when none is
 * said, as New does — with `title` already typed.
 */
export const openTemplates = (where: { folder?: string; title?: string } = {}): void =>
  set({ open: true, folder: where.folder ?? null, title: where.title ?? "" });

export const closeTemplates = (): void => set({ ...state, open: false });
