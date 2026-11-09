import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const VERSION = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

export default defineConfig({
  plugins: [
    react(),
    /* The build the page came from, where a script can read it without running the page:
       a `<meta name="version">` beside the rest of the head. */
    {
      name: "anydag-version-meta",
      transformIndexHtml: () => [{ tag: "meta", attrs: { name: "version", content: VERSION }, injectTo: "head" }],
    },
  ],
  /* The product version the Settings modal's About tab states: the repository's `VERSION`,
     the file `cli/build.mjs` gives `anydag --version`, so the page and the terminal say one thing. */
  define: {
    __ANYDAG_VERSION__: JSON.stringify(VERSION),
  },
  /* The note editor is a lazy chunk, so the dependency scan at start-up never sees BlockNote: the
     first note opened would make Vite discover it, re-bundle, and reload the page under whoever was
     looking — twice, once for each layer of the editor. Named here, it is bundled before the first
     page is served. Development only; a build has no such step. */
  optimizeDeps: {
    include: [
      "@blocknote/core",
      "@blocknote/core/extensions",
      "@blocknote/react",
      "@blocknote/mantine",
      "@mantine/core",
      "@mantine/hooks",
      "@tiptap/extension-code",
      /* The PDF preview and the export zip, both loaded the first time they are wanted —
         the same first-import reload the editor's layers had, one feature later. */
      "pdfjs-dist/legacy/build/pdf.mjs",
      "fflate",
      /* Equations, the first time a page draws one. */
      "katex",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    /*
     * There is one server, and it is not this one: `anydag serve` (`server/`), which
     * `npm run dev` starts on `ANYDAG_API_PORT` with a fixed token. The proxy adds the token as a
     * header, which is what the desktop shell does from its main process — the page itself never
     * holds it.
     */
    proxy: Object.fromEntries(
      /* `/api` is a regex key, not a prefix, on purpose (#99): the page bundles `api/protocol/`
         (the wire's types and the log vocabulary), and in dev Vite serves those modules at
         `/api/protocol/*.ts` — a plain prefix would hand them to the backend, which has no such
         route and would 404 every page that mentions a log. `/api/protocol/` is Vite's; every
         other `/api/**` is the server's. */
      ["/__board", "^/api(?!/protocol/)"].map((prefix) => [
        prefix,
        {
          target: `http://127.0.0.1:${Number(process.env.ANYDAG_API_PORT) || 3601}`,
          changeOrigin: true,
          headers: { "x-anydag-token": process.env.ANYDAG_TOKEN || "dev-token" },
        },
      ]),
    ),
    /* 3500, not 3000. A band away from the numbers every dev tool reaches for first is less likely
       to collide with another dev server on this machine.

       `ANYDAG_PORT` moves it, and a second checkout needs it: vite falls back to the next free port
       when 3500 is taken, but `playwright.config.ts` waits on a fixed URL and reuses whatever
       answers there — so a worktree without this runs its whole visual gate, and regenerates its
       baselines, against the *other* checkout's server. */
    port: Number(process.env.ANYDAG_PORT) || 3500,
    host: true,
  },
  build: {
    outDir: "dist",
  },
});
