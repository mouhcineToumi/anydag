#!/usr/bin/env node
/**
 * What does a change need from the browser suite? One answer, asked by two callers:
 *
 *   - `.githooks/pre-push` — which tests to run before a push leaves the machine;
 *   - `.github/workflows/e2e.yml` — whether a pull request or a push needs the suite at all (a
 *     change to nothing but prose must still get a green `e2e` check, without paying for a browser).
 *
 *     node scripts/e2e-plan.mjs --base origin/develop --head <sha>      # prints JSON
 *     node scripts/e2e-plan.mjs --head <sha> --head <sha> --field run   # `--head` may repeat; one field
 *     node scripts/e2e-plan.mjs --files a.ts,b.md                       # classify a list, no git
 *
 * **The rule.** Every changed path is one of five kinds, and a specs run is the union of what the
 * kinds ask for:
 *
 *   ignore   prose, CI config, unit tests, the desktop shell, scripts that only check things — the
 *            browser suite cannot tell the difference, so nothing runs for them alone
 *   app      anything else (`src/`, `server/`, `plugins/`, `cli/`, `vite.config.ts`, …, and any path
 *            this list has not heard of — the safe side): the `@smoke` tier, which touches every
 *            surface
 *   pixels   what changes how a board is drawn (`boards/`, `icons/`, `public/`, and the drawing
 *            layers of `src/`): also `reference.spec.ts`, the 45 screenshots, because the smoke tier
 *            holds only ten of them
 *   sync     the sync server and its client: also `sync.spec.ts`
 *   harness  the way the suite is run (`playwright.config.ts`, the lockfile, `scripts/e2e-*`): the
 *            smoke tier, to prove the suite still runs
 *
 * and a change *inside* `e2e/` runs the specs it touches — a spec itself, or any helper a spec
 * imports, which Playwright's own `--only-changed` traces through the import graph. That is why the
 * specs that import `e2e/keys.ts` run when it changes, and why a change to `src/` alone is *not*
 * traced to specs: they drive a browser, and `--only-changed` cannot follow a page.
 *
 * The answer is a single `--grep` regular expression (`@smoke|reference\.spec\.ts|…`), because
 * Playwright ANDs a file argument with `--grep`, and a union has to be one expression.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/* Order matters: the first rule that matches a path decides its kind. */
const RULES = [
  [/^e2e\/[^/]+-snapshots\//, "snapshot"],
  [/^e2e\//, "spec"],
  [/^(playwright\.config\.ts|package(-lock)?\.json|scripts\/e2e-[^/]+|\.github\/workflows\/e2e\.yml)$/, "harness"],
  [/^(sync\/|server\/sync\/)/, "sync"],
  [/^boards\//, "pixels"],
  [/^(icons\/|public\/|index\.html$)/, "pixels"],
  [/^src\/(render|layout|theme|styles|dsl|quality|view|board)\//, "pixels"],
  /* Prose. Under `boards/` a `.md` is a fixture the suite draws, and was caught above. */
  [/\.md$/, "ignore"],
  [/^(docs|\.github|\.githooks|\.claude|test|skills|desktop)\//, "ignore"],
  [/^scripts\/(check-[^/]+|checks\.sh|gate\.sh|hooks\.mjs|parity\.mjs|stamp\.mjs|icons\/.*|sync-demo\.sh)$/, "ignore"],
  [/^(LICENSE[^/]*|CODEOWNERS|\.gitignore|\.gitattributes|\.editorconfig|biome\.jsonc?|renovate\.json|VERSION)$/, "ignore"],
];

/** The kind of one repository-relative path. */
export function kindOf(file) {
  for (const [re, kind] of RULES) if (re.test(file)) return kind;
  return "app";
}

/**
 * @param {string[]} files   changed paths, relative to the repository root
 * @param {(string[]) => string[]} [tracedSpecs]  the spec files Playwright's `--only-changed` names,
 *        given the changed `e2e/` paths; only asked when something under `e2e/` changed
 */
export function plan(files, tracedSpecs = () => []) {
  const kinds = new Map();
  for (const f of files) kinds.set(kindOf(f), [...(kinds.get(kindOf(f)) ?? []), f]);
  const has = (k) => kinds.has(k);

  const smoke = has("app") || has("pixels") || has("sync") || has("harness");
  const specs = new Set();
  if (has("pixels")) specs.add("reference.spec.ts");
  if (has("sync")) specs.add("sync.spec.ts");
  for (const f of kinds.get("snapshot") ?? []) {
    const m = /^e2e\/([^/]+\.spec\.ts)-snapshots\//.exec(f);
    if (m) specs.add(m[1]);
  }
  const e2eSide = [...(kinds.get("spec") ?? []), ...(kinds.get("snapshot") ?? [])];

  /* A change under `e2e/` that no spec traces to — `global-setup.ts`, which only the config imports —
     is a change to every spec's starting point. */
  let all = false;
  if (e2eSide.length) {
    const traced = tracedSpecs(e2eSide);
    all = traced.length === 0 && specs.size === 0;
    for (const s of traced) specs.add(s.replace(/^.*\//, ""));
  }

  const run = smoke || specs.size > 0 || all;
  const parts = [];
  if (smoke) parts.push("@smoke");
  for (const s of [...specs].sort()) parts.push(s.replace(/\./g, "\\."));
  const why = [...kinds].map(([k, fs]) => `${fs.length} ${k}`).join(", ") || "no changes";
  const asks = all ? ["the whole suite"] : [smoke ? "the @smoke tier" : "", ...[...specs].sort()].filter(Boolean);
  return {
    run,
    grep: run && !all ? parts.join("|") : null,
    kinds: Object.fromEntries([...kinds].map(([k, fs]) => [k, fs.length])),
    why: run ? `${why} → ${asks.join(" + ")}` : `${why} → nothing the browser suite could see`,
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ref(name) {
  try {
    git("rev-parse", "--verify", "--quiet", `${name}^{commit}`);
    return name;
  } catch {
    return null;
  }
}

/** `--only-changed`'s spec files, from Playwright itself. */
function tracedFromPlaywright(base) {
  return (changed) => {
    /* `ANYDAG_E2E_PLAN_TRACE=0`: do not ask (CI's plan job has no `node_modules`, and only wants
       to know whether anything needs running). */
    if (process.env.ANYDAG_E2E_PLAN_TRACE === "0") return [];
    try {
      const out = execFileSync("npx", ["playwright", "test", `--only-changed=${base}`, "--list", "--reporter=json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
      const json = JSON.parse(out.slice(out.indexOf("{")));
      const files = new Set();
      const walk = (s) => {
        for (const sp of s.specs ?? []) files.add(sp.file);
        for (const c of s.suites ?? []) walk(c);
      };
      for (const s of json.suites ?? []) walk(s);
      return [...files];
    } catch {
      /* Could not ask: run the specs the changed paths name themselves, which is the floor. */
      return changed.filter((f) => /\.spec\.ts$/.test(f));
    }
  };
}

function main(argv) {
  const args = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
  const arg = (name) => args(name)[0];
  const field = arg("--field");
  const out = (answer) => console.log(field ? String(answer[field] ?? "") : JSON.stringify(answer));
  const explicit = arg("--files");
  let files;
  let base = arg("--base");
  if (explicit !== undefined) {
    files = explicit.split(",").filter(Boolean);
  } else {
    const heads = args("--head");
    base = (base && ref(base)) || ref("origin/develop") || ref("origin/main");
    if (!base) {
      out({ run: true, grep: null, kinds: {}, why: "no origin/develop or origin/main to compare with → the whole suite" });
      return;
    }
    files = [
      ...new Set(
        (heads.length ? heads : ["HEAD"]).flatMap((h) =>
          git("diff", "--name-only", `${base}...${h}`).split("\n").filter(Boolean),
        ),
      ),
    ];
  }
  out(plan(files, tracedFromPlaywright(base ?? "HEAD")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
