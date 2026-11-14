/**
 * What the model picker offers (`GET /__board/chat/models`): per provider, the models and the effort
 * levels. Claude Code's are a short list we keep; OpenCode's are whatever `opencode models` prints for
 * this person's logins, asked once and kept for ten minutes; Codex's are the models its catalog lists
 * for this login (`codexModels`), the first being Codex's own default. A provider that is not installed, too
 * old or not signed in is listed as unavailable, with the sentence the prompt card's settings say
 * (`claudeReady`, `opencodeReady`, `codexReady`), so the picker can say so rather than fail on the first turn.
 */

import { execFile } from "node:child_process";

import { claudeReady, codexModels, codexReady, opencodeReady } from "../../plugins/generate/providers";
import { PROVIDER_NAMES } from "../../src/settings/providerNames";
import type { Provider } from "./types";

interface ModelChoice {
  id: string;
  label: string;
}

export interface ProviderModels {
  provider: Provider;
  label: string;
  available: boolean;
  why?: string;
  models: ModelChoice[];
  /** Effort levels the harness understands; the first is the default. */
  efforts: string[];
  /** What a new chat starts on. */
  default: string;
}

const CLAUDE_MODELS: ModelChoice[] = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
];

const OPENCODE_DEFAULT = "opencode-go/glm-5.3-flash";
/** The scripted harness's Codex model: it reaches no model, so any id would do, and this one says so. */
const CODEX_FAKE = "gpt-fake";

let cached: { at: number; models: ModelChoice[] } | null = null;

function opencodeModels(bin: string): Promise<ModelChoice[]> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return Promise.resolve(cached.models);
  return new Promise((resolve) => {
    execFile(bin, ["models"], { timeout: 15_000, maxBuffer: 1 << 20 }, (e, stdout) => {
      const models = e
        ? []
        : stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => /^[\w.-]+\/[\w.:-]+$/.test(l))
            .map((id) => ({ id, label: id }));
      if (models.length) cached = { at: Date.now(), models };
      resolve(models);
    });
  });
}

/**
 * `fake`: the server runs the scripted harness, which needs no binary — so every provider is available
 * whatever is installed, and the answer says so for the e2e suite to check.
 */
export async function modelsFor(
  have: readonly Provider[],
  env: NodeJS.ProcessEnv = process.env,
  fake = false,
): Promise<{ providers: ProviderModels[]; fake?: true }> {
  const out: ProviderModels[] = [];
  const claude = fake ? { ok: true as const, bin: "fake" } : claudeReady(env);
  out.push({
    provider: "claude",
    label: PROVIDER_NAMES.claude,
    available: have.includes("claude") && claude.ok,
    ...(claude.ok ? {} : { why: claude.error }),
    models: CLAUDE_MODELS,
    efforts: ["", "low", "medium", "high", "max"],
    default: "claude-sonnet-5-5",
  });
  const opencode = fake ? { ok: true as const, bin: "fake" } : opencodeReady(env);
  const listed = !fake && opencode.ok && have.includes("opencode") ? await opencodeModels(opencode.bin) : [];
  out.push({
    provider: "opencode",
    label: PROVIDER_NAMES.opencode,
    available: have.includes("opencode") && opencode.ok,
    ...(opencode.ok ? {} : { why: opencode.error }),
    models: listed.length ? listed : [{ id: OPENCODE_DEFAULT, label: OPENCODE_DEFAULT }],
    efforts: ["", "low", "medium", "high", "max"],
    default: listed.some((m) => m.id === OPENCODE_DEFAULT) || !listed.length ? OPENCODE_DEFAULT : listed[0]!.id,
  });
  const codex = fake ? { ok: true as const, bin: "fake" } : codexReady(env);
  const codexListed = !fake && codex.ok && have.includes("codex") ? (codexModels(codex.bin, env)?.models ?? []) : [];
  const codexList = codexListed.length ? codexListed : fake ? [{ id: CODEX_FAKE, label: "GPT Fake" }] : [];
  out.push({
    provider: "codex",
    label: PROVIDER_NAMES.codex,
    /* A Codex with no catalog cannot run a turn (`codexHarness`), so it is not offered as if it could. */
    available: have.includes("codex") && codex.ok && codexList.length > 0,
    ...(codex.ok ? (codexList.length ? {} : { why: "Codex did not list its models" }) : { why: codex.error }),
    models: codexList,
    efforts: ["", "low", "medium", "high", "max"],
    default: codexList[0]?.id ?? "",
  });
  return fake ? { providers: out, fake: true } : { providers: out };
}
