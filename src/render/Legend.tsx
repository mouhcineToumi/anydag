import type { LegendEntry } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

/**
 * The legend explains encodings, never content.
 *
 * An entry earns its place only when a reader could not work the mark out — dashed meaning "a
 * different clock" needs saying; a crow's foot does not.
 *
 * Every line glyph draws with the same theme values `Edges` draws with. It used to copy them —
 * `1.5`, `0.72`, `"5 6"` written out, which are `paper`' numbers — so under `neutral`, whose
 * edges are thinner, softer and dashed differently, the legend described a stroke that appeared
 * nowhere in the diagram it sat under. A legend that can disagree with its own diagram is worse
 * than no legend.
 */
function Line({ theme, stroke, opacity, dash }: { theme: Theme; stroke: number; opacity: number; dash?: string }) {
  const { glyphW, glyphH } = theme.metric.legend;
  const mid = glyphH / 2;
  return (
    <svg width={glyphW} height={glyphH} viewBox={`0 0 ${glyphW} ${glyphH}`} aria-hidden="true">
      <path
        d={`M1,${mid} L${glyphW - 1},${mid}`}
        stroke="var(--dag-color-slate)"
        strokeWidth={stroke}
        strokeDasharray={dash}
        opacity={opacity}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

const GLYPHS: Record<string, (theme: Theme) => JSX.Element> = {
  solid: (t) => <Line theme={t} stroke={t.metric.edge.stroke} opacity={t.color.opacity.edge} />,
  dashed: (t) => <Line theme={t} stroke={t.metric.edge.stroke} opacity={t.color.opacity.edge} dash={t.metric.edge.dash} />,
  quiet: (t) => <Line theme={t} stroke={t.metric.edge.quiet.stroke} opacity={t.color.opacity.edgeQuiet} />,
  external: () => <span className="dag-legend__swatch dag-legend__swatch--external" />,
  done: () => <span className="dag-legend__swatch dag-legend__swatch--done" />,
  wait: () => <span className="dag-legend__swatch dag-legend__swatch--wait" />,
  stop: () => <span className="dag-legend__swatch dag-legend__swatch--stop" />,
  port: () => <span className="dag-legend__port">a row is a port</span>,
};

export function Legend({ entries, theme }: { entries: LegendEntry[]; theme: Theme }) {
  return (
    <footer className="dag-legend">
      {entries.map((e, i) => {
        const glyph = GLYPHS[e.glyph];
        return (
          <span className="dag-legend__item" key={i}>
            {glyph ? glyph(theme) : <span className="dag-legend__swatch" />}
            <span className="dag-legend__text">{e.text}</span>
          </span>
        );
      })}
    </footer>
  );
}
