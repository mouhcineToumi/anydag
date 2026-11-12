/**
 * The pure half of the model picker: what a search leaves, how a raw id reads, the five recently
 * chosen models, and the nearest id when a custom one is not in a provider's list.
 *
 * No React and no fetch. The two adapters at the foot turn the two routes the app already reads —
 * `/__board/llm` for diagrams and `/__board/chat/models` for the Assistant — into the same shape, so
 * the component never learns which surface it is on. `test/model-picker.test.ts` holds it in Node.
 */

import { providerName } from "@/settings/providerNames";

export interface PickerModel {
  id: string;
  label: string;
}

export interface PickerProvider {
  id: string;
  label: string;
  ready: boolean;
  why?: string;
  models: PickerModel[];
  defaultModel: string;
}

export interface PickerChoice {
  provider: string | null;
  model: string | null;
}

export interface PickerGroup {
  provider: PickerProvider;
  models: PickerModel[];
}

export interface RecentChoice {
  provider: string;
  model: string;
}

/** Where the recently chosen models live. This browser's, not a preference that travels. */
export const RECENT_KEY = "dag:model-recent";
export const RECENT_MAX = 5;

/** The words a model id is made of that want their own case. Everything else is capitalised. */
const WORDS: Readonly<Record<string, string>> = {
  ai: "AI",
  api: "API",
  claude: "Claude",
  deepseek: "DeepSeek",
  fable: "Fable",
  flash: "Flash",
  glm: "GLM",
  gpt: "GPT",
  haiku: "Haiku",
  kimi: "Kimi",
  llm: "LLM",
  max: "Max",
  mini: "Mini",
  ocr: "OCR",
  opus: "Opus",
  pro: "Pro",
  sonnet: "Sonnet",
  stt: "STT",
  tts: "TTS",
  turbo: "Turbo",
  vl: "VL",
};

/**
 * A model id as a person reads it: the part after a provider prefix, split on the dashes and dots
 * that are the id's punctuation rather than its words.
 *
 * A route that carries a readable label — the Assistant's list — uses that instead. This is for the
 * diagrams' list, whose whole answer is raw ids, and for OpenCode's ids, whose label is the id.
 */
export function prettyModel(id: string): string {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The providers a search leaves, each with its matching models. A query matching the provider's own
 * name keeps all of its models; otherwise it is read against each model's id and readable name.
 * Case is the only thing normalised — `glm` finds `opencode-go/glm-5.3-flash`.
 */
export function filterModels(providers: readonly PickerProvider[], query: string): PickerGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return providers.map((provider) => ({ provider, models: [...provider.models] }));
  const out: PickerGroup[] = [];
  for (const provider of providers) {
    const providerHit = provider.label.toLowerCase().includes(q) || provider.id.toLowerCase().includes(q);
    const models = providerHit
      ? [...provider.models]
      : provider.models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
    if (models.length) out.push({ provider, models });
  }
  return out;
}

/** Levenshtein distance, two rows, because a model id is short and this runs while somebody types. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The model a typed id is probably reaching for, or none when nothing is close. A typo one or two
 * characters away suggests the id; a different model entirely does not, because a wrong suggestion
 * is worse than an honest "not in the list".
 */
export function nearestModel(id: string, models: readonly PickerModel[]): PickerModel | undefined {
  const q = id.trim().toLowerCase();
  if (!q || !models.length) return undefined;
  let best: PickerModel | undefined;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const model of models) {
    const at = Math.min(distance(q, model.id.toLowerCase()), distance(q, model.label.toLowerCase()));
    if (at < bestAt) {
      best = model;
      bestAt = at;
    }
  }
  const longest = Math.max(q.length, ...models.map((m) => m.id.length));
  return bestAt <= Math.max(2, Math.ceil(longest / 3)) ? best : undefined;
}

/** The recently chosen models this browser remembers, newest first, validated and capped. */
export function readRecent(): RecentChoice[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    const out: RecentChoice[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const { provider, model } = item as Partial<RecentChoice>;
      if (typeof provider !== "string" || !provider || typeof model !== "string" || !model) continue;
      if (out.some((r) => r.provider === provider && r.model === model)) continue;
      out.push({ provider, model });
      if (out.length === RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Put a model at the front of the recent list and remember it. A repeated pick moves rather than
 * duplicates; the list is capped at five, which is the point at which it stops being quicker than
 * the search.
 */
export function rememberRecent(choice: RecentChoice, previous?: readonly RecentChoice[]): RecentChoice[] {
  const before = previous ?? readRecent();
  const next = [choice, ...before.filter((r) => r.provider !== choice.provider || r.model !== choice.model)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Blocked site data: the list is this session's, and the pick still works. */
  }
  return next;
}

/**
 * The same shape from `GET /__board/llm`, whose models are ids and whose readiness is `ready`.
 * `error` is the server's sentence, kept as the group's explanation when it is not ready.
 */
export function pickerProvidersFromLlm(
  list:
    | {
        providers: readonly {
          id: string;
          label: string;
          defaultModel: string;
          models: readonly string[];
          ready: boolean;
          error?: string;
        }[];
      }
    | null
    | undefined,
): PickerProvider[] {
  return (list?.providers ?? []).map((p) => ({
    id: p.id,
    label: providerName(p.id) ?? p.label,
    ready: p.ready,
    ...(p.error ? { why: p.error } : {}),
    defaultModel: p.defaultModel,
    models: p.models.map((id) => ({ id, label: prettyModel(id) })),
  }));
}

/**
 * The same shape from `GET /__board/chat/models`, whose models already carry a label and whose
 * readiness is `available`. A label that is the id — OpenCode's list does that — is read as a name.
 */
export function pickerProvidersFromChat(
  list:
    | readonly {
        provider: string;
        label: string;
        available: boolean;
        why?: string;
        models: readonly { id: string; label: string }[];
        default: string;
      }[]
    | null
    | undefined,
): PickerProvider[] {
  return (list ?? []).map((p) => ({
    id: p.provider,
    label: providerName(p.provider) ?? p.label,
    ready: p.available,
    ...(p.why ? { why: p.why } : {}),
    defaultModel: p.default,
    models: p.models.map((m) => ({ id: m.id, label: m.label && m.label !== m.id ? m.label : prettyModel(m.id) })),
  }));
}
