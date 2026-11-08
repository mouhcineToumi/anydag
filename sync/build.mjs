#!/usr/bin/env node
/**
 * Bundle `anydag-sync`: `sync/server/cli.ts` and everything it imports into one ESM file,
 * `sync/dist/anydag-sync.mjs`, plus the SQL migrations beside it in `sync/dist/migrations/` —
 * `server/build.mjs`'s move, for its reason (TypeScript with extensionless imports, run as plain
 * Node). `node sync/build.mjs --watch` rebuilds on every change, which is what `sync/dev.sh` runs.
 *
 * Load-bearing:
 * - **The migrations are copied, not inlined**: `meta/migrations.ts` reads `./migrations/` beside
 *   its own `import.meta.url`, which in the bundle is `sync/dist/`, so the SQL files are the source
 *   of truth in the checkout and in the image alike.
 * - **`dist/` is the whole of what the image takes**: the bundle, the migrations, and a
 *   `package.json` naming the externals at the lockfile's versions (`writeManifest`), so
 *   `sync/Dockerfile` copies one folder and installs one package.
 * - **PGlite stays outside the bundle**: it finds its WebAssembly and data files beside its own
 *   module, which a bundle would move away from them. `pg-native` and `pg-cloudflare` are optional
 *   requires of `pg` that nothing here uses. Everything else — `pg`, Hono, and the one file of the
 *   app's own the index reaches (`server/ids.ts` and what it imports) — is in the bundle, so the
 *   image needs `node_modules` for PGlite alone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const DIST = path.join(here, "dist");
export const BUNDLE = path.join(DIST, "anydag-sync.mjs");
export const EXTERNAL = ["@electric-sql/pglite", "pg-native", "pg-cloudflare"];
/** The externals the bundle loads for real; the other two are `pg`'s optional requires, never reached. */
const RUNTIME = ["@electric-sql/pglite"];

function options(version) {
  return {
    absWorkingDir: root,
    entryPoints: ["sync/server/cli.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: BUNDLE,
    banner: { js: "import{createRequire as __acr}from'node:module';const require=__acr(import.meta.url);" },
    external: EXTERNAL,
    define: { __ANYDAG_SYNC_VERSION__: JSON.stringify(version) },
    metafile: true,
    logLevel: "warning",
  };
}

function copyMigrations() {
  const from = path.join(here, "server", "meta", "migrations");
  const to = path.join(DIST, "migrations");
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) if (f.endsWith(".sql")) fs.copyFileSync(path.join(from, f), path.join(to, f));
}

/**
 * `dist/package.json`: what the bundle still needs from npm — PGlite, at the
 * version the lockfile has — so the image installs exactly that and nothing else.
 */
function writeManifest(version) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const dependencies = {};
  for (const name of RUNTIME) {
    const v = lock.packages?.[`node_modules/${name}`]?.version;
    if (v) dependencies[name] = v;
  }
  fs.writeFileSync(
    path.join(DIST, "package.json"),
    JSON.stringify({ name: "anydag-sync", version, type: "module", private: true, dependencies }, null, 2) + "\n",
  );
}

/** Build once; writes `dist/meta.json` with the inputs, which the launcher checks for staleness. */
export async function build() {
  const esbuild = await import("esbuild");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  fs.mkdirSync(DIST, { recursive: true });
  const result = await esbuild.build(options(version));
  copyMigrations();
  const inputs = [
    ...Object.keys(result.metafile.inputs),
    ...fs.readdirSync(path.join(here, "server", "meta", "migrations")).map((f) => `sync/server/meta/migrations/${f}`),
  ];
  fs.writeFileSync(path.join(DIST, "meta.json"), JSON.stringify({ version, inputs }, null, 2));
  writeManifest(version);
  return BUNDLE;
}

async function watch() {
  const esbuild = await import("esbuild");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  fs.mkdirSync(DIST, { recursive: true });
  copyMigrations();
  const ctx = await esbuild.context({
    ...options(version),
    plugins: [{ name: "migrations", setup: (b) => b.onEnd(() => copyMigrations()) }],
  });
  await ctx.watch();
  console.log(`watching — ${path.relative(process.cwd(), BUNDLE)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--watch")) await watch();
  else {
    await build();
    console.log(path.relative(process.cwd(), BUNDLE));
  }
}
