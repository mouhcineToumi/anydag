import type { Node } from "@/dsl/ir";
import type { Box } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "../hue";
import { Icon, iconFor, tileClass } from "../Icon";
import { emOf } from "./em";

/**
 * The icon-first card: a tinted tile carrying a glyph, the name and one mono line beside it, and
 * port rows underneath when the component declares any.
 *
 * The tile replaces the hue dot the earlier boards used — one hue signal per node, and it is the
 * thing your eye lands on first. An external component gets a neutral tile and a slate glyph rather
 * than a hue, so what we do not run recedes without needing a legend to say so.
 */

interface Props {
  node: Node;
  box: Box;
  theme: Theme;
}

const statusClass = (node: Node): string => {
  if (node.status === "done") return " dag-node--done";
  if (node.status === "wait") return " dag-node--wait";
  if (node.status === "stop") return " dag-node--stop";
  if (node.status === "muted") return " dag-node--muted";
  return "";
};

export function ServiceCard({ node, box, theme }: Props) {
  const external = node.external === true;
  const icon = iconFor(node.kind, theme, node.icon);

  return (
    <div
      className={`dag-node dag-node--card${statusClass(node)}${external ? " dag-node--external" : ""}`}
      data-dag-node={node.id}
      data-dag-kind={node.kind}
      data-dag-icon={icon.mode}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...hueVars(node.hue) }}
    >
      <div className="dag-node__head" style={{ height: node.rows.length ? theme.metric.node.headerArch : undefined }}>
        <span className={tileClass(icon)}>
          <Icon icon={icon} size={theme.metric.tile.icon} stroke={theme.metric.tile.stroke} />
        </span>
        <span className="dag-node__text">
          <span className="dag-node__title" data-dag-title="" {...emOf(node)}>
            {node.title}
          </span>
          {node.meta ? <span className="dag-node__meta">{node.meta}</span> : null}
        </span>
        {node.async ? <span className="dag-pill">async</span> : null}
      </div>

      {node.rows.length > 0 ? (
        <div className="dag-node__rows">
          {node.rows.map((row) => (
            <div className="dag-row" key={row.id} data-dag-row={row.id} style={{ height: theme.metric.node.rowArch }}>
              <span className="dag-row__name">{row.name}</span>
              {row.detail ? <span className="dag-row__detail">{row.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
