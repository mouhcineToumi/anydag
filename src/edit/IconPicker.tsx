import { useEffect, useMemo, useRef, useState } from "react";

import { ICON_NAMES } from "@/dsl/icon-names";
import type { Hue, NodeKind } from "@/dsl/ir";
import { Icon, iconFor, hasLucide, type IconRef } from "@/render/Icon";
import { ALIASES, COLOR, MONO } from "@/render/icon-index";
import { hueVars } from "@/render/hue";
import { THEMES, THEME_NAMES } from "@/theme/useTheme";
import type { Theme } from "@/theme/contract";

/**
 * The icon picker: the field that used to be a bare text input over ~2,900 legal values.
 *
 * The brief it serves is the reason `icon=layers` came to stand for dbt and `icon=database` for
 * Redis on real boards here: the only way to know a name exists was to already know it. This
 * replaces the input with a search over the vocabulary where every candidate shows its actual
 * glyph — recognising a logo is the whole point, and a list of words is the same failure as the
 * bare input with one more step in front of it.
 *
 * Five things about the shape of it:
 *
 * - **The value is one string, and the field always holds exactly what will be written.** The DSL
 *   string is the mode and the name in one (`postgresql`, `mono:postgresql`, `lucide:server`), so
 *   the input shows the whole thing and a blur commits what it says — the old field's semantics,
 *   preserved: empty removes the attribute, an unknown name stays on the line and is drawn as the
 *   kind's default, because `iconFor()` falls back and `W_UNKNOWN_ICON` says why.
 * - **Mode is a filter and a composer, not a second field.** Four chips — Brand, Mono, Lucide,
 *   Emoji — narrow the list to the names that resolve in that mode and set the string a *chosen*
 *   option is written as: the bare name, the `mono:`/`lucide:` prefix, or an `emoji:` picture (in
 *   the card's hue, `mono:emoji:`, when "In the hue" is pressed). Typing a full raw value beats
 *   all of it: Enter writes what is typed, whatever the chips say, so `mono:redis` typed by hand
 *   survives untouched. The chips sit before the options in the grid's arrow walk.
 * - **Resolution is `iconFor()`'s, never copied.** Every preview — the current value's and each
 *   candidate's — is `iconFor(kind, theme, writtenString)` through the existing `Icon` component,
 *   so the picker cannot disagree with the card about what a name draws: brand beats mono beats
 *   Lucide, and an unresolvable value falls back to the kind's glyph exactly as the card will.
 * - **Previews are capped.** ~2,900 names is enough that mounting every match is a render the
 *   panel cannot afford; the first `PREVIEW_CAP` are drawn and the note says how many are waiting,
 *   because a cap nobody announces is a silent lie about the vocabulary.
 * - **Focus roves over real buttons**, the pattern `BoardList` already established: the rendered
 *   options *are* the list, ArrowDown from the field walks in, arrows move, Enter or a click
 *   commits, Escape climbs back out — the field first, then whatever held it before.
 */

/** How many previews may be on the page at once; the note under the grid says when this bit. */
export const PREVIEW_CAP = 60;

/**
 * The picker's own mode vocabulary — the *spelling* a value carries, not how the renderer resolves
 * it. `lucide:` is the DSL's prefix and `Icon`'s `IconMode` for it is `"concept"`; conflating the
 * two words here would put a `"concept"` chip on screen and write values no parser ever reads.
 */
export type PickMode = "brand" | "mono" | "lucide" | "emoji";

/** One of the three spellings, with the chip's words and the prefix it writes. */
const MODES: { mode: PickMode; label: string; title: string }[] = [
  { mode: "brand", label: "Brand", title: "The logo in its own colours, written unprefixed" },
  { mode: "mono", label: "Mono", title: "The brand as a silhouette wearing the card's hue" },
  { mode: "lucide", label: "Lucide", title: "The concept glyph: a server, a queue, a person" },
  { mode: "emoji", label: "Emoji", title: "A picture: a person, a house, a book, a truck" },
];

/** The brand bundle's own indirection: `pg` is `postgresql`. `iconFor()` applies it too. */
const target = (name: string): string => ALIASES[name] ?? name;

const ALL = [...ICON_NAMES].sort();
/** Everything that draws a logo: brand colours, or mono-only where no colour art exists. */
const BRAND = ALL.filter((n) => COLOR.has(target(n)) || MONO.has(target(n)));
const MONO_NAMES = ALL.filter((n) => MONO.has(target(n)));
/**
 * Lucide's own vocabulary, asked of Lucide rather than derived by subtracting the bundle.
 *
 * The subtraction is the obvious way to write this and it is wrong: the names both vocabularies
 * claim — `figma` `github` `gitlab` `slack` `vault` `snowflake` — sit in the bundle as well as in
 * Lucide, so taking the complement drops exactly the six for which `lucide:` is the *only* way to
 * reach the glyph. Since `snowflake` became a brand, nothing else can ask for the weather.
 */
const LUCIDE = ALL.filter(hasLucide);
/**
 * The pictures — the one list whose names carry their namespace, because `emoji:house` is
 * what a line says and a bare `house` is Lucide's. Its chip writes the colour cut; "In the hue" beside
 * it writes the mono one, which is the same subject drawn in the card's hue, and is a toggle rather
 * than a fifth chip because it is not a different vocabulary — it is the same fifteen hundred
 * pictures in a different ink.
 */
const EMOJI = ALL.filter((n) => n.startsWith("emoji:"));

/**
 * The names to show for a query, and the mode they are shown in.
 *
 * A chip narrows the list; it must never be the reason a name looks absent. The mode a picker
 * opens in is derived from the value already on the line, which is nobody's *choice* — a `service`
 * card wears Lucide's `server`, so the picker opens on Lucide, and a person typing "postgres"
 * there was told *nothing matches* while the elephant sat one chip away. That is the exact failure
 * this picker exists to end: an author concludes the icon does not ship and settles for
 * `icon=database`, which is how two boards in this repository came to do precisely that.
 *
 * So a query with no hits under the active chip is answered from the first chip that has any, and
 * the caller lights that one: what was typed is the intent, and a chip nobody touched is not. With
 * no query there is nothing to disagree with, so the declared mode stands — `searchIcons("", m)`
 * is the whole of `m`, never empty.
 */
export function searchAcross(query: string, mode: PickMode): { mode: PickMode; names: string[]; fellBack: boolean } {
  const here = searchIcons(query, mode);
  if (here.length > 0) return { mode, names: here, fellBack: false };
  for (const { mode: m } of MODES) {
    if (m === mode) continue;
    const hits = searchIcons(query, m);
    if (hits.length > 0) return { mode: m, names: hits, fellBack: true };
  }
  return { mode, names: [], fellBack: false };
}

/** A chip's own word, for a note that has to name the one it fell back from. */
const labelOf = (m: PickMode): string => MODES.find((x) => x.mode === m)?.label ?? m;

/** The DSL string a choice in a mode writes — an emoji in the hue when `tint` says so. */
export const writtenFor = (mode: PickMode, name: string, tint = false): string =>
  mode === "mono" || (mode === "emoji" && tint) ? `mono:${name}` : mode === "lucide" ? `lucide:${name}` : name;

/**
 * What a value already says, mode-wise — where the picker opens.
 *
 * An empty value opens on the pictures for a `figure`, whose whole job is to be one, and on the
 * brands for everything else, as it always did.
 */
export function modeOf(value: string, kind?: string): PickMode {
  if (value.startsWith("emoji:") || value.startsWith("mono:emoji:")) return "emoji";
  if (value === "" && kind === "figure") return "emoji";
  if (value.startsWith("mono:")) return "mono";
  if (value.startsWith("lucide:")) return "lucide";
  const t = target(value);
  if (COLOR.has(t) || MONO.has(t)) return "brand";
  return ICON_NAMES.has(value) ? "lucide" : "brand";
}

/** Names of a mode that match every token of the query, starts-with first. */
export function searchIcons(query: string, mode: PickMode): string[] {
  const list = mode === "brand" ? BRAND : mode === "mono" ? MONO_NAMES : mode === "emoji" ? EMOJI : LUCIDE;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return list;
  const hits: { name: string; lead: boolean }[] = [];
  for (const name of list) {
    const hay = name.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) continue;
    /* The namespace is not what anybody typed: `house` leads for `emoji:house`. */
    const lead = hay.replace(/^emoji:/, "");
    hits.push({ name, lead: terms.some((t) => lead.startsWith(t)) });
  }
  hits.sort((a, b) => (a.lead === b.lead ? a.name.localeCompare(b.name) : a.lead ? -1 : 1));
  return hits.map((h) => h.name);
}

/** The name a query is about, without the prefix that is not part of it. */
const stripPrefix = (text: string): string => text.replace(/^(?:mono|lucide):/, "").replace(/^emoji:/, "");

/**
 * The theme the board is drawn in, read back off the `<html>` the theme flattened itself onto.
 *
 * `applyTheme` stamps `data-theme` on the root as the record of what it did, and the panel has no
 * theme in its props — threading one from `App` would cross four components to reach a control
 * that needs it only for an unresolvable value's fallback. Reading the stamp back is the one
 * answer that cannot disagree with what is on screen; an attribute observer keeps it current if
 * the theme is switched while the panel is open.
 */
export function useAppliedTheme(): Theme {
  const read = (): Theme => {
    const name = document.documentElement.dataset.theme;
    return (name && THEMES[name]) || THEMES[THEME_NAMES[0] ?? ""] || Object.values(THEMES)[0]!;
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function IconPicker({
  value,
  hue,
  kind,
  onSet,
}: {
  /** The value as the line says it — prefixed spellings included. */
  value: string;
  /** The card's hue, for a mono preview drawn the way the card draws it. */
  hue: Hue | undefined;
  /** The node's kind word — the fallback a garbage value draws is the kind's glyph. */
  kind: string;
  onSet(value: string | null): void;
}) {
  const theme = useAppliedTheme();
  const [mode, setMode] = useState<PickMode>(() => modeOf(value, kind));
  /* Only an emoji has a second ink; everywhere else the chip alone says how a name is written. */
  const [tint, setTint] = useState(() => value.startsWith("mono:emoji:"));
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* The file may say something different under the editor — adopt it, which is what the old
     field's `key` remount did, minus the remount and the focus it took with it. */
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }

  /** What the card draws today — a garbage value falls back exactly as the card does. */
  const current: IconRef = useMemo(() => iconFor(kind as NodeKind, theme, value), [kind, theme, value]);
  const stripped = stripPrefix(text);
  const found = useMemo(() => searchAcross(stripped, mode), [stripped, mode]);
  const effective = found.mode;
  const shown = found.names;
  const view = shown.slice(0, PREVIEW_CAP);

  const write = (next: string | null) => {
    if (next !== null) setText(next);
    const t = next?.trim() ?? "";
    if (t === value) return;
    onSet(t || null);
  };

  /** A blur that stays inside the picker is a step of the gesture, not a commit. */
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (rootRef.current && e.relatedTarget instanceof Node && rootRef.current.contains(e.relatedTarget)) return;
    write(text);
  };

  /** Arrow from the field into the grid, at the end the arrow points at. */
  const into = (dir: 1 | -1) => {
    const opts = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-dag-iconpick-opt]") ?? []);
    opts[dir === 1 ? 0 : opts.length - 1]?.focus();
  };

  const walk = (e: React.KeyboardEvent) => {
    const opts = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-dag-iconpick-opt]") ?? []);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = document.activeElement instanceof HTMLButtonElement ? opts.indexOf(document.activeElement) : -1;
      const d = e.key === "ArrowDown" ? 1 : -1;
      opts[Math.min(Math.max(i + d, 0), opts.length - 1)]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  return (
    <div className="dag-iconpick" data-dag-iconpick="" ref={rootRef}>
      <div className="dag-iconpick__field">
        <span
          className={`dag-iconpick__current${current.mode === "brand" ? " dag-iconpick__current--brand" : ""}`}
          style={hueVars(hue)}
          title={value || "no icon"}
        >
          {value ? <Icon icon={current} size={18} stroke={2} /> : null}
        </span>
        <input
          ref={inputRef}
          className="dag-input dag-input--mono dag-iconpick__input"
          data-dag-prop-icon=""
          aria-label="Icon"
          placeholder="search the icons: brand, mono:, lucide:, emoji:"
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              into(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              into(-1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (text !== value) setText(value);
              else e.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="dag-iconpick__modes" role="group" aria-label="Icon mode">
        {MODES.map(({ mode: m, label, title }) => (
          <button
            key={m}
            type="button"
            className={effective === m ? "dag-iconpick__mode dag-iconpick__mode--on" : "dag-iconpick__mode"}
            data-dag-iconpick-mode={m}
            aria-pressed={effective === m}
            title={title}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
        {effective === "emoji" ? (
          <button
            type="button"
            className={tint ? "dag-iconpick__mode dag-iconpick__mode--on" : "dag-iconpick__mode"}
            data-dag-iconpick-tint=""
            aria-pressed={tint}
            title="Draw the picture in one colour, the card's hue, instead of its own"
            onClick={() => {
              /* The ink is a property of the picture already chosen, so switching it re-draws that
                 picture — `emoji:house` becomes `mono:emoji:house` — rather than waiting for the next pick. */
              const next = !tint;
              setTint(next);
              const bare = value.replace(/^mono:/, "");
              if (bare.startsWith("emoji:")) write(next ? `mono:${bare}` : bare);
            }}
          >
            In the hue
          </button>
        ) : null}
      </div>

      <div className="dag-iconpick__grid" ref={gridRef} onKeyDown={walk}>
        {view.map((name) => {
          const written = writtenFor(effective, name, tint);
          return (
            <button
              key={name}
              type="button"
              className="dag-iconpick__opt"
              data-dag-iconpick-opt={written}
              title={written}
              aria-label={`Icon ${written}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => write(written)}
            >
              <span className="dag-iconpick__glyph" data-dag-iconpick-glyph={iconFor(kind as NodeKind, theme, written).mode}>
                <Icon icon={iconFor(kind as NodeKind, theme, written)} size={20} stroke={2} />
              </span>
              <span className="dag-iconpick__name">{name}</span>
            </button>
          );
        })}
      </div>

      <p className="dag-iconpick__note" data-dag-iconpick-count="">
        {shown.length === 0
          ? "nothing matches; the field writes what is typed"
          : found.fellBack
            ? `nothing in ${labelOf(mode)}; ${shown.length} in ${labelOf(effective)}`
            : shown.length > view.length
              ? `showing ${view.length} of ${shown.length}; keep typing to narrow`
              : `${shown.length} of ${ALL.length} icons`}
      </p>
    </div>
  );
}
