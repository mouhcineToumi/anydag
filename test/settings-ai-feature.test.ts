import { describe, expect, it } from "vitest";

import { featureSummary } from "@/settings/aiFeature";
import { modelChoice } from "@/settings/modelChoice";
import type { Providers } from "@/settings/useProviders";

const CLAUDE = { provider: "claude", name: "Claude Code", model: "sonnet" };

describe("an AI feature's summary row", () => {
  it("names the provider and model the way a model chip does", () => {
    const list: Providers = {
      default: "claude",
      providers: [
        {
          id: "claude",
          label: "Claude Code",
          description: "Uses your Claude plan.",
          kind: "cli",
          defaultModel: "sonnet",
          models: ["sonnet"],
          ready: true,
        },
      ],
    };
    expect(featureSummary(modelChoice({ provider: null, model: null, reasoning: null }, list), null)).toBe(
      "Claude Code · sonnet",
    );
    expect(featureSummary(CLAUDE, null)).toBe("Claude Code · sonnet");
  });

  it("adds the effort only when one is chosen", () => {
    expect(featureSummary(CLAUDE, "low")).toBe("Claude Code · sonnet · Low");
    expect(featureSummary(CLAUDE, "medium")).toBe("Claude Code · sonnet · Medium");
    expect(featureSummary(CLAUDE, "high")).toBe("Claude Code · sonnet · High");
    expect(featureSummary(CLAUDE, "max")).toBe("Claude Code · sonnet · Max");
    /* A preference from before Max existed is still read and still said. */
    expect(featureSummary(CLAUDE, "none")).toBe("Claude Code · sonnet · None");
  });

  it("says Automatic until a provider is known", () => {
    expect(featureSummary(null, null)).toBe("Automatic");
    expect(featureSummary(null, "high")).toBe("Automatic · High");
  });
});
