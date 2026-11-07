import type { PointerEvent as ReactPointerEvent } from "react";

import type { MarkerAt, RoutedEdge } from "@/layout/types";
import type { Theme } from "@/theme/contract";

/**
 * The edge layer: one SVG under the cards, `pointer-events: none`, emitted before them so DOM order
 * alone does the stacking, no z-index anywhere.
 *
 * Markers are drawn as explicit paths rather than SVG `<marker>` elements. Each one needs its own
 * hue and its own opacity (the body sits at 0.72, the head at 1, so an arrow reads as a terminus
 * rather than fading with its line), and a hollow triangle needs filling with whatever surface it
 * happens to sit on. `context-stroke` would cover one of those three and is unreliable besides.
 */

interface Props {
  edges: RoutedEdge[];
  width: number;
  height: number;
  theme: Theme;
  /**
   * Make each line pickable, and ring the one that is picked.
   *
   * A line is a hairline nobody can hit, so `onPick` also brings a hit target: a stroke twenty
   * times as wide, invisible, over the top of it. Absent under `?snapshot=1`, which is what keeps
   * a photographed board free of hit strokes it would never use.
   *
   * **`picked` is the board layer's alone.** A board link is React state on the one component that
   * draws all of them (`BoardEdges`); a diagram's edges belong to a memoised `Item`, so which one
   * is picked reaches them as a painted `data-dag-picked` instead — see `paint()` in `useEditor`.
   * Left `undefined` on both sides of a diff, React writes nothing here, so the paint stands.
   */
  onPick?(id: string): void;
  picked?: string | null;
  /**
   * Bend the picked line through a point: a handle at its middle, pulled.
   *
   * **The board layer's alone**, and passed by `BoardEdges` only. A diagram's edges run between
   * cards ELK placed, so a point pinned on the line between two of them is a claim the next
   * relayout would make false — the same refusal a diagram's resize handle makes by writing
   * `aspect=` rather than a width. `Edges` draws the circle and forwards the press; what a drag
   * *means* is `ctl.bendLink`'s, which is where every other gesture's meaning lives.
   */
  onBend?(id: string, e: ReactPointerEvent<SVGCircleElement>): void;
  /** Straighten it again. Double-click, on the handle, because the handle is the thing to undo. */
  onStraighten?(id: string): void;
}

const hueVar = (hue: string | undefined) => (hue ? `var(--dag-color-hues-${hue})` : "var(--dag-color-slate)");

function markerPath(mk: MarkerAt, theme: Theme): JSX.Element | null {
  const m = theme.metric.edge;
  const deg = (mk.angle * 180) / Math.PI;
  const transform = `translate(${mk.x} ${mk.y}) rotate(${deg})`;
  /* Every shape is drawn pointing along +x from the origin and rotated into place: one geometry per
     marker instead of one per marker per direction. */
  switch (mk.kind) {
    case "chevron":
      return (
        <path
          transform={transform}
          d={`M${-m.chevron.len},${-m.chevron.half} L0,0 L${-m.chevron.len},${m.chevron.half}`}
          fill="none"
        />
      );
    case "open":
      return (
        <path
          transform={transform}
          d={`M${-m.chevron.len},${-m.chevron.half} L0,0 L${-m.chevron.len},${m.chevron.half}`}
          fill="none"
        />
      );
    case "one":
      return <circle transform={transform} cx={0} cy={0} r={m.dotR} strokeWidth={0} />;
    case "crow":
      return (
        <path
          transform={transform}
          d={`M${-m.crow.len},0 L0,0 M${-m.crow.len},0 L0,${-m.crow.spread} M${-m.crow.len},0 L0,${m.crow.spread}`}
          fill="none"
        />
      );
    case "triangle":
      return (
        <path transform={transform} d={`M0,0 L${-m.triangle.h},${-m.triangle.w / 2} L${-m.triangle.h},${m.triangle.w / 2} Z`} />
      );
    case "diamond":
      return (
        <path
          transform={transform}
          d={`M0,0 L${-m.diamond.h / 2},${-m.diamond.w / 2} L${-m.diamond.h},0 L${-m.diamond.h / 2},${m.diamond.w / 2} Z`}
        />
      );
    case "diamond-hollow":
      return (
        <path
          transform={transform}
          d={`M0,0 L${-m.diamond.h / 2},${-m.diamond.w / 2} L${-m.diamond.h},0 L${-m.diamond.h / 2},${m.diamond.w / 2} Z`}
        />
      );
    default:
      return null;
  }
}

const surfaceFill = (surface: MarkerAt["surface"]) =>
  surface === "group" ? "var(--dag-color-paper100)" : surface === "card" ? "var(--dag-color-card)" : "var(--dag-color-paper)";

export function Edges({ edges, width, height, theme, onPick, picked, onBend, onStraighten }: Props) {
  const m = theme.metric.edge;
  /* How hard the line is laid down is a colour decision, not a geometric one — see `ThemeColor`. */
  const op = theme.color.opacity;

  return (
    <svg className="dag-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {edges.map((e) => {
        const colour = e.danger ? "var(--dag-color-danger)" : hueVar(e.hue);
        const stroke = e.quiet ? m.quiet.stroke : m.stroke;
        const opacity = e.quiet ? op.edgeQuiet : op.edge;
        const markOpacity = e.quiet ? op.markerQuiet : op.marker;

        return (
          <g key={e.id} data-dag-edge={e.id} data-dag-picked={picked === e.id ? "" : undefined}>
            {onPick ? (
              <path
                className="dag-edge-hit"
                d={e.d}
                fill="none"
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onPick(e.id);
                }}
              />
            ) : null}
            <path
              className="dag-edge-line"
              d={e.d}
              fill="none"
              stroke={colour}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={e.dash ? m.dash : undefined}
              opacity={opacity}
            />
            {(
              [
                ["tail", e.tail],
                ["head", e.head],
              ] as const
            ).map(([which, mk]) =>
              mk ? (
                <g
                  key={which}
                  data-dag-marker={which}
                  stroke={colour}
                  strokeWidth={e.quiet ? m.quiet.markerStroke : stroke}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={markOpacity}
                  fill={mk.kind === "triangle" || mk.kind === "diamond-hollow" ? surfaceFill(mk.surface) : colour}
                >
                  {markerPath(mk, theme)}
                </g>
              ) : null,
            )}
            {e.junction ? (
              <circle cx={e.junction.x} cy={e.junction.y} r={m.bus.junctionR} fill={colour} opacity={op.junction} />
            ) : null}
          </g>
        );
      })}

      {/* The bend handle, over the lines and under the labels: it is only ever drawn for the one
          line that is picked, and a label it covered would be that line's own. `.dag-edges` takes
          no pointer, so the circle puts it back on itself — the rule `.dag-edge-hit` already
          follows one element up, and its radius comes from `chrome.css` for that one's reason
          too: no theme has an opinion about how big a thing you drag is. */}
      {onBend
        ? edges.map((e) =>
            picked === e.id && e.mid ? (
              <circle
                key={`${e.id}-bend`}
                className="dag-bend-handle"
                data-dag-bend={e.id}
                cx={e.mid.x}
                cy={e.mid.y}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onBend(e.id, ev);
                }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  onStraighten?.(e.id);
                }}
              >
                <title>Drag to bend this line; double-click to straighten it</title>
              </circle>
            ) : null,
          )
        : null}

      {/* Labels last, so they sit over the lines they belong to. */}
      {edges.map((e) =>
        e.label ? (
          <text
            key={`${e.id}-label`}
            data-dag-edge-label={e.id}
            className={[
              "dag-edge-label",
              e.label.mono === false ? "dag-edge-label--prose" : "",
              /* The router has always recorded which surface a label lands on; nothing read it
                 until the halo needed to know what colour to paint out. */
              e.label.surface === "group" ? "dag-edge-label--on-group" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            x={e.label.x}
            y={e.label.y}
            textAnchor={e.label.anchor}
            dominantBaseline="middle"
          >
            {e.label.text2 ? (
              <>
                {/* The router puts `y` one `labelOffset` off the line, room for one line of
                    text. A second line has to go *up* from there, not down: the technology
                    chip used to hang a line below the anchor, which is exactly where the edge
                    runs, and every C4 chip was struck through by its own line. */}
                <tspan x={e.label.x} dy={-(theme.type.edgeLabel + 2)}>
                  {e.label.text}
                </tspan>
                <tspan className="dag-edge-label__tech" x={e.label.x} dy={theme.type.edgeLabel + 2}>
                  {e.label.text2}
                </tspan>
              </>
            ) : (
              e.label.text
            )}
          </text>
        ) : null,
      )}
    </svg>
  );
}
