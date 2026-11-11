import type { ReactNode } from "react";

import type { BoardItem } from "@/board/types";
import type { Hue } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

import { frameHueVars } from "./hue";

/**
 * The frame every diagram is drawn inside: a title, a one-line subtitle, the mono type chip, a
 * hairline rule, then the body.
 *
 * It is a component rather than something each diagram draws so that ten diagram types cannot end
 * up with ten slightly different headers — the thing that made the hand-built artboards expensive
 * to keep consistent.
 *
 * **Bare is the other half of that argument.** A header is something the author asks for — a
 * `title=` or a `subtitle=`, or `frame=full` — and most things dropped on the paper are not asked
 * for one: an actor, a service, a store, or a whole diagram nobody has named yet. It used to fall
 * back to the id when it framed anyway (`usecase-wazt`), which named nothing a reader couldn't
 * already see in the card; that fallback is gone, so an untitled header is one that was not asked
 * for at all — `title` is empty, not the id. Bare drops the head and the rule and keeps only
 * `frame.barePad` around the body: enough to hold the hover ring and the selection outline off the
 * card's edge, and no more. The type chip goes with the header — an element on the board does not
 * announce its family unless something is already naming it. Who is framed is not decided here —
 * `DiagramItem` weighs `frame=` against the author's own title and subtitle, through `framed()` in
 * `@/board/types`.
 *
 * **A diagram's own `hue=` tints the frame**: a hairline border all round and the title band behind
 * the header. It is drawn the way the frame is, with nothing added to its box — the border is an
 * inset shadow and the band is the header stretched out to the frame's edge by exactly the padding
 * it was inset by — so a hue never moves a card, and `size.ts`'s arithmetic still holds. A bare
 * frame has no band to tint, and keeps the border. `frameHueVars` says why it is not `hueVars`.
 */
export function Frame({
  item,
  width,
  theme,
  bare,
  children,
}: {
  item: BoardItem;
  width: number;
  theme: Theme;
  /** Draw the body alone: no head, no rule, `frame.barePad` instead of `frame.pad`. */
  bare?: boolean;
  children: ReactNode;
}) {
  const m = theme.metric.frame;
  const hue = item.hue as Hue | undefined;
  const tint = frameHueVars(hue);
  const hued = hue !== undefined;

  /* `h=` is a minimum everywhere, framed or not; the measure the flow trusts already includes it. */
  if (bare) {
    return (
      <section
        className={hued ? "dag-frame dag-frame--bare dag-frame--hued" : "dag-frame dag-frame--bare"}
        style={{ width, padding: m.barePad, minHeight: item.h, ...tint }}
      >
        {children}
      </section>
    );
  }

  return (
    <section
      className={hued ? "dag-frame dag-frame--hued" : "dag-frame"}
      style={{ width, padding: m.pad, minHeight: item.h, ...tint }}
    >
      <header
        className={hued ? "dag-frame__head dag-frame__head--hued" : "dag-frame__head"}
        style={
          hued
            ? /* Out to the frame's edge by the padding the section gave it, and that padding put back
                 inside: the box ends where it did, and so does everything under it. */
              {
                height: m.headerH,
                marginTop: -m.pad,
                marginLeft: -m.pad,
                marginRight: -m.pad,
                paddingTop: m.pad,
                paddingLeft: m.pad,
                paddingRight: m.pad,
              }
            : { height: m.headerH - m.pad }
        }
      >
        <div>
          <h2 className="dag-frame__title">{item.title}</h2>
          {item.subtitle ? <p className="dag-frame__sub">{item.subtitle}</p> : null}
        </div>
        <span className="dag-frame__chip">{item.type}</span>
      </header>
      <div className="dag-frame__rule" />
      {children}
    </section>
  );
}
