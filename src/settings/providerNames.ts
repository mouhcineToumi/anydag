/**
 * What the app calls each model provider — one list, so Settings, a provider's error sentence and
 * the Assistant say the same thing. A provider's id is the protocol's word; this is a person's.
 *
 * Plain TypeScript with no imports: `plugins/generate/providers.ts` and `server/chat/models.ts`
 * import it into the server bundle as a relative path, and the page imports it through `@/`, so it
 * must be free of browser APIs and of the alias itself.
 */
export const PROVIDER_NAMES = {
  claude: "Claude Code",
  gemini: "Gemini",
  opencode: "OpenCode",
  zai: "Z.ai",
  custom: "OpenAI-compatible",
} as const;

/** The name for an id, or `undefined` for one this build does not know. */
export function providerName(id: string | null | undefined): string | undefined {
  if (!id || !Object.prototype.hasOwnProperty.call(PROVIDER_NAMES, id)) return undefined;
  return PROVIDER_NAMES[id as keyof typeof PROVIDER_NAMES];
}
