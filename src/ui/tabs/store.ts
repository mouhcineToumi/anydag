import { useSyncExternalStore } from "react";

import { single, type Tabs } from "./model";

/**
 * The window's tabs, held once for the page: `App` changes them and the strip draws them.
 *
 * A module rather than React state because two things that are not in one component tree read it —
 * the strip in the shell and the pages under it — and because the address handler that decides which
 * tab an entry belongs to runs outside a render. `model.ts` is every change it can make; this only
 * holds the answer and says when it moved.
 */

let tabs: Tabs | null = null;
const listeners = new Set<() => void>();

/** The tabs, or the first set made from `place` — what the address said when the page loaded. */
export function tabsNow(place = ""): Tabs {
  tabs ??= single(place);
  return tabs;
}

/** Replace the set with what `change` makes of it; nothing is announced when it is the same set. */
export function changeTabs(change: (was: Tabs) => Tabs): Tabs {
  const was = tabsNow();
  const next = change(was);
  if (next !== was) {
    tabs = next;
    for (const listen of listeners) listen();
  }
  return next;
}

const subscribe = (listen: () => void): (() => void) => {
  listeners.add(listen);
  return () => listeners.delete(listen);
};

const snapshot = (): Tabs => tabsNow();

/** The tabs, for a component: drawn again whenever they change. */
export function useTabs(): Tabs {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
