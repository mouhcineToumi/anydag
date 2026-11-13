import type { LlmReasonCode } from "./llmReason";
import type { ProviderInfo } from "./useProviders";

/**
 * The pill on a provider's row in Settings: one or two words for the state the server reported,
 * so every provider's state reads without opening anything. The sentence that says what to do is
 * `explainLlmReason`'s; this is only its headline.
 */
export type ProviderStatus =
  | "ready"
  | "needs-key"
  | "needs-address"
  | "needs-model"
  | "not-signed-in"
  | "not-installed"
  | "needs-update"
  | "not-ready";

export const STATUS_LABEL: Readonly<Record<ProviderStatus, string>> = {
  ready: "Ready",
  "needs-key": "Needs a key",
  "needs-address": "Needs an address",
  "needs-model": "Needs a model",
  "not-signed-in": "Not signed in",
  "not-installed": "Not installed",
  "needs-update": "Needs an update",
  "not-ready": "Not ready",
};

function fromCode(code: LlmReasonCode): ProviderStatus {
  switch (code) {
    case "no-key":
      return "needs-key";
    case "needs-base-url":
      return "needs-address";
    case "needs-model":
      return "needs-model";
    case "not-signed-in":
      return "not-signed-in";
    case "not-installed":
      return "not-installed";
    case "too-old":
      return "needs-update";
    case "unknown-provider":
    case "busy":
    case "timeout":
    case "provider-error":
      return "not-ready";
    default:
      return assertNever(code);
  }
}

function assertNever(x: never): never {
  throw new Error(`unexpected reason ${String(x)}`);
}

export function providerStatus(p: Pick<ProviderInfo, "ready" | "reason">): ProviderStatus {
  if (p.ready) return "ready";
  return p.reason ? fromCode(p.reason.code) : "not-ready";
}

/**
 * Whether the provider a feature uses needs attention: the dot on the Settings tab that holds the
 * provider list. A provider nobody chose is not a problem, however unready it is.
 */
export function needsAttention(
  list: { default: string; providers: readonly Pick<ProviderInfo, "id" | "ready">[] } | null,
  inUse: readonly (string | null | undefined)[],
): boolean {
  if (!list) return false;
  const used = new Set(inUse.map((id) => id ?? list.default));
  return list.providers.some((p) => used.has(p.id) && !p.ready);
}

/** "just now", "12 seconds ago", "3 minutes ago": when the list on screen was checked. */
export function checkedAgo(at: number | null, now: number): string {
  if (at === null) return "not yet";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? "a minute ago" : `${m} minutes ago`;
}
