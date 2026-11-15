import { useRef, useState, type KeyboardEvent } from "react";

import { HUE_ORDER, type Hue } from "@/dsl/ir";
import { hueVars } from "@/render/hue";

/** A hue as a person reads it: `Indigo`. */
export const hueLabel = (hue: Hue): string => hue.charAt(0).toUpperCase() + hue.slice(1);

/**
 * The ten hues as swatches: **every colour choice in the chrome is this one component** — a project's
 * colour, a tag's, the swatch strip under *Create tag*. `dag-swatch` is the board panel's, so this is
 * `dag-palette` (#327).
 *
 * Each swatch is a 24px hit box round a 16px dot, with no overlap between two, and a 44px one under
 * 720px, where the strip wraps to two rows of five: the targets the audit asked for. The strip is a
 * `radiogroup` with a roving tabindex — one Tab stop, the arrows between swatches — so it is one
 * control to the keyboard, as a set of radios is.
 *
 * `onMove` is the arrows choosing without committing (the create strip, where Enter creates), and
 * `onPick` a press or Enter committing. Without `onMove` the arrows only move the focus.
 */
export function Palette({
  value,
  fallback,
  label,
  hook,
  onMove,
  onPick,
  onEscape,
}: {
  /** The hue chosen, ringed; `null` for none. */
  value: Hue | null;
  /** The default hue, said in its swatch's name: *Ochre, default*. */
  fallback?: Hue;
  /** The group's accessible name: *Colour of meeting*. */
  label: string;
  /** A second attribute each swatch carries, with its hue as the value: an older check's handle. */
  hook?: string;
  onMove?(hue: Hue): void;
  onPick(hue: Hue): void;
  onEscape?(): void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<Hue>(value ?? fallback ?? HUE_ORDER[0]!);
  /* The Tab stop: the chosen swatch, or where the arrows last were. */
  const stop = onMove ? (value ?? at) : at;

  const onKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      return onEscape();
    }
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Home" || e.key === "End" || step) {
      e.preventDefault();
      const focused = (document.activeElement as HTMLElement | null)?.dataset.dagPaletteHue as Hue | undefined;
      const from = HUE_ORDER.indexOf(focused ?? stop);
      const next =
        e.key === "Home"
          ? HUE_ORDER[0]!
          : e.key === "End"
            ? HUE_ORDER[HUE_ORDER.length - 1]!
            : HUE_ORDER[(from + step + HUE_ORDER.length) % HUE_ORDER.length]!;
      setAt(next);
      onMove?.(next);
      box.current?.querySelector<HTMLElement>(`[data-dag-palette-hue="${next}"]`)?.focus();
    }
  };

  return (
    <span ref={box} className="dag-palette" role="radiogroup" aria-label={label} data-dag-palette="" onKeyDown={onKey}>
      {HUE_ORDER.map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={value === h}
          aria-label={h === fallback ? `${hueLabel(h)}, default` : hueLabel(h)}
          tabIndex={h === stop ? 0 : -1}
          className="dag-palette__hue"
          data-dag-palette-hue={h}
          {...(hook ? { [hook]: h } : {})}
          style={hueVars(h)}
          onClick={() => onPick(h)}
        />
      ))}
    </span>
  );
}
