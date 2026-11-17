import { forwardRef, useMemo } from "react";
import { X } from "lucide-react";

import { chipsOf, dropRules, legendOf, onlyValue, orphansOf, toggleValue } from "@/graph/legend";
import type { Graph } from "@/graph/model";
import type { Palette } from "@/graph/palette";
import { DEFAULT_FORCES, FORCE_RANGE, GROUP_BY_LINKS, type GraphForces, type GraphView } from "@/graph/view";
import { Button } from "@/ui/controls";

import { slotColour } from "./look";

/**
 * The Graph page's panel (#459): what colours the graph, which of its values are shown, and how it is
 * laid out. **It names no field**: *Colour by* and *Group by* list whatever fields the server sent,
 * by their own labels, so a field added to the server later appears here with no change. Every
 * control is a real control with a name.
 */

const ICON = { size: 12, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SLIDER_STEP = 0.02;

/** The four forces and the two group forces, in the order they are listed, with what each is called. */
const FORCES: readonly { key: keyof GraphForces; label: string; grouped?: true }[] = [
  { key: "repel", label: "Space between files" },
  { key: "link", label: "Link length" },
  { key: "pull", label: "Link pull" },
  { key: "centre", label: "Pull to the centre" },
];
const GROUP_FORCES: readonly { key: keyof GraphForces; label: string }[] = [
  { key: "tight", label: "Group tightness" },
  { key: "gap", label: "Space between groups" },
];

/** `groupBy`'s `<select>` value for "nothing": no field is keyed so. */
const NOTHING = "";

const count = (n: number) => n.toLocaleString("en-GB");

export interface PanelProps {
  graph: Graph;
  view: GraphView;
  palette: Palette | null;
  /** What is shown, and the groups the layout has. */
  shownFiles: number;
  shownLinks: number;
  groups: number;
  /** A change to what is shown or how it is coloured. */
  onView(next: GraphView): void;
  /** A change to the layout: forces and groups. `reset` says it was *Reset the layout*. */
  onLayout(next: GraphView, reset?: boolean): void;
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { graph, view, palette, shownFiles, shownLinks, groups, onView, onLayout },
  ref,
) {
  const rows = useMemo(() => (palette ? legendOf(graph, view, palette) : []), [graph, view, palette]);
  const chips = useMemo(() => chipsOf(graph, view), [graph, view]);
  const orphans = useMemo(() => orphansOf(graph), [graph]);
  const field = graph.field.get(view.colourBy);
  const grouped = view.groupBy !== null;
  const groupBy = view.groupBy ?? NOTHING;
  const setForce = (key: keyof GraphForces, value: number) => onLayout({ ...view, forces: { ...view.forces, [key]: value } });

  const slider = ({ key, label }: { key: keyof GraphForces; label: string }, off = false) => {
    const [min, max] = FORCE_RANGE[key];
    return (
      <label key={key} className="dag-graph__slider" data-off={off ? "" : undefined}>
        <span>{label}</span>
        <input
          type="range"
          className="dag-graph__range"
          data-dag-graph-force={key}
          min={min}
          max={max}
          step={SLIDER_STEP}
          value={view.forces[key]}
          disabled={off}
          onChange={(e) => setForce(key, Number(e.target.value))}
        />
      </label>
    );
  };

  return (
    <aside ref={ref} className="dag-graph__panel" data-dag-graph-panel="" aria-label="Graph settings">
      <h2 className="dag-graph__title">Graph</h2>
      <p className="dag-graph__counts" data-dag-graph-counts="">
        {count(shownFiles)} of {count(graph.n)} files · {count(shownLinks)} links
        {groups ? ` · ${count(groups)} groups` : ""}
      </p>
      {chips.length ? (
        <div className="dag-graph__chips">
          {chips.map((c) => (
            <button
              key={c.field}
              type="button"
              className="dag-graph__chip"
              data-dag-graph-chip={c.field}
              aria-label={`${c.label}: ${c.shown} of ${c.total} shown. Show them all`}
              title="Take this filter off"
              onClick={() => onView(dropRules(view, c.field))}
            >
              <span>{c.label}</span>
              <span className="dag-graph__chipcount">
                {c.shown} of {c.total}
              </span>
              <X {...ICON} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <details className="dag-graph__section" open>
        <summary className="dag-graph__summary">Colour and filter</summary>
        <label className="dag-graph__field">
          <span>Colour by</span>
          <select
            className="dag-select"
            data-dag-graph-colour-by=""
            value={field ? view.colourBy : ""}
            onChange={(e) => onView({ ...view, colourBy: e.target.value })}
          >
            {field ? null : <option value="">—</option>}
            {graph.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <ul className="dag-graph__legend" aria-label={field ? `${field.label}: press a value to show or hide it` : "Legend"}>
          {rows.map((r) => (
            <li key={r.key} className="dag-graph__value" data-dag-graph-value={r.key}>
              <button
                type="button"
                className="dag-graph__row"
                aria-pressed={r.shown}
                data-dag-graph-toggle=""
                onClick={() => onView(toggleValue(graph, view, view.colourBy, r.key))}
              >
                <span className="dag-graph__dot" style={{ background: slotColour(r.slot) }} aria-hidden="true" />
                <span className="dag-graph__name">{r.label}</span>
                <span className="dag-graph__count">{count(r.count)}</span>
              </button>
              <button
                type="button"
                className="dag-graph__only"
                data-dag-graph-only=""
                aria-label={`Only ${r.label}`}
                onClick={() => onView(onlyValue(graph, view, view.colourBy, r.key))}
              >
                Only
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="dag-graph__row dag-graph__row--orphans"
          aria-pressed={view.orphans}
          data-dag-graph-orphans=""
          onClick={() => onView({ ...view, orphans: !view.orphans })}
        >
          <span className="dag-graph__dot dag-graph__dot--hollow" aria-hidden="true" />
          <span className="dag-graph__name">Files with no links</span>
          <span className="dag-graph__count">{count(orphans)}</span>
        </button>
      </details>

      <details className="dag-graph__section" open>
        <summary className="dag-graph__summary">Layout</summary>
        {FORCES.map((f) => slider(f))}
        <label className="dag-graph__field">
          <span>Group by</span>
          <select
            className="dag-select"
            data-dag-graph-group-by=""
            value={groupBy}
            onChange={(e) => onLayout({ ...view, groupBy: e.target.value === NOTHING ? null : e.target.value })}
          >
            <option value={NOTHING}>Nothing</option>
            <option value={GROUP_BY_LINKS}>Linked clusters</option>
            {graph.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {GROUP_FORCES.map((f) => slider(f, !grouped))}
        <Button
          variant="quiet"
          size="sm"
          className="dag-graph__reset"
          data-dag-graph-reset=""
          onClick={() => onLayout({ ...view, forces: { ...DEFAULT_FORCES } }, true)}
        >
          Reset the layout
        </Button>
      </details>
    </aside>
  );
});
