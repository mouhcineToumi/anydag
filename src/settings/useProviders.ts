import { useEffect, useState } from "react";

import type { LlmReason } from "./llmReason";

/**
 * What `GET /__board/llm` says: which providers exist and which could answer now. No keys, ever.
 * Shared by the Settings tab and the three surfaces that need to offer another ready provider when
 * one fails. `enabled` lets a card ask only once it has a failure to explain.
 */
interface ProviderInfo {
  id: string;
  label: string;
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

export function useProviders(enabled = true): [Providers | null, () => void] {
  const [list, setList] = useState<Providers | null>(null);
  const [asked, ask] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/__board/llm")
      .then((r) => (r.ok ? (r.json() as Promise<Providers>) : null))
      .then((d) => live && d && setList(d))
      /* No server: the select offers the server default and nothing else, which is true. */
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [asked, enabled]);
  return [list, () => ask((n) => n + 1)];
}
