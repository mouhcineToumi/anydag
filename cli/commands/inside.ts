import { EXIT } from "../api";
import { UsageError, bool, pairs, point, str } from "../args";
import { itemOf, load, mutate, report } from "../board";
import { emit, short, table, type Command, type Ctx } from "../context";
import {
  addEdgeBody,
  addNodeBody,
  addRowBody,
  diagramOf,
  dupNodeBody,
  edgeOf,
  listDiagram,
  moveNodeBody,
  removeEdgeBody,
  removeNodeBody,
  removeRowBody,
  renameNodeBody,
  rowsOf,
  setChartBody,
  setEdgeBody,
  setNodeBody,
  setRowBody,
  type Where,
} from "../inside";

/**
 * Inside one diagram: the cards, the edges between them, a card's rows, and a chart's settings —
 * what a person reaches by picking a card (`CLAUDE.md` → *Picking a node*, *Controls on the canvas*).
 *
 * Each command writes one new body for one item, and the body is worked out again from the text if
 * the board moved underneath it (`board.ts`'s `mutate`), so an edit never lands on a stale line.
 */

const PATCH = "POST /__board/patch";
const GET = "GET /__board/get";

/** Write one item's next body, and say what happened in one line. */
async function edit(ctx: Ctx, board: string, id: string, what: string | (() => string), next: (it: ReturnType<typeof itemOf>) => string): Promise<number> {
  const { written } = await mutate(ctx, board, (l) => {
    const it = diagramOf(itemOf(l, id));
    const body = next(it);
    return body === it.body ? [] : [{ id: it.id, body }];
  });
  const said = typeof what === "function" ? what() : what;
  emit(ctx, written ?? { unchanged: true }, () => ctx.io.err(written ? `${board}: ${said} — base ${short(written.base)}` : `${board}: nothing to change`));
  return (await report(ctx, board)) > 0 ? EXIT.errors : EXIT.ok;
}

export const INSIDE: Command[] = [
  {
    name: ["node", "ls"],
    args: "<board> <item>",
    min: 2,
    summary: "the cards, groups and lanes a diagram declares, and its edges",
    routes: [GET],
    async run(ctx, p) {
      const l = await load(ctx, p.pos[0]!);
      const it = diagramOf(itemOf(l, p.pos[1]!));
      const d = listDiagram(it);
      emit(ctx, d, () => {
        for (const line of table(d.nodes.map((n) => [n.id, n.kind, n.title ? JSON.stringify(n.title) : "", n.in ? `in ${n.in}` : "", `line ${n.line}`]))) ctx.io.out(line);
        if (d.edges.length) ctx.io.out("");
        for (const line of table(d.edges.map((e) => [e.id, `${e.from} → ${e.to}`, e.label ? JSON.stringify(e.label) : "", `line ${e.line}`]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["node", "add"],
    args: "<board> <item> <kind> [<id>]",
    min: 2,
    summary: "a new card in a diagram — in a group, or grown from another with the edge drawn",
    help:
      "The kind is the dialect's own word (`service`, `entity`, `state`, `circle` …); a chart takes `series` or " +
      "`slice` with --values. --from grows the card from another the way the `+` on a picked card does, with the " +
      "edge between them; its --side says which way the edge points. In a sketch or a layout=fixed fence the " +
      "coordinate is the placement, so --at is where it goes. A sketch's `figure` is a picture with its --title as " +
      "the caption under it: --icon emoji:house (`anydag icons house` finds the name), or none for a stick figure.",
    flags: [
      { name: "id", type: "string", value: "<id>", help: "its id, as the positional <id> is (one is made when neither is given)" },
      { name: "title", type: "string", value: "<text>", help: "what the card says" },
      { name: "in", type: "string", value: "<group>", help: "the group or lane it goes in" },
      { name: "from", type: "string", value: "<card>", help: "grow it from this card, with the edge" },
      { name: "side", type: "string", value: "<e|w|n|s>", help: "which handle the `+` was on (default e)" },
      { name: "edge", type: "boolean", help: "in a hand-placed drawing, draw the edge from --from too" },
      { name: "at", type: "string", value: "<x,y>", help: "its coordinate, in a sketch or a layout=fixed fence" },
      { name: "values", type: "string", value: "<n n …>", help: "a chart series' or slice's numbers, `-` for a gap" },
      { name: "icon", type: "string", value: "<name>", help: "what it wears: a figure's picture (emoji:house), a card's glyph" },
    ],
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, kind, given] = p.pos as [string, string, string | undefined, string | undefined];
      const id = given ?? str(p, "id");
      const from = str(p, "from");
      if (!kind && !from) throw new UsageError("say which kind of card, or --from to grow one like another");
      const side = str(p, "side");
      if (side && !["e", "w", "n", "s"].includes(side)) throw new UsageError("--side is e, w, n or s");
      let made = "";
      const code = await edit(ctx, board, item, () => `added ${made}${from ? ` beside ${from}` : ""}`, (it) => {
        const out = addNodeBody(it, {
          kind: kind ?? "",
          id,
          title: str(p, "title"),
          in: str(p, "in"),
          from,
          side: side as "e" | undefined,
          at: str(p, "at") ? point(str(p, "at")!) : undefined,
          edge: bool(p, "edge"),
          values: str(p, "values"),
          icon: str(p, "icon"),
        });
        made = out.id;
        return out.body;
      });
      if (!ctx.json) ctx.io.out(made);
      return code;
    },
  },
  {
    name: ["node", "set"],
    args: "<board> <item> <card> <key=value>...",
    min: 4,
    summary: "what a card says: title= meta= desc= kind= hue= icon= status= col= bold italic x= y= w= h= values=",
    help:
      "The Properties view of a picked card, as key=value. `key=` takes one off (`status=`, `bold=`); a flag given " +
      "bare turns it on. `values=\"1 2 - 4\"` rewrites a chart series' numbers. Groups and lanes take a title too.",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card, ...rest] = p.pos as [string, string, string, ...string[]];
      const props = pairs(rest);
      return edit(ctx, board, item, `${card}: ${Object.keys(props).join(", ")}`, (it) => setNodeBody(it, card, props));
    },
  },
  {
    name: ["node", "rm"],
    args: "<board> <item> <card>",
    min: 3,
    summary: "take a card out, with its block and every edge that named it — a group takes its children",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card] = p.pos as [string, string, string];
      return edit(ctx, board, item, `removed ${card}`, (it) => removeNodeBody(it, card));
    },
  },
  {
    name: ["node", "rename"],
    args: "<board> <item> <card> <new-id>",
    min: 4,
    summary: "rename a card's id and every reference to it inside the diagram",
    help: "Board links that name `item.card` are not rewritten — the page does not rewrite them either; `anydag link ls` finds them.",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, from, to] = p.pos as [string, string, string, string];
      return edit(ctx, board, item, `${from} is ${to}`, (it) => renameNodeBody(it, from, to));
    },
  },
  {
    name: ["node", "dup"],
    args: "<board> <item> <card>",
    min: 3,
    summary: "a copy of a card's statement — and its block — under an id nothing uses",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card] = p.pos as [string, string, string];
      let made = "";
      const code = await edit(ctx, board, item, `copied ${card}`, (it) => {
        const out = dupNodeBody(it, card);
        made = out.id;
        return out.body;
      });
      if (!ctx.json) ctx.io.out(made);
      return code;
    },
  },
  {
    name: ["node", "move"],
    args: "<board> <item> <card>",
    min: 3,
    summary: "move a card's statement: --into a group or lane, --after a sibling, --top; a topic --under another",
    help:
      "What the structural drag of a picked card writes, without the drop. In an automatic layout the order of " +
      "statements is the order within a layer, never which layer — `node set col=` is how a card is kept in a column.",
    flags: [
      { name: "into", type: "string", value: "<group>", help: "into a group or lane, at its end" },
      { name: "after", type: "string", value: "<card>", help: "after this statement" },
      { name: "top", type: "boolean", help: "out to the top of the body" },
      { name: "under", type: "string", value: "<topic>", help: "a mindmap topic, re-indented under another" },
    ],
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card] = p.pos as [string, string, string];
      const given = [str(p, "into"), str(p, "after"), bool(p, "top") || undefined, str(p, "under")].filter((x) => x !== undefined);
      if (given.length !== 1) throw new UsageError("say where: one of --into, --after, --top or --under");
      const where: Where = str(p, "into") ? { into: str(p, "into")! } : str(p, "after") ? { after: str(p, "after")! } : str(p, "under") ? { under: str(p, "under")! } : { top: true };
      return edit(ctx, board, item, `moved ${card}`, (it) => moveNodeBody(it, card, where));
    },
  },

  /* ---- edges -------------------------------------------------------------------------------- */

  {
    name: ["edge", "add"],
    args: "<board> <item> <from> <to>",
    min: 4,
    summary: "an edge between two cards of one diagram — `api.identity` leaves from a row",
    flags: [
      { name: "label", type: "string", value: "<text>", help: "words on the edge" },
      { name: "arrow", type: "string", value: "<arrow>", help: "--> (default), -.->, ||--o{ …" },
    ],
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, from, to] = p.pos as [string, string, string, string];
      return edit(ctx, board, item, `${from} → ${to}`, (it) => addEdgeBody(it, from, to, { label: str(p, "label"), arrow: str(p, "arrow") }));
    },
  },
  {
    name: ["edge", "set"],
    args: "<board> <item> <from> <to> <key=value>...",
    min: 5,
    summary: "an edge's label=, arrow=, hue= and quiet, on its own segment of the statement",
    help: "Name the edge by its two ends as written, or by the parser's id (`node ls` prints it) as `<id> -`.",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, from, to, ...rest] = p.pos as [string, string, string, string, ...string[]];
      const props = pairs(rest);
      return edit(ctx, board, item, `edge ${from} → ${to} set`, (it) => setEdgeBody(it, to === "-" ? edgeOf(it, from) : edgeOf(it, from, to), props));
    },
  },
  {
    name: ["edge", "rm"],
    args: "<board> <item> <from> <to>",
    min: 4,
    summary: "take an edge out — its whole statement, so a chain goes as one",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, from, to] = p.pos as [string, string, string, string];
      return edit(ctx, board, item, `removed ${from} → ${to}`, (it) => removeEdgeBody(it, to === "-" ? edgeOf(it, from) : edgeOf(it, from, to)));
    },
  },

  /* ---- rows --------------------------------------------------------------------------------- */

  {
    name: ["row", "ls"],
    args: "<board> <item> <card>",
    min: 3,
    summary: "a card's rows — an entity's columns, a class's members — numbered for `row set` and `row rm`",
    routes: [GET],
    async run(ctx, p) {
      const l = await load(ctx, p.pos[0]!);
      const rows = rowsOf(diagramOf(itemOf(l, p.pos[1]!)), p.pos[2]!);
      emit(ctx, { rows }, () => rows.forEach((r, i) => ctx.io.out(`${i + 1}  ${r.text.trim()}`)));
    },
  },
  {
    name: ["row", "add"],
    args: "<board> <item> <card> <text>",
    min: 4,
    summary: "a row at the end of a card's block, making the block if it has none",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card, ...text] = p.pos as [string, string, string, ...string[]];
      return edit(ctx, board, item, `${card} gained a row`, (it) => addRowBody(it, card, text.join(" ")));
    },
  },
  {
    name: ["row", "set"],
    args: "<board> <item> <card> <n> <text>",
    min: 5,
    summary: "rewrite row n of a card, keeping its indent and its comment",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card, n, ...text] = p.pos as [string, string, string, string, ...string[]];
      const at = Number(n);
      if (!Number.isInteger(at) || at < 1) throw new UsageError("a row is numbered from 1 — `anydag row ls` numbers them");
      return edit(ctx, board, item, `${card} row ${at}`, (it) => setRowBody(it, card, at, text.join(" ")));
    },
  },
  {
    name: ["row", "rm"],
    args: "<board> <item> <card> <n>",
    min: 4,
    summary: "take row n off a card",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, card, n] = p.pos as [string, string, string, string];
      const at = Number(n);
      if (!Number.isInteger(at) || at < 1) throw new UsageError("a row is numbered from 1 — `anydag row ls` numbers them");
      return edit(ctx, board, item, `${card} lost row ${at}`, (it) => removeRowBody(it, card, at));
    },
  },

  /* ---- charts ------------------------------------------------------------------------------- */

  {
    name: ["chart", "set"],
    args: "<board> <item> <key=value>...",
    min: 3,
    summary: "a chart's form= stacked horizontal legend= values unit= min= max= categories=",
    help:
      "The item view of a chart, one statement each: `form=line`, `stacked` and `stacked=`, `legend=bottom`, " +
      "`values` for a number on every mark, `unit=k€`, `min=0`, `categories=\"Q1 Q2 Q3\"`. A series' own numbers " +
      "are `anydag node set <board> <chart> <series> values=\"…\"`.",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [board, item, ...rest] = p.pos as [string, string, ...string[]];
      const props = pairs(rest);
      return edit(ctx, board, item, `chart ${Object.keys(props).join(", ")}`, (it) => setChartBody(it, props));
    },
  },
];
