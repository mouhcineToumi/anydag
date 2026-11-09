import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const VERSION = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

/* Loopback only by default: a listener beyond it is an explicit opt-in, for a LAN of your own. */
const HOST = process.env.ANYDAG_DEV_HOST || "127.0.0.1";

/** The names `anydag serve` itself accepts — a dev page is on this machine or it is not ours. */
const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * The proxy's gate, run before it attaches the token: a request from another origin, from a
 * cross-site page, or with a Host this machine does not answer to is refused here rather than
 * handed the vault's credential. `changeOrigin` then hides that Host from the server, which trusts
 * what the proxy sends it.
 */
function foreign(req: IncomingMessage, res: ServerResponse): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  const origin = (req.headers.origin ?? "").toLowerCase();
  const site = req.headers["sec-fetch-site"];
  const ours = LOOPBACK.test(host) && (!origin || origin === `http://${host}`);
  if (ours && (!site || site === "same-origin" || site === "none")) return false;
  res.statusCode = 403;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("refused: the dev proxy answers only this machine's own page");
  return true;
}

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
     * `npm run dev` starts on `ANYDAG_API_PORT` with a token minted per run. The proxy adds the
     * token as a header, which is what the desktop shell does from its main process — the page
     * itself never holds it, and `foreign()` keeps it away from anything but this machine's page.
     */
    proxy: Object.fromEntries(
      ["/__board", "/api"].map((prefix) => [
        prefix,
        {
          target: `http://127.0.0.1:${Number(process.env.ANYDAG_API_PORT) || 3601}`,
          changeOrigin: true,
          headers: { "x-anydag-token": process.env.ANYDAG_TOKEN ?? "" },
          bypass: (req: IncomingMessage, res: ServerResponse) => (foreign(req, res) ? false : undefined),
        },
      ]),
    ),
    /*
     * The app home (`.dev-home/`), each vault's `.anydag/`, and the repository's credential
     * dot-folders all live inside this root. None of them is the page's to serve; `?raw`, `%2E`
     * and `/@fs` all resolve to the same path and meet the same deny list.
     */
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.dev-home",
        "**/.dev-home/**",
        "**/.anydag",
        "**/.anydag/**",
        "**/.git",
        "**/.git/**",
        "**/.claude",
        "**/.claude/**",
        "**/.ssh",
        "**/.ssh/**",
        "**/.gnupg",
        "**/.gnupg/**",
        "**/.aws",
        "**/.aws/**",
        "**/e2e/.auth",
        "**/e2e/.auth/**",
      ],
    },
    /* 3500, not 3000. A band away from the numbers every dev tool reaches for first is less likely
       to collide with another dev server on this machine.

       `ANYDAG_PORT` moves it, and a second checkout needs it: vite falls back to the next free port
       when 3500 is taken, but `playwright.config.ts` waits on a fixed URL and reuses whatever
       answers there — so a worktree without this runs its whole visual gate, and regenerates its
       baselines, against the *other* checkout's server. */
    port: Number(process.env.ANYDAG_PORT) || 3500,
    /* Loopback by default; `ANYDAG_DEV_HOST` is the opt-in for listening beyond loopback. */
    host: HOST,
  },
  /* `vite preview` inherits `server.host` and `server.proxy`, but says so here too: the built page
     is a local page first, and a preview listener on every interface is the same exposure. */
  preview: {
    host: HOST,
  },
  build: {
    outDir: "dist",
  },
});
