import { parseChart } from "../dsl/chart";
import { CODES } from "../dsl/codes";
import { HUE_ORDER } from "../dsl/ir";
import { parseDiagram } from "../dsl/parse";
import { parseSequence } from "../dsl/sequence";
import { nearest } from "../dsl/suggest";
import { parse as parseYaml } from "yaml";

import { flag, num, str } from "./attrs";
import { endText, parseLinks } from "./links";
import { locateItems } from "./locate";
import {
  isDiagramType,
  isItemType,
  isLinkType,
  type Board,
  type BoardDiagnostic,
  type BoardItem,
  type BoardLink,
  type BoardPage,
  type ItemType,
  type LinkEnd,
} from "./types";

/**
 * A board file is Markdown: frontmatter, then fenced blocks, then whatever prose sits between them.
 *
 * Prose is not ignored — a contiguous run of non-fence lines becomes its own `md` item, so a board
 * can be written as a document and still lay out. That is what makes the file readable in an editor
 * and in git, which is the whole reason the board is a file rather than a database.
 *
 * Which bytes are which item is `locateItems`' answer, shared with `applyPatch`: this function
 * turns that list into items and reports what is wrong with them.
 */

/** Cheap, stable, and enough to tell "this DSL changed" from "this file was touched". */
export function hashOf(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).padStart(12, "0");
}

interface Frontmatter {
  title?: string;
  theme?: string;
  pages?: (BoardPage | string)[];
  flow?: { width?: number; gap?: number };
}

export function parseBoard(name: string, text: string): Board {
  const errors: Board["errors"] = [];
  const located = locateItems(text, isItemType);

  let fm: Frontmatter = {};
  if (located.frontmatter !== null) {
    try {
      fm = (parseYaml(located.frontmatter) as Frontmatter) ?? {};
    } catch (e) {
      errors.push({ line: 1, code: CODES.EB_FRONTMATTER, message: `frontmatter: ${(e as Error).message}`, severity: "error" });
    }
  }

  for (const u of located.unknown)
    errors.push({ line: u.line, code: CODES.EB_UNKNOWN_TYPE, message: `unknown item type \`${u.type}\``, severity: "error" });

  const items: BoardItem[] = [];
  /*
   * The items that never named a page.
   *
   * `page-1` is the id of the implicit single page, so it is both "the first page" and "nobody
   * said" — and those are different questions once a board declares pages of its own. An item with
   * no `page=` belongs to whatever the first page is called; only an item that *names* a page the
   * board does not have is a mistake worth reporting.
   */
  const implicit = new Set<string>();

  for (const loc of located.items) {
    const { line, attrs } = loc;

    if (loc.prose) {
      /* Loose prose has no fence line to carry an attribute, so it can never have named a page. */
      implicit.add(loc.id);
      items.push({
        id: loc.id,
        type: "md",
        body: loc.body,
        page: "page-1",
        note: false,
        hidden: false,
        attrs,
        line,
        hash: hashOf(`md\0${loc.body}`),
      });
      continue;
    }

    /* The column is where in the info string the attribute parser stopped; keeping it is what lets a
       reader put the caret on the character rather than the line. */
    for (const e of loc.attrErrors) errors.push({ line, col: e.col, code: e.code, message: e.message, severity: "error" });

    if (loc.duplicateOf)
      errors.push({ line, code: CODES.EB_DUPLICATE_ID, message: `duplicate id \`${loc.duplicateOf}\``, severity: "error" });

    const dirRaw = str(attrs, "dir");
    const dir = dirRaw === "LR" || dirRaw === "TB" ? dirRaw : undefined;
    if (dirRaw && !dir)
      errors.push({ line, code: CODES.EB_BAD_DIR, message: `dir must be LR or TB, got \`${dirRaw}\``, severity: "error" });

    /* The theme's per-type `aspect` is a house default, not a law: a diagram that really is one
       chain — a pipeline, a delivery path — reads as a chain only if nothing folds it. `0` is how
       `state` and `flow` say that in the theme, and this is how one board says it. */
    const aspectRaw = attrs.map.aspect;
    const aspect = num(attrs, "aspect");
    if (aspectRaw !== undefined && (aspect === undefined || !Number.isFinite(aspect) || aspect < 0))
      errors.push({
        line,
        code: CODES.EB_BAD_ASPECT,
        message: `aspect must be a number >= 0 (0 turns wrapping off), got \`${String(aspectRaw)}\``,
        severity: "error",
      });

    /* `frame=` is the manual override of the component rule; absent means "let the diagram decide". */
    const frameRaw = str(attrs, "frame");
    const frame = frameRaw === "none" || frameRaw === "full" ? frameRaw : undefined;
    if (frameRaw && !frame)
      errors.push({
        line,
        code: CODES.EB_BAD_FRAME,
        message: `frame must be none or full, got \`${frameRaw}\``,
        severity: "error",
      });

    /* An unknown name is dropped rather than kept broken, unlike `dir`/`aspect`/`frame`: a stray
       `hue=purple` should not stop the item being anything, only stop it wearing a colour nobody
       asked the theme for. Parsed for every item type, the way `dir` is — only `md`/`note`/`image`
       draw it (`hueVars()` in `MarkdownItem`/`ImageItem`), but the fence line means the same thing
       everywhere and a future diagram-item control should not need a second parser for it. */
    const hueRaw = str(attrs, "hue");
    const hue = hueRaw !== undefined && (HUE_ORDER as readonly string[]).includes(hueRaw) ? hueRaw : undefined;
    if (hueRaw !== undefined && hue === undefined)
      errors.push({
        line,
        code: CODES.WB_BAD_HUE,
        message: `unknown hue \`${hueRaw}\`. Expected one of ${HUE_ORDER.join(", ")}`,
        severity: "warn",
      });

    /* `layout=fixed` is the author saying the coordinates in this fence are theirs. One value,
       because there is one thing to say: the alternative is the automatic layout, which is what an
       absent attribute already means. */
    const layoutRaw = str(attrs, "layout");
    const layout = layoutRaw === "fixed" ? layoutRaw : undefined;
    if (layoutRaw && !layout)
      errors.push({
        line,
        code: CODES.EB_BAD_LAYOUT,
        message: `layout must be fixed, got \`${layoutRaw}\``,
        severity: "error",
      });

    const type: ItemType = loc.type === "note" ? "md" : (loc.type as ItemType);

    /* `as=` is a prompt card's request for a type. Read on every item for the reason `hue` is, and
       meaningful only on a prompt; a name that is not a diagram type is dropped rather than kept,
       because the card should still run and let the model choose. */
    const asRaw = str(attrs, "as");
    const as = asRaw !== undefined && isDiagramType(asRaw) ? asRaw : undefined;
    if (asRaw !== undefined && as === undefined)
      errors.push({
        line,
        code: CODES.WB_BAD_AS,
        message: `as must be a diagram type, got \`${asRaw}\``,
        severity: "warn",
      });

    items.push({
      id: loc.id,
      type,
      body: loc.body,
      x: num(attrs, "x"),
      y: num(attrs, "y"),
      w: num(attrs, "w"),
      h: num(attrs, "h"),
      title: str(attrs, "title"),
      subtitle: str(attrs, "subtitle"),
      hue,
      group: str(attrs, "group"),
      dir,
      frame,
      aspect,
      layout,
      as,
      src: str(attrs, "src"),
      page: str(attrs, "page") ?? (implicit.add(loc.id), "page-1"),
      note: loc.type === "note" || flag(attrs, "note"),
      hidden: flag(attrs, "hidden"),
      attrs,
      line,
      /* The type is in the hash because the same text means different things to two parsers, and a
         `md` → `arch` retype must miss the cache. `dir`, `aspect` and `layout` are in it because
         they change the layout — `layout` changes the *parse* as well — without changing a
         character of the DSL, and the cache is keyed on this hash. `hue` is deliberately not: it is
         colour only, no layout, so changing it must not miss the layout cache. */
      hash: hashOf(`${type}\0${loc.body}\0${dir ?? ""}\0${aspect ?? ""}\0${layout ?? ""}`),
    });
  }

  const declared: BoardPage[] = (fm.pages ?? []).map((p, i) =>
    typeof p === "string" ? { id: `page-${i + 1}`, name: p } : p,
  );
  const used = new Set(items.map((it) => it.page));
  const pages: BoardPage[] = declared.length
    ? declared
    : [...used].sort().map((id) => ({ id, name: id === "page-1" ? "Board" : id }));
  for (const it of items) {
    if (pages.some((p) => p.id === it.page)) continue;
    /* No `page=` of its own: it is on the first page, whatever that page is called. Reporting this
       was wrong — an image appended to a board that declares named pages is exactly this case, and
       it drew in plain view under an error saying its page did not exist. */
    if (!implicit.has(it.id)) {
      errors.push({ line: it.line, code: CODES.EB_UNKNOWN_PAGE, message: `unknown page \`${it.page}\``, severity: "error" });
    }
    it.page = pages[0]!.id;
  }

  /* After the pages are settled, not before: an item on a page nobody declared is moved onto the
     first one, and it is *there* that a reader sees it. Resolving against the declared page would
     report `EB_LINK_UNKNOWN_ITEM` for a card sitting in plain view. */
  const links = resolveLinks(items, errors);

  return {
    name,
    /* A non-empty string, trimmed — `titleOf`'s rule and the api's, held to one fixture
       (`test/titles.test.ts`), so the toolbar never calls a board something its sidebar row does not.
       `title: 42` used to reach the toolbar as a number. */
    title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : undefined,
    theme: fm.theme,
    pages,
    items,
    links,
    flow: { width: fm.flow?.width ?? 4000, gap: fm.flow?.gap ?? 80 },
    errors,
  };
}

/**
 * Every `edges` fence on the board, read and pointed at something real.
 *
 * Two jobs the grammar cannot do on its own. **Which items exist** — a link may only name items on
 * the same page as the fence that holds it, because a page is a separate drawing and a curve cannot
 * leave one. And **what an endpoint means**: `arch1.db` is a node inside `arch1` unless there is an
 * item literally called `arch1.db`, so the whole string is tried as an id before the split is
 * trusted, exactly as `resolveRefs()` reads a row ref.
 *
 * **An endpoint that does not resolve takes its link with it.** Nothing downstream — routing,
 * drawing, export — then has to carry a case for an end that is not anywhere; the diagnostic is
 * the whole of the report.
 */
function resolveLinks(items: BoardItem[], errors: BoardDiagnostic[]): BoardLink[] {
  const fences = items.filter((it) => isLinkType(it.type));
  if (fences.length === 0) return [];

  const byPage = new Map<string, Map<string, BoardItem>>();
  for (const it of items) {
    let m = byPage.get(it.page);
    if (!m) byPage.set(it.page, (m = new Map()));
    m.set(it.id, it);
  }

  /*
   * The group names in play, per page — the other namespace an endpoint may come from.
   *
   * A board-level group is a `group=` attribute shared by its members and nothing else: no
   * wrapper item, no id of its own. What it does have is a *name*, and that is enough to be an
   * endpoint, because the thing a link needs at the far end is a box and the union of the
   * members' boxes is one. `routeLinks` is handed it under this name.
   *
   * Per page for the same reason `here` is: two pages are two drawings, and a link may not reach
   * off the page it is written on.
   */
  const groupsByPage = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.group) continue;
    let g = groupsByPage.get(it.page);
    if (!g) groupsByPage.set(it.page, (g = new Set()));
    g.add(it.group);
  }

  /* Parsing a diagram to check one node id is the expensive part of this, so it happens once per
     item and only for the items a link actually names. A board of forty diagrams and one link pays
     for one parse. */
  const nodesOf = new Map<string, Set<string> | null>();
  const nodeIds = (it: BoardItem): Set<string> | null => {
    const had = nodesOf.get(it.id);
    if (had !== undefined) return had;
    const ids = nodeIdsOf(it);
    nodesOf.set(it.id, ids);
    return ids;
  };

  const out: BoardLink[] = [];

  for (const fence of fences) {
    const parsed = parseLinks(fence.body, fence.line, fence.id);
    for (const d of parsed.diagnostics) errors.push(d);

    const here = byPage.get(fence.page) ?? new Map<string, BoardItem>();
    const groupsHere = groupsByPage.get(fence.page) ?? new Set<string>();

    /* A chain says `b` twice and a bus says the target once per source, so one wrong id would
       otherwise be reported as many times as it is mentioned. */
    const said = new Set<string>();
    const report = (line: number, code: BoardDiagnostic["code"], message: string): void => {
      const key = `${line}\0${message}`;
      if (said.has(key)) return;
      said.add(key);
      errors.push({ line, code, message, severity: "error" });
    };

    const resolve = (end: LinkEnd, line: number): LinkEnd | null => {
      const raw = endText(end);
      if (here.has(raw)) return { item: raw };

      /* A group, after every item id has been tried — the same precedence the dot already
         follows, and for the same reason: an item is a thing somebody named, a group name is
         generated, and the one a reader meant when both exist is the one they typed themselves.
         Only a bare name, because `group.node` names nothing: a group has no cards of its own. */
      if (end.node === undefined && groupsHere.has(raw)) return { item: raw, group: true };

      const owner = end.node === undefined ? undefined : here.get(end.item);
      if (!owner) {
        /* Named as written, suggested from the head: `arch-1.db` misspelt as `arch1.db` is a
           misspelt *item*, and nothing on the page is called `arch1.db` to be near. Group names
           join the pool a suggestion comes from, since a bare name could have meant either.

           The code stays `EB_LINK_UNKNOWN_ITEM` rather than gaining a group-shaped sibling: what
           failed is "nothing on this page is called that", and which of the two namespaces the
           author had in mind is exactly what cannot be known from a name that is in neither. */
        const pool = end.node === undefined ? [...here.keys(), ...groupsHere] : [...here.keys()];
        const guess = nearest(end.item, pool);
        report(
          line,
          CODES.EB_LINK_UNKNOWN_ITEM,
          guess
            ? `unknown item \`${raw}\`. Did you mean \`${guess}\`?`
            : `unknown item \`${raw}\`: nothing on this board is called that`,
        );
        return null;
      }

      const ids = nodeIds(owner);
      if (ids === null) {
        report(
          line,
          CODES.EB_LINK_UNKNOWN_NODE,
          `\`${end.item}\` is not a diagram, so it has no node \`${end.node!}\`; link to \`${end.item}\` itself`,
        );
        return null;
      }
      if (!ids.has(end.node!)) {
        const guess = nearest(end.node!, ids);
        report(
          line,
          CODES.EB_LINK_UNKNOWN_NODE,
          guess
            ? `\`${end.item}\` has no node \`${end.node!}\`. Did you mean \`${guess}\`?`
            : `\`${end.item}\` has no node \`${end.node!}\``,
        );
        return null;
      }
      return { item: end.item, node: end.node };
    };

    for (const link of parsed.links) {
      /* Both ends, always: two wrong ids are two mistakes, and reporting only the first would send
         the author round the loop twice. */
      const from = resolve(link.from, link.line);
      const to = resolve(link.to, link.line);
      if (from && to) out.push({ ...link, from, to });
    }
  }

  return out;
}

/**
 * The ids inside one item's body that a board link can end on: nodes and groups for a graph
 * dialect, a sequence's participants, a chart's series and slices. `null` for an item with no node
 * namespace — prose, an image, an `edges` fence, a prompt card.
 *
 * Module scope and pure so `survive.ts` can ask the same question of a body that is not on the
 * board yet; `resolveLinks` memoises around it per parse. One implementation, because a second one
 * that answered differently from what `resolveLinks` decides a moment later is the failure this
 * module exists to prevent.
 */
export function nodeIdsOf(it: Pick<BoardItem, "type" | "body" | "dir" | "aspect" | "layout">): Set<string> | null {
  /* Dispatch by name rather than through `hasGraph()`: this is the one place that has a parser
     to call for each, so the branch is where the knowledge belongs. Everywhere else the
     question is only "is this a `Graph`", and that is the predicate. */
  if (it.type === "sequence") return new Set(parseSequence(it.body).participants.map((p) => p.id));
  if (it.type === "chart") {
    /* A series and a slice both answer, because both are things a link can end on: a line
       labelled off to the side of the chart it belongs to is the commonest reason to draw one. */
    const chart = parseChart(it.body);
    return new Set([...chart.series, ...chart.slices].map((s) => s.id));
  }
  if (isDiagramType(it.type)) {
    const g = parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout);
    /* Groups as well as nodes: a link into a group anchors on the group's box, and the router
       already treats one as a node with a row. */
    if (g) return new Set([...g.nodes.map((n) => n.id), ...g.groups.map((x) => x.id)]);
  }
  return null;
}
