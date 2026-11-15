import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";

import type { Hue } from "@/dsl/ir";
import { defaultHue, pastedTags, tagKey, tagOf, tagProblem, typedTag, type TagChange } from "@/note/tags";
import { hueVars } from "@/render/hue";
import { Button } from "@/ui/controls";
import { Palette, hueLabel } from "@/ui/Palette";

import { TagChip, useUnder } from "./TagChip";
import { forgetTag, hueOfTag, tagIn, useTagList, type TagInfo } from "./tagStore";

/** One row of the list: a tag the vault has, or the row that makes a new one. */
type Option = { kind: "tag"; tag: TagInfo } | { kind: "create"; name: string };

/** How many suggestions are drawn: the rest are a word more away. */
const SHOWN = 50;

/**
 * A document's tags, and the way to change them: its chips, then a combobox that suggests the
 * vault's tags and **creates a new one where it is typed** — *Create tag "roadmap"* with the ten
 * swatches under it, the name's default chosen; Enter creates with the chosen swatch, a press on a
 * swatch with that one. No trip to Settings (#327).
 *
 * The ARIA 1.2 combobox pattern: the field names its list (`aria-controls`) and its highlighted row
 * (`aria-activedescendant`), the create row is one `option` that says its colour, and the swatches are
 * a radiogroup with one Tab stop — Tab from the field, the arrows to choose, Enter to create, Escape
 * back to the field.
 *
 * Names are kept from going wrong rather than refused: a space is a `-` as it is typed, a pasted
 * `a, b c` is three tags, a `#` is dropped. The one refusal is a name of digits alone, with its fix a
 * press away.
 *
 * `onChange` writes the change and resolves once it has landed; `created` is set when the change makes
 * a tag, with its colour, for the caller to register. A tag made here and taken off again, with no
 * other document carrying it, leaves the tag list too — a typo does not stay in every suggestion.
 *
 * `row` is the note page's: chips, then *Add tag*, with the list floated under the field. `pop` is
 * the popover's, where the field is always there and the list is part of the card.
 */
export function TagEditor({
  tags,
  editable,
  variant,
  onChange,
}: {
  tags: readonly string[];
  editable: boolean;
  variant: "row" | "pop";
  onChange(change: TagChange, created?: { name: string; hue: Hue }): Promise<unknown> | void;
}) {
  const list = useTagList();
  const id = useId();
  const [field, setField] = useState(variant === "pop");
  const [query, setQuery] = useState("");
  const [listed, setListed] = useState(variant === "pop");
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<Hue | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /* The tags made in this editor, by key: the ones whose removal unregisters them. */
  const made = useRef(new Set<string>());

  const on = useMemo(() => new Set(tags.map(tagKey)), [tags]);
  const problem = tagProblem(query);
  const options = useMemo<Option[]>(() => {
    const q = tagKey(query);
    const known = (list ?? []).filter((t) => !on.has(tagKey(t.name)));
    const shown = (q ? known.filter((t) => tagKey(t.name).includes(q)) : known).slice(0, SHOWN);
    const out: Option[] = shown.map((tag) => ({ kind: "tag", tag }));
    const exact = !!tagIn(list, query) || on.has(q);
    if (query && tagOf(query) && !exact) out.push({ kind: "create", name: query });
    return out;
  }, [list, on, query]);
  const create = options.find((o): o is Extract<Option, { kind: "create" }> => o.kind === "create");
  const fallback = create ? defaultHue(create.name) : null;
  const hue = chosen ?? fallback;
  const open = field && listed && (options.length > 0 || !!problem);
  const at = Math.min(active, Math.max(0, options.length - 1));
  const floated = useUnder(input, variant === "row" && open, 220);

  /* A new word is a new choice: the first row, and the new name's own default. */
  useEffect(() => {
    setActive(0);
    setChosen(null);
  }, [query]);

  useEffect(() => {
    if (field && variant === "row") input.current?.focus();
  }, [field, variant]);

  if (!editable)
    return tags.length ? (
      <span className="dag-tags" role="list" aria-label="Tags" data-dag-tags="">
        {tags.map((t) => (
          <span key={t} role="listitem">
            <TagChip name={t} hue={hueOfTag(list, t)} />
          </span>
        ))}
      </span>
    ) : null;

  const add = (name: string, hue?: Hue) => {
    setQuery("");
    input.current?.focus();
    if (hue) {
      made.current.add(tagKey(name));
      return void onChange({ add: [name] }, { name, hue });
    }
    void onChange({ add: [name] });
  };
  const take = (o: Option | undefined, h: Hue | null = hue) => {
    if (!o) return;
    if (o.kind === "tag") return add(o.tag.name);
    add(o.name, h ?? defaultHue(o.name));
  };
  const remove = async (name: string) => {
    await onChange({ remove: [name] });
    if (made.current.delete(tagKey(name))) await forgetTag(name);
  };

  const close = () => {
    setQuery("");
    if (variant === "row") {
      setField(false);
      requestAnimationFrame(() => addButton.current?.focus());
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!listed) return setListed(true);
      if (!options.length) return;
      setActive((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open) take(options[at]);
    } else if (e.key === "Escape") {
      if (variant === "pop" && !query) return;
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else close();
    } else if (e.key === "Backspace" && query === "" && tags.length) {
      e.preventDefault();
      void remove(tags[tags.length - 1]!);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\s,]/.test(text.trim())) return;
    e.preventDefault();
    const names = pastedTags(text).filter((t) => tagOf(t));
    const fresh = names.filter((t) => !tagIn(list, t) && !on.has(tagKey(t)));
    const known = names.filter((t) => !fresh.includes(t)).map((t) => tagIn(list, t)?.name ?? t);
    if (known.length) void onChange({ add: known });
    for (const t of fresh) add(t, defaultHue(t));
    setQuery("");
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  const why = `${id}-why`;
  const rows: ReactNode = (
    <>
      {options.length ? (
        <div className="dag-tagedit__lb" role="listbox" id={`${id}-list`} aria-label="Tags">
          {options.map((o, i) => {
            const isCreate = o.kind === "create";
            const name = isCreate ? o.name : o.tag.name;
            const dot = isCreate ? (hue ?? defaultHue(name)) : o.tag.hue;
            return (
              <div
                key={isCreate ? "\u0000create" : name}
                id={optionId(i)}
                role="option"
                aria-selected={i === at}
                aria-label={
                  isCreate ? `Create tag ${name}, colour ${hueLabel(dot)}${dot === fallback ? ", default" : ""}` : undefined
                }
                className="dag-tagedit__opt"
                data-dag-tag-option={isCreate ? "" : name}
                data-dag-tag-create={isCreate ? name : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => take(o)}
              >
                <span className="dag-tag__dot" style={hueVars(dot)} aria-hidden="true" />
                {isCreate ? <span>Create tag “{name}”</span> : <Matched name={name} query={query} />}
                {!isCreate && o.tag.count === 0 ? <span className="dag-tagedit__unused">Unused</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {create && hue ? (
        <div className="dag-tagedit__hues">
          <Palette
            value={hue}
            fallback={fallback ?? undefined}
            label={`Colour for ${create.name}`}
            onMove={setChosen}
            onPick={(h) => take(create, h)}
            onEscape={() => input.current?.focus()}
          />
        </div>
      ) : null}
      {problem ? (
        <div className="dag-tagedit__why" id={why} role="alert" data-dag-tag-problem="">
          <span>{problem.message}</span>
          <button
            type="button"
            className="dag-tagedit__fix"
            data-dag-tag-fix={problem.fix}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery(problem.fix);
              input.current?.focus();
            }}
          >
            Use {problem.fix}?
          </button>
        </div>
      ) : null}
    </>
  );

  const combo = (
    <input
      ref={input}
      className="dag-tagedit__input"
      data-dag-tag-input=""
      role="combobox"
      aria-label="Add tag"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={options.length ? `${id}-list` : undefined}
      aria-activedescendant={open && options.length ? optionId(at) : undefined}
      aria-invalid={problem ? true : undefined}
      aria-describedby={problem ? why : undefined}
      placeholder="Add tag"
      autoComplete="off"
      spellCheck={false}
      value={query}
      onChange={(e) => {
        setQuery(typedTag(e.target.value));
        setListed(true);
      }}
      onFocus={() => setListed(true)}
      onKeyDown={onKey}
      onPaste={onPaste}
    />
  );

  return (
    <span
      ref={box}
      className={variant === "pop" ? "dag-tagedit dag-tagedit--pop" : "dag-tagedit"}
      data-dag-tagedit={variant}
      onBlur={(e) => {
        if (box.current?.contains(e.relatedTarget as Node | null)) return;
        setListed(false);
        if (variant === "row" && !query) setField(false);
      }}
    >
      <span className="dag-tags" role="list" aria-label="Tags" data-dag-tags="">
        {tags.map((t) => (
          <span key={t} role="listitem">
            <TagChip name={t} hue={hueOfTag(list, t)} onRemove={() => void remove(t)} />
          </span>
        ))}
      </span>
      {variant === "row" && !field ? (
        <Button
          ref={addButton}
          variant="quiet"
          size="sm"
          className="dag-tagedit__add"
          data-dag-tag-add=""
          onClick={() => setField(true)}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          Add tag
        </Button>
      ) : null}
      {variant === "row" && field ? <span className="dag-tagedit__field">{combo}</span> : null}
      {variant === "pop" ? combo : null}
      {variant === "pop" ? (
        open ? (
          <div className="dag-tagedit__opts">{rows}</div>
        ) : null
      ) : open ? (
        <div className="dag-tagedit__list" style={floated ?? { visibility: "hidden" }}>
          {rows}
        </div>
      ) : null}
    </span>
  );
}

/** A suggestion's name with what was typed marked in it. */
function Matched({ name, query }: { name: string; query: string }) {
  const at = query ? tagKey(name).indexOf(tagKey(query)) : -1;
  if (at < 0) return <span>{name}</span>;
  return (
    <span>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </span>
  );
}
