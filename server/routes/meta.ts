/**
 * Everything that is not one document: the saved components, the grammar's reference routes, the
 * prompt card's model, practice, the preferences, and the three answers that stand in for an account
 * (`/api/auth/me`, `/api/health`).
 *
 * There is no account (decision 3). The page still asks who it is, so it is told: one person, `local`,
 * whose time zone is the vault's or the app's. The vault a request names is `?vault=<id>`.
 */


import type { Hono } from "hono";
import YAML from "yaml";

import { generate } from "../../plugins/generate/generate";
import { completeFor, LlmError } from "../../plugins/generate/llm";
import { describeProviders, resolveProvider } from "../../plugins/generate/providers";
import { isDiagramType, type DiagramType } from "../../src/board/types";
import type { Session } from "../context";
import { zoneIn } from "../frontmatter";
import { grammar } from "../grammar";
import { bodyOf, err } from "../http";
import { validId } from "../ids";
import { aliveOf, answersOf, counts, graduateOf, GRADUATE_MAX, GRADUATE_MIN, pool, PracticeRefused, statsOf } from "../practice";
import { readPrefs, SETTINGS_MAX, writePrefs, type Scope } from "./prefs";

const PROMPT_MAX = 4000;
const SOURCE_MAX = 16000;
const RUNNING_MAX = 4;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const LOCAL_ACCOUNT = { uid: "local", handle: "local", email: "", name: "You" };

/** The person's saved components, with what their frontmatter says each is. */
async function savedComponents(s: Session) {
  const texts = await s.vault.components();
  return Object.keys(texts)
    .sort()
    .map((key) => {
      const text = texts[key]!;
      let meta: unknown = null;
      const fm = FRONTMATTER.exec(text);
      if (fm) {
        try {
          meta = YAML.parse(fm[1]!);
        } catch {
          meta = null;
        }
      }
      return { name: key.slice("components/".length), text, meta };
    });
}

export function metaRoutes(app: Hono, s: Session): void {
  /* -- who, and where ----------------------------------------------------------------------- */

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "anydag", version: s.version, store: "vault", vault: s.any ? s.vault.root : null, mcp: "", app: "" }),
  );

  app.get("/api/auth/me", (c) =>
    c.json({ account: LOCAL_ACCOUNT, zone: (s.any ? zoneIn(readPrefs(s, "vault")) : null) ?? zoneIn(readPrefs(s, "app")) }),
  );

  /* -- preferences ------------------------------------------------------------------------- */

  const prefs = (scope: Scope) => {
    const at = scope === "app" ? "/api/settings" : "/api/vault/settings";
    app.get(at, (c) => c.json({ settings: readPrefs(s, scope) }));
    app.put(at, async (c) => {
      const body = await bodyOf(c);
      const value = body.settings;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw err(400, "expected `settings` to be an object");
      if (JSON.stringify(value).length > SETTINGS_MAX) throw err(413, `settings are at most ${SETTINGS_MAX} bytes`);
      writePrefs(s, scope, value as Record<string, unknown>);
      // The attachments folder is read when a vault opens; a changed `dag:attachments` takes effect now.
      if (scope === "vault") s.reconfigure(s.vault);
      return c.json({ settings: value });
    });
  };
  prefs("app");
  prefs("vault");

  /* -- saved components -------------------------------------------------------------------- */

  app.get("/__board/components", async (c) => c.json({ components: await savedComponents(s) }));

  app.post("/__board/components/delete", async (c) => {
    const body = await bodyOf(c);
    const said = typeof body.name === "string" ? body.name.replace(/^components\//, "") : "";
    const full = `components/${said}`;
    if (!said || !(await s.vault.read(full, "board"))) throw err(404, `no component \`${String(body.name)}\``);
    await s.vault.delete(full, "board");
    return c.json({ name: body.name });
  });

  /* -- the grammar's reference ------------------------------------------------------------- */

  app.get("/__board/library", async (c) => {
    const id = c.req.query("id");
    if (id) return c.json(await grammar.library({ id }));
    const served = await grammar.library({ type: c.req.query("type"), q: c.req.query("q") });
    return c.json({ blueprints: served.blueprints, objects: served.objects ?? null, saved: await savedComponents(s) });
  });

  app.get("/__board/icons", async (c) => c.json(await grammar.icons({ q: c.req.query("q"), mode: c.req.query("mode") })));
  app.get("/__board/dsl", async (c) => c.json(await grammar.dsl(c.req.query("type"))));

  /* -- the prompt card's model ------------------------------------------------------------- */

  app.get("/__board/llm", (c) => c.json(describeProviders(s.env)));

  let running = 0;
  app.post("/__board/generate", async (c) => {
    const body = await bodyOf(c);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) throw err(400, "describe the diagram first");
    if (prompt.length > PROMPT_MAX) throw err(413, `a description is at most ${PROMPT_MAX} characters, this one is ${prompt.length}`);
    const source = body.source;
    if (source !== undefined && source !== null && typeof source !== "string") throw err(400, "the source must be a string holding the diagram's DSL");
    if (typeof source === "string" && source.length > SOURCE_MAX) {
      throw err(413, `the diagram's source is at most ${SOURCE_MAX} characters, this one is ${source.length}`);
    }
    const as = typeof body.as === "string" && isDiagramType(body.as) ? (body.as as DiagramType) : undefined;
    const from = typeof body.from === "string" && /^[a-z]{1,16}$/.test(body.from) && isDiagramType(body.from) ? (body.from as DiagramType) : undefined;
    const reasoning = typeof body.reasoning === "string" && body.reasoning ? body.reasoning : undefined;
    const resolved = resolveProvider(s.env, {
      provider: typeof body.provider === "string" ? body.provider : null,
      model: typeof body.model === "string" ? body.model : null,
    });
    if (!resolved.ok) throw err(400, resolved.error);
    if (running >= RUNNING_MAX) throw err(429, `${RUNNING_MAX} diagrams are being drawn already — give it a moment`);

    const system = await grammar.system(as, typeof source === "string" ? "rewrite" : "draw");
    const attempts = Number(s.env.ANYDAG_LLM_ATTEMPTS) || 3;
    const timeout = Number(s.env.ANYDAG_LLM_TIMEOUT) || 120_000;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(new Error("timeout")), timeout * attempts);
    c.req.raw.signal.addEventListener("abort", () => stop.abort(new Error("gone")));
    running++;
    try {
      return c.json(
        await generate({
          prompt,
          ...(typeof source === "string" ? { source } : {}),
          ...(from ? { from } : {}),
          ...(as ? { as } : {}),
          system,
          complete: completeFor(resolved.value, s.env, { reasoning }),
          attempts,
          signal: stop.signal,
        }),
      );
    } catch (e) {
      if (stop.signal.aborted && (stop.signal.reason as Error)?.message === "timeout") throw err(504, "the model did not answer in time");
      if (e instanceof LlmError) throw err(502, e.message);
      throw e;
    } finally {
      clearTimeout(timer);
      running--;
    }
  });

  /* -- practice ---------------------------------------------------------------------------- */

  app.get("/api/practice", async (c) => {
    const graduate = s.practice.graduate();
    const quiz = c.req.query("quiz");
    if (quiz !== undefined) {
      if (!validId(quiz)) throw err(400, "`quiz` is a quiz's id");
      return c.json({ graduate, stats: statsOf(s.practice.records(quiz)[quiz] ?? {}, graduate) });
    }
    const entries = pool(s.practice.records(), graduate, aliveOf(await s.vault.tree()));
    return c.json({ graduate, pool: entries, counts: counts(entries) });
  });

  app.post("/api/practice", async (c) => {
    const body = await bodyOf(c);
    let answers;
    try {
      answers = answersOf(body.events);
    } catch (e) {
      if (e instanceof PracticeRefused) throw err(400, e.message);
      throw e;
    }
    if (!answers.length) return c.json({ stats: {} });
    const listed = new Set(Object.values((await s.vault.tree()).ids));
    const unknown = [...new Set(answers.map((a) => a.quiz))].filter((q) => !listed.has(q)).sort();
    if (unknown.length) throw err(404, `no quiz \`${unknown[0]}\``);
    const after = s.practice.fold(answers);
    const graduate = s.practice.graduate();
    return c.json({ graduate, stats: Object.fromEntries(Object.entries(after).map(([q, st]) => [q, statsOf(st, graduate)])) });
  });

  app.put("/api/practice", async (c) => {
    const body = await bodyOf(c);
    const graduate = body.graduate;
    if (graduateOf(graduate) !== graduate) throw err(400, `\`graduate\` is a whole number from ${GRADUATE_MIN} to ${GRADUATE_MAX}`);
    s.practice.setGraduate(graduate as number);
    return c.json({ graduate });
  });
}
