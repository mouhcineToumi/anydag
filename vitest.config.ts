import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /* Vite builds this into a real Worker; Node has none, so the tests get elkjs' own fake one. */
      /* Vite 5 does not know `node:sqlite` is a builtin: test/node-sqlite.ts hands it to Node. */
      "node:sqlite": fileURLToPath(new URL("./test/node-sqlite.ts", import.meta.url)),
      "elkjs/lib/elk-worker.min.js?worker": fileURLToPath(new URL("./test/elk-worker-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "api/**/*.test.ts"],
    environment: "node",
    /*
     * **Modules are shared between the files a worker runs, and two workers run them.** Isolated,
     * every one of the 78 files imported the dsl, the layout and the library afresh in a fresh
     * process — 13 s and 85 s of CPU for 18 s of tests, on the hook that runs before every commit.
     * Shared, a worker pays for an import once: 8.4 s and 21 s of CPU, measured on eight cores.
     * More workers than two bought no wall time here — the longest file is the floor — and each one
     * costs another copy of every import.
     *
     * Sharing is safe because nothing in `test/` leaves state behind: the globals a file stubs it
     * takes back in `afterEach`, and five shuffled file orders all pass. A new test that stubs a
     * global or pins module state has to put it back the same way.
     */
    isolate: false,
    maxWorkers: 2,
    minWorkers: 1,
  },
});
