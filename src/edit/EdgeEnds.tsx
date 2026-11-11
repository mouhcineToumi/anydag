import { X } from "lucide-react";

import { addEdgeEnd, appendHop, dropHop, edgeEnds, edgeSpan, removeEdgeEnd, setEdgeEnd, type EdgeSide } from "@/dsl/restate";

/** What an end may name, in menu sections: a heading and the ids under it. Empty sections are left out. */
export type EndChoices = readonly (readonly [string, readonly string[]])[];

/**
 * The ends of a picked edge: what it leaves, what it arrives at, and where it goes on from there.
 *
 * Three forms of edge the connect handle cannot say by itself, each one control:
 *
 * - **A bus and a fan** — `a & b --> c`, `f --> a & b`. Each end is a list; the select beside the
 *   list adds an id to it and the cross beside an id takes it off. One statement, so the router
 *   draws one trunk with one label, which a line per pair cannot.
 * - **A chain** — `a --> b --> c`. "Then" appends a hop wearing the chain's own arrow, and "Last hop"
 *   takes it off again. Both act on the end of the *statement*, whichever hop is picked, because a
 *   chain has one end and the person who has just carried it on is still looking at the first hop.
 * - **A group or a row** — `workspace --> intake`, `api.content --> store`. Every select offers what
 *   the caller hands it in `choices`: for a diagram its cards, then its groups, then its rows; for a
 *   board link the items on the page, then each diagram's cards as `item.node`.
 *
 * It writes the one line it was handed and nothing else, through the span writers in `restate.ts`
 * — which is also why it renders nothing for a line it cannot read.
 */
export function EdgeEnds({
  choices,
  src,
  seg,
  onLine,
  onOut,
}: {
  /** What each end may name, read by the caller from the draft it is showing. */
  choices: EndChoices;
  /** The picked statement's line, as it is now. */
  src: string;
  seg: number;
  onLine(next: string): void;
  /** Let go of the pick: what the picked hop was, once it is the one taken off. */
  onOut(): void;
}) {
  const e = edgeSpan(src);
  if (!e) return null;
  const known = new Set(choices.flatMap(([, ids]) => ids));
  /* The chain's own spelling, from its last arrow: that is where a new hop is added, whichever
     segment is picked — the statement has one end, and it is not necessarily this segment's. */
  const arrow = e.arrows[e.arrows.length - 1]?.value ?? "-->";
  const lastPicked = seg === e.arrows.length - 1;

  const options = (taken: string[], keep?: string) => {
    const free = (ids: string[]) => ids.filter((id) => !taken.includes(id) || id === keep);
    return choices
      .map(([label, ids]) => [label, free([...ids])] as const)
      .filter(([, ids]) => ids.length > 0)
      .map(([label, ids], i) => (
        <optgroup key={`${i}:${label}`} label={label}>
          {ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      ));
  };

  const end = (side: EdgeSide) => {
    const ids = edgeEnds(src, seg, side);
    const noun = side === "from" ? "source" : "target";
    return (
      <div className="dag-props__ends" data-dag-prop-ends={side} key={side}>
        <span className="dag-props__tag">{side === "from" ? "From" : "To"}</span>
        {ids.map((id, i) => (
          <span className="dag-props__end" key={`${i}:${id}`}>
            <select
              className="dag-select dag-props__id"
              data-dag-prop-end={`${side}:${i}`}
              aria-label={`${noun} ${i + 1}`}
              value={id}
              onChange={(ev) => onLine(setEdgeEnd(src, seg, side, i, ev.target.value))}
            >
              {/* The current id is always offered, even where the diagram does not declare it: a
                  menu that cannot show what the line says would claim the line says something else. */}
              {known.has(id) ? null : <option value={id}>{id}</option>}
              {options(ids, id)}
            </select>
            {ids.length > 1 ? (
              <button
                type="button"
                className="dag-icon dag-icon--tiny"
                data-dag-prop-end-remove={`${side}:${i}`}
                aria-label={`Remove ${id}`}
                title={`Take ${id} off this ${noun} list`}
                onClick={() => onLine(removeEdgeEnd(src, seg, side, i))}
              >
                <X size={14} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
        <select
          className="dag-select dag-props__id dag-props__id--add"
          data-dag-prop-end-add={side}
          aria-label={`Add a ${noun}`}
          title={side === "from" ? "Add a source: several sources converge on one trunk" : "Add a target: one source fans out"}
          value=""
          onChange={(ev) => ev.target.value && onLine(addEdgeEnd(src, seg, side, ev.target.value))}
        >
          <option value="">+ {noun}</option>
          {options(ids)}
        </select>
      </div>
    );
  };

  return (
    <div className="dag-props__edgeends" data-dag-props-ends="">
      {end("from")}
      {end("to")}
      <div className="dag-props__ends" data-dag-prop-hops="">
        <span className="dag-props__tag">Then</span>
        <select
          className="dag-select dag-props__id dag-props__id--add"
          data-dag-prop-hop-add=""
          aria-label="Carry the chain on to"
          title="Carry this on: a --> b becomes a --> b --> c"
          value=""
          onChange={(ev) => ev.target.value && onLine(appendHop(src, ev.target.value, arrow))}
        >
          <option value="">→ continue to…</option>
          {options([])}
        </select>
        {e.arrows.length > 1 ? (
          <button
            type="button"
            className="dag-props__add"
            data-dag-prop-hop-drop=""
            title="Take the last arrow of the chain off"
            onClick={() => {
              onLine(dropHop(src));
              /* Taking off the hop that is picked leaves a pick of nothing, so it lets go. */
              if (lastPicked) onOut();
            }}
          >
            <X size={14} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" /> Last hop
          </button>
        ) : null}
      </div>
    </div>
  );
}
