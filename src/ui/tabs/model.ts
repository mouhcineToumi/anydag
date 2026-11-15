import { assertNever, FILE_KINDS, type FileKind } from "@/board/useBoard";
import { leaf } from "@/ui/tree";

/**
 * The window's documents as tabs: what each tab holds, and every change to the set, with no DOM in
 * it (`test/doctabs.test.ts`).
 *
 * **A tab is a place, and a place is the half of the address that says which page is open.** The
 * address the app already had — `?board=`, `?note=`, `?tasks=1&project=…` — is the whole of what a
 * page needs to be drawn again, so a tab keeps exactly that and nothing else: the vault, a `?theme=`
 * and a `?snapshot=` are the window's, and stay in the address whichever tab is in front. The active
 * tab's place *is* the address; a tab in the background keeps its own here. See *Tabs* in
 * `docs/architecture/sidebar.md`.
 *
 * **One tab per document or page.** Opening a file that is already open in another tab goes to that
 * tab, so a note never has two editors in one window writing against each other, and what a tab
 * keeps while it is away (its scroll, its selection, its undo) is the document's too.
 */

/** The keys that say which page is open, and what each page shows of itself. */
export const PAGE_KEYS = [
  "board",
  "note",
  "quiz",
  "table",
  "tab",
  "file",
  "tasks",
  "project",
  "tag",
  "quizzes",
  "run",
  "page",
  "calendar",
  "date",
  "days",
  "trash",
  "chat",
] as const;

/**
 * The page keys and `ref`: a reference on its way to being resolved is the tab's too, so a tab opened
 * on a link draws the document the link names once the server has said which one it is.
 */
const PLACE_KEYS: readonly string[] = [...PAGE_KEYS, "ref"];

/** What a tab holds. `id` is the tab's own and never a file's; it outlives a rename of what it shows. */
export interface Tab {
  id: string;
  /** The page keys of the address, as a query string without its `?` — `""` is Home. */
  place: string;
}

/** A tab closed, and where it was, so Ctrl/Cmd+Shift+T puts it back in its place. */
export interface Closed {
  tab: Tab;
  at: number;
}

/** The window's tabs: never empty, one of them in front, and the ones closed most recently. */
export interface Tabs {
  list: readonly Tab[];
  active: string;
  closed: readonly Closed[];
}

/** How many closed tabs Ctrl/Cmd+Shift+T can walk back through. */
export const CLOSED_LIMIT = 20;

/** The page half of an address, in one order, so two places that mean the same say the same. */
export function placeOf(query: URLSearchParams | string): string {
  const q = typeof query === "string" ? new URLSearchParams(query) : query;
  const out = new URLSearchParams();
  for (const key of PLACE_KEYS) {
    const v = q.get(key);
    if (v !== null) out.set(key, v);
  }
  return out.toString();
}

/**
 * The address a tab is drawn under: the window's own keys from `address` — the vault, a theme, a
 * snapshot — and the tab's place in place of whatever page `address` named.
 */
export function addressOf(place: string, address: URLSearchParams | string): URLSearchParams {
  const next = new URLSearchParams(typeof address === "string" ? address : address.toString());
  for (const key of PLACE_KEYS) next.delete(key);
  for (const [k, v] of new URLSearchParams(place)) next.set(k, v);
  return next;
}

/** What a tab shows: a file of one of the five kinds, one of the listing pages, or Home. */
export type TabKind = FileKind | "tasks" | "calendar" | "quizzes" | "trash" | "assistant" | "home";

/**
 * The page a place draws, by the rule `App` reads the address with: a listing page before a file,
 * and among the files a quiz, a table, an attachment, a note, then a board. The Assistant's page is
 * named whether or not the Assistant is on; `App` draws Home for it when it is off.
 */
export function kindOf(place: string): TabKind {
  const q = new URLSearchParams(place);
  if (q.get("tasks") === "1") return "tasks";
  if (q.get("calendar")) return "calendar";
  if (q.get("quizzes") === "1") return "quizzes";
  if (q.get("trash") === "1") return "trash";
  if (q.get("chat")) return "assistant";
  for (const kind of ["quiz", "table", "file", "note", "board"] as const) if (q.get(kind)) return kind;
  return "home";
}

/** What a tab is called: a file by its title, or the last part of its name; a page by its name. */
export function tabLabel(place: string, titles: Readonly<Record<string, string>>): string {
  const kind = kindOf(place);
  switch (kind) {
    case "board":
    case "note":
    case "quiz":
    case "table":
    case "file": {
      const name = fileOf(place)?.name ?? "";
      return titles[name] ?? leaf(name);
    }
    case "tasks":
      return "Tasks";
    case "calendar":
      return "Calendar";
    case "quizzes":
      return "Quizzes";
    case "trash":
      return "Trash";
    case "assistant":
      return "Assistant";
    case "home":
      return "Home";
    default:
      return assertNever(kind);
  }
}

/** The file a place is open on, or `null` for a listing page and Home. */
export function fileOf(place: string): { kind: FileKind; name: string } | null {
  const kind = kindOf(place);
  if (!isFileKind(kind)) return null;
  const name = new URLSearchParams(place).get(kind);
  return name ? { kind, name } : null;
}

const isFileKind = (kind: TabKind): kind is FileKind => (FILE_KINDS as readonly string[]).includes(kind);

/**
 * What makes two places one tab: the same file, or the same listing page. Home is never shared — a
 * new tab is a Home of its own, which is what Ctrl/Cmd+T is for.
 */
export function identity(place: string): string | null {
  const kind = kindOf(place);
  switch (kind) {
    case "board":
    case "note":
    case "quiz":
    case "table":
    case "file":
      return `${kind}:${new URLSearchParams(place).get(kind)}`;
    case "tasks":
    case "calendar":
    case "quizzes":
    case "trash":
    case "assistant":
      return kind;
    case "home":
      return null;
    default:
      return assertNever(kind);
  }
}

/** The tab already holding `place`'s document or page, other than `except`. */
export function holding(tabs: Tabs, place: string, except?: string): Tab | undefined {
  const want = identity(place);
  if (want === null) return undefined;
  return tabs.list.find((t) => t.id !== except && identity(t.place) === want);
}

/** A tab's id: short, and unique among the tabs a window has ever had. */
export function newTabId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `t${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** One tab, in front, on `place`. */
export function single(place: string, id: string = newTabId()): Tabs {
  return { list: [{ id, place }], active: id, closed: [] };
}

/** The tab with `id`, if the window has it. */
export const tabById = (tabs: Tabs, id: string | null | undefined): Tab | undefined =>
  id ? tabs.list.find((t) => t.id === id) : undefined;

/** The tab in front. */
export const activeTab = (tabs: Tabs): Tab => tabById(tabs, tabs.active) ?? tabs.list[0]!;

/** `id` gives up the place it had for `place`; the set is the same object when nothing changed. */
export function setPlace(tabs: Tabs, id: string, place: string): Tabs {
  const at = tabs.list.findIndex((t) => t.id === id);
  if (at < 0 || tabs.list[at]!.place === place) return tabs;
  const list = tabs.list.slice();
  list[at] = { id, place };
  return { ...tabs, list };
}

/**
 * The window's address moved, in the entry `entry` names: that tab takes the place and comes to the
 * front. An entry made before tabs, or by a tab since closed, names none, and the tab in front takes
 * it — Back never makes a tab.
 */
export function adopt(tabs: Tabs, entry: string | null | undefined, place: string): Tabs {
  const id = tabById(tabs, entry)?.id ?? tabs.active;
  const moved = setPlace(tabs, id, place);
  return moved.active === id ? moved : { ...moved, active: id };
}

/** Bring `id` to the front. */
export function activate(tabs: Tabs, id: string): Tabs {
  return tabs.active === id || !tabById(tabs, id) ? tabs : { ...tabs, active: id };
}

/**
 * A new tab on `place`, right after the one in front — or after `after`, the tab opened from it last,
 * so several opened in a row keep the order they were opened in, as a browser's do. In front itself
 * unless `front` is false: a click that asks for a new tab leaves the page it was made on in front.
 */
export function openTab(tabs: Tabs, place: string, id: string = newTabId(), front = true, after?: string): Tabs {
  const from = after && tabById(tabs, after) ? after : tabs.active;
  const at = tabs.list.findIndex((t) => t.id === from);
  const list = tabs.list.slice();
  list.splice(at + 1, 0, { id, place });
  return { ...tabs, list, active: front ? id : tabs.active };
}

/**
 * Close `id`. The tab in front goes to its right-hand neighbour, as a browser's does, or its left at
 * the end. The last tab is never closed: it becomes Home, so the window always has a page.
 */
export function closeTab(tabs: Tabs, id: string, homeId: string = newTabId()): Tabs {
  const at = tabs.list.findIndex((t) => t.id === id);
  if (at < 0) return tabs;
  const tab = tabs.list[at]!;
  const closed = remember(tabs.closed, { tab, at });
  if (tabs.list.length === 1) return { list: [{ id: homeId, place: "" }], active: homeId, closed };
  const list = tabs.list.filter((t) => t.id !== id);
  const active = tabs.active === id ? list[Math.min(at, list.length - 1)]!.id : tabs.active;
  return { list, active, closed };
}

/** Close every tab but `id`, which comes to the front; each closed one can be reopened. */
export function closeOthers(tabs: Tabs, id: string): Tabs {
  const keep = tabById(tabs, id);
  if (!keep) return tabs;
  let closed = tabs.closed;
  tabs.list.forEach((tab, at) => {
    if (tab.id !== id) closed = remember(closed, { tab, at });
  });
  return { list: [keep], active: id, closed };
}

const remember = (closed: readonly Closed[], c: Closed): Closed[] =>
  /* Home is nothing to come back to. */
  c.tab.place === "" ? closed.slice() : [...closed, c].slice(-CLOSED_LIMIT);

/**
 * The tab closed last, back where it was and in front. Its document may be open in another tab by
 * now: then that tab comes to the front, and nothing is opened twice.
 */
export function reopen(tabs: Tabs): Tabs {
  const last = tabs.closed[tabs.closed.length - 1];
  if (!last) return tabs;
  const closed = tabs.closed.slice(0, -1);
  const there = holding(tabs, last.tab.place);
  if (there) return { ...tabs, active: there.id, closed };
  /* A Home nobody has used yet is replaced, as a browser's empty new tab would be. */
  const lone = tabs.list.length === 1 && tabs.list[0]!.place === "";
  const list = lone ? [] : tabs.list.slice();
  const id = tabById(tabs, last.tab.id) ? newTabId() : last.tab.id;
  list.splice(Math.min(last.at, list.length), 0, { id, place: last.tab.place });
  return { list, active: id, closed };
}

/** `id` moved to position `to` among the tabs; the same object when it is already there. */
export function moveTab(tabs: Tabs, id: string, to: number): Tabs {
  const from = tabs.list.findIndex((t) => t.id === id);
  const at = Math.max(0, Math.min(to, tabs.list.length - 1));
  if (from < 0 || from === at) return tabs;
  const list = tabs.list.slice();
  const [tab] = list.splice(from, 1);
  list.splice(at, 0, tab!);
  return { ...tabs, list };
}

/** The tab `step` places from the one in front, round the ends — Ctrl+Tab and Ctrl+Shift+Tab. */
export function stepFrom(tabs: Tabs, step: number): Tab {
  const n = tabs.list.length;
  const at = tabs.list.findIndex((t) => t.id === tabs.active);
  return tabs.list[(((at + step) % n) + n) % n]!;
}

/** Ctrl/Cmd+1…8 is that tab, and 9 the last, as in a browser. */
export function nth(tabs: Tabs, digit: number): Tab | undefined {
  if (digit === 9) return tabs.list[tabs.list.length - 1];
  return tabs.list[digit - 1];
}
