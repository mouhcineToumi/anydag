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

/** The layout's sliders, each a position the simulation maps to a force (#458). */
interface GraphForces {
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

const DEFAULT_FORCES: Readonly<GraphForces> = { repel: 0, link: 0, pull: 0, centre: 0, tight: 0.5, gap: 0.3 };

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
