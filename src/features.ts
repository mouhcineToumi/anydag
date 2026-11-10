/**
 * What the page is allowed to show, asked of its own server once at boot.
 *
 * Some features talk to an AnyDag server somebody else runs — sync (Settings → Sync, the sidebar's
 * row), the anonymous logs (the first-run question, Settings → Privacy), Send feedback (the
 * sidebar's row, its card and `/api/feedback`). They are behind **one switch, `cloud`**, which the *local server* decides
 * (`server/features.ts`) and answers with `/api/health`, beside the version it already reports.
 *
 * **Read once, at boot, and never owned by the page.** `loadFeatures()` fetches it before anything
 * renders the chrome, one unscoped call the page makes the way `src/auth/api.ts`'s `me()` does, and
 * every gated component reads the same object through `useFeatures()`. There is deliberately no
 * copy in `localStorage` — a page that remembered its own answer could disagree with the server
 * that answers the requests, and the server's answer is the one true one.
 *
 * While the answer is on its way, `useFeatures()` is `null`, and the gated components render
 * nothing: a subject the page is not allowed to draw is drawn late rather than drawn early.
 * The switch is a server's opinion of a build, not a preference anyone pastes in.
 */

import { useSyncExternalStore } from "react";

/** What this build may show of the app's server-backed features — `/api/health`'s `features`. */
export interface Features {
  cloud: boolean;
}

/** Dispatched on `window` when the answer lands, so a page that mounted before it moves. */
const FEATURES_EVENT = "dag:features";

let known: Features | null = null;

function announce(): void {
  try {
    dispatchEvent(new Event(FEATURES_EVENT));
  } catch {
    /* no window */
  }
}

export function useFeatures(): Features | null {
  return useSyncExternalStore(
    (on) => {
      addEventListener(FEATURES_EVENT, on);
      return () => removeEventListener(FEATURES_EVENT, on);
    },
    () => known,
    () => null,
  );
}

/**
 * Ask the server what this build carries, once, before the first page draws. Kicking it off is
 * `main.tsx`'s boot, beside `me()`; there is no retry, because the server's answer is not something
 * a page second-guesses — the next page load asks again.
 */
export async function loadFeatures(): Promise<Features | null> {
  try {
    const r = await fetch("/api/health");
    if (r.ok) {
      const said = (await r.json()) as { features?: Partial<Features> };
      known = { cloud: said.features?.cloud === true };
      announce();
    }
  } catch {
    /* No server: nothing to gate, and nothing gated will try to reach one. */
  }
  return known;
}

/** Whether this page is one nothing server-backed should show: it cannot know its server's answer. */
export function cloudOn(): boolean {
  return known?.cloud === true;
}
