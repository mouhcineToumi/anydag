import { serializeAttrs } from "../../src/board/attrs";
import { lost } from "../../src/board/survive";
import { isDiagramType, isPromptType, type DiagramType } from "../../src/board/types";
import { replacement, type Draft, type Generated } from "../../src/edit/generate";
import { rewriteContext, rewriteOps } from "../../src/edit/rewrite";

import { EXIT } from "../api";
import { UsageError, bool, point, str } from "../args";
import { freshId, idsOf, itemOf, load, mutate, report, warnUnpinned } from "../board";
import { confirm, emit, short, table, type Command, type Ctx } from "../context";
import { lineDiff } from "../diff";
import { insertOps } from "../ops";
import { accountSettings } from "./app";

/**
 * Asking a model: a prompt card's Generate, the selection toolbar's rewrite, and a draw with no card
 * at all. The server holds the keys, runs the fix loop and writes nothing (`POST /__board/generate`);
 * what is done with the answer is the client's, and here it is the same edit the page makes.
 *
 * The provider, model and thinking level are the account's own settings — what the card would have
 * used — unless a flag says otherwise.
 */

const modelFlags = [
  { name: "provider", type: "string" as const, value: "<id>", help: "which model provider (`anydag llm` lists them)" },
  { name: "model", type: "string" as const, value: "<id>", help: "which of its models" },
  { name: "reasoning", type: "string" as const, value: "<none|low|medium|high>", help: "how hard it thinks" },
];

async function ask(ctx: Ctx, req: { prompt: string; as?: string; source?: string }, p: Parameters<Command["run"]>[1]): Promise<Generated> {
  const { llm } = await accountSettings(ctx);
  ctx.io.err("asking…");
  return ctx.api.post<Generated>("/__board/generate", {
    ...req,
    provider: str(p, "provider") ?? llm.provider,
    model: str(p, "model") ?? llm.model,
    reasoning: str(p, "reasoning") ?? llm.reasoning,
  });
}

/** What came back, in the shape `scripts/generate.mjs` printed it. */
function describe(ctx: Ctx, g: Generated): void {
  const head = [
    `${g.provider ?? "?"}/${g.model ?? "?"}`,
    g.draft ? g.draft.type : "no diagram",
    `${g.attempts} attempt${g.attempts === 1 ? "" : "s"}`,
    `${((g.ms ?? 0) / 1000).toFixed(1)}s`,
    g.ok ? "clean" : g.error ? "failed" : "errors left",
  ].join(" · ");
  ctx.io.err(head);
  if (g.error) ctx.io.err(g.error);
  for (const d of g.diagnostics ?? []) ctx.io.err(`${d.code}  ${d.line === 0 ? "fence" : `line ${d.line}`}  ${d.message}`);
}

const fenceOf = (d: Draft): string => {
  const attrs = serializeAttrs({ map: { ...d.attrs }, order: Object.keys(d.attrs) });
  return "```" + d.type + (attrs ? ` {${attrs}}` : "") + "\n" + d.body.replace(/\n*$/, "\n") + "```\n";
};

export const MODELS: Command[] = [
  {
    name: ["llm"],
    group: "models",
    args: "",
    summary: "which model providers this server could ask, and why not when it cannot",
    routes: ["GET /__board/llm"],
    async run(ctx) {
      const got = await ctx.api.get<{ default: string; providers: { id: string; label: string; defaultModel: string; ready: boolean; reason?: string }[] }>("/__board/llm");
      emit(ctx, got, () => {
        for (const line of table(got.providers.map((x) => [x.id === got.default ? `${x.id} *` : x.id, x.defaultModel ?? "", x.ready ? "ready" : `not ready — ${x.reason ?? ""}`]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["generate"],
    group: "models",
    args: "<description>...",
    min: 1,
    summary: "a model draws a diagram from a description — printed, or put on a board with --board",
    help:
      "The server writes the system prompt from the cheat sheets and the library, checks the answer with the real " +
      "parser and asks again with the codes until it is clean — three attempts. Without --board the fence is " +
      "printed, so it can be read or piped; with it the diagram is put down where --at says. A draft that still " +
      "has errors is not put down unless --anyway says so, and exits 4 either way.",
    flags: [
      { name: "as", type: "string", value: "<type>", help: "which of the fourteen diagram types" },
      { name: "board", type: "string", value: "<board>", help: "put the diagram on this board" },
      { name: "at", type: "string", value: "<x,y>", help: "where on the board" },
      { name: "page", type: "string", value: "<page>", help: "which page of it" },
      { name: "anyway", type: "boolean", help: "put a draft down even with errors left in it" },
      ...modelFlags,
    ],
    routes: ["POST /__board/generate", "GET /api/settings", "GET /__board/get", "POST /__board/patch", "GET /__board/diagnostics"],
    async run(ctx, p) {
      const as = str(p, "as");
      if (as && !isDiagramType(as)) throw new UsageError(`\`${as}\` is not a diagram type`);
      const g = await ask(ctx, { prompt: p.pos.join(" "), as }, p);
      describe(ctx, g);
      const board = str(p, "board");
      if (!board || !g.draft) {
        emit(ctx, g, () => g.draft && ctx.io.write(fenceOf(g.draft)));
        return g.ok ? EXIT.ok : EXIT.errors;
      }
      if (!g.ok && !bool(p, "anyway")) {
        ctx.io.write(fenceOf(g.draft));
        ctx.io.err("not put down: the draft has errors — --anyway puts it down to be fixed where it lands");
        return EXIT.errors;
      }
      const draft = g.draft;
      const at = str(p, "at") ? point(str(p, "at")!) : undefined;
      let ids: string[] = [];
      const { written, loaded } = await mutate(ctx, board, (l) => {
        const attrs = { ...draft.attrs, ...(at ?? {}) };
        const made = insertOps(l, [{ type: draft.type, attrs, body: draft.body }], str(p, "page"));
        ids = made.ids;
        return made.ops;
      });
      if (at) warnUnpinned(ctx, loaded, str(p, "page") ?? loaded.board.pages[0]?.id ?? "page-1", new Set(ids));
      emit(ctx, { ...g, ids, ...written }, () => {
        ctx.io.out(ids.join("\n"));
        ctx.io.err(`${board}: ${draft.type} ${ids.join(", ")} put down — base ${short(written?.base)}`);
      });
      return (await report(ctx, board)) > 0 || !g.ok ? EXIT.errors : EXIT.ok;
    },
  },
  {
    name: ["prompt", "run"],
    args: "<board> <card>",
    min: 2,
    summary: "a prompt card's Generate: the card replaced by the diagram it describes, in one edit",
    help:
      "The card's text and its `as=` are the request. The diagram takes the card's place — its x, y, page and " +
      "group — and the card goes, in one write. A draft with errors is left unapplied unless --anyway, which is " +
      "the card's Insert anyway.",
    flags: [{ name: "anyway", type: "boolean", help: "put a draft down even with errors left in it" }, ...modelFlags],
    routes: ["GET /__board/get", "POST /__board/generate", "GET /api/settings", "POST /__board/patch", "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, card] = p.pos as [string, string];
      const l = await load(ctx, board);
      const it = itemOf(l, card);
      if (!isPromptType(it.type)) throw new UsageError(`${card} is a ${it.type}, not a prompt card`);
      if (!it.body.trim()) throw new UsageError(`${card} is empty — write the description into it first`);
      const g = await ask(ctx, { prompt: it.body.trim(), as: it.as }, p);
      describe(ctx, g);
      if (!g.draft) return EXIT.errors;
      if (!g.ok && !bool(p, "anyway")) {
        ctx.io.write(fenceOf(g.draft));
        ctx.io.err("the card is left as it was: the draft has errors — --anyway puts it down");
        return EXIT.errors;
      }
      const draft = g.draft;
      let id = "";
      const { written } = await mutate(ctx, board, (now) => {
        /* The answer took seconds; a card deleted meanwhile drops it, the way the page does. */
        const still = now.board.items.find((x) => x.id === card);
        if (!still) throw new UsageError(`${card} was removed while the model was drawing; nothing was put down`);
        id = freshId(draft.type, idsOf(now));
        return replacement(still, draft, id);
      });
      emit(ctx, { ...g, id, ...written }, () => {
        ctx.io.out(id);
        ctx.io.err(`${board}: ${card} became ${draft.type} ${id} — base ${short(written?.base)}`);
      });
      return (await report(ctx, board)) > 0 || !g.ok ? EXIT.errors : EXIT.ok;
    },
  },
  {
    name: ["rewrite"],
    group: "models",
    args: "<board> <item> <instruction>...",
    min: 3,
    summary: "a model rewrites one diagram in place, shown as a diff before anything is written",
    help:
      "The model is sent the diagram's own text and the ids other items link into it, and told to keep those. The " +
      "answer is shown as a diff with anything it would break named; nothing is written until you say yes — or " +
      "--yes says it for you. The item keeps its id, its place and its links.",
    flags: [
      { name: "yes", short: "y", type: "boolean", help: "write it without asking" },
      { name: "dry", type: "boolean", help: "show the diff and write nothing" },
      ...modelFlags,
    ],
    routes: ["GET /__board/get", "POST /__board/generate", "GET /api/settings", "POST /__board/patch", "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, ...words] = p.pos as [string, string, ...string[]];
      const l = await load(ctx, board);
      const it = itemOf(l, item);
      if (!isDiagramType(it.type)) throw new UsageError(`${item} is a ${it.type}; only a diagram is rewritten`);
      const context = rewriteContext(l.board, new Set([it.id]));
      const instruction = words.join(" ");
      const g = await ask(ctx, { prompt: context ? `${instruction}\n\n${context}` : instruction, as: it.type as DiagramType, source: it.body }, p);
      describe(ctx, g);
      if (!g.ok || !g.draft) return EXIT.errors;
      const draft = g.draft;
      const survival = lost(l.board, it, draft.body);
      for (const line of lineDiff(it.body, draft.body)) ctx.io.out(line);
      if (survival.parsed && survival.lost.length) {
        ctx.io.err(`this drops ${survival.lost.join(", ")}, which something else on the board points at — those lines would go`);
      }
      if (bool(p, "dry")) return EXIT.ok;
      await confirm(ctx, `write this over ${item}?`, bool(p, "yes"));
      const { written } = await mutate(ctx, board, (now) => {
        const still = now.board.items.find((x) => x.id === it.id);
        if (!still) throw new UsageError(`${item} was removed while the model was drawing; nothing was written`);
        return rewriteOps(still, draft);
      });
      emit(ctx, { ...g, ...written }, () => ctx.io.err(`${board}: ${item} rewritten — base ${short(written?.base)}`));
      return (await report(ctx, board)) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
];
