import type { DiagramType, Group as GroupDef } from "@/dsl/ir";
import type { PlacedGroup } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "./hue";

/**
 * A group: a soft tint field with a hue dot, a label and an optional mono sublabel.
 *
 * A tint rather than a bordered box, and the fill deepens by nesting level — a group inside a group
 * reads as further in without a second border weight to invent.
 */
export function Group({
  group,
  box,
  theme,
  type,
}: {
  group: GroupDef;
  box: PlacedGroup;
  theme: Theme;
  /**
   * The dialect, for the one type whose containers are not domains.
   *
   * A `sketch` group is a phone frame or a browser window — scenery the author drew, not a
   * boundary that means something — so it is an outline rather than a tint field, and it carries
   * no hue dot because `sketch` assigns no automatic hue. The kind alone cannot say that: a group
   * is a group in every dialect, and only the fence knows which language it is in.
   */
  type?: DiagramType;
}) {
  /* The fill is chosen in CSS from `data-level`, not here. It was the one theme colour that reached
     the DOM as a raw hex, which put it outside every stylesheet's reach and outside what
     `check-theme.mjs` can see. The last level's fill repeats for anything deeper. */
  const level = Math.min(box.level, theme.color.groupFills.length - 1);

  /*
   * A span, drawn as a labelled rule rather than a filled box.
   *
   * The filled version had to clip its own label whenever a section was shorter than its name, and
   * a truncated "Foundatio" is worse than a label that reaches past its bar. The rule states the
   * extent exactly; the label sits above it and is allowed to overflow.
   */
  if (box.strip) {
    return (
      <div
        className="dag-strip"
        data-dag-group={group.id}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...hueVars(group.hue) }}
      >
        <span className="dag-strip__label" data-dag-title="">
          <span className="dag-group__dot" />
          {group.label}
          {group.sublabel ? <span className="dag-group__sub">{group.sublabel}</span> : null}
        </span>
        <span className="dag-strip__rule" />
      </div>
    );
  }

  return (
    <div
      className={`dag-group${type === "sketch" ? " dag-group--sketch" : ""}`}
      data-dag-group={group.id}
      data-level={level}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...hueVars(group.hue) }}
    >
      <div
        className="dag-group__label"
        data-dag-title=""
        style={{ left: theme.metric.group.labelX, top: theme.metric.group.labelY }}
      >
        <span className="dag-group__dot" />
        {group.label}
        {group.sublabel ? <span className="dag-group__sub">{group.sublabel}</span> : null}
      </div>
    </div>
  );
}
