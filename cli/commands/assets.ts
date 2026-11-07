import fs from "node:fs";

import { itemsToText } from "../../src/board/clipboard";
import { componentFrontmatter } from "../../src/board/library/saved";
import { isDiagramType } from "../../src/board/types";
import { placedWidth } from "../../src/edit/image";

import { Conflict } from "../api";
import { UsageError, bool, num, point, str } from "../args";
import { itemOf, kindQuery, load, pageAttr, warnUnpinned } from "../board";
import { confirm, emit, short, table, type Command } from "../context";
import { readImage } from "../image";
import { GRID } from "../ops";
import { accountSettings } from "./app";
import { ITEMS } from "./items";

/**
 * Images and saved components — the two kinds of thing that live beside a board rather than in it.
 */

interface Sized {
  files: { file: string; bytes: number }[];
  bytes: number;
}

export const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const ASSETS: Command[] = [
  {
    name: ["image", "add"],
    args: "<board> <file>",
    min: 2,
    summary: "put an image on a board — stored beside it, and the fence that draws it appended",
    help:
      "The width follows your paste setting (`anydag settings`), the rule a pasted screenshot follows, against " +
      "--dpr: 1 unless you say the image came off a denser screen. --w says the width outright. With --note the " +
      "image is stored beside a note and its Markdown appended to the note's end, where the editor would have put " +
      "it at the caret. A file is stored exactly as it is; nothing here resamples a pixel.",
    flags: [
      { name: "at", type: "string", value: "<x,y>", help: "where its top-left goes" },
      { name: "w", type: "string", value: "<px>", help: "its width on the board" },
      { name: "dpr", type: "string", value: "<n>", help: "the pixel density it was captured at (default 1)" },
      { name: "page", type: "string", value: "<page>", help: "which page, by id or name" },
      { name: "note", type: "boolean", help: "the document is a note" },
      { name: "alt", type: "string", value: "<text>", help: "a note image's description" },
    ],
    routes: ["POST /__board/asset", "POST /__board/upload", "GET /__board/get", "POST /__board/put", "GET /api/settings"],
    async run(ctx, p) {
      const [name, file] = p.pos as [string, string];
      const img = readImage(file);
      if (bool(p, "note")) {
        const up = await ctx.api.post<{ src: string }>("/__board/upload", { dataUrl: img.dataUrl }, { name, kind: "note" });
        const line = `![${str(p, "alt") ?? ""}](${up.src})`;
        /* Appended under the base it was read at, and read again if the note moved meanwhile: a note
           has a person typing in it more often than a board does. */
        for (let attempt = 0; ; attempt++) {
          const got = await ctx.api.get<{ text: string; base: string }>("/__board/get", { name, kind: kindQuery("note") });
          const text = `${got.text.replace(/\s*$/, "")}\n\n${line}\n`;
          try {
            const after = await ctx.api.post<{ base: string }>("/__board/put", { text, base: got.base }, { name, kind: "note" });
            emit(ctx, { src: up.src, ...after }, () => ctx.io.err(`${name}: image ${up.src} appended — base ${short(after.base)}`));
            return;
          } catch (e) {
            if (attempt > 0 || !(e instanceof Conflict)) throw e;
          }
        }
      }
      const l = await load(ctx, name);
      const at = str(p, "at") ? point(str(p, "at")!) : undefined;
      let w = num(p, "w");
      if (w === undefined) {
        const rule = (await accountSettings(ctx)).paste;
        w = placedWidth(img.width ?? rule.width, num(p, "dpr") ?? 1, rule, GRID);
      }
      const page = pageAttr(l, str(p, "page"));
      const done = await ctx.api.post<{ src: string; id: string; base: string }>(
        "/__board/asset",
        { dataUrl: img.dataUrl, x: at?.x, y: at?.y, w, page },
        { name },
      );
      if (at) warnUnpinned(ctx, l, page ?? l.board.pages[0]?.id ?? "page-1", new Set([done.id]));
      emit(ctx, done, () => {
        ctx.io.out(done.id);
        ctx.io.err(`${name}: ${done.id} (${kb(img.bytes)}, ${w}px wide) — base ${short(done.base)}`);
      });
    },
  },
  {
    name: ["image", "get"],
    args: "<path>",
    min: 1,
    summary: "download an image a board or note keeps — `demo.assets/paste-1a2b3c4d.png`",
    flags: [{ name: "out", short: "o", type: "string", value: "<file>", help: "where to write it (default: stdout)" }],
    routes: ["GET /__board/assets/{path:path}"],
    async run(ctx, p) {
      const res = await ctx.api.raw(`/__board/assets/${p.pos[0]!.split("/").map(encodeURIComponent).join("/")}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const out = str(p, "out");
      if (out) {
        fs.writeFileSync(out, bytes);
        ctx.io.err(`wrote ${out} (${kb(bytes.length)})`);
      } else ctx.io.write(bytes);
    },
  },
  {
    name: ["image", "unused"],
    args: "<board>",
    min: 1,
    summary: "the images beside a board that no board's text names any more",
    routes: ["GET /__board/assets/unused"],
    async run(ctx, p) {
      const got = await ctx.api.get<Sized>("/__board/assets/unused", { name: p.pos[0] });
      emit(ctx, got, () => {
        for (const line of table(got.files.map((f) => [f.file, kb(f.bytes)]))) ctx.io.out(line);
        ctx.io.err(`${got.files.length} unused, ${kb(got.bytes)}`);
      });
    },
  },
  {
    name: ["image", "sweep"],
    args: "<board>",
    min: 1,
    summary: "delete the images `image unused` lists — this board's only, and never undone",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["GET /__board/assets/unused", "POST /__board/assets/sweep"],
    async run(ctx, p) {
      const name = p.pos[0]!;
      const unused = await ctx.api.get<Sized>("/__board/assets/unused", { name });
      if (unused.files.length === 0) {
        emit(ctx, unused, () => ctx.io.err(`${name}: no unused images`));
        return;
      }
      await confirm(ctx, `delete ${unused.files.length} image(s), ${kb(unused.bytes)}, from beside ${name}?`, bool(p, "yes"));
      const swept = await ctx.api.post<Sized>("/__board/assets/sweep", {}, { name });
      emit(ctx, swept, () => ctx.io.err(`${name}: deleted ${swept.files.length} image(s), ${kb(swept.bytes)}`));
    },
  },

  /* ---- saved components --------------------------------------------------------------------- */

  {
    name: ["component", "ls"],
    args: "",
    summary: "the components you have kept, which the library shows under Yours",
    routes: ["GET /__board/components"],
    async run(ctx) {
      const got = await ctx.api.get<{ components: { name: string; meta?: { title?: string; component?: { description?: string } } | null }[] }>(
        "/__board/components",
      );
      emit(ctx, got, () => {
        for (const line of table(got.components.map((c) => [c.name, c.meta?.title ?? "", c.meta?.component?.description ?? ""]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["component", "keep"],
    args: "<board> [<item>...]",
    min: 1,
    summary: "keep items as a component of your own — one diagram is a part, several a stack",
    help:
      "What ctrl+shift+K does to a selection. With no items named, everything visible on the page is kept. One " +
      "diagram becomes a part that can be dropped inside another of its type; anything else a stack that goes down " +
      "together. The name is numbered if it is taken.",
    flags: [
      { name: "name", type: "string", value: "<title>", help: "what to call it" },
      { name: "description", type: "string", value: "<text>", help: "what it is for" },
      { name: "page", type: "string", value: "<page>", help: "the page to keep, when no items are named" },
    ],
    routes: ["GET /__board/get", "POST /__board/create"],
    async run(ctx, p) {
      const [board, ...ids] = p.pos as [string, ...string[]];
      const l = await load(ctx, board);
      const page = str(p, "page") ? l.board.pages.find((x) => x.id === str(p, "page") || x.name === str(p, "page"))?.id : l.board.pages[0]?.id;
      const chosen = ids.length ? ids.map((id) => itemOf(l, id)) : l.board.items.filter((i) => i.page === page && !i.hidden);
      if (chosen.length === 0) throw new UsageError("nothing to keep");
      const one = chosen.length === 1 ? chosen[0]! : null;
      const title = str(p, "name")?.trim() || one?.title || (one ? `A ${one.type}` : `${chosen.length} items`);
      const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "component";
      const description = str(p, "description") ?? (one ? `${one.type}, saved from \`${board}\`` : `${chosen.length} items, saved from \`${board}\``);
      const icon = one && isDiagramType(one.type) ? "Boxes" : "Layers";
      const text = `${componentFrontmatter(title, description, icon)}\n${itemsToText(chosen)}\n`;
      const made = await ctx.api.post<{ name: string }>("/__board/create", { name: `components/${stem}`, text });
      const kept = made.name.replace(/^components\//, "");
      emit(ctx, { ...made, component: kept }, () => {
        ctx.io.out(kept);
        ctx.io.err(`kept ${chosen.map((c) => c.id).join(", ")} as \`${kept}\``);
      });
    },
  },
  {
    name: ["component", "place"],
    args: "<component> <board>",
    min: 2,
    summary: "put one of your components on a board, or --into a diagram of its type",
    flags: [
      { name: "at", type: "string", value: "<x,y>", help: "where its top-left goes" },
      { name: "into", type: "string", value: "<item>", help: "append a part inside this diagram" },
      { name: "page", type: "string", value: "<page>", help: "which page" },
    ],
    routes: ["GET /__board/components", "GET /__board/get", "POST /__board/patch"],
    async run(ctx, p) {
      /* The same drop `item add --saved` makes; one implementation, reached by two names. */
      const add = ITEMS.find((c) => c.name.join(" ") === "item add")!;
      return add.run(ctx, { pos: [p.pos[1]!], flags: { ...p.flags, saved: p.pos[0]! } });
    },
  },
  {
    name: ["component", "rm"],
    args: "<component>",
    min: 1,
    summary: "delete a component you kept",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["POST /__board/components/delete"],
    async run(ctx, p) {
      await confirm(ctx, `delete the component ${p.pos[0]}?`, bool(p, "yes"));
      const done = await ctx.api.post("/__board/components/delete", { name: p.pos[0] });
      emit(ctx, done, () => ctx.io.err(`deleted component ${p.pos[0]}`));
    },
  },
];

