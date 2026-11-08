/**
 * References in the note editor. The React half of `REF_CONFIG` and `EMBED_CONFIG`, whose
 * shapes `src/note/schema.ts` decides, plus the picker that writes them.
 *
 * `@` and `[[` insert a reference, `![` (Markdown's own start of an image) inserts an embed, and the
 * slash menu's "Board" opens the `![` picker for somebody who does not know that. The picker lists
 * every board and note by its title, with its kind and its folder under it; two with the same title
 * are told apart by their folders, which is the only honest
 * answer — a title is not unique and nothing should pretend it is. **Not by their file names**:
 * a name is the technical half of a document nobody has to know, and a picker that
 * printed `untitled-2` under every new board was asking them to. Only two with one title *in one
 * folder* show a name, under the row, because then it is the one thing that tells them apart.
 */
import { createReactBlockSpec, createReactInlineContentSpec, type DefaultReactSuggestionItem } from "@blocknote/react";
import { File as FileGlyph, FileText, FolderKanban, GraduationCap, LayoutDashboard, Table2, type LucideIcon } from "lucide-react";

import type { FileKind } from "@/board/useBoard";
import { FileIcon } from "@/files/FileIcon";
import { fileWhat } from "@/files/types";

import { EMBED_CONFIG, REF_CONFIG } from "@/note/schema";
import { dagUrl } from "@/refs/extract";
import { RefBlock, RefChip } from "@/refs/Ref";
import { titleOf, type IndexDoc } from "@/refs/useIndex";

export const refInline = createReactInlineContentSpec(REF_CONFIG, {
  render: ({ inlineContent }) => <RefChip href={inlineContent.props.href} title={inlineContent.props.title} />,
});

export const embedBlock = createReactBlockSpec(EMBED_CONFIG, {
  render: ({ block }) => <RefBlock href={block.props.href} title={block.props.title} />,
});

/** The trigger that inserts an embed rather than a reference. */
export const EMBED_TRIGGER = "![";

/**
 * How well a document answers a query, lower being better, or `null` when it does not: every token
 * of the query has to be somewhere in the title or the path — `plan q3` finds `work/q3-plan` — and
 * the title starting with the query beats a word in it starting with it, which beats the query
 * turning up anywhere else. Without the ranking `@arch` offered three boards whose *paths* happened
 * to contain the letters before the one called Architecture.
 */
export function rank(doc: IndexDoc, query: string): number | null {
  const title = titleOf(doc).toLowerCase();
  const hay = `${title} ${doc.name.toLowerCase()}`;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return null;
  const q = tokens.join(" ");
  if (!q) return 3;
  if (title.startsWith(q)) return 0;
  if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(tokens[0]!))) return 1;
  if (title.includes(q)) return 2;
  return 3;
}

/**
 * The picker's items for a query. `pick` is what choosing one does — insert a reference or an
 * embed — so one list serves both triggers. The note being written is left out: a note linking to
 * itself is a loop nobody meant, and embedding itself would never finish drawing.
 */
export function refItems(
  docs: readonly IndexDoc[],
  query: string,
  self: string | null,
  pick: (doc: IndexDoc) => void,
  only?: IndexDoc["kind"],
): DefaultReactSuggestionItem[] {
  const hits = docs
    .filter((d) => d.id !== self && (!only || d.kind === only))
    .map((d) => ({ d, r: rank(d, query) }))
    .filter((x): x is { d: IndexDoc; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || titleOf(a.d).localeCompare(titleOf(b.d)) || a.d.name.localeCompare(b.d.name))
    .slice(0, 20)
    .map((x) => x.d);
  /* Two documents with one title are told apart in the title itself, because BlockNote keys its
     rows by it and two rows with one key is a list React cannot keep in order: by their folders when
     those differ, and by a number when they do not — with the file name under the row then, the one
     thing left that tells them apart. */
  const same = new Map<string, IndexDoc[]>();
  for (const d of hits) same.set(titleOf(d), [...(same.get(titleOf(d)) ?? []), d]);
  return hits.map((d) => {
    const twins = same.get(titleOf(d))!;
    const apart = new Set(twins.map(folderOf)).size === twins.length;
    const at = twins.indexOf(d);
    const title =
      twins.length === 1
        ? titleOf(d)
        : apart
          ? `${titleOf(d)} (${folderOf(d) || "top level"})`
          : at
            ? `${titleOf(d)} (${at + 1})`
            : titleOf(d);
    const where = twins.length > 1 && !apart ? d.name : folderOf(d);
    /* A project is tagged by naming its note, so the picker says which notes are projects;
       an attachment says what it is, a PDF from a spreadsheet. */
    const Icon = d.project ? FolderKanban : KIND_ICON[d.kind];
    const what = d.project ? "Project" : d.kind === "file" ? fileWhat(d.name, d.bytes) : KIND_LABEL[d.kind];
    return {
      title,
      subtext: `${what}${where ? ` · ${where}` : ""}`,
      icon: d.kind === "file" ? <FileIcon name={d.name} size={16} /> : <Icon size={16} />,
      onItemClick: () => pick(d),
    };
  });
}

/**
 * What the picker says each kind of document is, and its mark. Keyed on the kind, so a quiz is
 * labelled a quiz rather than the board `kind === "note" ? … : "Board"` made of it.
 */
const KIND_LABEL = { board: "Board", note: "Note", quiz: "Quiz", table: "Table", file: "File" } satisfies Record<
  FileKind,
  string
>;
const KIND_ICON = {
  board: LayoutDashboard,
  note: FileText,
  quiz: GraduationCap,
  table: Table2,
  file: FileGlyph,
} satisfies Record<FileKind, LucideIcon>;

/** The folder a document is in, `""` for the top level — where a person put it, which they chose. */
const folderOf = (d: IndexDoc): string => (d.name.includes("/") ? d.name.slice(0, d.name.lastIndexOf("/")) : "");

export const refFor = (d: IndexDoc) => ({ type: "ref" as const, props: { href: dagUrl(d.id), title: titleOf(d) } });
export const embedFor = (d: IndexDoc) => ({ type: "embed" as const, props: { href: dagUrl(d.id), title: titleOf(d) } });
