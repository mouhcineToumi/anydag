/**
 * The meta routes' schemas and rows (`server/routes/meta.ts`): who and where, the preferences, the
 * window's tabs, the Graph page's view, saved components, the grammar's reference, the prompt card's
 * model, practice — and this document.
 */

import { z } from "zod";

import { CARDS_MAX, CARDS_MIN } from "../../plugins/generate/cards";
import { ICON_MODES } from "../../plugins/icons";
import { err } from "../http";
import { answersOf, GRADUATE_MAX, GRADUATE_MIN, graduateOf, MAX_EVENTS, PracticeRefused } from "../practice";
import { SETTINGS_MAX } from "../routes/prefs";
import { about, body, field, json, kept, named, param } from "./fields";
import { route } from "./row";

/** A window's tabs, saved: a few hundred tabs' places is far less. */
const TABS_MAX = 64 * 1024;
/** The Graph page's view, saved: a few rules and six sliders, with room for a long list of hidden values. */
const GRAPH_VIEW_MAX = 32 * 1024;

const object = z.record(z.string(), z.unknown());
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const SettingsBody = body(
  "SettingsBody",
  "The whole bundle of preferences, as the page keeps it: opaque here (`src/settings/store.ts` checks the shape).",
  {
    settings: field(
      object,
      `An object; at most ${SETTINGS_MAX} bytes as JSON.`,
      (raw) => {
        if (!isObject(raw)) throw err(400, "expected `settings` to be an object");
        if (JSON.stringify(raw).length > SETTINGS_MAX) throw err(413, `settings are at most ${SETTINGS_MAX} bytes`);
        return raw;
      },
      "read",
    ),
  },
  ["settings"],
);

/** An opaque value kept in the app's home by the vault's id: an object, or `null` to forget it. */
function saved(key: string, max: number, tooBig: string) {
  return field(
    object.nullable(),
    `An object, at most ${max} bytes as JSON; \`null\` forgets it.`,
    (raw) => {
      if (raw === null) return null;
      if (!isObject(raw)) throw err(400, `expected \`${key}\` to be an object or null`);
      if (JSON.stringify(raw).length > max) throw err(413, tooBig);
      return raw;
    },
    "read",
  );
}

export const TabsBody = body(
  "TabsBody",
  "Which documents the window has open in this vault, and which is in front: opaque here (`src/ui/tabs/saved.ts` reads it back).",
  { tabs: saved("tabs", TABS_MAX, `tabs are at most ${TABS_MAX} bytes`) },
  ["tabs"],
);

export const GraphViewBody = body(
  "GraphViewBody",
  "What the Graph page colours, filters and groups by, and its sliders: opaque here (`src/graph/view.ts` reads it back).",
  { view: saved("view", GRAPH_VIEW_MAX, `the graph's view is at most ${GRAPH_VIEW_MAX} bytes`) },
  ["view"],
);

export const ComponentDeleteBody = body(
  "ComponentDeleteBody",
  "A saved component to delete.",
  { name: kept(z.string(), "Its name, with or without `components/`.") },
  ["name"],
);

export const LlmTestBody = body(
  "LlmTestBody",
  "A provider to try, with one short call.",
  {
    provider: field(
      z.string().min(1),
      "The provider's id (`GET /__board/llm`).",
      (raw) => {
        if (typeof raw !== "string" || !raw) throw err(400, "`provider` names the provider to test");
        return raw;
      },
      "read",
    ),
    model: kept(z.string(), "The model; left out, the provider's default."),
  },
  ["provider"],
);

export const GenerateBody = body(
  "GenerateBody",
  "What to ask the model for: a diagram, drawn or rewritten, or flashcards for a quiz. Nothing is written — the page shows the answer and writes what is kept.",
  {
    kind: field(
      z.enum(["diagram", "flashcards"]),
      "Which; left out, a diagram.",
      (raw) => {
        const kind = raw ?? "diagram";
        if (kind !== "diagram" && kind !== "flashcards") throw err(400, "`kind` is `diagram` or `flashcards`");
        return kind;
      },
      "read",
    ),
    prompt: kept(
      z.string(),
      "A diagram: what to draw (at most 4000 characters). Flashcards: the topic, or what to focus on in the note.",
    ),
    source: kept(
      z.string(),
      "A diagram: the DSL being rewritten (at most 16000 characters). Flashcards: the note's text (at most 60000).",
    ),
    as: kept(z.string(), "A diagram: the type to draw it as."),
    from: kept(z.string(), "A diagram: the type it is now."),
    count: kept(z.int().min(CARDS_MIN).max(CARDS_MAX), `Flashcards: how many, ${CARDS_MIN} to ${CARDS_MAX}.`),
    provider: kept(z.string(), "The provider; left out, the default."),
    model: kept(z.string(), "The model; left out, the provider's."),
    reasoning: kept(z.string(), "How hard the model thinks, where it can be told."),
  },
);

export const PracticeBody = body(
  "PracticeBody",
  "Answers given in a quiz or in Mistakes, folded into each question's record.",
  {
    events: field(
      z
        .array(
          z.object({
            quiz: about("The quiz's id.", z.string()),
            question: about("The question's id.", z.string()),
            correct: z.boolean(),
            run: z.enum(["quiz", "mistakes"]),
          }),
        )
        .max(MAX_EVENTS),
      `The answers, at most ${MAX_EVENTS}: send them as they happen.`,
      (raw) => {
        try {
          return answersOf(raw);
        } catch (e) {
          if (e instanceof PracticeRefused) throw err(400, e.message);
          throw e;
        }
      },
      "read",
    ),
  },
  ["events"],
);

export const GraduateBody = body(
  "GraduateBody",
  "How many right answers in a row take a question out of Mistakes.",
  {
    graduate: field(
      z.int().min(GRADUATE_MIN).max(GRADUATE_MAX),
      `A whole number from ${GRADUATE_MIN} to ${GRADUATE_MAX}.`,
      (raw) => {
        if (graduateOf(raw) !== raw) throw err(400, `\`graduate\` is a whole number from ${GRADUATE_MIN} to ${GRADUATE_MAX}`);
        return raw as number;
      },
      "read",
    ),
  },
  ["graduate"],
);

// -- the answers -------------------------------------------------------------------------------

const Health = named(
  "Health",
  "What is answering: its version, the vault it serves, and what this build carries.",
  z.object({
    ok: z.literal(true),
    service: z.literal("anydag"),
    version: z.string(),
    store: z.literal("vault"),
    vault: about("The open vault's folder, `null` when none is open.", z.string().nullable()),
    mcp: z.string(),
    app: z.string(),
    features: about(
      "The build's switches (`server/features.ts`): `cloud` carries sync, logs and feedback.",
      z.object({ cloud: z.boolean() }),
    ),
  }),
);

const Me = named(
  "Me",
  "The one local user — there is no sign-in — and the time zone times are read and written in, `null` for this machine's.",
  z.object({
    account: z.object({ uid: z.literal("local"), handle: z.literal("local"), email: z.literal(""), name: z.string() }),
    zone: z.string().nullable(),
  }),
);

const Stat = z.object({ wrong: z.int(), right: z.int(), streak: z.int(), at: z.string() });
const Stats = about(
  "Each question's record, by its id, and whether Mistakes asks it.",
  z.record(z.string(), Stat.extend({ inPool: z.boolean() })),
);

const Provider = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  kind: z.string(),
  keyEnv: z.array(z.string()),
  defaultModel: z.string(),
  models: z.array(z.string()),
  ready: z.boolean(),
  error: z.string().optional(),
  reason: z.object({ code: z.string(), provider: z.string() }).optional(),
});

const Generated = named(
  "Generated",
  "A diagram's best draft and what the grammar says of it, or the flashcards that came back and the problems with the ones left out.",
  z.union([
    z.looseObject({
      ok: z.boolean(),
      draft: z.looseObject({}).optional(),
      diagnostics: z.array(z.looseObject({})),
      attempts: z.int(),
    }),
    z.looseObject({
      ok: z.boolean(),
      cards: z.array(z.looseObject({})),
      problems: z.array(z.looseObject({})),
      attempts: z.int(),
    }),
  ]),
);

// -- the rows ----------------------------------------------------------------------------------

const MODEL_REFUSES = {
  400: "A provider that is not ready or not known, with `reason`.",
  429: "Four answers are being written already: `reason.code` is `busy`.",
  502: "The provider failed: `reason.code` is `provider-error`.",
  504: "The model did not answer in time: `reason.code` is `timeout`.",
};

const Blueprint = named(
  "Blueprint",
  "A blueprint of the component library, with the text it writes standing on its own.",
  z.object({
    id: z.string(),
    layer: about("How whole it is, from 0 to 4 (`src/board/library/types.ts`).", z.int().min(0).max(4)),
    type: about("The dialect it speaks; for a fragment, the diagram type it can join.", z.string()),
    name: z.string(),
    description: z.string(),
    source: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    shelf: about("An *Objects* entry's shelf.", z.string().optional()),
  }),
);

const SavedComponent = named(
  "SavedComponent",
  "A component the person saved: its name, its text, and what its frontmatter says (`null` when it has none, or it does not read).",
  z.object({ name: z.string(), text: z.string(), meta: z.unknown() }),
);

export const META_ROUTES = [
  route({
    method: "get",
    path: "/api/health",
    operationId: "health",
    summary: "What is answering",
    tag: "app",
    answers: { 200: json("Its version, vault and switches.", Health) },
  }),
  route({
    method: "get",
    path: "/api/auth/me",
    operationId: "me",
    summary: "The one local user, and the time zone",
    tag: "app",
    answers: { 200: json("The account and the zone.", Me) },
  }),
  route({
    method: "get",
    path: "/api/openapi.json",
    operationId: "openapi",
    summary: "This document",
    description: "The routes the build's `cloud` switch leaves out are not in it.",
    tag: "app",
    answers: {
      200: json(
        "The OpenAPI 3.1 document of this server.",
        named("OpenApiDocument", "An OpenAPI 3.1 document.", z.looseObject({ openapi: z.string() })),
      ),
    },
  }),
  ...(["app", "vault"] as const).flatMap((scope) => {
    const at = scope === "app" ? "/api/settings" : "/api/vault/settings";
    const whose =
      scope === "app"
        ? "The person's preferences, in the app's home: the window's layout, the time zone, the AI choices."
        : "The vault's preferences, in `<vault>/.anydag/settings.json`: its favourites, attachments folder, links switch and settings card.";
    const op = scope === "app" ? "Settings" : "VaultSettings";
    return [
      route({
        method: "get",
        path: at,
        operationId: `get${op}`,
        summary: scope === "app" ? "The app's preferences" : "The vault's preferences",
        description: whose,
        tag: "settings",
        answers: {
          200: json(
            "The bundle; `null` when nothing was ever saved, `{}` when it was saved empty.",
            z.object({ settings: object.nullable() }),
          ),
        },
      }),
      route({
        method: "put",
        path: at,
        operationId: `put${op}`,
        summary: scope === "app" ? "Replace the app's preferences" : "Replace the vault's preferences",
        description: whose,
        tag: "settings",
        body: { schema: SettingsBody },
        answers: { 200: json("The bundle as saved.", z.object({ settings: object })) },
        refuses: { 400: "`settings` is not an object.", 413: `Over ${SETTINGS_MAX} bytes.` },
      }),
    ];
  }),
  route({
    method: "get",
    path: "/api/tabs",
    operationId: "tabs",
    summary: "The window's saved tabs in this vault",
    description: "Kept in the app's home by the vault's id, never in the vault (#264).",
    tag: "settings",
    answers: { 200: json("What was saved, `null` for nothing.", z.object({ tabs: object.nullable() })) },
  }),
  route({
    method: "put",
    path: "/api/tabs",
    operationId: "putTabs",
    summary: "Save the window's tabs",
    tag: "settings",
    body: { schema: TabsBody },
    answers: { 200: json("What was saved.", z.object({ tabs: object.nullable() })) },
    refuses: { 400: "`tabs` is neither an object nor `null`.", 413: `Over ${TABS_MAX} bytes.` },
  }),
  route({
    method: "get",
    path: "/api/graph-view",
    operationId: "graphView",
    summary: "The Graph page's saved view in this vault",
    description: "Kept in the app's home by the vault's id (#459).",
    tag: "settings",
    answers: { 200: json("What was saved, `null` for nothing.", z.object({ view: object.nullable() })) },
  }),
  route({
    method: "put",
    path: "/api/graph-view",
    operationId: "putGraphView",
    summary: "Save the Graph page's view",
    tag: "settings",
    body: { schema: GraphViewBody },
    answers: { 200: json("What was saved.", z.object({ view: object.nullable() })) },
    refuses: { 400: "`view` is neither an object nor `null`.", 413: `Over ${GRAPH_VIEW_MAX} bytes.` },
  }),
  route({
    method: "get",
    path: "/__board/components",
    operationId: "components",
    summary: "The saved components",
    tag: "library",
    answers: {
      200: json(
        "Each saved component's name, text, and what its frontmatter says (`null` when it has none, or it does not read).",
        z.object({ components: z.array(SavedComponent) }),
      ),
    },
  }),
  route({
    method: "post",
    path: "/__board/components/delete",
    operationId: "deleteComponent",
    summary: "Delete a saved component",
    tag: "library",
    body: { schema: ComponentDeleteBody },
    answers: { 200: json("Deleted; `name` as it was sent.", z.object({ name: z.unknown() })) },
    refuses: { 404: "No such component." },
  }),
  route({
    method: "get",
    path: "/__board/library",
    operationId: "library",
    summary: "The component library",
    description: "Every blueprint rendered by the same code that parses it, and the saved components; with `id`, one blueprint.",
    tag: "library",
    query: z.object({
      id: param("One blueprint, by its id.", z.string().optional()),
      type: param("Only blueprints of this diagram type.", z.string().optional()),
      q: param("Only blueprints matching these words.", z.string().optional()),
    }),
    answers: {
      200: json(
        "The blueprints, the objects, and the saved components; or the one blueprint asked for.",
        z.union([
          z.object({
            blueprints: z.array(Blueprint),
            objects: about(
              "The pictures of *Objects*: how many there are (or matched `q`), how many are listed, by shelf, and how to ask for them.",
              z
                .object({
                  total: z.int(),
                  listed: z.int(),
                  shelves: z.array(z.object({ shelf: z.string(), count: z.int() })),
                  how: z.string(),
                })
                .nullable(),
            ),
            saved: z.array(SavedComponent),
          }),
          Blueprint,
        ]),
      ),
    },
    refuses: { 404: "No such blueprint." },
  }),
  route({
    method: "get",
    path: "/__board/icons",
    operationId: "icons",
    summary: "Which icon names exist, and how each can be drawn",
    tag: "library",
    query: z.object({
      q: param("Only names matching these words.", z.string().optional()),
      mode: param("Only icons that can be drawn this way.", z.string().optional()),
    }),
    answers: {
      200: json(
        "The names that match, each with the way it draws, at most 500 of them; how many matched, how many are listed, and whether that is all of them.",
        z.object({
          icons: z.array(z.object({ name: z.string(), mode: z.enum(ICON_MODES) })),
          total: z.int(),
          returned: z.int(),
          truncated: z.boolean(),
        }),
      ),
    },
    refuses: { 400: "A `mode` that is not one." },
  }),
  route({
    method: "get",
    path: "/__board/dsl",
    operationId: "dsl",
    summary: "The grammar's cheat sheets",
    description: "With no `type`, which sheets there are; with one, its text.",
    tag: "library",
    query: z.object({ type: param("A diagram type.", z.string().optional()) }),
    answers: {
      200: json(
        "The types, or one sheet.",
        z.union([z.object({ types: z.array(z.string()) }), z.object({ type: z.string(), text: z.string() })]),
      ),
    },
    refuses: { 403: "A name outside the cheat sheets.", 404: "No such sheet." },
  }),
  route({
    method: "get",
    path: "/__board/llm",
    operationId: "llm",
    summary: "The model providers, and which are ready",
    description: "`?fresh=1` asks every provider again rather than answering from the minute a yes is remembered for.",
    tag: "models",
    query: z.object({ fresh: param("Anything: ask again.", z.string().optional()) }),
    answers: {
      200: json("The default provider and every provider.", z.object({ default: z.string(), providers: z.array(Provider) })),
    },
  }),
  route({
    method: "post",
    path: "/__board/llm/test",
    operationId: "llmTest",
    summary: "Try a provider with one short call",
    description: "Spends a few tokens of the person's own key, once per press, with one attempt and thirty seconds.",
    tag: "models",
    body: { schema: LlmTestBody },
    answers: {
      200: json(
        "It answered.",
        z.object({ ok: z.literal(true), provider: z.string(), model: z.string().nullable(), ms: z.number() }),
      ),
    },
    refuses: { ...MODEL_REFUSES, 400: `No provider. ${MODEL_REFUSES[400]}` },
  }),
  route({
    method: "post",
    path: "/__board/generate",
    operationId: "generate",
    summary: "Ask the model for a diagram or flashcards",
    description:
      "The grammar checks what comes back before it is answered, and asks again with what it found, up to `ANYDAG_LLM_ATTEMPTS` times. At most four at once.",
    tag: "models",
    body: { schema: GenerateBody },
    answers: { 200: json("The best answer and what is wrong with it.", Generated) },
    refuses: {
      ...MODEL_REFUSES,
      400: `A \`kind\` that is not one; no prompt (a diagram) or neither topic nor note (flashcards); a source that is not a string; a \`count\` out of range. ${MODEL_REFUSES[400]}`,
      413: "A prompt, a source or a note over its limit.",
    },
  }),
  route({
    method: "get",
    path: "/api/practice",
    operationId: "practice",
    summary: "What Mistakes asks",
    description: "With `quiz`, that quiz's record of each question instead.",
    tag: "practice",
    query: z.object({ quiz: param("A quiz's id.", z.string().optional()) }),
    answers: {
      200: json(
        "How many right in a row graduate a question, and the pool with how many each quiz has in it; or one quiz's stats.",
        z.union([
          z.object({ graduate: z.int(), stats: Stats }),
          z.object({
            graduate: z.int(),
            pool: z.array(Stat.extend({ quiz: z.string(), question: z.string() })),
            counts: z.record(z.string(), z.int()),
          }),
        ]),
      ),
    },
    refuses: { 400: "A `quiz` that is not an id." },
  }),
  route({
    method: "post",
    path: "/api/practice",
    operationId: "recordPractice",
    summary: "Record answers",
    tag: "practice",
    body: { schema: PracticeBody },
    answers: {
      200: json(
        "Each quiz's records after them (`stats: {}` when none were sent).",
        z.union([z.object({ stats: z.object({}) }), z.object({ graduate: z.int(), stats: z.record(z.string(), Stats) })]),
      ),
    },
    refuses: { 400: "An answer that is not one.", 404: "A quiz the vault does not list." },
  }),
  route({
    method: "put",
    path: "/api/practice",
    operationId: "putGraduate",
    summary: "Set how many right in a row graduate a question",
    tag: "practice",
    body: { schema: GraduateBody },
    answers: { 200: json("As set.", z.object({ graduate: z.int() })) },
    refuses: { 400: `Not a whole number from ${GRADUATE_MIN} to ${GRADUATE_MAX}.` },
  }),
];
