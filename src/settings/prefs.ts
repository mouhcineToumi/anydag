/**
 * The one place a *preference* touches `localStorage`.
 *
 * Five keys had grown up in five files — the board list's open state in `App`, the library's beside
 * it, the panel's mode in `useEditor`, its width in `Inspector`, the theme in `useTheme` — each
 * with its own `try`/`catch` and its own idea of what a blocked accessor means. That was fine while
 * a preference was a fact about this window. It stopped being fine the moment they had to follow
 * the person: something has to be able to say *what the whole set is*, and five scattered call sites
 * cannot. The board list's became a dialog and left the set; the sidebar's docking and width came
 * back, and its favourites joined — which makes seven.
 *
 * So this is the list and the accessor, `sync.ts` is what mirrors them to the app's home so they
 * follow the person, and `store.ts` — which owns the `dag:settings` object — is left exactly as it
 * was. Two files
 * rather than one because the settings object is validated (`normalise`) and these are single
 * scalars a component already knows how to read.
 *
 * **Under `?snapshot=1` nothing here is read and nothing is written.** A picture of a board must be
 * a fact about the board, not about whoever last opened it on this machine — the rule `store.ts`
 * states, now holding for the other keys too, which it did not before: a persistent browser
 * profile pointed at `snapshot.mjs` got its own sidebar state in the picture.
 */

import { scopedKey } from "@/vault/current";

/** Where the reader's own choice of theme lives. */
export const THEME = "dag:theme";
/**
 * Whether the reader's own theme is drawn on every board, over a board's own `theme:` — *Use my
 * theme on every board*. `"1"` for on; absent or `"0"`, **off**: a board that names a theme is drawn
 * in it. The theme's own half (`VAULT_PREF_KEYS`) — it is a statement about the theme above it.
 */
export const OWN_THEME = "dag:own-theme";
/** Where the library remembers whether it was open. */
export const LIBRARY = "dag:library";
/**
 * Whether the sidebar is docked, and how wide somebody dragged it.
 *
 * **`dag:sidebar` is back, and the reason it went is still true.** It left this list
 * with the permanent 232px column it remembered, because a board list consulted for two seconds
 * should not cost canvas on every board, and a dialog nobody wants reopening itself is not a
 * preference. The sidebar is not that list: it is the app's navigation and the
 * settings, and it puts itself away with one key. Whether somebody keeps it is exactly a
 * preference — a fact about how this person works, which should follow them to another browser —
 * so it is back in the set that travels. `"0"` is put away; absent is open.
 */
export const SIDEBAR = "dag:sidebar";
export const SIDEBAR_WIDTH = "dag:sidebar-w";
/**
 * The sidebar's favourites: a JSON list of `kind:name`. **In `PREF_KEYS`, so they follow the
 * person** — which files somebody keeps at hand is theirs, not this browser's, unlike which
 * folders happen to be unfolded. A name is the identity, so `tree.follow` keeps the list in step
 * with renames and moves made here; one made elsewhere leaves a favourite naming nothing, which is
 * left undrawn rather than drawn broken.
 */
export const FAVOURITES = "dag:favourites";
/**
 * Which folders in the sidebar are open — **this browser's, and deliberately not in `PREF_KEYS`.**
 *
 * View state, like a scroll position: a laptop and a phone have no reason to agree on which
 * folders are unfolded, and syncing it would make every click on a chevron a write that travels.
 * Written with {@link writeLocal}, which is why a click here does not wake the sync either.
 */
export const SIDEBAR_FOLDERS = "dag:sidebar-open";
/**
 * The list of files as this browser last fetched it, per vault — a cache, never a
 * preference, and never in `PREF_KEYS`: the sidebar draws it the moment the page loads and the
 * fetch replaces it, so a refresh does not show an empty tree for as long as the listing takes. It
 * carries the vault it was fetched for, and nothing is drawn from it for any other.
 */
export const FILE_LIST = "dag:file-list";
/**
 * Whether the Tasks page is a list or a board — this browser's for `SIDEBAR_FOLDERS`'s
 * reason: which way somebody looks at their tasks is view state, and not something to write to the
 * settings that travel every time they switch.
 */
export const TASKS_VIEW = "dag:tasks-view";

/**
 * Whether a run's *About this quiz* panel is folded away, `"0"` when it is. The Tasks
 * page's layout's reason: view state, this browser's, not in `PREF_KEYS`.
 */
export const QUIZ_ABOUT = "dag:quiz-about";
/**
 * Which tab of the Settings modal was open last, so the next ctrl+, lands where the last
 * one left off. The Tasks page's layout's reason: view state, this browser's, not in `PREF_KEYS` —
 * a tab somebody glanced at is not a thing to write to the settings that travel.
 */
export const SETTINGS_TAB = "dag:settings-tab";
/**
 * Which of tasks, events and notes the calendar shows: a comma list of what is **off**,
 * so a kind added later is shown to everybody who has not said otherwise. **In `PREF_KEYS`, in the
 * half that follows the person**: a person's view of their own time is the same in every vault.
 */
export const CALENDAR_HIDE = "dag:calendar-hide";
/**
 * The day a calendar week starts on, `0` for Sunday to `6` for Saturday — Monday, `1`, when nobody
 * has said. **The person's, in every vault**: the one line in
 * the Settings card that does not switch with the vault, which the card says beside it.
 */
export const WEEK_START = "dag:week-start";
/**
 * The time zone a person reads and writes times in, an IANA name — absent, the browser's
 * own. **The person's, in every vault**, `WEEK_START`'s reason, and in `PREF_KEYS` for a second
 * one: the server reads it out of the app's bundle, so an agent that writes `09:00` with no
 * offset gets the zone its person meant (`server/frontmatter.ts`'s `placed`).
 */
export const TIME_ZONE = "dag:time-zone";
/**
 * The zone the browser this person used last was in, written by the page whenever it differs
 * (`watchZone`). Nobody chooses it — it is how "the default is theirs" reaches the server, which has
 * no browser to ask, when {@link TIME_ZONE} is absent. Two browsers in two zones take turns, and the
 * one used last is the better guess.
 */
export const TIME_ZONE_SEEN = "dag:time-zone-seen";
/**
 * Which view a bare `?calendar=1` opens, and how many days a run of days is — this
 * browser's, for `TASKS_VIEW`'s reason: which way somebody looks at their time is view state.
 */
export const CALENDAR_VIEW = "dag:calendar-view";
/**
 * The folder a vault puts new attachments in, relative to its root (`attachments` when unset). The
 * vault's: it travels in the vault's bundle, `<vault>/.anydag/settings.json`, which the server reads
 * when the vault opens and again whenever that bundle is written.
 */
export const ATTACHMENTS = "dag:attachments";
/**
 * Whether renaming or moving a document rewrites the `[[wikilinks]]` that name it, Obsidian's
 * *Automatically update internal links*: `"0"` for off, anything else — absent included — on. The
 * vault's, for `ATTACHMENTS`'s reason: the server reads it out of the vault's bundle on every rename
 * (`server/relink.ts`), and a CLI or an agent renaming with the app closed reads the same file.
 */
export const UPDATE_LINKS = "dag:update-links";
/** Which half of the editor panel is showing, and how wide somebody dragged it. */
export const INSPECTOR_MODE = "dag:inspector-mode";
export const INSPECTOR_WIDTH = "dag:inspector-w";

/**
 * Every preference that is not the settings object.
 *
 * A closed set, and the reason it is one: `sync.ts` sends *this list* to the app's home, so a fifth
 * key added in a component and not here is a preference that silently stops following anybody.
 * `test/prefs.test.ts` holds it against the keys the app actually reads.
 */
export const PREF_KEYS = [
  THEME,
  OWN_THEME,
  LIBRARY,
  INSPECTOR_MODE,
  INSPECTOR_WIDTH,
  SIDEBAR,
  SIDEBAR_WIDTH,
  FAVOURITES,
  CALENDAR_HIDE,
  WEEK_START,
  TIME_ZONE,
  TIME_ZONE_SEEN,
  ATTACHMENTS,
  UPDATE_LINKS,
] as const;

/**
 * **The half of `PREF_KEYS` that switches with the vault**: the
 * theme and the favourites — which name files, and a vault's files are its own — travel with the
 * settings object in the vault's bundle. Everything else in `PREF_KEYS` is how the window is laid
 * out, and stays the person's: a sidebar docked in one vault is docked in the next.
 */
export const VAULT_PREF_KEYS = [THEME, OWN_THEME, FAVOURITES, ATTACHMENTS, UPDATE_LINKS] as const;
export const ACCOUNT_PREF_KEYS = PREF_KEYS.filter((k) => !(VAULT_PREF_KEYS as readonly string[]).includes(k));

/**
 * When this browser last changed a preference **of this vault's** — `STAMP`'s counterpart for
 * the vault's bundle, kept per vault like the preferences it dates.
 */
export const VAULT_STAMP = "dag:vault-prefs-at";

/**
 * Every key this browser keeps a copy of **per vault**: the vault's preferences, the settings
 * object (`store.ts`'s `dag:settings`), which folders are open — they are the vault's folders —
 * and the clock that dates them. Under any vault but the default they are stored as `key@slug`,
 * so two tabs in two vaults never read each other's theme (`vault/current.ts`).
 */
const PER_VAULT = new Set<string>([...VAULT_PREF_KEYS, "dag:settings", SIDEBAR_FOLDERS, VAULT_STAMP, FILE_LIST]);

/** Where `key` is kept in `localStorage` for this tab: scoped to the vault when it is a vault's. */
export function storageKey(key: string): string {
  return PER_VAULT.has(key) ? scopedKey(key) : key;
}

function keysOf(half?: Half): readonly string[] {
  return half === "account" ? ACCOUNT_PREF_KEYS : half === "vault" ? VAULT_PREF_KEYS : PREF_KEYS;
}

/** Dispatched on `window` after any preference changes, so `sync.ts` can push it up. */
export const CHANGED = "dag:prefs";

/**
 * When this browser last changed a preference, in milliseconds.
 *
 * What makes the sync last-write-wins rather than server-always-wins. Without it, a person who
 * toggles the board list and reloads inside the push debounce gets the *older saved copy*
 * adopted over the change they just made — a switch that flips back on its own, which is the
 * worst kind of preference bug because it looks like the click never registered.
 */
export const STAMP = "dag:prefs-at";

/**
 * Whether this browser syncs preferences to the app's home at all.
 *
 * `"off"` is the Playwright suite, seeded through `storageState` — see `e2e/global-setup.ts`. Eight
 * workers share one set of preferences through the server, so worker A
 * opening the library changed what worker B's next page load started with: twenty checks failed on
 * a chord that toggled the library *closed*, an export at somebody else's scale, and a board list
 * that was open when the check had just hidden it (that last one's key is
 * gone; the other two are live). The suite needs the isolation a browser context
 * used to give it for nothing, and saying so in one key is honester than making two hundred URLs
 * carry a flag. `settings.spec.ts` turns it back on for the one check that is about the sync.
 */
export const SYNC = "dag:sync";

function snapshot(): boolean {
  try {
    return new URLSearchParams(location.search).get("snapshot") === "1";
  } catch {
    return false;
  }
}

/**
 * A preference, or the fallback — for a snapshot, for blocked site data, and for an absent key.
 *
 * `key` is a `string` rather than one of `PREF_KEYS` because `STAMP` and `SYNC` are read through
 * here too and are deliberately *not* in that array: it is what travels with the person, and neither
 * of those is a preference anybody chose. Keeping them out of it is what stops the sync from
 * syncing its own bookkeeping.
 */
export function readPref(key: string, fallback: string | null = null): string | null {
  if (snapshot()) return fallback;
  try {
    return localStorage.getItem(storageKey(key)) ?? fallback;
  } catch {
    /* A browser with site data blocked throws on the accessor itself. */
    return fallback;
  }
}

/** The same, for the one that is a boolean. Anything that is not `"0"` counts as on. */
export function readFlag(key: string, fallback: boolean): boolean {
  const raw = readPref(key);
  return raw === null ? fallback : raw !== "0";
}

/** Write one, and tell the window — which is how it reaches the sync. */
export function writePref(key: string, value: string | null): void {
  if (snapshot()) return;
  try {
    if (value === null) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), value);
  } catch {
    /* Remembering is the nicety; honouring it for this session is the point. */
  }
  announce(PER_VAULT.has(key) ? "vault" : "account");
}

export function writeFlag(key: string, value: boolean): void {
  writePref(key, value ? "1" : "0");
}

/**
 * Write a key this browser keeps to itself: no announcement, so nothing is pushed to the app's
 * home
 * and the sync's clock does not move. For view state such as {@link SIDEBAR_FOLDERS}, which is not
 * in `PREF_KEYS` and would otherwise make every click on a folder a round trip for nothing.
 */
export function writeLocal(key: string, value: string | null): void {
  if (snapshot()) return;
  try {
    if (value === null) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), value);
  } catch {
    /* Blocked site data: the folder is open for this session, which is the point. */
  }
}

/** Which of the two bundles a change belongs to: the person's, or this vault's. */
export type Half = "account" | "vault";

function announce(half: Half = "account"): void {
  touch(half);
  try {
    dispatchEvent(new CustomEvent(CHANGED, { detail: half }));
  } catch {
    /* No `window`. Nothing is listening either. */
  }
}

/** Record that this browser has just changed something in one half. */
export function touch(half: Half = "account"): void {
  if (snapshot()) return;
  try {
    localStorage.setItem(storageKey(half === "vault" ? VAULT_STAMP : STAMP), String(Date.now()));
  } catch {
    /* Site data blocked, so there is nothing to be newer *than* either. */
  }
}

/** When this browser last changed a preference in one half. `0` for one that never has. */
export function stamp(half: Half = "account"): number {
  const n = Number(readPref(half === "vault" ? VAULT_STAMP : STAMP, "0"));
  return Number.isFinite(n) ? n : 0;
}

/** Whether preferences follow the person between browsers. Off for a snapshot and for the e2e suite. */
export function syncs(): boolean {
  if (snapshot()) return false;
  try {
    return localStorage.getItem(SYNC) !== "off";
  } catch {
    return false;
  }
}

/**
 * Every preference this browser holds, as one object — what goes up to the app's home. With a `half`,
 * only that half's: the person's bundle and each vault's are written separately.
 */
export function readAll(half?: Half): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keysOf(half)) {
    const value = readPref(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Take the app's saved copy, replacing what this browser holds.
 *
 * **Called before the app mounts**, never after. Every one of these is read once into React state
 * by the component that owns it, so adopting them afterwards would mean a subscription per key and
 * as many components learning where the saved copy lives. Doing it in the gate — before `<App/>` —
 * costs one round trip and keeps every one of those files as it was.
 *
 * A key the saved copy does not carry is *removed*, not left: a browser that has never
 * chosen a theme should show the default, not whatever the last person on this machine picked.
 */
export function adoptAll(values: Record<string, unknown>, half?: Half): void {
  if (snapshot()) return;
  for (const key of keysOf(half)) {
    const value = values[key];
    try {
      if (typeof value === "string") localStorage.setItem(storageKey(key), value);
      else localStorage.removeItem(storageKey(key));
    } catch {
      /* Site data blocked. The session still honours whatever the defaults are. */
    }
  }
}
