import { str } from "../args";
import { emit, table, type Command } from "../context";

/**
 * The three things an author cannot invent — the grammar, the ready-made parts, the icon names —
 * each served by the running server from the files that live beside the parsers, so what this
 * prints is what the parser accepts rather than what somebody remembered.
 */

interface Served {
  id: string;
  layer: number;
  type: string;
  name: string;
  description: string;
  source: string;
}

const LAYERS = ["atom", "molecule", "pattern", "diagram", "stack"];

export const GRAMMAR: Command[] = [
  {
    name: ["dsl"],
    group: "grammar",
    args: "[<type>]",
    summary: "a cheat sheet — with no type, the names of all of them",
    help: "`common` is what every type shares and `edges` is the fence that joins two items; read those two and the one for your type before writing a fence body.",
    routes: ["GET /__board/dsl"],
    async run(ctx, p) {
      const type = p.pos[0];
      const got = await ctx.api.get<{ types?: string[]; type?: string; text?: string }>("/__board/dsl", { type });
      emit(ctx, got, () => {
        if (got.text !== undefined) ctx.io.write(got.text.endsWith("\n") ? got.text : `${got.text}\n`);
        else ctx.io.out((got.types ?? []).join("\n"));
      });
    },
  },
  {
    name: ["library"],
    group: "grammar",
    args: "[<id>]",
    summary: "ready-made pieces, and your own kept components; name one to see the text it writes",
    help:
      "Five layers: an atom is one statement, a molecule a container with something in it, a pattern several of " +
      "those wired together, a diagram a whole item, a stack several items. `anydag item add <board> --from <id>` " +
      "places one; a part (layer 2 or below) goes inside a diagram of its type with --into. The Objects — about " +
      "1,700 pictures to illustrate with, a person, a house, a truck, each one sketch `figure` — are listed only " +
      "when --search finds them.",
    flags: [
      { name: "type", type: "string", value: "<type>", help: "one dialect's pieces only" },
      { name: "search", type: "string", value: "<words>", help: "every word in the name or what it writes — how the pictures are found" },
    ],
    routes: ["GET /__board/library"],
    async run(ctx, p) {
      const id = p.pos[0];
      if (id) {
        const one = await ctx.api.get<Served>("/__board/library", { id });
        emit(ctx, one, () => {
          ctx.io.err(`${one.name} — ${LAYERS[one.layer] ?? one.layer}, ${one.type}: ${one.description}`);
          ctx.io.write(one.source.endsWith("\n") ? one.source : `${one.source}\n`);
        });
        return;
      }
      const search = str(p, "search");
      const got = await ctx.api.get<{
        blueprints: (Served & { shelf?: string })[];
        objects?: { total: number; listed: number; shelves: { shelf: string; count: number }[] } | null;
        saved: { name: string; meta?: { title?: string } | null }[];
      }>("/__board/library", {
        type: str(p, "type"),
        q: search,
      });
      emit(ctx, got, () => {
        for (const line of table(
          got.blueprints.map((b) => [b.id, b.type, b.shelf ? `object · ${b.shelf}` : (LAYERS[b.layer] ?? String(b.layer)), b.name]),
        ))
          ctx.io.out(line);
        const o = got.objects;
        if (o && o.total > o.listed)
          ctx.io.err(
            o.listed === 0
              ? `${o.total} objects (${o.shelves.map((s) => `${s.shelf} ${s.count}`).join(", ")}) — --search finds them`
              : `${o.listed} of ${o.total} objects — search more narrowly for the rest`,
          );
        if (got.saved.length) {
          ctx.io.out("");
          for (const line of table(got.saved.map((s) => [s.name, "yours", s.meta?.title ?? ""]))) ctx.io.out(line);
        }
      });
    },
  },
  {
    name: ["icons"],
    group: "grammar",
    args: "[<search>]",
    summary: "what `icon=` may say — about 4,500 names, so search",
    help:
      "`brand` draws a vendor's own colours on a neutral tile, `mono` a silhouette in the card's hue " +
      "(`icon=mono:postgresql`), `concept` a Lucide glyph. The pictures are every Unicode emoji as `emoji:<name>` — " +
      "`anydag icons emoji:house` — which a sketch `figure` draws big with a caption, in its own colours or, as " +
      "`mono:emoji:<name>`, in the hue.",
    flags: [{ name: "mode", type: "string", value: "<brand|mono|concept>", help: "one way of drawing only" }],
    routes: ["GET /__board/icons"],
    async run(ctx, p) {
      const got = await ctx.api.get<{ icons: { name: string; mode: string }[]; total: number; returned: number; truncated: boolean }>("/__board/icons", {
        q: p.pos[0],
        mode: str(p, "mode"),
      });
      emit(ctx, got, () => {
        for (const line of table(got.icons.map((i) => [i.name, i.mode]))) ctx.io.out(line);
        if (got.truncated) ctx.io.err(`${got.returned} of ${got.total} — search to narrow it`);
      });
    },
  },
];
