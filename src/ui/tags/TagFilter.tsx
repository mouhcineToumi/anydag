import { useEffect, useMemo, useRef, useState } from "react";

import type { BoardTree } from "@/board/useBoard";
import { collation } from "@/locale";
import { tagKey } from "@/note/tags";
import { Tooltip } from "@/ui/Tooltip";
import { NO_TAG, type TagFilter } from "@/ui/tagFilter";

import { TagChip, useUnder } from "./TagChip";
import { hueOfTag, tagIn, useTagList } from "./tagStore";

/**
 * The Tag select of the Tasks page and the Calendar's Show menu (#327), beside the project's and
 * built like it: *All tags*, each tag the documents it filters carry, then *No tag*. A tag is
 * spelled as the tag list spells it. Drawn only when there is a tag to choose or a filter to undo.
 */
export function TagSelect({
  list,
  names,
  filter,
  onFilter,
  label,
  hook,
}: {
  list: BoardTree;
  /** The documents the page filters: their tags are the choices. */
  names: readonly string[];
  filter: TagFilter;
  onFilter(next: TagFilter): void;
  label: string;
  hook: { [key: `data-${string}`]: string };
}) {
  const known = useTagList();
  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const name of names)
      for (const t of list.tags[name] ?? []) if (!byKey.has(tagKey(t))) byKey.set(tagKey(t), tagIn(known, t)?.name ?? t);
    if (filter.kind === "tag" && !byKey.has(tagKey(filter.name))) byKey.set(tagKey(filter.name), filter.name);
    return [...byKey.values()].sort((a, b) => collation({ numeric: true }).compare(a, b));
  }, [names, list.tags, known, filter]);
  if (!options.length && filter.kind === "all") return null;
  const value =
    filter.kind === "tag"
      ? (options.find((o) => tagKey(o) === tagKey(filter.name)) ?? filter.name)
      : filter.kind === "none"
        ? `\u0000${NO_TAG}`
        : "";
  return (
    <select
      className="dag-select dag-tasks__project"
      aria-label={label}
      value={value}
      {...hook}
      onChange={(e) => {
        const v = e.target.value;
        onFilter(v === "" ? { kind: "all" } : v === `\u0000${NO_TAG}` ? { kind: "none" } : { kind: "tag", name: v });
      }}
    >
      <option value="">All tags</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      {/* A tag may be called `none`: the choice for no tag is a value no tag can be. */}
      <option value={`\u0000${NO_TAG}`}>No tag</option>
    </select>
  );
}

/**
 * A row's tags, read only: up to `max` chips, then *+n* — a focusable chip named for what it hides,
 * *2 more tags: meeting, design*, whose names the drawn tooltip shows on hover and focus. A press
 * opens a card listing them, which is how a finger reads them: under 720px *+n* is a 44px target.
 */
export function TagChips({ tags, max = 2 }: { tags: readonly string[]; max?: number }) {
  const list = useTagList();
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.slice(max);
  return (
    <span className="dag-tags" role="list" aria-label="Tags" data-dag-tags-row="">
      {shown.map((t) => (
        <span key={t} role="listitem">
          <TagChip name={t} hue={hueOfTag(list, t)} />
        </span>
      ))}
      {rest.length ? (
        /* Inside a board's card, which a press drags and a click or Enter opens: these are the chip's own. */
        <span
          role="listitem"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreTags tags={rest} />
        </span>
      ) : null}
    </span>
  );
}

function MoreTags({ tags }: { tags: readonly string[] }) {
  const list = useTagList();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const at = useUnder(button, open);
  const names = tags.join(", ");

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  return (
    <>
      <Tooltip name={names}>
        <button
          ref={button}
          type="button"
          className="dag-tagmore__button"
          data-dag-tags-more={tags.length}
          aria-label={`${tags.length} more ${tags.length === 1 ? "tag" : "tags"}: ${names}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || !open) return;
            e.preventDefault();
            setOpen(false);
          }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="dag-tag dag-tag--more" aria-hidden="true">
            +{tags.length}
          </span>
        </button>
      </Tooltip>
      {open ? (
        <div
          ref={card}
          className="dag-tagmore"
          role="dialog"
          aria-label="More tags"
          data-dag-tags-more-card=""
          style={at ?? { visibility: "hidden" }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            setOpen(false);
            button.current?.focus();
          }}
        >
          <span className="dag-tags" role="list" aria-label="Tags">
            {tags.map((t) => (
              <span key={t} role="listitem">
                <TagChip name={t} hue={hueOfTag(list, t)} />
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}
