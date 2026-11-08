import type { Lane as LaneDef } from "@/dsl/ir";
import type { Placed } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "./hue";

/**
 * A swimlane band: a tint the full width of the flow, with its owner named in the margin beside it.
 *
 * The label sits outside the band rather than inside it, so a lane with one node in it is still
 * obviously a lane and the band's left edge stays a clean line down the diagram.
 */
export function Lane({ lane, box, theme }: { lane: LaneDef | undefined; box: Placed["lanes"][number]; theme: Theme }) {
  return (
    <>
      <div className="dag-band" data-dag-lane={box.id} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      {lane ? (
        <div
          className="dag-band__label"
          /* The band carries `data-dag-lane` and the label is its *sibling*, not its child — the
             label sits outside the band so a one-node lane still reads as one. So the inline
             rename cannot reach it by looking inside the band, and this is the hook that says
             where a lane's name is actually drawn. */
          data-dag-lane-label={box.id}
          data-dag-title=""
          style={{
            left: theme.metric.lane.labelLeft,
            top: box.labelY - theme.metric.lane.labelH / 2,
            width: theme.metric.lane.labelW,
            ...hueVars(lane.hue),
          }}
        >
          {lane.label}
          <span className="dag-group__dot" />
        </div>
      ) : null}
    </>
  );
}
