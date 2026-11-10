/**
 * The build's feature switches.
 *
 * Some features talk to an AnyDag server somebody else runs — sync, the anonymous logs, Send
 * feedback, and later whatever else needs one (accounts). Until that server ships, they are behind
 * **one switch, `cloud`**, which the *local server* decides and everything else asks it for — see
 * *Feature switches* in `docs/architecture/server.md`.
 *
 * The switch is **off unless a build says on**: `server/build.mjs` and `cli/build.mjs` bake
 * `__ANYDAG_CLOUD__` from `ANYDAG_CLOUD_BUILD=on|off`, the release workflow never says on, and the
 * desktop app a release ships therefore has none of the server-backed features. `ANYDAG_CLOUD=on`
 * (or `off`) overrides the build at run time, which is how a developer or tester turns them on in a
 * release build, or off in a checkout without rebuilding anything. `npm run dev` and both test
 * suites say on.
 *
 * **One decision, read wherever it is acted on.** `cloudOn` is a plain function over the
 * environment each caller holds — a route answer, a loop start, a tool list — never a value cached
 * at module load, so a process that re-reads it (a test flipping the override, or a health answer)
 * sees the state it should. There is no second copy of it in the page bundle: the page reads
 * `features.cloud` off `/api/health` once at boot (`src/features.ts`), the way it already learns the
 * version.
 *
 * Plain Node, no browser API and no `Session`: the CLI, the MCP server and the tests import it.
 */

declare const __ANYDAG_CLOUD__: string;

/** What a build baked in: `on`, or empty for "off". `typeof` first so the identifier can be
 *  undefined — TypeScript and Vite run this module with no define, as the tests do. */
const BUILT_IN = typeof __ANYDAG_CLOUD__ === "string" ? __ANYDAG_CLOUD__ : "";

/** What the build says about the switch, as `/api/health` answers it. */
export interface Features {
  cloud: boolean;
}

/**
 * Whether the server-backed features are here: `ANYDAG_CLOUD=on|off` wins, else what the build
 * baked. Unknown values count as unset, the way every preference in this repository falls back
 * rather than guessing — a person who typed `ANYDAG_CLOUD=0N` is in any case running a shell loop
 * of their own.
 */
export function cloudOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const said = env.ANYDAG_CLOUD?.trim().toLowerCase();
  if (said === "on") return true;
  if (said === "off") return false;
  return BUILT_IN === "on";
}

/** The whole answer, for a route that reports it: `/api/health`'s `features`. */
export function features(env: NodeJS.ProcessEnv = process.env): Features {
  return { cloud: cloudOn(env) };
}
