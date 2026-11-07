/**
 * The settings, following the person rather than the browser.
 *
 * The constraint this is shaped by is in `store.ts` and is not negotiable: **`readSettings()` is
 * synchronous and is called inside the gesture** — `onPaste` reads the placement rule as it runs,
 * `exportAs` reads the scale as the menu is clicked. A server cannot be in that path. So the
 * arrangement is the only one that fits:
 *
 * - `localStorage` stays exactly what it was, and is now *the synchronous cache of the saved
 *   copy* rather than the copy itself. Nothing that reads a preference changed at all.
 * - **Pulling happens once, before the app mounts.** `pull()` is awaited by the gate, between
 *   `/api/auth/me` and the first render, so every component still initialises from storage that is
 *   already the saved one's. The alternative — adopting after mount — would mean five components
 *   subscribing to a change they have no other reason to know about.
 * - **Pushing is debounced and fire-and-forget.** A preference that failed to reach the server is
 *   worth one retry at most: it is already honoured in this window, which is the point of it.
 *
 * What travels is `dag:settings` (the object `store.ts` validates) plus the scalars in `prefs.ts` —
 * *everything* follows the person, window state included —
 * in two bundles: the app's home's, and the vault's this tab is in.
 */

import { fetchVaultSettings, saveVaultSettings } from "@/vault/api";

import { CHANGED, type Half, adoptAll, readAll, stamp, storageKey, syncs, touch } from "./prefs";
import { EVENT, STORE, normalise, readSettings } from "./store";

/** The app's preferences, or `null` when none were ever saved. */
async function fetchSettings(): Promise<Record<string, unknown> | null> {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error(`settings ${response.status}`);
  return ((await response.json()) as { settings?: Record<string, unknown> | null }).settings ?? null;
}

async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
}

/** How long after the last change the saved copy is written. */
const DEBOUNCE = 800;

let timer: ReturnType<typeof setTimeout> | null = null;
let stop: (() => void) | null = null;
/** Which halves changed since the last push, so a theme picked writes the vault's bundle alone. */
const dirty = new Set<Half>();

/**
 * **Two bundles since vaults**, each with its own `at`, which is what makes the sync
 * last-write-wins rather than server-always-wins — sent rather than taken from the server's clock
 * because the comparison it has to win is against *this* browser's own later change.
 *
 * The app's is how the window is laid out; the vault's is the validated settings object
 * plus the preferences that switch with the vault, the theme and the favourites.
 */
function accountBundle(): Record<string, unknown> {
  return { at: stamp("account"), ...readAll("account") };
}

function vaultBundle(): Record<string, unknown> {
  return { settings: readSettings(), at: stamp("vault"), ...readAll("vault") };
}

const atOf = (b: Record<string, unknown>): number => (typeof b.at === "number" ? b.at : Number.POSITIVE_INFINITY);

/** Take a vault's half as this browser's copy for this tab's vault. */
function adoptVault(b: Record<string, unknown>): void {
  try {
    /* Validated on the way in exactly as it is on the way out of `localStorage` — this arrived
       over a wire and may have been written by an older version of the app. */
    localStorage.setItem(storageKey(STORE), JSON.stringify(normalise(b.settings)));
  } catch {
    /* Site data blocked. The values below still will not stick, and that is survivable. */
  }
  adoptAll(b, "vault");
}

/**
 * Adopt the saved copies, or push this browser's where none are saved.
 *
 * `null` and `{}` are different answers on purpose — see the server's `GET /api/settings`. A
 * browser that has never saved anything is the case where what is on this machine is the only
 * thing anybody has chosen, and throwing it away to adopt an emptiness nobody picked would lose a
 * person's setup the first time they open the app.
 *
 * **Last write wins, and the loser is usually the server.** A person toggles the library and
 * reloads before the debounce has fired; the saved copy is still the older one, and adopting it
 * puts the switch back where it was — a click that undoes itself a second later. So a browser whose
 * own change is newer keeps it, and pushes instead. A missing `at` means the copy was written before
 * this mechanism existed, and it is authoritative then: there is nothing to compare it against.
 */
export async function pull(): Promise<void> {
  if (!syncs()) return;
  let account: Record<string, unknown> | null;
  let space: Record<string, unknown> | null;
  try {
    [account, space] = await Promise.all([fetchSettings(), fetchVaultSettings()]);
  } catch {
    /* Offline, or a server that is not answering. The cache is a perfectly good answer and the
       app must still open: a preference is not worth a blank screen. */
    return;
  }

  if (account === null || atOf(account) < stamp("account")) push("account");
  else adoptAll(account, "account");

  if (space === null) {
    push("vault");
  } else if (atOf(space) < stamp("vault")) push("vault");
  else adoptVault(space);

  try {
    dispatchEvent(new Event(EVENT));
  } catch {
    /* No window. */
  }
}

/** Write this browser's copy of one half — or both — to the app's home. Debounced; the last in a burst wins. */
function push(half?: Half): void {
  if (!syncs()) return;
  if (half) dirty.add(half);
  else {
    dirty.add("account");
    dirty.add("vault");
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const halves = [...dirty];
    dirty.clear();
    /* Fire and forget. It is honoured in this window already, which is what a preference is for;
       a failed write is not worth a message on a canvas. */
    if (halves.includes("account")) void saveSettings(accountBundle()).catch(() => undefined);
    if (halves.includes("vault")) void saveVaultSettings(vaultBundle()).catch(() => undefined);
  }, DEBOUNCE);
}

/**
 * Start following changes. Returns the teardown, and is idempotent.
 *
 * Two events because there are two halves of what changes: `dag:settings` is the object, fired by
 * `store.ts`'s `save` — a vault's — and `dag:prefs` is the scalars, whose
 * `detail` says which bundle the key belongs to. Neither knows this is listening.
 */
export function watch(): () => void {
  if (stop) return stop;
  const onSettings = () => {
    /* Stamped here rather than in `store.ts`, which knows nothing about the sync. */
    touch("vault");
    push("vault");
  };
  const onPrefs = (e: Event) => {
    const half = (e as CustomEvent<Half | undefined>).detail;
    push(half === "account" || half === "vault" ? half : undefined);
  };
  addEventListener(EVENT, onSettings);
  addEventListener(CHANGED, onPrefs);
  /* Stops listening and nothing more. A push already waiting still goes: `Gate`'s effect is torn
     down and run again by StrictMode in development, and a teardown that dropped the timer lost the
     first push a fresh browser makes — its time zone among it. Dropping it is `halt`'s. */
  stop = () => {
    removeEventListener(EVENT, onSettings);
    removeEventListener(CHANGED, onPrefs);
    stop = null;
  };
  return stop;
}
