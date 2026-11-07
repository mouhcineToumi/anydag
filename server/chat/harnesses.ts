/**
 * Which harnesses this server runs turns on: Claude Code and OpenCode, or with `ANYDAG_CHAT_FAKE=1`
 * the scripted one in their place (the e2e suite, and anybody trying the Assistant without a login).
 */

import { claudeHarness } from "./claude";
import { fakeHarness } from "./fake";
import type { Harness } from "./harness";
import { opencodeHarness } from "./opencode";
import type { Provider } from "./types";

export function defaultHarnesses(env: NodeJS.ProcessEnv = process.env): Partial<Record<Provider, Harness>> {
  if (env.ANYDAG_CHAT_FAKE === "1") return { claude: fakeHarness("claude"), opencode: fakeHarness("opencode") };
  return { claude: claudeHarness({ env }), opencode: opencodeHarness({ env }) };
}
