import type { Io } from "../cli/context";
import { main as run, type Reach } from "../cli/main";

/**
 * A connection with no socket for the CLI tests: requests go to the global `fetch`, read late so
 * each test's stub is the one used. `server/connect.ts` is what a real run reaches the routes with.
 */
export const reach: Reach = async () => ({
  backend: { via: "stub", call: async () => ({ status: 500, headers: {} }) },
  via: "stub",
  home: "/nowhere",
  running: null,
  origin: "http://anydag.test",
  token: "t0k3n",
  fetch: (input, init) => globalThis.fetch(input, init),
  vault: undefined,
  listen: async () => null,
  close: async () => {},
});

export const main = (argv: string[], io: Io, env: NodeJS.ProcessEnv) => run(argv, io, env, reach);
