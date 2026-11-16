import { everyFile, namesOf, type KindLists } from "@/board/useBoard";
import { syncs } from "@/settings/prefs";
import { scopedKey } from "@/vault/current";

import { seedTabs } from "./store";
import {
  addressOf,
  fileOf,
  holding,
  identity,
  newTabId,
  openTab,
  placeOf,
  setPlace,
  tabById,
  type Tab,
  type Tabs,
} from "./model";

/**
 * The tabs a window had open in a vault, kept between runs (#264), and the files they are on, kept
 * up with while the window is open.
 *
 * **Where they are kept: the app's home, never the vault.** `/api/tabs` stores them in the home's
 * database under the vault's id (`server/routes/meta.ts`). The vault holds the person's documents and
 * goes where a sync takes it; which of them one window has open is not one of them. With the
 * settings' sync switched off (`syncs()`, `dag:sync`) the app keeps nothing of this browser's in
 * the home, and the tabs are kept in this browser's storage for the vault instead — the rule every
 * preference already follows. A snapshot and a read-only view keep none.
 *
 * **A tab knows its file by id.** The address names a file, and a file is renamed and moved; each
 * tab's file id is noted as the listing gives it (`TabFiles`), and saved with it. A tab whose name the
 * listing no longer has follows its id to the name it has now, and one whose id is nowhere is gone:
 * restored, it is dropped; behind the tab in front, it is closed with a reason.
 */

/** What is saved of a tab: its place, and its file's id when it is on one the listing knew. */
interface SavedTab {
  id: string;
  place: string;
  doc?: string;
}

export interface SavedTabs {
  list: SavedTab[];
  active: string;
}

/** Which file each tab was last seen on: the name the listing gave and its id there. */
export type TabFiles = Map<string, { name: string; doc: string }>;

/**
 * A saved set, read back — whatever a past version of the app or a hand wrote. A tab that does not
 * parse is dropped; a second tab on one document is folded into the first, as opening it again
 * would. `null` is "nothing to restore".
 */
export function parseTabs(raw: unknown): { tabs: Tabs; files: TabFiles } | null {
  if (!raw || typeof raw !== "object") return null;
  const { list, active } = raw as { list?: unknown; active?: unknown };
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const kept: Tab[] = [];
  const files: TabFiles = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, place, doc } = item as { id?: unknown; place?: unknown; doc?: unknown };
    if (typeof id !== "string" || !/^t[0-9a-f]{6,32}$/.test(id) || seen.has(id) || typeof place !== "string") continue;
    const clean = placeOf(place);
    const same = identity(clean);
    if (same !== null && kept.some((t) => identity(t.place) === same)) continue;
    seen.add(id);
    kept.push({ id, place: clean });
    const file = fileOf(clean);
    if (file && typeof doc === "string" && doc) files.set(id, { name: file.name, doc });
  }
  if (!kept.length) return null;
  const front = typeof active === "string" && seen.has(active) ? active : kept[0]!.id;
  return { tabs: { list: kept, active: front, closed: [] }, files };
}

/** What is saved: the tabs, their files' ids, and which is in front. The closed ones are this run's. */
export function savedForm(tabs: Tabs, files: TabFiles): SavedTabs {
  return {
    list: tabs.list.map(({ id, place }) => {
      const known = files.get(id);
      const file = fileOf(place);
      return known && file && known.name === file.name ? { id, place, doc: known.doc } : { id, place };
    }),
    active: tabs.active,
  };
}

/**
 * The window's tabs as it opens on `place` — the address it was given — over the ones it had: a
 * link to a document already in a tab is that tab, and a link to another is a new tab beside the one
 * that was in front. An address with no document on it is the tab that was in front when the window
 * is new (`resume`, a launch: carry on where it was left) and Home in one already open, as a bare
 * address always was — a Home tab the set has, or a new one beside the one that was in front.
 */
export function restore(saved: Tabs, place: string, resume = true): Tabs {
  if (!place) {
    if (resume || activeOf(saved) === "") return saved;
    const home = saved.list.find((t) => t.place === "");
    return home ? { ...saved, active: home.id } : openTab(saved, "", newTabId(), true, saved.active);
  }
  const there = holding(saved, place);
  if (there) return { ...setPlace(saved, there.id, place), active: there.id };
  return openTab(saved, place, newTabId(), true, saved.active);
}

const activeOf = (tabs: Tabs): string | undefined => tabById(tabs, tabs.active)?.place;

/**
 * What the listing says of the tabs' files: a tab whose name it no longer has but whose id it does
 * follows the file there; one whose id it does not have either may be gone, which the caller asks
 * the server about (a listing can be a round trip behind). A tab whose file was never seen by id — a
 * file made a moment ago — is left alone, unless it was restored, when there is nothing to wait for.
 */
export function reconcile(
  tabs: Tabs,
  files: TabFiles,
  list: KindLists & { ids: Readonly<Record<string, string>> },
  restored: ReadonlySet<string> = new Set(),
): { follow: { id: string; place: string }[]; missing: { id: string; doc: string; name: string }[] } {
  const follow: { id: string; place: string }[] = [];
  const missing: { id: string; doc: string; name: string }[] = [];
  let byId: Map<string, { kind: string; name: string }> | null = null;
  for (const tab of tabs.list) {
    const file = fileOf(tab.place);
    if (!file) continue;
    if (namesOf(list, file.kind).includes(file.name)) continue;
    const known = files.get(tab.id);
    if (!known || known.name !== file.name) {
      /* A tab restored on a file the listing never gave an id for: nothing to follow it by. */
      if (restored.has(tab.id)) missing.push({ id: tab.id, doc: "", name: file.name });
      continue;
    }
    byId ??= new Map(everyFile(list).map((f) => [list.ids[f.name] ?? "", f]));
    const now = byId.get(known.doc);
    if (now && now.kind === file.kind) {
      const q = new URLSearchParams(tab.place);
      q.set(file.kind, now.name);
      follow.push({ id: tab.id, place: placeOf(q) });
    } else missing.push({ id: tab.id, doc: known.doc, name: file.name });
  }
  return { follow, missing };
}

/** Note the ids of the files the tabs are on, as the listing has them now. */
export function noteFiles(tabs: Tabs, files: TabFiles, ids: Readonly<Record<string, string>>): void {
  for (const id of files.keys()) if (!tabById(tabs, id)) files.delete(id);
  for (const tab of tabs.list) {
    const file = fileOf(tab.place);
    const doc = file ? ids[file.name] : undefined;
    if (file && doc) files.set(tab.id, { name: file.name, doc });
  }
}

/* ---- where they are kept ---- */

/** Where the tabs are kept in this browser when the settings do not sync — never a preference. */
export const SAVED_TABS = "dag:tabs";

/** The tabs this window had in this vault, or `null`. Never throws: a window opens without them. */
async function loadTabs(): Promise<{ tabs: Tabs; files: TabFiles } | null> {
  if (!syncs()) {
    try {
      const raw = localStorage.getItem(scopedKey(SAVED_TABS));
      return raw ? parseTabs(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  try {
    const r = await fetch("/api/tabs");
    return r.ok ? parseTabs(((await r.json()) as { tabs?: unknown }).tabs) : null;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: SavedTabs | null = null;
let last = "";

function flush(keepalive = false): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const form = pending;
  pending = null;
  if (!form) return;
  const text = JSON.stringify(form);
  if (text === last) return;
  last = text;
  if (!syncs()) {
    try {
      localStorage.setItem(scopedKey(SAVED_TABS), text);
    } catch {
      /* Storage full or refused: the tabs are not kept, which is what a private window expects. */
    }
    return;
  }
  void fetch("/api/tabs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tabs: form }),
    keepalive,
  }).catch(() => undefined);
}

/** Keep the tabs, a moment after the last change: a run of switches is one write to the home. */
export function saveTabs(tabs: Tabs, files: TabFiles): void {
  pending = savedForm(tabs, files);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(), 500);
}

/** Whatever is waiting goes now — the window is going. */
export const flushTabs = (): void => flush(true);

/** The file each tab is on, by id, for this run (`App` keeps it up as the listing changes). */
export const tabFiles: TabFiles = new Map();

/**
 * The tabs restored from the last run, until the first fresh listing has said which of their files
 * are still there: a restored tab whose file is gone is dropped without a word, where a tab closed
 * under the person's eyes says why.
 */
export const restoredTabs = new Set<string>();

/** Marks this window as one the app has been in: a reload and a link keep it, a new window has none. */
export const WINDOW_SEEN = "dag:tabs-window";

/** Whether this window is opening for the first time — a launch, a new browser tab — and marks it. */
function newWindow(): boolean {
  try {
    if (sessionStorage.getItem(WINDOW_SEEN)) return false;
    sessionStorage.setItem(WINDOW_SEEN, "1");
  } catch {
    /* No storage: every load is the window's first, as it would be with the tabs not kept. */
  }
  return true;
}

/**
 * Open the window on the tabs it had — before the first render, so the first page drawn is the
 * one that was in front. In a new window an address with no document on it takes that tab's place.
 */
export async function openSavedTabs(): Promise<void> {
  const resume = newWindow();
  const got = await loadTabs();
  if (!got) return;
  const place = placeOf(location.search);
  const next = restore(got.tabs, place, resume);
  seedTabs(next);
  for (const [id, file] of got.files) tabFiles.set(id, file);
  /* The tab the address names is the address's: a link to a file that is gone draws the page that
     says so, not some other tab. */
  for (const t of got.tabs.list) if (!place || t.id !== next.active) restoredTabs.add(t.id);
  /* What is kept now — not `next`, which may have a tab the address opened that is not kept yet. */
  last = JSON.stringify(savedForm(got.tabs, got.files));
  const front = tabById(next, next.active);
  if (!place && front?.place)
    history.replaceState(history.state, "", `${location.pathname}?${addressOf(front.place, location.search)}`);
}
