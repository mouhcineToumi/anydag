import { useEffect, useState } from "react";

import type { LlmReason } from "./llmReason";

/**
 * What `GET /__board/llm` says: which providers exist and which could answer now. No keys, ever.
 * Shared by the Settings tab and the three surfaces that need to offer another ready provider when
 * one fails, and by their model chips. `enabled` lets a card ask only once it has a failure to
 * explain.
 */
interface ProviderInfo {
  id: string;
  label: string;
  /** What the name no longer explains, shown as the provider row's hint in Settings. */
  description: string;
  kind: "http" | "cli";
  defaultModel: string;
  models: string[];
  ready: boolean;
  /** Why it is not ready, in the server's own words. */
  error?: string;
  /** The same answer, machine-readable. */
  reason?: LlmReason;
}

export interface Providers {
  default: string;
  providers: ProviderInfo[];
}

/* One answer for every surface: a board with ten prompt cards would otherwise ask ten times. A
   refresh (the Settings tab, a failure's Check again) asks the server again, and every mounted
   surface hears the new answer — a chip on a card must not go on naming the provider from before
   a sign-in. */
let last: Providers | null = null;
let pending: Promise<Providers | null> | null = null;
const listeners = new Set<(d: Providers) => void>();

function load(force: boolean): Promise<Providers | null> {
  if (!force && last) return Promise.resolve(last);
  if (!pending) {
    pending = fetch("/__board/llm")
      .then((r) => (r.ok ? (r.json() as Promise<Providers>) : null))
      .then((d) => {
        if (d) {
          last = d;
          for (const hear of listeners) hear(d);
        }
        return d;
      })
      /* No server: the select offers the server default and nothing else, which is true. */
      .catch(() => null)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useProviders(enabled = true): [Providers | null, () => void] {
  const [list, setList] = useState<Providers | null>(last);
  const [asked, ask] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const hear = (d: Providers) => live && setList(d);
    listeners.add(hear);
    void load(asked > 0).then((d) => {
      if (live && d) setList(d);
    });
    return () => {
      live = false;
      listeners.delete(hear);
    };
  }, [asked, enabled]);
  return [list, () => ask((n) => n + 1)];
}
