import { useEffect, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

import { Button, IconButton } from "@/ui/controls";
import { Tooltip } from "@/ui/Tooltip";

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
 * is the one `docs/architecture/things-that-will-bite.md` warns about twice: that attribute is *painted*, in the same statement as
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
    <div className="dag-zoombar" data-dag-zoombar="" role="toolbar" aria-label="Zoom">
      <IconButton className="dag-zoombar__step" onClick={() => onZoom(-1)} aria-label="Zoom out (−)" tip="Zoom out" shortcut="−">
        <Minus {...ICON} aria-hidden="true" />
      </IconButton>
      {/* Not a label: a control. "100%" that only reported would be the one thing on the board you
          can read and not act on, and the `0` key already means this. */}
      <Tooltip name="Back to 100%" shortcut="0">
        <Button
          variant="quiet"
          className="dag-zoombar__pct"
          data-dag-zoom-actual=""
          onClick={onActual}
          aria-label={`Zoom to 100% (currently ${Math.round(zoom * 100)}%) (0)`}
        >
          {Math.round(zoom * 100)}%
        </Button>
      </Tooltip>
      <IconButton className="dag-zoombar__step" onClick={() => onZoom(1)} aria-label="Zoom in (+)" tip="Zoom in" shortcut="+">
        <Plus {...ICON} aria-hidden="true" />
      </IconButton>
      <IconButton onClick={onFit} aria-label="Fit to content (F)" tip="Fit to content" shortcut="F">
        <Maximize2 {...ICON} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
