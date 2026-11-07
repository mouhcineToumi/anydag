import { useEffect, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

/**
 * Zoom, in the corner, away from everything that makes something.
 *
 * Both references agree on this and for the same reason: zoom is navigation, not creation, so it
 * belongs where the hand already is rather than in a row of tools. It is the bottom *right*, which
 * is Miro's corner — tldraw's is the left, and the left is where our board list already opens.
 *
 * **The percentage does not come through a prop.** `Viewport` has carried an `onZoom` callback
 * since M12 that nothing used, and the obvious thing — holding the zoom in `App` — would re-render
 * every child of `App` on every wheel step, which is the exact cost `data-zoom` was invented to
 * avoid. So the figure arrives on a `dag:zoom` document event, the way a drag publishes its moving
 * boxes on `dag:links-preview` and a tidy reports on `dag:tidy`, and only this component re-renders.
 *
 * Reading `data-zoom` off the viewport instead would have been the other tempting shortcut, and it
 * is the one `CLAUDE.md` warns about twice: that attribute is *painted*, in the same statement as
 * the transform it describes, precisely because as rendered state it is a frame stale.
 */

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ZoomBar({ onZoom, onFit, onActual }: { onZoom(dir: 1 | -1): void; onFit(): void; onActual(): void }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const on = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    document.addEventListener("dag:zoom", on);
    return () => document.removeEventListener("dag:zoom", on);
  }, []);
  return (
    <div className="dag-zoombar" data-dag-zoombar="" role="group" aria-label="Zoom">
      <button className="dag-icon dag-zoombar__step" onClick={() => onZoom(-1)} aria-label="Zoom out (−)" title="Zoom out (−)">
        <Minus {...ICON} aria-hidden="true" />
      </button>
      {/* Not a label: a control. "100%" that only reported would be the one thing on the board you
          can read and not act on, and the `0` key already means this. */}
      <button
        className="dag-zoombar__pct"
        data-dag-zoom-actual=""
        onClick={onActual}
        aria-label={`Zoom to 100% (currently ${Math.round(zoom * 100)}%) (0)`}
        title="Back to 100% (0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className="dag-icon dag-zoombar__step" onClick={() => onZoom(1)} aria-label="Zoom in (+)" title="Zoom in (+)">
        <Plus {...ICON} aria-hidden="true" />
      </button>
      <button className="dag-icon" onClick={onFit} aria-label="Fit to content (F)" title="Fit to content (F)">
        <Maximize2 {...ICON} aria-hidden="true" />
      </button>
    </div>
  );
}
