import { useCallback, useState } from "react";

import type { SettingsTab } from "./tabs";

/*
 * Apart from `Settings.tsx` so that a page holds this state without fetching the modal: the modal
 * and its panes are a chunk of their own (`src/ui/chunk.ts`), asked for when it opens.
 */

/** Whether Settings is up, and on which tab it was asked to open — the state each page keeps. */
export interface SettingsOpen {
  /** The tab a request named; absent is "where the last one left off". */
  tab?: SettingsTab;
}

/**
 * The state a page holds for the modal, and the three ways it is changed: a request that names a tab
 * (the switcher's *Vault settings…*, the account menu), `ctrl+,` which toggles it, and a close.
 * One hook for the three pages that draw it, so the rule is written once.
 */
export function useSettingsOpen() {
  const [open, setOpen] = useState<SettingsOpen | null>(null);
  const show = useCallback((tab?: SettingsTab) => setOpen({ tab }), []);
  const toggle = useCallback(() => setOpen((v) => (v ? null : {})), []);
  const close = useCallback(() => setOpen(null), []);
  return { open, show, toggle, close };
}
