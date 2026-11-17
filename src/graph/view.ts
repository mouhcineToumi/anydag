/**
 * A graph **view**: everything a person chose on the graph page, as plain data the page remembers
 * as JSON (#457). It names fields and values by key, never by index, so a view kept from yesterday
 * still means the same thing after the vault moved.
 *
 * The defaults are the one place on the page's side where a field is named (`kind`); the model
 * (`model.ts`, `palette.ts`) reads whatever field a view names.
 *
 * Pure: no DOM, no React, no `@/` alias.
 */

/**
 * One filter over one field. A document passes when at least one of its values is allowed: `hide`
 * takes values out, so a value the vault gains later is shown; `only` keeps the named values and
 * nothing else, so a later one is not. `""` is the value of a document with none. On a `tree` field
 * a key covers everything under it.
 */
export interface GraphRule {
  field: string;
  hide?: string[];
  only?: string[];
}

/** The layout's sliders, each a position `simForces` maps to a force (#458). */
export interface GraphForces {
  repel: number;
  link: number;
  pull: number;
  centre: number;
  tight: number;
  gap: number;
}

export interface GraphView {
  /** The field whose values colour the dots. */
  colourBy: string;
  /** A field key, `GROUP_BY_LINKS` (clusters found from the links), or `null` for no grouping. */
  groupBy: string | null;
  /** Every rule must pass for a document to be shown. */
  rules: GraphRule[];
  /** Whether documents with no link at all are shown. */
  orphans: boolean;
  forces: GraphForces;
}

/** `groupBy`'s one value that is not a field: the clusters the links make. No field is keyed so. */
export const GROUP_BY_LINKS = "links";

/** A rule's value for "has none". */
export const NONE = "";

export const DEFAULT_FORCES: Readonly<GraphForces> = { repel: 0, link: 0, pull: 0, centre: 0, tight: 0.5, gap: 0.3 };

/**
 * Where each slider can go. The four forces are a position either side of the picture as designed
 * (0), and each is a power of its own base, so a step reads as much at either end; the two group
 * forces are already the simulation's own 0 to 1.
 */
export const FORCE_RANGE: Readonly<Record<keyof GraphForces, readonly [number, number]>> = {
  repel: [-1, 1],
  link: [-1, 1],
  pull: [-1, 1],
  centre: [-1, 1],
  tight: [0, 1],
  gap: [0, 1],
};

/** Each force's base: at slider `v` the force is `base ** v` times the one designed (`sim.ts`'s 1). */
const FORCE_BASE = { repel: 4, link: 3, pull: 4, centre: 6 } as const;

/** What the simulation is handed: its own multipliers (`Forces` in `sim.ts`, kept structural here). */
export interface SimForces {
  repel: number;
  link: number;
  pull: number;
  centre: number;
  tight: number;
  gap: number;
}

const within = (k: keyof GraphForces, v: number): number => {
  const [lo, hi] = FORCE_RANGE[k];
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : DEFAULT_FORCES[k]));
};

/**
 * The view's slider positions as the simulation's forces: `repel = 4^v`, `link = 3^v`, `pull = 4^v`,
 * `centre = 6^v`, and `tight` and `gap` as they are — but 0 when nothing is grouped, where they
 * would do nothing anyway and a link between "groups" must not be told it crosses one.
 */
export function simForces(view: Pick<GraphView, "forces" | "groupBy">): SimForces {
  const f = view.forces;
  const grouped = view.groupBy !== null;
  return {
    repel: FORCE_BASE.repel ** within("repel", f.repel),
    link: FORCE_BASE.link ** within("link", f.link),
    pull: FORCE_BASE.pull ** within("pull", f.pull),
    centre: FORCE_BASE.centre ** within("centre", f.centre),
    tight: grouped ? within("tight", f.tight) : 0,
    gap: grouped ? within("gap", f.gap) : 0,
  };
}

/** Coloured by kind, grouped by nothing, attachments hidden, orphans shown. */
export const DEFAULT_VIEW: Readonly<GraphView> = {
  colourBy: "kind",
  groupBy: null,
  rules: [{ field: "kind", hide: ["attachment"] }],
  orphans: true,
  forces: DEFAULT_FORCES,
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : undefined;

function ruleOf(raw: unknown): GraphRule | null {
  if (!isObject(raw) || typeof raw.field !== "string") return null;
  const hide = keys(raw.hide);
  const only = keys(raw.only);
  return { field: raw.field, ...(hide ? { hide } : {}), ...(only ? { only } : {}) };
}

/**
 * A remembered view, read leniently: what is missing or malformed is the default's, so a view kept
 * by an older page, or edited by hand, still opens. A field the vault no longer has is the model's
 * to pass over, not this.
 */
export function viewOf(raw: unknown): GraphView {
  const v = isObject(raw) ? raw : {};
  const forces = isObject(v.forces) ? v.forces : {};
  const force = (k: keyof GraphForces): number => {
    const x = forces[k];
    return typeof x === "number" && Number.isFinite(x) ? x : DEFAULT_FORCES[k];
  };
  return {
    colourBy: typeof v.colourBy === "string" ? v.colourBy : DEFAULT_VIEW.colourBy,
    groupBy: typeof v.groupBy === "string" ? v.groupBy : v.groupBy === null ? null : DEFAULT_VIEW.groupBy,
    rules: Array.isArray(v.rules)
      ? v.rules.map(ruleOf).filter((r): r is GraphRule => r !== null)
      : DEFAULT_VIEW.rules.map((r) => ({ ...r })),
    orphans: typeof v.orphans === "boolean" ? v.orphans : DEFAULT_VIEW.orphans,
    forces: {
      repel: force("repel"),
      link: force("link"),
      pull: force("pull"),
      centre: force("centre"),
      tight: force("tight"),
      gap: force("gap"),
    },
  };
}
