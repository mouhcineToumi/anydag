import { availableParallelism } from "node:os";
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
  /* The build's feature switch (`server/features.ts`): the suite runs on, without a build.
     A test that wants a feature off passes `ANYDAG_CLOUD=off` in its own environment — the
     override is read per call, which is what makes that a test rather than a rebuild. */
  define: {
    __ANYDAG_CLOUD__: JSON.stringify(process.env.ANYDAG_CLOUD_BUILD === "off" ? "" : "on"),
  },
  test: {
    include: ["test/**/*.test.ts", "api/**/*.test.ts"],
    /* Every answer of the local server held to its OpenAPI document (`test/server/spec.ts`). */
    setupFiles: ["test/server/answers.setup.ts"],
    environment: "node",
    /*
     * **Modules are shared between the files a worker runs, and up to four workers run them.**
     * Isolated, every one of the 78 files imported the dsl, the layout and the library afresh in a
     * fresh process — 13 s and 85 s of CPU for 18 s of tests, on the hook that runs before every
     * commit. Shared, a worker pays for an import once: 8.4 s and 21 s of CPU, measured on eight
     * cores. Two workers were the floor then, when the longest file was; at 203 files they were not
     * (#258, twelve cores: 33 s on two, 26 s on three, 23 s on four, ten runs at four all green), and
     * past four each worker costs another copy of every import for a second or two. Never more
     * workers than cores: CI's runner has four.
     *
     * Sharing is safe because nothing in `test/` leaves state behind: the globals a file stubs it
     * takes back in `afterEach`, and five shuffled file orders all pass. A new test that stubs a
     * global or pins module state has to put it back the same way.
     */
    isolate: false,
    maxWorkers: Math.min(4, availableParallelism()),
    minWorkers: 1,
  },
});
