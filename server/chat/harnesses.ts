/**
 * Which harnesses this server runs turns on: Claude Code, OpenCode and Codex, or with `ANYDAG_CHAT_FAKE=1`
 * the scripted one in their place (the e2e suite, and anybody trying the Assistant without a login).
 */

import { claudeHarness } from "./claude";
import { codexHarness } from "./codex";
import { fakeHarness } from "./fake";
import type { Harness } from "./harness";
import { opencodeHarness } from "./opencode";
import type { Provider } from "./types";

export function defaultHarnesses(env: NodeJS.ProcessEnv = process.env): Partial<Record<Provider, Harness>> {
  if (env.ANYDAG_CHAT_FAKE === "1")
    return { claude: fakeHarness("claude"), opencode: fakeHarness("opencode"), codex: fakeHarness("codex") };
  return { claude: claudeHarness({ env }), opencode: opencodeHarness({ env }), codex: codexHarness({ env }) };
}
