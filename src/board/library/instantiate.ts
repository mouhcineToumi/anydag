import type { Blueprint, Part } from "./types";

/**
 * A blueprint, rendered to the dialect's own text.
 *
 * Two passes, and the first one exists because a literal part may name an instance declared deeper
 * in the tree than itself — `${api}` at the top of an `arch` referring to a service inside a group.
 * So every id is allocated before anything is rendered, and the names bind in one flat scope: they
 * are the author's own, unique within the blueprint, and a scope per level would only mean writing
 * a path to say what a word already says.
 *
 * Holes are **delimited** — `${name}`, not `$name`. The old library wrote `$id_a` and substituted
 * `$id`, which produced `x1_a`; the result parsed only because a sequence invents a participant for
 * any id it has not seen, so an "add an alt fragment" part quietly added its messages between two
 * participants that were not on the diagram. A delimiter is the whole fix for that class.
 *
 * Four holes:
 *
 * - `${self}` — this instance's id.
 * - `${prop}` — a prop, from the `Use` or the blueprint's defaults.
 * - `${?prop}` — the same, preceded by a space when it is not empty and gone when it is. Every
 *   dialect's flags and attributes are optional trailing tokens, and this is how a statement says
 *   so without an empty prop leaving a trailing space behind.
 * - `${children}`, alone on its line — the parts, each line carrying that line's own indentation.
 *   The indent is written in the source rather than added, so the template reads like its output.
 */

/** Whether an id already occurs in some text — the boundary rules the library has always used. */
const occurs = (id: string, text: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![A-Za-z0-9_])`, "m").test(text);

const HOLE = /\$\{(\??)([A-Za-z_][A-Za-z0-9_]*)\}/g;
const CHILDREN_LINE = /^([ \t]*)\$\{children\}[ \t]*$/;

interface Node {
  bp: Blueprint;
  props: Record<string, string>;
  children: (string | Node)[];
  as?: string;
  id?: string;
  /** The id of the instance that contains this one, for `${parent}`. */
  parentId?: string;
}

export type Find = (id: string) => Blueprint | undefined;

/** An unresolved `use`, so a caller can say which one rather than rendering a hole. */
class UnknownBlueprint extends Error {
  constructor(public readonly missing: string) {
    super(`no blueprint \`${missing}\``);
  }
}

function build(bp: Blueprint, find: Find, props: Record<string, string>, parts: Part[] | undefined, as?: string): Node {
  const merged = { ...bp.props, ...props };
  const node: Node = { bp, props: merged, children: [], as };
  for (const part of parts ?? bp.parts ?? []) {
    if (typeof part === "string") {
      node.children.push(part);
      continue;
    }
    const child = find(part.use);
    if (!child) throw new UnknownBlueprint(part.use);
    node.children.push(build(child, find, part.props ?? {}, part.parts, part.as));
  }
  return node;
}

/**
 * Render a blueprint into a diagram that already says `existing`.
 *
 * `existing` is the text an allocated id must stay clear of — the body a part is being appended to,
 * or `""` for a fragment standing on its own.
 */
export function instantiate(bp: Blueprint, find: Find, existing = "", props: Record<string, string> = {}): string {
  const root = build(bp, find, props, undefined);

  const taken = new Set<string>();
  const scope = new Map<string, string>();

  /*
   * A `Use`'s props are written by the blueprint that is composing, so they are filled in *its*
   * vocabulary before the child ever sees them: `${parent}` is the container's own id — `grp1_svc`,
   * `lane1_1` — and any other name is one of the container's props, which is how an `alt` hands its
   * two branch labels down to the two messages inside it. Resolved during the pre-order allocation
   * walk, so it can only ever point upwards, and a hole naming nothing above is left for the
   * child's own source to fill.
   */
  const upward = (text: string, parent: Node | undefined): string =>
    text.replace(HOLE, (whole, optional: string, name: string) => {
      const value = name === "parent" ? parent?.id : parent?.props[name];
      if (value === undefined) return whole;
      if (!optional) return value;
      return value ? ` ${value}` : "";
    });

  const allocate = (node: Node, parent?: Node): void => {
    node.parentId = parent?.id;
    for (const [key, value] of Object.entries(node.props)) node.props[key] = upward(value, parent);
    const wanted = node.props.id;
    if (wanted) node.id = wanted;
    else if (node.bp.slot) {
      const base = node.bp.slot;
      for (let n = 1; ; n++) {
        const id = `${base}${n}`;
        if (!taken.has(id) && !occurs(id, existing)) {
          node.id = id;
          break;
        }
      }
    }
    if (node.id) taken.add(node.id);
    if (node.as && node.id) scope.set(node.as, node.id);
    for (const child of node.children) if (typeof child !== "string") allocate(child, node);
  };
  allocate(root);

  const fill = (text: string, node: Node): string =>
    text.replace(HOLE, (whole, optional: string, name: string) => {
      const value = name === "self" ? node.id : name === "parent" ? node.parentId : (node.props[name] ?? scope.get(name));
      if (value === undefined) return whole;
      if (!optional) return value;
      return value ? ` ${value}` : "";
    });

  const render = (node: Node): string => {
    const kids = node.children.map((child) => (typeof child === "string" ? fill(child, node) : render(child)));
    if (node.bp.source === undefined) return kids.join("\n");

    const out: string[] = [];
    for (const line of node.bp.source.split("\n")) {
      const slot = CHILDREN_LINE.exec(line);
      if (!slot) {
        out.push(fill(line, node));
        continue;
      }
      const indent = slot[1] ?? "";
      for (const kid of kids.join("\n").split("\n")) out.push(kid ? `${indent}${kid}` : "");
    }
    return out.join("\n");
  };

  return render(root);
}

/** Every blueprint an instance of this one would pull in, deepest last, for the panel's tree. */
export function partsOf(bp: Blueprint, find: Find): Blueprint[] {
  const out: Blueprint[] = [];
  const walk = (parts: Part[] | undefined): void => {
    for (const part of parts ?? []) {
      if (typeof part === "string") continue;
      const child = find(part.use);
      if (!child) continue;
      out.push(child);
      walk(part.parts ?? child.parts);
    }
  };
  walk(bp.parts);
  for (const id of bp.madeOf ?? []) {
    const child = find(id);
    if (child) out.push(child);
  }
  return out;
}

/** What a `Use` names, for the checker: every id reachable from this blueprint's own parts. */
export function usesOf(bp: Blueprint): string[] {
  const out: string[] = [];
  const walk = (parts: Part[] | undefined): void => {
    for (const part of parts ?? []) {
      if (typeof part === "string") continue;
      out.push(part.use);
      walk(part.parts);
    }
  };
  walk(bp.parts);
  return out;
}
