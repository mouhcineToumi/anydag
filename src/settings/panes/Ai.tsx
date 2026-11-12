import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { loadModels } from "@/assistant/api";
import { defaultChoice } from "@/assistant/Composer";
import type { ProviderModels } from "@/assistant/types";
import { assertNever } from "@/board/useBoard";
import { explainLlmReason, type LlmAction } from "@/settings/llmReason";
import { useProviders, type Providers } from "@/settings/useProviders";
import { desktop } from "@/vault/desktop";

import { EffortPicker } from "@/ui/EffortPicker";
import { LlmSentence } from "@/ui/LlmSentence";
import { ModelPicker } from "@/ui/ModelPicker";
import { pickerProvidersFromChat, pickerProvidersFromLlm } from "@/ui/modelList";
import { askPage } from "@/ui/chrome";
import { ProviderMark } from "@/ui/ProviderMark";

import { AI_FEATURE_LABEL, featureSummary, type AiFeature } from "../aiFeature";
import { modelChoice, type ModelChoice } from "../modelChoice";
import { useNarrow } from "../narrow";
import { providerName } from "../providerNames";
import { resetSettingsWithUndo, writeSettings } from "../store";
import { useSettings } from "../useSettings";

import { Field, Group, Hint, ICON, Reset } from "./common";

/**
 * Which model draws this vault's diagrams and flashcards, and what a new Assistant chat starts on.
 *
 * The model half is the old card's *Prompt cards* section, now named after everything it drives —
 * prompt cards, Rewrite and Generate flashcards share it. The Assistant half is the chat's own
 * default, and each message can pick another. Both are stored with the vault today (`dag:settings`
 * is one of the vault's keys), which is why the tab is under *This vault*; moving them to the person
 * is issue #191, not this tab's.
 *
 * **On a phone the two features are two rows**, each naming the provider, model and effort it
 * would use, and a row opens onto that feature's controls inside the same pane. The wide window
 * keeps the two groups side by side in one scroll (#188).
 */
export function AiPane() {
  const narrow = useNarrow();
  const [feature, setFeature] = useState<AiFeature | null>(null);
  const s = useSettings();
  const [llm, refresh] = useProviders();
  const models = useChatModels();
  const diagrams = modelChoice(s.llm, llm);
  const assistant = assistantChoice(models, s.assistant);

  /* A switch with a default, so a feature added to `AiFeature` fails to compile until it has a page. */
  const featurePane = (which: AiFeature) => {
    switch (which) {
      case "diagrams":
        return <DiagramsGroup llm={llm} refresh={refresh} />;
      case "assistant":
        return <AssistantGroup models={models} />;
      default:
        return assertNever(which);
    }
  };

  /* A row is gone with the summary list when it is pressed, so the focus goes to the page it
     opened — left on `<body>`, neither Escape nor the Tab trap would be the modal's any more. */
  const openFeature = (which: AiFeature) => {
    setFeature(which);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-dag-settings] [data-dag-setting-ai-back]")?.focus());
  };

  const closeFeature = () => {
    const from = feature;
    setFeature(null);
    requestAnimationFrame(() => {
      const row = from
        ? document.querySelector<HTMLElement>(`[data-dag-settings] [data-dag-setting-ai-feature="${from}"]`)
        : null;
      (row ?? document.querySelector<HTMLElement>("[data-dag-settings] [data-dag-settings-back]"))?.focus();
    });
  };

  if (!narrow)
    return (
      <>
        <DiagramsGroup llm={llm} refresh={refresh} />
        <AssistantGroup models={models} />
        <Reset what="AI" onReset={() => resetSettingsWithUndo(["llm", "assistant"])} />
      </>
    );

  if (feature !== null)
    return (
      <>
        <button type="button" className="dag-settings__featureBack" data-dag-setting-ai-back="" onClick={closeFeature}>
          <ArrowLeft {...ICON} aria-hidden="true" />
          <span>All AI settings</span>
        </button>
        {featurePane(feature)}
      </>
    );

  return (
    <>
      <Group prompt>
        <FeatureRow
          feature="diagrams"
          provider={diagrams?.provider ?? null}
          summary={featureSummary(diagrams, s.llm.reasoning)}
          onOpen={() => openFeature("diagrams")}
        />
        <FeatureRow
          feature="assistant"
          provider={assistant?.provider ?? null}
          summary={featureSummary(assistant, null)}
          onOpen={() => openFeature("assistant")}
        />
      </Group>
      <Reset what="AI" onReset={() => resetSettingsWithUndo(["llm", "assistant"])} />
    </>
  );
}

/** The Assistant's providers, once the route answers: the summary needs what a new chat would use. */
function useChatModels(): ProviderModels[] | null {
  const [models, setModels] = useState<ProviderModels[] | null>(null);
  useEffect(() => {
    let live = true;
    loadModels().then(
      (got) => live && setModels(got),
      /* No server: the selects offer the defaults and nothing else, which is true. */
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return models;
}

/** One AI feature at phone width: its mark, its name, and the choice a tap would change. */
function FeatureRow({
  feature,
  provider,
  summary,
  onOpen,
}: {
  feature: AiFeature;
  provider: string | null;
  summary: string;
  onOpen(): void;
}) {
  return (
    <button type="button" className="dag-settings__feature" data-dag-setting-ai-feature={feature} onClick={onOpen}>
      {/* A provider with no mark keeps the column, as its row on AI providers does. */}
      <span className="dag-settings__featureMark">
        <ProviderMark provider={provider} size={18} nameFallback={false} />
      </span>
      <span className="dag-settings__featureText">
        <span className="dag-settings__name">{AI_FEATURE_LABEL[feature]}</span>
        <span className="dag-settings__desc" data-dag-setting-ai-summary={feature}>
          {summary}
        </span>
      </span>
      <ChevronRight {...ICON} className="dag-settings__featureChevron" aria-hidden="true" />
    </button>
  );
}

/** The diagrams' and flashcards' half: the provider, the model and how hard to think. */
function DiagramsGroup({ llm, refresh }: { llm: Providers | null; refresh(): void }) {
  const s = useSettings();
  const chosen = llm?.providers.find((p) => p.id === (s.llm.provider ?? llm.default));
  const automatic = llm ? labelOf(llm, llm.default) : undefined;
  const keys = desktop()?.keys;
  const explained =
    chosen && !chosen.ready && chosen.reason
      ? explainLlmReason(chosen.reason, { host: keys ? "desktop" : "browser", providers: llm?.providers })
      : null;
  /* This pane is the AI settings, so "Open AI settings" would open the page already open. The only
     settings action worth a button here is the desktop's "Add a key", which goes to its field on
     the AI providers tab. */
  const keyField = keys ? chosen?.reason?.keyEnv?.[0] : undefined;
  const explanation = explained && {
    ...explained,
    actions: explained.actions.filter((a) => a.kind !== "settings" || keyField !== undefined),
  };
  const problem =
    chosen && !chosen.ready
      ? (explanation?.sentence ?? `${chosen.label} is not set up: ${chosen.error ?? "it could not answer"}.`)
      : null;
  /* In the app a key is typed on the AI providers tab; anywhere else it is the server's environment,
     which is worth one line. */
  const note = problem ?? (keys ? null : "Keys come from the server's environment. This only picks which provider to ask.");
  const act = (a: LlmAction) => {
    switch (a.kind) {
      case "settings":
        /* Only the desktop's "Add a key" is left by the filter above: it means the field on the
           AI providers tab, which is not drawn here. */
        if (keyField) askPage("settings", "providers");
        return;
      case "provider":
        if (a.provider) writeSettings({ llm: { provider: a.provider, model: null } });
        refresh();
        return;
      case "retry":
        refresh();
        return;
      default:
        return assertNever(a.kind);
    }
  };
  return (
    <Group
      prompt
      title="Diagrams and flashcards"
      footer={
        <>
          <Hint data-dag-setting-llm-scope="">Prompt cards, Rewrite in the panel, and Generate flashcards use this model.</Hint>
          {note ? (
            <>
              <Hint data-dag-setting-llm-hint="">
                <LlmSentence text={note} />
              </Hint>
              {explanation ? (
                <div className="dag-settings__actions">
                  {explanation.actions.map((a) => (
                    <button
                      key={`${a.kind}:${a.label}`}
                      type="button"
                      className="dag-button"
                      data-dag-setting-llm-act={a.kind}
                      onClick={() => act(a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      <Field label="Provider" hint={chosen?.description} save="llm.provider">
        <select
          className="dag-select dag-select--wide"
          data-dag-setting-llm-provider=""
          value={s.llm.provider ?? ""}
          /* A model name belongs to its provider, so choosing another provider clears it back to
             that provider's own default rather than sending a Gemini name to Z.ai. */
          onChange={(e) => writeSettings({ llm: { provider: e.target.value || null, model: null } })}
        >
          <option value="">{automatic ? `Automatic · ${automatic}` : "Automatic"}</option>
          {(llm?.providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.ready ? "" : " (not set up)"}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Model"
        save="llm.model"
        hint={s.llm.model ? undefined : `Uses ${chosen?.defaultModel || "the provider's default"} unless you choose another.`}
      >
        <ModelPicker
          data-dag-setting-llm-model=""
          providers={pickerProvidersFromLlm(llm)}
          provider={s.llm.provider}
          model={s.llm.model}
          defaultProvider={llm?.default ?? null}
          onChange={(choice) => writeSettings({ llm: { provider: choice.provider, model: choice.model } })}
        />
      </Field>
      <Field label="Thinking" hint="More is slower, and rarely a better diagram. Low is usually enough." save="llm.reasoning">
        <EffortPicker
          data-dag-setting-llm-reasoning=""
          value={s.llm.reasoning}
          onChange={(level) => writeSettings({ llm: { reasoning: level } })}
        />
      </Field>
    </Group>
  );
}

/**
 * What a new Assistant chat starts on: the harness and the model.
 * Only a new chat reads it — a chat already begun keeps what it was last sent with, and the
 * composer changes that per turn. Both harnesses are the person's own, signed in on this computer.
 */
function AssistantGroup({ models }: { models: ProviderModels[] | null }) {
  const s = useSettings();
  const providers = models;
  const chosen = providers?.find((p) => p.provider === s.assistant.provider);
  const automatic = providers?.length ? defaultChoice(providers, s.assistant).provider : null;
  const automaticLabel = automatic
    ? (providers?.find((p) => p.provider === automatic)?.label ?? providerName(automatic))
    : undefined;
  const note = chosen && !chosen.available ? `${chosen.label} is not available: ${chosen.why ?? "it did not answer"}.` : null;
  return (
    <Group
      prompt
      title="Assistant"
      footer={
        <Hint data-dag-setting-assistant-hint="">
          {note ??
            "The chat in the panel and on the Assistant page runs on your own Claude Code or OpenCode, signed in on this computer. Each message can pick another."}
        </Hint>
      }
    >
      <Field label="Provider" hint="What a new chat runs on." save="assistant.provider">
        <select
          className="dag-select dag-select--wide"
          data-dag-setting-assistant-provider=""
          value={s.assistant.provider ?? ""}
          /* A model name belongs to its provider, so choosing another provider clears it back to
             that provider's own default. */
          onChange={(e) =>
            writeSettings({ assistant: { provider: (e.target.value || null) as "claude" | "opencode" | null, model: null } })
          }
        >
          <option value="">{automaticLabel ? `Automatic · ${automaticLabel}` : "Automatic"}</option>
          {(providers ?? []).map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label}
              {p.available ? "" : " (not available)"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model" save="assistant.model">
        <ModelPicker
          data-dag-setting-assistant-model=""
          providers={pickerProvidersFromChat(providers)}
          provider={s.assistant.provider}
          model={s.assistant.model}
          defaultProvider={automatic}
          disabled={!providers}
          onChange={(choice) =>
            writeSettings({
              assistant: { provider: (choice.provider ?? null) as "claude" | "opencode" | null, model: choice.model },
            })
          }
        />
      </Field>
    </Group>
  );
}

/**
 * What a new chat would start on, in the shape a model chip uses. `null` until the models route
 * answers: "Automatic" is the only honest summary before the list says what automatic is.
 */
function assistantChoice(
  models: readonly ProviderModels[] | null,
  pref: { provider: "claude" | "opencode" | null; model: string | null },
): ModelChoice | null {
  if (!models?.length) return null;
  const at = models.find((p) => p.provider === pref.provider) ?? models.find((p) => p.available) ?? models[0]!;
  const name = at.label || providerName(at.provider);
  if (!name) return null;
  return { provider: at.provider, name, model: pref.model ?? at.default };
}

/** A provider's name for a person, off its id; `undefined` when neither the list nor the app knows it. */
function labelOf(list: Providers | null, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return list?.providers.find((p) => p.id === id)?.label ?? providerName(id);
}
