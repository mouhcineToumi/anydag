import { useSyncExternalStore } from "react";

import type { TextKind } from "@/board/useBoard";
import { onBoard, onNote, onQuiz, onTable, onTags, type BoardChange } from "@/board/events";
import type { Hue } from "@/dsl/ir";
import { defaultHue, tagKey, type TagChange } from "@/note/tags";
import { isLocked, refuseLocked } from "@/settings/lock";

/**
 * The vault's tags, from the page: the list `GET /__board/tags` answers — every tag a document
 * carries or the tag list registers, with its colour and how many documents carry it — and the calls
 * that change them. See *Tags* in `docs/architecture/tasks-projects-calendar.md`.
 *
 * **One list for the page**, however many chips draw from it: asked for when the first one mounts,
 * again when the feed says the tag list changed (`dag:tags`) or a document's tags did, and let go
 * when the last one unmounts.
 */

/** What `GET /__board/tags` says of one tag — `server/tags.ts`' `TagInfo`. */
export interface TagInfo {
  name: string;
  hue: Hue;
  registered: boolean;
  count: number;
  kinds: TextKind[];
}

let list: TagInfo[] | null = null;
const subs = new Set<() => void>();
let off: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let asked = 0;

const tell = () => {
  for (const s of [...subs]) s();
};

/** Ask for the list again now. Resolves once it is in, so a caller can read it. */
async function reloadTags(): Promise<TagInfo[] | null> {
  const n = ++asked;
  try {
    const r = await fetch("/__board/tags");
    if (!r.ok) return list;
    const got = ((await r.json()) as { tags?: TagInfo[] }).tags ?? [];
    /* A later ask answered first holds the newer list. */
    if (n === asked) {
      list = got;
      tell();
    }
    return got;
  } catch {
    return list;
  }
}

/* A document's tags moved: the counts did. Coalesced, because a note being typed in is a change every
   quarter-second and only a change carrying tags matters. */
const soon = (change: BoardChange) => {
  if (change.tags === undefined && !change.resume && change.sha1 !== null) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void reloadTags();
  }, 250);
};

function subscribe(listen: () => void): () => void {
  subs.add(listen);
  if (!off) {
    void reloadTags();
    const offs = [onTags(() => void reloadTags()), onNote(soon), onBoard(soon), onQuiz(soon), onTable(soon)];
    off = () => {
      for (const o of offs) o();
    };
  }
  return () => {
    subs.delete(listen);
    if (subs.size || !off) return;
    off();
    off = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** The vault's tags, `null` until the first answer — kept in step with the feed. */
export function useTagList(): TagInfo[] | null {
  return useSyncExternalStore(subscribe, () => list);
}

/** The tag `name` names, in `tags`, ignoring case. */
export const tagIn = (tags: readonly TagInfo[] | null, name: string): TagInfo | undefined =>
  tags?.find((t) => tagKey(t.name) === tagKey(name));

/** The hue `name` is drawn in: the tag list's, else the default its name hashes to. */
export const hueOfTag = (tags: readonly TagInfo[] | null, name: string): Hue => tagIn(tags, name)?.hue ?? defaultHue(name);

/* ---------------------------------------------------------------- writes */

/** What a tag call answers: the server's body, or the sentence saying why it could not be. */
type Done<T> = { ok: true; got: T } | { ok: false; error: string };

async function post<T>(route: string, body: object): Promise<Done<T>> {
  /* The floor under the page, which does not offer these while locked. */
  if (isLocked()) {
    refuseLocked();
    return { ok: false, error: "Read only: unlock to change tags." };
  }
  try {
    const r = await fetch(`/__board/tags/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const got = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, error: got.error ?? "The tags could not be changed. Try again." };
    /* The feed says so too, a moment later: a page does not wait on it for its own change. */
    dispatchEvent(new CustomEvent("dag:tags"));
    return { ok: true, got };
  } catch {
    return { ok: false, error: "The server did not answer. Try again." };
  }
}

/**
 * One document's tags changed, any kind: `POST /__board/tags/apply`. A tag the vault has never seen
 * is created — registered with `hue`, or with its default.
 */
export const applyTags = (kind: TextKind, name: string, change: TagChange, hue?: Hue) =>
  post<{ tags: string[]; created: string[] }>("apply", { kind, name, ...change, ...(hue ? { hue } : {}) });

/** A tag's colour, which registers it: `null` is its default. */
export const colorTag = (tag: string, hue: Hue | null) => post<{ name: string; hue: Hue }>("color", { tag, hue });

/**
 * A tag made a moment ago and taken off again: out of the tag list, if no document carries it now —
 * so a typo does not stay in every suggestion. A tag some other document carries is left alone.
 */
export async function forgetTag(tag: string): Promise<void> {
  const now = await reloadTags();
  const info = tagIn(now, tag);
  if (!info || info.count > 0) return;
  await post("delete", { tag: info.name });
}

/** A document a vault-wide change reached, or could not. */
export interface TagDoc {
  name: string;
  kind: TextKind;
}

/**
 * A tag renamed in every document, or merged into one that exists: `POST /__board/tags/rename`. A
 * file that kept changing is in `missed`, nothing is rolled back, and sending it again finishes it.
 */
export const renameTag = (from: string, to: string) =>
  post<{ files: TagDoc[]; missed: TagDoc[]; merged: boolean }>("rename", { from, to });

/** A tag taken off every document and out of the tag list: the hue it had comes back, for *Undo*. */
export const deleteTag = (tag: string) =>
  post<{ files: TagDoc[]; missed: TagDoc[]; registered: boolean; hue: Hue | null }>("delete", { tag });
