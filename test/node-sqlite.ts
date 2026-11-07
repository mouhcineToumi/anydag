/**
 * `node:sqlite` for the unit suite. Vite 5 does not know it is a builtin and fails to resolve it, so
 * `vitest.config.ts` aliases the id here and this hands it to Node's own loader. An alias rather than
 * a `vi.mock` in each file: with `isolate: false` a mock registered by one file and a module graph
 * loaded by another disagreed, and whichever ran second failed with "Failed to load url sqlite".
 */
import { createRequire } from "node:module";

const sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const { DatabaseSync, StatementSync } = sqlite;
export default sqlite;
