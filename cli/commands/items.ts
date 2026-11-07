import { itemsToText, textToItems } from "../../src/board/clipboard";
import { locateItems } from "../../src/board/locate";
import type { NewItem, PatchOp } from "../../src/board/patch";
import { renameItemId } from "../../src/board/rename";
import { TEMPLATES } from "../../src/board/templates";
import { isItemType, type BoardItem, type ItemType } from "../../src/board/types";
import { find as findBlueprint, appendPart, isFragment, render } from "../../src/board/library";
import { fromMermaid } from "../../src/dsl/from-mermaid";
import { detectMermaid } from "../../src/dsl/mermaid";
import { rebind } from "../../src/dsl/rebind";
import { stripCoords } from "../../src/dsl/restate";

import { EXIT } from "../api";
import { UsageError, bool, list, pairs, point, str } from "../args";
import { freshId, idsOf, itemOf, load, mutate, report, rewrite, warnUnpinned, type Loaded } from "../board";
import { emit, readText, short, table, type Command, type Ctx } from "../context";
import {
  GRID,
  addLinkOps,
  addPageOps,
  anchorAt,
  attrsOf,
  insertOps,
  linkOf,
  movePageOps,
  pageOf,
  removeLinkOps,
  removePageOps,
  renamePageOps,
  restackOps,
  setLinkOps,
  withGroups,
} from "../ops";

/**
 * What the pointer does to an item, a page and a link, as commands.
 *
 * Every one reads the board, works out the ops the page would commit (`ops.ts`), and writes them
 * under the base it read, recomputing once if somebody wrote in between (`board.ts`'s `mutate`).
 */

const PATCH = "POST /__board/patch";
const GET = "GET /__board/get";

const pageFlag = { name: "page", type: "string" as const, value: "<page>", help: "which page, by id or name (default: the first)" };

/** What a write said, in one line: the board, what changed, and the base it is at now. */
function wrote(ctx: Ctx, name: string, what: string, written: { base: string } | null): void {
  emit(ctx, written ?? { unchanged: true }, () => ctx.io.err(written ? `${name}: ${what} — base ${short(written.base)}` : `${name}: nothing to change`));
}

const describe = (it: BoardItem): string[] => {
  const at = it.x !== undefined && it.y !== undefined ? `${it.x},${it.y}` : "flows";
  const size = it.w !== undefined ? `${it.w}${it.h !== undefined ? `×${it.h}` : ""}` : "";
  const marks = [it.hidden ? "hidden" : "", it.group ? `group=${it.group}` : "", it.layout ? `layout=${it.layout}` : ""].filter(Boolean).join(" ");
  return [it.id, it.type, it.page, at, size, it.title ?? "", marks];
};

/** The first page, or the one named — as an id, for comparing with `item.page`. */
const pageIdOf = (l: Loaded, page: string | undefined): string => (page ? pageOf(l, page).id : l.board.pages[0]?.id ?? "page-1");

export const ITEMS: Command[] = [
  {
    name: ["item", "ls"],
    args: "<board>",
    min: 1,
    summary: "the items on a board: id, type, page, position, size, title",
    help: "--fences prints what the server's own scan says the fences are instead — the first thing to compare when an edit lands on the wrong line.",
    flags: [pageFlag, { name: "fences", type: "boolean", help: "the server's scan of the fences, raw" }],
    routes: [GET, "GET /__board/fences"],
    async run(ctx, p) {
      const name = p.pos[0]!;
      if (bool(p, "fences")) {
        const got = await ctx.api.get<{ fences: { id?: string; type: string; line: number }[] }>("/__board/fences", { name });
        emit(ctx, got, () => {
          for (const line of table(got.fences.map((f) => [f.id ?? "", f.type, `line ${f.line}`]))) ctx.io.out(line);
        });
        return;
      }
      const l = await load(ctx, name);
      const page = str(p, "page") ? pageOf(l, str(p, "page")!).id : undefined;
      const items = l.board.items.filter((i) => !page || i.page === page);
      emit(ctx, { items: items.map(({ attrs: _a, hash: _h, body: _b, ...rest }) => rest), pages: l.board.pages }, () => {
        for (const line of table([["id", "type", "page", "at", "size", "title", ""], ...items.map(describe)])) ctx.io.out(line);
      });
    },
  },
  {
    name: ["item", "show"],
    args: "<board> <id>",
    min: 2,
    summary: "one item's source — its fence line, its body and its closing fence, as a copy would carry it",
    routes: [GET],
    async run(ctx, p) {
      const l = await load(ctx, p.pos[0]!);
      const it = itemOf(l, p.pos[1]!);
      const { attrs: _a, hash: _h, ...rest } = it;
      emit(ctx, rest, () => ctx.io.out(itemsToText([it])));
    },
  },
  {
    name: ["item", "add"],
    args: "<board> [<type>]",
    min: 1,
    summary: "put an item on a board: a type's starter, your own text, a library blueprint or a saved component",
    help:
      "With a type and nothing else, the item is that type's starter — the smallest diagram that draws, which is " +
      "what the library would drop. --file gives the body instead (`-` is stdin); a --file holding whole fences " +
      "puts every one of them down, the way a paste does. --from names a library blueprint (`anydag library` lists " +
      "them) and --saved one of your components; with --into, a part lands inside that diagram rather than beside " +
      "it. Without --at the item has no position and flows below the ones that do.",
    flags: [
      { name: "file", type: "string", value: "<path|->", help: "the body, or fences to paste" },
      { name: "from", type: "string", value: "<blueprint>", help: "a library blueprint's id" },
      { name: "saved", type: "string", value: "<component>", help: "one of your saved components" },
      { name: "into", type: "string", value: "<item>", help: "append a part to this diagram instead" },
      { name: "at", type: "string", value: "<x,y>", help: "where its top-left goes, in board pixels" },
      { name: "id", type: "string", value: "<id>", help: "the item's id (one is made when it is absent or taken)" },
      { name: "title", type: "string", value: "<text>", help: "a header on a diagram" },
      { name: "attr", type: "list", value: "<k=v>", help: "any other fence attribute; repeatable" },
      pageFlag,
    ],
    routes: [GET, PATCH, "GET /__board/components"],
    async run(ctx, p) {
      const name = p.pos[0]!;
      const type = p.pos[1];
      const at = str(p, "at") ? point(str(p, "at")!) : undefined;
      const into = str(p, "into");
      const extra = pairs(list(p, "attr"));
      if (type !== undefined && !isItemType(type)) throw new UsageError(`\`${type}\` is not an item type`);

      /* Where the items come from, before anything is read: the file, the library, a saved one. */
      let items: NewItem[] | null = null;
      let part: ((l: Loaded) => { target: BoardItem; body: string }) | null = null;
      const saved = str(p, "saved");
      const from = str(p, "from");
      if (from) {
        const b = findBlueprint(from);
        if (!b) throw new UsageError(`no blueprint \`${from}\` — \`anydag library\` lists them`);
        if (into) {
          if (!isFragment(b)) throw new UsageError(`\`${from}\` is a whole ${b.type === "md" ? "item" : "diagram"}, not a part to put inside one`);
          part = (l) => {
            const target = itemOf(l, into);
            if (target.type !== b.type) throw new UsageError(`\`${from}\` is ${b.type} and \`${into}\` is ${target.type}`);
            return { target, body: appendPart(b, target.body) };
          };
        } else items = [{ type: b.type, attrs: { ...(b.attrs ?? {}) }, body: render(b) }];
      } else if (saved) {
        const { components } = await ctx.api.get<{ components: { name: string; text: string }[] }>("/__board/components");
        const c = components.find((x) => x.name === saved);
        if (!c) throw new UsageError(`no saved component \`${saved}\` — \`anydag component ls\` lists them`);
        const got = textToItems(c.text).map((it) => ({ ...it, attrs: { ...it.attrs } }));
        if (into) {
          if (got.length !== 1) throw new UsageError(`\`${saved}\` is ${got.length} items; only a single diagram goes inside another`);
          part = (l) => {
            const target = itemOf(l, into);
            if (target.type !== got[0]!.type) throw new UsageError(`\`${saved}\` is ${got[0]!.type} and \`${into}\` is ${target.type}`);
            return { target, body: `${target.body.replace(/\s+$/, "")}\n\n${rebind(target.type, got[0]!.body, target.body)}` };
          };
        } else {
          /* A stamp never inherits an id: the one it was saved with belongs to the board it came
             from. A single item does not inherit that board's position either — the page always
             places a component at a point, so here it is `--at`'s or it flows. */
          for (const it of got) delete it.attrs.id;
          if (got.length === 1) {
            delete got[0]!.attrs.x;
            delete got[0]!.attrs.y;
          }
          items = got;
        }
      } else if (str(p, "file")) {
        const text = await readText(ctx, str(p, "file"));
        /* Text with fences in it is a paste — every fence an item, as ctrl+V would make them; text
           with none is the body of the type named, or a note when no type was. */
        const fenced = locateItems(text, isItemType).items.some((it) => !it.prose);
        items = type && !fenced ? [{ type: type as ItemType, attrs: {}, body: text.replace(/\n+$/, "") }] : textToItems(text);
      } else {
        if (!type) throw new UsageError("say what to add: a type, --file, --from or --saved");
        items = [{ type: type as ItemType, attrs: {}, body: TEMPLATES[type as ItemType] }];
      }

      if (part) {
        const make = part;
        const { written } = await mutate(ctx, name, (l) => {
          const { target, body } = make(l);
          return [{ id: target.id, body }];
        });
        wrote(ctx, name, `added to ${into}`, written);
        return (await report(ctx, name)) > 0 ? EXIT.errors : EXIT.ok;
      }

      const batch = items!;
      if (batch.length === 0) throw new UsageError("nothing to add — the text was empty");
      if (batch.length > 1 && (str(p, "id") || str(p, "title") || Object.keys(extra).length)) {
        throw new UsageError(`that is ${batch.length} items; --id, --title and --attr name one`);
      }
      if (batch.length === 1) {
        const one = batch[0]!;
        if (str(p, "id")) one.attrs.id = str(p, "id")!;
        if (str(p, "title")) one.attrs.title = str(p, "title")!;
        for (const [k, v] of Object.entries(extra)) if (v !== null) one.attrs[k] = v;
      }
      const placed = at ? anchorAt(batch, at) : batch;
      let ids: string[] = [];
      const { written, loaded } = await mutate(ctx, name, (l) => {
        const made = insertOps(l, placed, str(p, "page"));
        ids = made.ids;
        return made.ops;
      });
      if (at) warnUnpinned(ctx, loaded, pageIdOf(loaded, str(p, "page")), new Set(ids));
      emit(ctx, { ids, ...written }, () => {
        ctx.io.out(ids.join("\n"));
        ctx.io.err(`${name}: added ${ids.join(", ")} — base ${short(written?.base)}`);
      });
      return (await report(ctx, name)) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
  {
    name: ["item", "set"],
    args: "<board> <id> <key=value>...",
    min: 3,
    summary: "write attributes on an item's fence line: x= y= w= h= hue= title= page= hidden, and key= to take one off",
    help:
      "Everything the Properties panel writes about an item is an attribute on its fence line, and this is that line: " +
      "`x=240 y=80` moves it, `w=560` sizes a note, `aspect=2` folds a diagram, `hue=teal` tints a note, `hidden` " +
      "hides it and `hidden=` shows it again, `page=Design` moves it to another page. A key with nothing after the " +
      "`=` is removed. The id is not an attribute here: `anydag item rename` carries every link with it.",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, id, ...rest] = p.pos as [string, string, ...string[]];
      const given = pairs(rest);
      const { written, loaded } = await mutate(ctx, name, (l) => [{ id: itemOf(l, id).id, attrs: attrsOf(l, given) }]);
      if ("x" in given || "y" in given) warnUnpinned(ctx, loaded, itemOf(loaded, id).page, new Set([id]));
      wrote(ctx, name, `set ${Object.keys(given).join(", ")} on ${id}`, written);
    },
  },
  {
    name: ["item", "body"],
    args: "<board> <id>",
    min: 2,
    summary: "replace what is between an item's fences — the DSL, the Markdown, the caption",
    flags: [{ name: "file", type: "string", value: "<path|->", help: "the new body; `-` reads stdin" }],
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      const body = (await readText(ctx, str(p, "file"), "the body")).replace(/\n+$/, "");
      const { written } = await mutate(ctx, name, (l) => [{ id: itemOf(l, id).id, body }]);
      wrote(ctx, name, `rewrote the body of ${id}`, written);
      return (await report(ctx, name)) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
  {
    name: ["item", "rm"],
    args: "<board> <id>...",
    min: 2,
    summary: "take items off a board, with the blank line that separated each",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, ...ids] = p.pos as [string, ...string[]];
      const { written } = await mutate(ctx, name, (l) => ids.map((id) => ({ id: itemOf(l, id).id, remove: true as const })));
      wrote(ctx, name, `removed ${ids.join(", ")}`, written);
    },
  },
  {
    name: ["item", "dup"],
    args: "<board> <id>",
    min: 2,
    summary: "a copy of an item beside it, under an id of its own",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      let made: string[] = [];
      const { written } = await mutate(ctx, name, (l) => {
        const it = itemOf(l, id);
        const attrs = { ...it.attrs.map };
        delete attrs.id;
        /* Three grid steps down and across, as ctrl+D does — only for an item that has a place to be beside. */
        if (typeof attrs.x === "number" && typeof attrs.y === "number") {
          attrs.x += GRID * 3;
          attrs.y += GRID * 3;
        }
        const out = insertOps(l, [{ type: it.type, attrs, body: it.body }], it.page === l.board.pages[0]?.id ? undefined : it.page);
        made = out.ids;
        return out.ops;
      });
      emit(ctx, { ids: made, ...written }, () => {
        ctx.io.out(made.join("\n"));
        ctx.io.err(`${name}: ${id} copied to ${made.join(", ")} — base ${short(written?.base)}`);
      });
    },
  },
  ...(["front", "back"] as const).map(
    (to): Command => ({
      name: ["item", to],
      args: "<board> <id>...",
      min: 2,
      summary: to === "front" ? "draw items on top of everything else on their page" : "draw items under everything else on their page",
      routes: [GET, PATCH],
      async run(ctx, p) {
        const [name, ...ids] = p.pos as [string, ...string[]];
        const { written } = await mutate(ctx, name, (l) => {
          for (const id of ids) itemOf(l, id);
          return restackOps(l, ids, to);
        });
        wrote(ctx, name, `${ids.join(", ")} to the ${to}`, written);
      },
    }),
  ),
  {
    name: ["item", "rename"],
    args: "<board> <id> <new-id>",
    min: 3,
    summary: "rename an item's id, and every link that names it",
    routes: [GET, "POST /__board/put"],
    async run(ctx, p) {
      const [name, from, to] = p.pos as [string, string, string];
      const { written } = await rewrite(ctx, name, (l) => {
        itemOf(l, from);
        const r = renameItemId(l.text, from, to);
        if (!r.ok) throw new UsageError(r.error);
        return r.text;
      });
      wrote(ctx, name, `${from} is ${to}`, written);
    },
  },
  {
    name: ["item", "group"],
    args: "<board> <id> <id>...",
    min: 3,
    summary: "group items so they select and move together",
    flags: [{ name: "name", type: "string", value: "<group>", help: "the group's name (one is made)" }],
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, ...ids] = p.pos as [string, ...string[]];
      let group = str(p, "name") ?? "";
      const { written } = await mutate(ctx, name, (l) => {
        for (const id of ids) itemOf(l, id);
        if (!group) group = freshId("group", idsOf(l));
        return ids.map((id) => ({ id, attrs: { group } }));
      });
      wrote(ctx, name, `grouped ${ids.join(", ")} as ${group}`, written);
    },
  },
  {
    name: ["item", "ungroup"],
    args: "<board> <id>...",
    min: 2,
    summary: "take the group off items — every member of any group they are in",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, ...ids] = p.pos as [string, ...string[]];
      let all: string[] = [];
      const { written } = await mutate(ctx, name, (l) => {
        for (const id of ids) itemOf(l, id);
        all = withGroups(l, ids).filter((id) => l.board.items.find((i) => i.id === id)?.group);
        return all.map((id) => ({ id, attrs: { group: null } }));
      });
      wrote(ctx, name, `ungrouped ${all.join(", ")}`, written);
    },
  },
  {
    name: ["item", "convert"],
    args: "<board> <id>",
    min: 2,
    summary: "rewrite a Mermaid paste in the dialect it was written for",
    help:
      "flowchart and graph become flow, erDiagram erd, sequenceDiagram sequence, pie and xychart-beta chart. What " +
      "cannot be translated comes through as `%%` comments, and this says how many.",
    routes: [GET, PATCH, "GET /__board/diagnostics"],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      let left = 0;
      let type = "";
      const { written } = await mutate(ctx, name, (l) => {
        const it = itemOf(l, id);
        if (!detectMermaid(it.body).fatal) throw new UsageError(`${id} is not Mermaid — there is nothing to convert`);
        const c = fromMermaid(it.body);
        if (!c) throw new UsageError(`${id} is a kind of Mermaid with no counterpart here`);
        left = c.left;
        type = c.type;
        const op: PatchOp = { id: it.id, type: c.type, body: c.body, ...(c.dir ? { attrs: { dir: c.dir } } : {}) };
        return [op];
      });
      wrote(ctx, name, `${id} converted to ${type}${left ? ` — ${left} statement${left === 1 ? "" : "s"} left as comments` : ""}`, written);
      return (await report(ctx, name)) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
  {
    name: ["item", "relayout"],
    args: "<board> <id>",
    min: 2,
    summary: "hand a hand-placed diagram back to the layout: every x= and y= off, and layout=fixed with them",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, id] = p.pos as [string, string];
      const { written } = await mutate(ctx, name, (l) => {
        const it = itemOf(l, id);
        if (it.layout !== "fixed") throw new UsageError(`${id} is not layout=fixed — the layout already places it`);
        return [{ id: it.id, body: stripCoords(it.body), attrs: { layout: null } }];
      });
      wrote(ctx, name, `${id} is laid out again`, written);
    },
  },

  /* ---- pages -------------------------------------------------------------------------------- */

  {
    name: ["page", "ls"],
    args: "<board>",
    min: 1,
    summary: "a board's pages, in order, and how many items each holds",
    routes: [GET],
    async run(ctx, p) {
      const l = await load(ctx, p.pos[0]!);
      const rows = l.board.pages.map((pg) => ({ ...pg, items: l.board.items.filter((i) => i.page === pg.id).length }));
      emit(ctx, { pages: rows }, () => {
        for (const line of table(rows.map((r) => [r.id, r.name, `${r.items} item${r.items === 1 ? "" : "s"}`]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["page", "add"],
    args: "<board> [<name>]",
    min: 1,
    summary: "add a page at the end",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, title] = p.pos as [string, string | undefined];
      let id = "";
      const { written } = await mutate(ctx, name, (l) => {
        const made = addPageOps(l, title);
        id = made.id;
        return made.ops;
      });
      emit(ctx, { id, ...written }, () => {
        ctx.io.out(id);
        ctx.io.err(`${name}: added page ${id} — base ${short(written?.base)}`);
      });
    },
  },
  {
    name: ["page", "rename"],
    args: "<board> <page> <name>",
    min: 3,
    summary: "rename a page; its id, which items name, stays",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, page, title] = p.pos as [string, string, string];
      const { written } = await mutate(ctx, name, (l) => renamePageOps(l, page, title));
      wrote(ctx, name, `page ${page} is “${title}”`, written);
    },
  },
  {
    name: ["page", "rm"],
    args: "<board> <page>",
    min: 2,
    summary: "remove a page; what was on it moves to the first page",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, page] = p.pos as [string, string];
      const { written } = await mutate(ctx, name, (l) => removePageOps(l, page));
      wrote(ctx, name, `removed page ${page}`, written);
    },
  },
  {
    name: ["page", "move"],
    args: "<board> <page>",
    min: 2,
    summary: "reorder a page: --before another, or to the end",
    flags: [{ name: "before", type: "string", value: "<page>", help: "the page it goes in front of (default: the end)" }],
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, page] = p.pos as [string, string];
      const { written } = await mutate(ctx, name, (l) => movePageOps(l, page, str(p, "before") ?? null));
      wrote(ctx, name, `moved page ${page}`, written);
    },
  },

  /* ---- links -------------------------------------------------------------------------------- */

  {
    name: ["link", "ls"],
    args: "<board>",
    min: 1,
    summary: "the links between items, from every edges fence",
    routes: [GET],
    async run(ctx, p) {
      const l = await load(ctx, p.pos[0]!);
      const end = (e: { item: string; node?: string }) => (e.node === undefined ? e.item : `${e.item}.${e.node}`);
      emit(ctx, { links: l.board.links }, () => {
        for (const line of table(l.board.links.map((k) => [k.id, end(k.from), "→", end(k.to), k.label ? JSON.stringify(k.label) : "", k.via ? `via ${k.via.x},${k.via.y}` : ""])))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["link", "add"],
    args: "<board> <from> <to>",
    min: 3,
    summary: "join two items, or a card inside a diagram (`stack.api`), with a line",
    help:
      "An end is an item's id, a group's name, or `item.card` for a card inside a diagram. Two cards of one " +
      "diagram are an edge of that diagram and are written into its body, as the pointer does.",
    flags: [
      { name: "label", type: "string", value: "<text>", help: "words on the line" },
      { name: "arrow", type: "string", value: "<arrow>", help: "--> (default), -.->, <-->, --- …" },
      { name: "hue", type: "string", value: "<hue>", help: "the line's own colour" },
      { name: "quiet", type: "boolean", help: "drawn quieter than the rest" },
      pageFlag,
    ],
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, from, to] = p.pos as [string, string, string];
      let into = "";
      const { written } = await mutate(ctx, name, (l) => {
        const made = addLinkOps(l, from, to, { label: str(p, "label"), arrow: str(p, "arrow"), hue: str(p, "hue"), quiet: bool(p, "quiet") || undefined }, pageIdOf(l, str(p, "page")));
        into = made.into === "diagram" ? `as an edge of ${made.fence}` : `in ${made.fence}`;
        return made.ops;
      });
      wrote(ctx, name, `linked ${from} → ${to} ${into}`, written);
    },
  },
  {
    name: ["link", "set"],
    args: "<board> <from> <to> <key=value>...",
    min: 4,
    summary: "a link's label=, arrow=, hue=, via=x,y and quiet — key= takes one off",
    help: "`via=320,180` bends the line through that point, in board coordinates; `via=` straightens it. Name a link by its two ends, or by its id from `link ls` as `<id> -`.",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, from, to, ...rest] = p.pos as [string, string, string, ...string[]];
      const given = pairs(rest);
      const { written } = await mutate(ctx, name, (l) => {
        const found = to === "-" ? linkOf(l, from) : linkOf(l, from, to);
        const change: Parameters<typeof setLinkOps>[1] = {};
        for (const [k, v] of Object.entries(given)) {
          if (k === "label") v === null ? (change.clearLabel = true) : (change.label = String(v));
          else if (k === "arrow") change.arrow = String(v);
          else if (k === "hue") v === null ? (change.clearHue = true) : (change.hue = String(v));
          else if (k === "quiet") change.quiet = v !== null;
          else if (k === "via") change.via = v === null ? null : point(String(v), "via=");
          else throw new UsageError(`a link has no \`${k}\` — label, arrow, hue, quiet, via`);
        }
        return setLinkOps(found, change);
      });
      wrote(ctx, name, `link ${from} → ${to} set`, written);
    },
  },
  {
    name: ["link", "rm"],
    args: "<board> <from> <to>",
    min: 3,
    summary: "take a link off — its whole statement, so a chain goes as one",
    routes: [GET, PATCH],
    async run(ctx, p) {
      const [name, from, to] = p.pos as [string, string, string];
      const { written } = await mutate(ctx, name, (l) => removeLinkOps(to === "-" ? linkOf(l, from) : linkOf(l, from, to)));
      wrote(ctx, name, `unlinked ${from} → ${to}`, written);
    },
  },
];
