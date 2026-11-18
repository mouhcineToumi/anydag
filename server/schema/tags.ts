/** The tag routes' schemas and rows (`server/routes/tags.ts`). See *Tags* in `docs/architecture/tasks-projects-calendar.md`. */

import { z } from "zod";

import { HUE_ORDER, type Hue as HueName } from "../../src/dsl/ir";
import { hueOf } from "../../src/note/project";
import { tagOf } from "../../src/note/tags";
import { err, outsideComponents, textKind } from "../http";
import { body, bodyThen, field, json, kept, named, param } from "./fields";
import { route } from "./row";
import { Hue, Named, TextKind } from "./shapes";

/** A tag in a body, or the 400 that says what one is. */
export function tagArg(raw: unknown, what: string): string {
  const tag = tagOf(raw);
  if (!tag)
    throw err(400, `\`${String(raw ?? "")}\` is not a tag (${what}): letters, digits, _, - and /, with a letter among them`);
  return tag;
}

/** A list of tags in a body: absent is none, and every entry must be one. */
function tagsArg(raw: unknown, what: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw err(400, `\`${what}\` is a list of tags`);
  return raw.map((t) => tagArg(t, what));
}

/** A hue in a body: one of the ten, or `null` for the default. */
function hueArg(raw: unknown): HueName | null {
  if (raw === null) return null;
  const hue = hueOf(raw);
  if (!hue) throw err(400, `\`${String(raw)}\` is not a hue: one of ${HUE_ORDER.join(", ")}, or null for the default`);
  return hue;
}

const TAG_DOC = z.string().regex(/[\p{L}]/u);
const tag = (what: string, description: string) => field(TAG_DOC, description, (raw) => tagArg(raw, what), "read");
const tags = (what: string) => kept(z.array(TAG_DOC).nullable(), `Tags to ${what}; left out, none.`);

export const ApplyTagsBody = bodyThen(
  "ApplyTagsBody",
  "One document's tags, added and taken off. A tag the vault has never seen is created — registered, with `hue` or its default.",
  {
    name: kept(z.string(), "The document's name."),
    kind: field(TextKind, "Which kind; left out, a note.", (raw) => textKind(raw ?? "note"), "read"),
    add: tags("add"),
    remove: tags("take off"),
    hue: kept(Hue.nullable(), "The colour of a tag this creates; `null` or left out, its default."),
  },
  ["name"],
  (b) => {
    const name = String(b.name ?? "");
    outsideComponents(b.kind, name);
    const add = tagsArg(b.add, "add");
    const remove = tagsArg(b.remove, "remove");
    const hue = "hue" in b ? hueArg(b.hue) : null;
    if (!add.length && !remove.length) throw err(400, "expected `add`, `remove` or both: lists of tags");
    return { name, kind: b.kind, add, remove, hue };
  },
);

export const RenameTagBody = bodyThen(
  "RenameTagBody",
  "A tag renamed in every document, or merged into one that exists.",
  { from: tag("from", "The tag as it is."), to: tag("to", "What it becomes; a tag the vault has already is a merge.") },
  ["from", "to"],
  (b) => {
    if (b.from === b.to) throw err(400, "`from` and `to` are the same tag");
    return b;
  },
);

export const DeleteTagBody = body("DeleteTagBody", "A tag to take off every document.", { tag: tag("tag", "The tag.") }, ["tag"]);

export const ColorTagBody = body(
  "ColorTagBody",
  "A tag's colour, which registers it.",
  {
    tag: tag("tag", "The tag."),
    hue: field(
      Hue.nullable(),
      "One of the ten hues, or `null` for the default its name hashes to.",
      (raw) => {
        if (raw === undefined) throw err(400, "expected `hue`: one of the ten hues, or null for the default");
        return hueArg(raw);
      },
      "read",
    ),
  },
  ["tag", "hue"],
);

const TagInfo = named(
  "TagInfo",
  "A tag: its spelling, its hue, whether the tag list holds it, how many documents carry it and of which kinds.",
  z.object({ name: z.string(), hue: Hue, registered: z.boolean(), count: z.int(), kinds: z.array(TextKind) }),
);

const Across = { files: z.array(Named), missed: z.array(Named) };
const TAG = "tags";
const NOT_A_TAG = "A tag that is not one: letters, digits, `_`, `-` and `/`, with a letter among them.";

export const TAG_ROUTES = [
  route({
    method: "get",
    path: "/__board/tags",
    operationId: "tags",
    summary: "The vault's tags",
    description: "With `tag`, the documents carrying it too.",
    tag: TAG,
    query: z.object({ tag: param("A tag whose documents to list.", z.string().optional()) }),
    answers: {
      200: json(
        "Every tag, and with `tag` the documents carrying it by title.",
        z.object({
          tags: z.array(TagInfo),
          tag: z.string().optional(),
          docs: z.array(z.object({ name: z.string(), kind: TextKind, title: z.string() })).optional(),
        }),
      ),
    },
    refuses: { 400: NOT_A_TAG },
  }),
  route({
    method: "post",
    path: "/__board/tags/apply",
    operationId: "applyTags",
    summary: "Add and take off one document's tags",
    tag: TAG,
    body: { schema: ApplyTagsBody },
    answers: {
      200: json(
        "The document's tags now, and the tags this created.",
        z.object({ name: z.string(), kind: TextKind, tags: z.array(z.string()), created: z.array(z.string()) }),
      ),
    },
    refuses: {
      400: `${NOT_A_TAG} A \`kind\` that is not one, a non-board under \`components/\`, a hue that is not one, or nothing to add or take off.`,
      404: "No such document.",
      409: "The document kept changing underneath the edit, or the tag list does not read.",
    },
  }),
  route({
    method: "post",
    path: "/__board/tags/rename",
    operationId: "renameTag",
    summary: "Rename a tag in every document",
    description:
      "A file that cannot be written is in `missed`, and nothing is rolled back: sending it again finishes it. The old entry leaves the tag list once nothing was missed.",
    tag: TAG,
    body: { schema: RenameTagBody },
    answers: {
      200: json(
        "Whether it was a merge, and the files it rewrote and missed.",
        z.object({ from: z.string(), to: z.string(), merged: z.boolean(), ...Across }),
      ),
    },
    refuses: { 400: `${NOT_A_TAG} The same tag twice.`, 409: "The tag list does not read." },
  }),
  route({
    method: "post",
    path: "/__board/tags/delete",
    operationId: "deleteTag",
    summary: "Take a tag off every document",
    description: "The hue it had is answered, so *Undo* on an unused tag can put it back with `/color`.",
    tag: TAG,
    body: { schema: DeleteTagBody },
    answers: {
      200: json(
        "The files it rewrote and missed, and whether and how it was registered.",
        z.object({ tag: z.string(), ...Across, registered: z.boolean(), hue: Hue.nullable() }),
      ),
    },
    refuses: { 400: NOT_A_TAG, 409: "The tag list does not read." },
  }),
  route({
    method: "post",
    path: "/__board/tags/color",
    operationId: "colorTag",
    summary: "Set a tag's colour",
    tag: TAG,
    body: { schema: ColorTagBody },
    answers: { 200: json("The tag as registered.", z.object({ name: z.string(), hue: Hue, registered: z.literal(true) })) },
    refuses: { 400: `${NOT_A_TAG} No hue, or one that is not.`, 409: "The tag list does not read." },
  }),
];
