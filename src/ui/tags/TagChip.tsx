import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { X } from "lucide-react";

import type { Hue } from "@/dsl/ir";
import { defaultHue } from "@/note/tags";
import { hueVars } from "@/render/hue";
import { Button, IconButton } from "@/ui/controls";
import { Palette } from "@/ui/Palette";

import { colorTag, hueOfTag, tagIn, useTagList } from "./tagStore";

/**
 * A tag as a chip: a pill with its colour's dot and its name — `--dag-color-paper100` ground and
 * `ink` text whatever the hue, so it reads in every theme without measuring each one (#327).
 *
 * Read-only it is only that. Editable, the dot is a button with a 24px hit box that opens the ten
 * swatches to recolour the tag in place, and the × an `IconButton` that takes it off this document.
 * Under 720px the whole chip but its × opens the swatches, which is the stylesheet's to say.
 */
export function TagChip({ name, hue, onRemove }: { name: string; hue: Hue; onRemove?(): void }) {
  if (!onRemove)
    return (
      <span className="dag-tag" data-dag-tag={name}>
        <span className="dag-tag__dot" style={hueVars(hue)} aria-hidden="true" />
        <span className="dag-tag__name">{name}</span>
      </span>
    );
  return (
    <span className="dag-tag dag-tag--edit" data-dag-tag={name}>
      <TagColour name={name} hue={hue} />
      <span className="dag-tag__name">{name}</span>
      <IconButton
        size="sm"
        className="dag-tag__remove"
        data-dag-tag-remove={name}
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </span>
  );
}

/** Where a picker opened from a control is drawn: fixed to the window, under it, kept inside. */
export function useUnder(anchor: RefObject<HTMLElement | null>, open: boolean, width = 0): CSSProperties | null {
  const [at, setAt] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return setAt(null);
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 8;
      const narrow = innerWidth < 720;
      const w = narrow ? innerWidth - margin * 2 : Math.max(width, r.width);
      const left = narrow ? margin : Math.max(margin, Math.min(r.left, innerWidth - w - margin));
      const below = innerHeight - r.bottom - margin;
      const above = r.top - margin;
      const maxHeight = Math.max(160, Math.min(360, Math.max(below, above) - 6));
      const flip = below < Math.min(maxHeight, 220) && above > below;
      setAt({
        left,
        ...(narrow ? { width: w } : { minWidth: w }),
        maxHeight,
        ...(flip ? { bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [anchor, open, width]);
  return at;
}

/**
 * A chip's dot, the button that recolours the tag: the ten swatches in a small dialog under it, and
 * *Use the default colour*. A choice is the tag's colour everywhere at once (`POST /__board/tags/color`).
 */
function TagColour({ name, hue }: { name: string; hue: Hue }) {
  const tags = useTagList();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const at = useUnder(button, open);
  const info = tagIn(tags, name);
  const fallback = defaultHue(info?.name ?? name);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  /* Once drawn, the focus goes to the chosen swatch, as a radiogroup's does. */
  useEffect(() => {
    if (open && at) card.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [open, at]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (next: Hue | null) => {
    close();
    void colorTag(info?.name ?? name, next);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="dag-tag__pick"
        data-dag-tag-pick={name}
        aria-label={`Colour of ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={hueVars(hue)}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div
          ref={card}
          className="dag-tag__hues"
          role="dialog"
          aria-label={`Colour of ${name}`}
          data-dag-tag-hues={name}
          style={at ?? { visibility: "hidden" }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
        >
          <Palette value={hue} fallback={fallback} label="Colour" onPick={choose} onEscape={close} />
          {info?.registered && hue !== fallback ? (
            <Button variant="quiet" size="sm" className="dag-tag__reset" data-dag-tag-default="" onClick={() => choose(null)}>
              Use the default colour
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** A document's tags, read-only, on the line above its text: `?view=1`, a snapshot, the PDF. */
export function TagLine({ tags }: { tags: readonly string[] }) {
  const list = useTagList();
  if (!tags.length) return null;
  return (
    <p className="dag-taskbar dag-taskbar--read dag-tagline" data-dag-tagline="">
      <span className="dag-tags" role="list" aria-label="Tags">
        {tags.map((t) => (
          <span key={t} role="listitem">
            <TagChip name={t} hue={hueOfTag(list, t)} />
          </span>
        ))}
      </span>
    </p>
  );
}
