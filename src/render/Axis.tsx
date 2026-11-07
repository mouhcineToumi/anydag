import type { Placed } from "@/layout/types";
import type { Theme } from "@/theme/contract";

/**
 * A timeline's date scale.
 *
 * A hairline with a tick per month, quarter or year — whichever keeps the labels apart, decided in
 * the layout. A January tick is drawn heavier and labelled with the year, so a multi-year timeline
 * reads at two levels without a second axis.
 */
export function Axis({ axis, width, theme }: { axis: NonNullable<Placed["axis"]>; width: number; theme: Theme }) {
  const a = theme.metric.axis;
  const hair = theme.metric.line.hair;
  const h = axis.y + a.pad;
  return (
    <svg className="dag-axis" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
      <path d={`M0,${axis.y} L${width},${axis.y}`} stroke="var(--dag-color-outline)" strokeWidth={hair} fill="none" />
      {axis.ticks.map((t, i) => (
        <g key={i}>
          <path
            d={`M${t.x},${axis.y} L${t.x},${axis.y + (t.major ? a.tickMajor : a.tickMinor)}`}
            stroke={t.major ? "var(--dag-color-slate)" : "var(--dag-color-outline)"}
            strokeWidth={hair}
            fill="none"
          />
          <text
            className={t.major ? "dag-axis__label dag-axis__label--major" : "dag-axis__label"}
            x={t.x}
            y={axis.y + a.labelY}
            textAnchor="middle"
          >
            {t.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
