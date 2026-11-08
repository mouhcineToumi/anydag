import type { Participant } from "@/dsl/sequence";
import type { SeqPlaced } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "./hue";
import { Edges } from "./Edges";
import { Icon, iconFor, tileClass } from "./Icon";

/**
 * The sequence view.
 *
 * Its own component because the furniture is unlike anything else on a board: vertical lifelines,
 * activation bars that say who is busy and for how long, and fragment boxes that must be *unfilled*
 * so the lifelines run through them. That last one is why a fragment is not the group component —
 * a group is a tint, and a tint here would hide the diagram it is meant to bracket.
 *
 * Messages reuse `Edges` unchanged: a message is a path with a marker and a label, which is exactly
 * what that component already draws.
 */
export function SequenceView({ placed, participants, theme }: { placed: SeqPlaced; participants: Participant[]; theme: Theme }) {
  const s = theme.metric.seq;
  const hair = theme.metric.line.hair;

  return (
    <div className="dag-diagram" style={{ width: placed.size.w, height: placed.size.h }}>
      <svg
        className="dag-edges"
        width={placed.size.w}
        height={placed.size.h}
        viewBox={`0 0 ${placed.size.w} ${placed.size.h}`}
        aria-hidden="true"
      >
        {placed.lifelines.map((l) => (
          <path
            key={l.id}
            d={`M${l.x},${l.y0} L${l.x},${l.y1}`}
            stroke="var(--dag-color-outline)"
            strokeWidth={hair}
            strokeDasharray={s.lifelineDash}
            fill="none"
          />
        ))}

        {placed.fragments.map((f, i) => (
          <g key={i}>
            <rect
              x={f.box.x}
              y={f.box.y}
              width={f.box.w}
              height={f.box.h}
              rx={s.fragmentR}
              fill="none"
              stroke="var(--dag-color-outline)"
              strokeWidth={hair}
            />
            {f.dividers.map((y, j) => (
              <path
                key={j}
                d={`M${f.box.x},${y} L${f.box.x + f.box.w},${y}`}
                stroke="var(--dag-color-outline)"
                strokeWidth={hair}
                strokeDasharray={s.dividerDash}
                fill="none"
              />
            ))}
          </g>
        ))}

        {placed.activations.map((a, i) => (
          <rect
            key={i}
            x={a.x}
            y={a.y0}
            width={s.activationW}
            height={Math.max(s.activationW, a.y1 - a.y0)}
            rx={s.activationR}
            className={a.hue ? "dag-activation dag-activation--hued" : "dag-activation"}
            style={hueVars(a.hue)}
            strokeWidth={hair}
          />
        ))}
      </svg>

      <Edges edges={placed.messages} width={placed.size.w} height={placed.size.h} theme={theme} />

      {/* Tabs are DOM so the operator and its condition can sit side by side with a paper halo,
          which is fiddly in SVG and free here. */}
      {placed.fragments.map((f, i) =>
        f.tabs.map((tab, j) => (
          <div className="dag-frag-tab" key={`${i}-${j}`} style={{ left: f.box.x + s.tabInset, top: tab.y }}>
            <span className="dag-frag-tab__kind">{tab.kind}</span>
            {tab.text ? <span className="dag-frag-tab__cond">{tab.text}</span> : null}
          </div>
        )),
      )}

      {participants.map((p) => {
        const box = placed.participants[p.id];
        if (!box) return null;
        const round = p.kind === "person" || p.kind === "client" || p.kind === "actor";
        const icon = iconFor(p.kind, theme, p.icon);
        return (
          <div
            className="dag-node dag-node--card"
            data-dag-node={p.id}
            data-dag-kind={p.kind}
            data-dag-icon={icon.mode}
            key={p.id}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          >
            <div className="dag-node__head">
              <span className={tileClass(icon, round ? "dag-tile--round" : undefined)} style={hueVars(p.hue)}>
                <Icon icon={icon} size={theme.metric.tile.icon} stroke={theme.metric.tile.stroke} />
              </span>
              <span className="dag-node__text">
                <span className="dag-node__title" data-dag-title="">
                  {p.title}
                </span>
                {p.meta ? <span className="dag-node__meta">{p.meta}</span> : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
