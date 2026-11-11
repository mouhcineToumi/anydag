import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CornerUpLeft, Plus, Trash2 } from "lucide-react";

import { isDiagramType, isLinkType, resizeOfItem, type BoardItem, type BoardPage } from "@/board/types";
import { FORMS, parseChart, type ChartForm } from "@/dsl/chart";
import { HUE_ORDER, STATUSES, type Hue, type Node, type Status } from "@/dsl/ir";
import { hasRows, kindsOf } from "@/dsl/parse";
import {
  edgeSpan,
  removeRow,
  replaceLine,
  rowLines,
  setCategories,
  setChartFlag,
  setChartForm,
  setChartOption,
  setDesc,
  setEdgeArrow,
  setEdgeFlag,
  setEdgeHue,
  setEdgeLabel,
  setFlag,
  setKind,
  setMeta,
  setModifier,
  setRow,
  setStatus,
  setTitle,
  setValues,
  valuesText,
  addRow as writeRow,
  type Flag,
  type ModifierKey,
} from "@/dsl/restate";
import { ARROWS, tokenize } from "@/dsl/tokenizer";

import { ASPECT_START, aspectAttr, aspectChoice } from "@/board/settings";

import { detachable, loneNode } from "./build";
import { REFUSAL, layered } from "./drag";
import { IconPicker } from "./IconPicker";
import type { Editor } from "./useEditor";

/**
 * The Properties view: everything the picked thing, or the item itself, has to say.
 *
 * F1 split the panel in two and put a strip of three controls in the first half — a hue, a status
 * and an icon, which was what `restate.ts` could write at the time. F2 made it able to write the
 * whole statement, and this is the other end of that: a kind, a title, a meta, a description, the
 * flags, the rows, an arrow, a label. The brief this serves says a person must be able to change
 * everything without ever seeing the DSL, and a control that is missing is a line somebody has to
 * go and type.
 *
 * Three things about the shape of it:
 *
 * - **One subject at a time.** A pick replaces the item's fields rather than stacking under them:
 *   a diagram's own six fields plus a card's twelve plus a rows list is a panel nobody can read,
 *   and the thing a person is working on is the innermost one they touched. The header carries a
 *   way back out, which is Escape's job too.
 * - **Every control is a span writer.** Each hands the whole body back the way a keystroke would,
 *   so it goes through the panel's own debounce, the same patch and the same undo entry as typing.
 *   Nothing here knows that a board file exists.
 * - **A row is edited as a line.** A `Row` is what the dialect's row grammar made of one — a name,
 *   a detail, some tags — and rebuilding a line from that would be the reserialisation `restate.ts`
 *   exists to avoid. The line is also the one form in which every dialect's rows are the same
 *   shape, so one editor serves an entity's columns and a class's members.
 */

/** What the panel is showing controls for, and where in the body it is written. */
export interface Subject {
  id: string;
  what: "node" | "group" | "lane" | "edge";
  /** 1-based, in the body being shown — the draft, which may be ahead of the file. */
  line: number;
  /** Which arrow along a chain, for an edge. 0 for everything else. */
  seg: number;
  /** `edges`-fence links are the same grammar one layer out, and say so in the header. */
  link?: boolean;
}

/** Lucide at one size and weight, stated once. */
const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What a fresh row should look like, per dialect. The placeholder is the whole documentation. */
const ROW_HINT: Record<string, string> = {
  erd: "name type",
  arch: 'id "what it does"',
  c4: 'id "what it does"',
  class: "+method()",
};

/** The kinds that draw C4's wrapping sentence — the only third string anything renders. */
const describes = (type: string, kind: string): boolean => type === "c4" || kind === "extsystem" || kind === "person";

/** Which flags a node may wear. `quiet` is an edge's; these two are a node's, in every dialect. */
const NODE_FLAGS: { flag: Flag; label: string }[] = [
  { flag: "async", label: "async" },
  { flag: "external", label: "external" },
];

export function Props({
  item,
  editor,
  pages,
  body,
  subject,
  showItem,
  onBody,
}: {
  item: BoardItem;
  editor: Editor;
  pages: BoardPage[];
  /** The panel's draft — what the person is looking at, which may be ahead of the file. */
  body: string;
  subject: Subject | null;
  /** Whether the item's own fields belong on screen: the props half, or an item with no halves. */
  showItem: boolean;
  onBody(next: string): void;
}) {
  if (subject) {
    /* `pickNode(item, null)` is how a pick is let go: it clears the node, the edge and the board
       link in one, which is what Escape does one layer up. */
    return (
      <PickProps
        type={item.type}
        layout={item.layout}
        body={body}
        subject={subject}
        /* Read every render, like the pick's own ring: the layout's answer lives on the page and
           there is no signal from inside a memoised, asynchronously laid out subtree to depend on.
           One `querySelector` is cheaper than inventing one — the argument `paint()` already makes. */
        column={subject.what === "node" ? editor.columnOf(item.id, subject.id) : null}
        onBody={onBody}
        onOut={() => editor.pickNode(item.id, null)}
      />
    );
  }
  return showItem ? <ItemProps item={item} editor={editor} pages={pages} body={body} onBody={onBody} /> : null;
}

/* ------------------------------------------------------------------ the thing inside a diagram */

function Head({ what, id, line, onOut }: { what: string; id: string; line: number; onOut(): void }) {
  return (
    <div className="dag-props__head">
      <button type="button" className="dag-props__out" data-dag-prop-out="" title="Back to the item (Esc)" onClick={onOut}>
        <CornerUpLeft {...ICON} aria-hidden="true" />
      </button>
      <span className="dag-props__what">{what}</span>
      <span className="dag-props__id" title={`line ${line}`}>
        {id}
      </span>
    </div>
  );
}

/**
 * A text field that commits on blur and on Enter, and re-reads itself when the file says something
 * different.
 *
 * Uncontrolled, with the value in the `key`: a controlled input would fight the debounce — the
 * caret jumps to the end every time the file comes back — and a `defaultValue` alone would never
 * notice Claude renaming the thing under it.
 */
function Field({
  label,
  value,
  hook,
  placeholder,
  mono,
  onSet,
}: {
  label: string;
  value: string;
  hook: string;
  placeholder?: string;
  mono?: boolean;
  onSet(next: string): void;
}) {
  return (
    <label className="dag-field">
      <span>{label}</span>
      <input
        className={mono ? "dag-input dag-input--mono" : "dag-input"}
        {...{ [hook]: "" }}
        defaultValue={value}
        key={`${hook}:${value}`}
        placeholder={placeholder}
        onBlur={(e) => e.target.value !== value && onSet(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

/**
 * A number, or nothing at all. Anything else is refused **in the box**.
 *
 * Refused rather than coerced, because `Number("")` is 0 and `Number("4o")` is `NaN`, and both of
 * those written into a `min` line are a chart that draws something nobody asked for. The box goes
 * back to what the file says, which is the same answer the id field gives a collision.
 */
function NumberField({
  label,
  hook,
  value,
  onSet,
}: {
  label: string;
  hook: string;
  value: string;
  onSet(next: number | null): void;
}) {
  return (
    <label className="dag-field dag-field--row">
      <span>{label}</span>
      <input
        className="dag-input"
        {...{ [hook]: "" }}
        inputMode="decimal"
        placeholder="auto"
        defaultValue={value}
        key={`${hook}:${value}`}
        onBlur={(e) => {
          const text = e.target.value.trim();
          if (text === value) return;
          if (text === "") {
            onSet(null);
            return;
          }
          const n = Number(text);
          if (Number.isFinite(n)) onSet(n);
          else e.target.value = value;
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

/**
 * What a person may type into the Values field: numbers and `-`, separated by spaces or commas.
 *
 * `null` is "that is not a list of values", and the field says so rather than writing it. A word
 * that is not a number is `E_CHART_VALUE` at the parse — the chart would still draw, with an error
 * card over it — and a control whose whole job is one line of data should not be the way that
 * happens.
 */
function readValues(text: string): (number | null)[] | null {
  const out: (number | null)[] = [];
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    if (word === "-") {
      out.push(null);
      continue;
    }
    const n = Number(word);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** Words, or comma-separated phrases: `Q1 Q2 Q3` and `Jan, Feb, Mar` both say what they look like. */
const splitLabels = (text: string): string[] =>
  (text.includes(",") ? text.split(",") : text.split(/\s+/)).map((s) => s.trim()).filter(Boolean);

/** The run of numbers on a `series` or `slice` line, edited as the line writes them. */
function ValuesField({
  label,
  value,
  one,
  onSet,
}: {
  label: string;
  value: string;
  /** A slice has one value by definition, so a second typed into it is not something to write. */
  one: boolean;
  onSet(values: (number | null)[]): void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <>
      <label className="dag-field">
        <span>{label}</span>
        <input
          className="dag-input dag-input--mono"
          data-dag-prop-values=""
          placeholder={one ? "62" : "12 30 - 21"}
          defaultValue={value}
          key={`values:${value}`}
          onFocus={() => setBad(false)}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (text === value) return;
            const next = readValues(text);
            if (next === null) {
              setBad(true);
              e.target.value = value;
              return;
            }
            onSet(one ? next.slice(0, 1) : next);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      {bad ? (
        <p className="dag-field__hint dag-field__hint--bad" data-dag-prop-values-error="">
          A value is a number, or <code>-</code> for a gap.
        </p>
      ) : null}
    </>
  );
}

function Hues({
  hue,
  onSet,
  label = "Hue",
  hook = "data-dag-prop-hue",
  none = "No hue of its own: inherit",
}: {
  hue: string;
  onSet(next: string | null): void;
  /** What a screen reader calls the row — a diagram's frame is not the card inside it. */
  label?: string;
  /** The attribute each swatch carries, so a check can tell two rows in one panel apart. */
  hook?: string;
  none?: string;
}) {
  return (
    <div className="dag-props__row" role="group" aria-label={label}>
      <button
        type="button"
        className={hue === "" ? "dag-swatch dag-swatch--none dag-swatch--on" : "dag-swatch dag-swatch--none"}
        aria-pressed={hue === ""}
        title={none}
        data-dag-hue-none=""
        onClick={() => onSet(null)}
      />
      {HUE_ORDER.map((h) => (
        <button
          key={h}
          type="button"
          {...{ [hook]: h }}
          className={hue === h ? "dag-swatch dag-swatch--on" : "dag-swatch"}
          style={{ background: `var(--dag-tint-${h})` }}
          aria-pressed={hue === h}
          aria-label={h}
          title={h}
          onClick={() => onSet(hue === h ? null : h)}
        />
      ))}
    </div>
  );
}

/**
 * The text-style control: the `bold` / `italic` flags a node's title wears.
 *
 * Two toggle buttons rather than checkboxes in `NODE_FLAGS`, and that is a statement about the
 * grouping, not a layout choice: `async` and `external` are claims about the thing in the system,
 * these two are about how its name is drawn, and one row of checkboxes holding both would say
 * they are the same kind of statement.
 *
 * The state is read off the line with the strings blanked out first — the trick `PickProps` and
 * the status scan already use — so `bold` inside a quoted title is a word in a title, not the
 * flag. The caller gates it to the dialects whose parsers read flags, which is `kindsOf`:
 * non-empty exactly where statements go through `modifiers()`, because `mindmap`, `timeline`,
 * `gitgraph`, `sequence` and `chart` parse their own bodies and have no flag grammar — a bare
 * word there is part of the label, or a value where the numbers are read from.
 */
function Em({ src, onSet }: { src: string; onSet(flag: Flag, on: boolean): void }) {
  /* The strings blanked out first, so `bold` inside a quoted title is a word in a title, not the
     flag — the same read `flagOn` in PickProps makes, and deliberately not a second regex. */
  const bare = src.replace(/"[^"]*"/g, '""');
  const on = (f: Flag) => new RegExp(`(?:^|\\s)${f}(?:\\s|$)`).test(bare);
  return (
    <div className="dag-props__row" role="group" aria-label="Text style">
      {(["bold", "italic"] as const).map((f) => (
        <button
          key={f}
          type="button"
          data-dag-prop-em={f}
          className={`dag-props__em dag-props__em--${f}${on(f) ? " dag-props__em--on" : ""}`}
          aria-pressed={on(f)}
          title={f === "bold" ? "Bold title" : "Italic title"}
          onClick={() => onSet(f, !on(f))}
        >
          {f === "bold" ? "B" : "I"}
        </button>
      ))}
    </div>
  );
}

/**
 * The style block for a diagram item that is one bare node.
 *
 * The item's frame has no fill, no kind and no icon — there is genuinely nothing to style about
 * it — and the node inside it has all three. So the item view shows *that node's* controls and
 * writes its line in the body, the way a pick does, rather than an attribute on the fence.
 *
 * Everything reads and writes the **line**, not the parse. `finalize()` has already done its
 * inheriting by the time a hue reaches the IR, so a swatch that offered the parsed node's hue
 * would offer to write what the card is already showing; a one-node diagram has no group, but
 * the reading habit is one rule, not two — the same paragraph `PickProps` carries on its own hue.
 */
function NodeStyle({ type, body, node, onBody }: { type: string; body: string; node: Node; onBody(next: string): void }) {
  const src = body.split("\n")[node.line - 1] ?? "";
  const write = (next: string) => onBody(replaceLine(body, node.line, next));
  const mod = (key: ModifierKey, value: string | null) => write(setModifier(src, key, value));
  const hue = /(?:^|\s)hue=([A-Za-z0-9_-]+)/.exec(src)?.[1] ?? "";
  const kind = /^\s*([A-Za-z0-9_-]+)\s/.exec(src)?.[1] ?? "";
  const icon = /(?:^|\s)icon=([A-Za-z0-9_:.-]+)/.exec(src)?.[1] ?? "";
  const kinds = kindsOf(type);

  return (
    <div className="dag-props__fields" data-dag-item-style={node.id}>
      <Hues hue={hue} onSet={(h) => mod("hue", h)} />
      <Em src={src} onSet={(f, on) => write(setFlag(src, f, on))} />
      {kinds.length > 0 && kinds.includes(kind) ? (
        <label className="dag-field dag-field--row">
          <span>Kind</span>
          <select className="dag-select" data-dag-prop-kind="" value={kind} onChange={(e) => write(setKind(src, e.target.value))}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* The picker a pick gets, not a bare field: a lone picture dropped from the library is
          exactly the item whose icon somebody wants to change, and fifteen hundred emoji plus
          every logo is not a vocabulary anybody can type from memory. */}
      <IconPicker
        key={`${node.id}:${node.line}`}
        value={icon}
        hue={hue === "" ? undefined : (hue as Hue)}
        kind={kind}
        onSet={(v) => mod("icon", v)}
      />
    </div>
  );
}

function PickProps({
  type,
  layout,
  body,
  subject,
  column,
  onBody,
  onOut,
}: {
  type: string;
  layout?: "fixed";
  body: string;
  subject: Subject;
  /** The layer the layout put this card in, if it is the kind of diagram that has layers. */
  column: number | null;
  onBody(next: string): void;
  onOut(): void;
}) {
  const { id, what, line, seg } = subject;
  const src = body.split("\n")[line - 1] ?? "";
  const write = (next: string) => onBody(replaceLine(body, line, next));
  const mod = (key: ModifierKey, value: string | null) => write(setModifier(src, key, value));

  /* Read back off the *line*, not off the IR: `finalize()` has already inherited a group's hue
     down onto its children, so every card in a tinted group would show that hue as its own and
     clicking the swatch it was already wearing would write it explicitly onto the node. */
  const hue = /(?:^|\s)hue=([A-Za-z0-9_-]+)/.exec(src)?.[1] ?? "";

  if (what === "edge") {
    const span = edgeSpan(src);
    const arrow = span?.arrows[seg]?.value ?? "";
    const label = span?.tails[seg + 1]?.strings[0]?.value ?? "";
    const quiet = /(?:^|\s)quiet(?:\s|$)/.test(src.replace(/"[^"]*"/g, '""'));
    /* The tokenizer's own table, plus whatever is written here in case it is not in it — the ER
       cardinalities are matched structurally rather than enumerated, and offering a menu that
       silently drops `}o--||` would be worse than offering none. */
    const spellings = [...new Set([arrow, ...ARROWS.map(([text]) => text)])].filter(Boolean);

    return (
      <div className="dag-props" data-dag-props={id}>
        <Head what={subject.link ? "link" : "edge"} id={id} line={line} onOut={onOut} />
        <div className="dag-props__row">
          <input
            className="dag-input dag-props__label"
            data-dag-prop-label=""
            aria-label="Label"
            placeholder="label"
            defaultValue={label}
            key={`label:${id}:${line}:${seg}:${label}`}
            onBlur={(e) => e.target.value.trim() !== label && write(setEdgeLabel(src, e.target.value.trim() || null, seg))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="dag-props__row">
          <select
            className="dag-select dag-props__arrow"
            data-dag-prop-arrow=""
            aria-label="Arrow"
            value={arrow}
            onChange={(e) => write(setEdgeArrow(src, e.target.value, seg))}
          >
            {spellings.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <label className="dag-field dag-field--row">
            <input
              type="checkbox"
              className="dag-check"
              data-dag-prop-quiet=""
              checked={quiet}
              onChange={(e) => write(setEdgeFlag(src, "quiet", e.target.checked))}
            />
            <span>quiet</span>
          </label>
        </div>
        {/* F3 promoted `hue=` in `parseEdge`, so this recolours the line rather than claiming to.
            `finalize()` still derives one from the source where the author wrote none. */}
        <Hues hue={hue} onSet={(h) => write(setEdgeHue(src, h))} />
      </div>
    );
  }

  const kinds = kindsOf(type);
  const kind = /^\s*([A-Za-z0-9_-]+)\s/.exec(src)?.[1] ?? "";
  const isNode = what === "node";
  /*
   * A chart statement is `<kind> <id> "Label" <values…>`, so every writer above already fits it —
   * but most of the *controls* do not. A meta is a second string the chart parser reads and never
   * draws; a status or a flag is a bare word in the position the values are read from, so `done`
   * on a `series` line is `E_CHART_VALUE`. What is left is the label, the hue, and the numbers.
   */
  const isChart = type === "chart";
  /*
   * The statement's own strings — its title, meta and desc — read the way `textSlots` reads them:
   * the *consecutive* run right after the id. Not a regular expression over the line, because a
   * quoted modifier value (`icon="two words"`) is a string too and would shift every slot along by
   * one; the tokenizer already knows which is which, and its `value` is the content without the
   * quotes and with the escapes resolved.
   */
  const toks = tokenize(src, []).filter((t) => t.kind !== "sep" && t.kind !== "eof");
  const idAt = toks[0]?.kind === "word" ? (toks[1]?.kind === "word" ? 1 : 0) : -1;
  const strings: string[] = [];
  for (let i = idAt + 1; i >= 1 && i < toks.length && toks[i]!.kind === "string"; i++) strings.push(toks[i]!.value);
  const slot = (n: number) => strings[n] ?? "";
  const status = STATUSES.find((s) => new RegExp(`(?:^|\\s)${s}(?:\\s|$)`).test(src.replace(/"[^"]*"/g, '""'))) ?? "";
  const icon = /(?:^|\s)icon=([A-Za-z0-9_:.-]+)/.exec(src)?.[1] ?? "";
  const writtenCol = /(?:^|\s)col=(\d+)/.exec(src)?.[1] ?? "";
  const flagOn = (f: Flag) => new RegExp(`(?:^|\\s)${f}(?:\\s|$)`).test(src.replace(/"[^"]*"/g, '""'));

  return (
    <div className="dag-props" data-dag-props={id}>
      {/* A chart says which of its two words this is, because both are `node` to everything else on
          the board and "series" against "slice" is the whole difference a reader cares about. */}
      <Head what={isChart && kind ? kind : what} id={id} line={line} onOut={onOut} />

      <div className="dag-props__fields">
        {isNode && kinds.length > 0 && kinds.includes(kind) ? (
          <label className="dag-field dag-field--row">
            <span>Kind</span>
            <select
              className="dag-select"
              data-dag-prop-kind=""
              value={kind}
              onChange={(e) => write(setKind(src, e.target.value))}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Field
          label={isChart ? "Label" : "Title"}
          hook="data-dag-prop-title"
          value={type === "mindmap" ? src.replace(/^[ \t]*(root\s+)?/, "") : slot(0)}
          placeholder={id}
          onSet={(v) => {
            /* A mindmap line *is* its title — indentation is the grammar and there is no id to
               hang a string off — so clearing it would leave a blank line where a statement was.
               Everywhere else an empty box means the title comes off, which the grammar can say. */
            const t = v.trim();
            if (type === "mindmap" && t === "") return;
            write(setTitle(src, t || null, type));
          }}
        />

        {/* Colour and text style, directly after the kind and the name: what a person
            reaching into a card wants first. The strings and the values below are the thing's own
            content — not chrome — so they keep their place, and keep it *under* these. */}
        <Hues hue={hue} onSet={(h) => mod("hue", h)} />
        {isNode && !isChart && kindsOf(type).length > 0 ? <Em src={src} onSet={(f, on) => write(setFlag(src, f, on))} /> : null}

        {type === "mindmap" || isChart ? null : (
          <Field
            label={what === "group" ? "Sublabel" : "Meta"}
            hook="data-dag-prop-meta"
            value={slot(1)}
            onSet={(v) => write(setMeta(src, v.trim() || null))}
          />
        )}
        {/* The data itself, which is the whole reason this dialect exists. */}
        {isChart ? (
          <ValuesField
            label={kind === "slice" ? "Value" : "Values"}
            value={valuesText(src)}
            one={kind === "slice"}
            onSet={(values) => write(setValues(src, values))}
          />
        ) : null}
        {isNode && describes(type, kind) ? (
          <Field
            label="Description"
            hook="data-dag-prop-desc"
            value={slot(2)}
            onSet={(v) => write(setDesc(src, v.trim() || null))}
          />
        ) : null}
      </div>

      {/* Both are left out of a chart, for different reasons. A status is a bare word in the
          position a chart reads its values from, so `done` on a `series` line is `E_CHART_VALUE` —
          the control would break the chart it was used on. An icon merely does nothing there: it
          parses and is checked, and a series is named by its swatch. */}
      {isChart ? null : (
        <div className="dag-props__row">
          <select
            className="dag-select dag-props__status"
            data-dag-prop-status=""
            aria-label="Status"
            value={status}
            onChange={(e) => write(setStatus(src, (e.target.value || null) as Status | null))}
          >
            <option value="">no status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* The picker writes through the same `mod` the input did — one span in, one span out, the
          author's spacing and comments untouched — and is keyed to the pick so a change of card
          re-reads its mode and text from the line. */}
      {!isChart && isNode ? (
        <IconPicker
          key={`${id}:${line}`}
          value={icon}
          hue={hue === "" ? undefined : (hue as Hue)}
          kind={kind}
          onSet={(v) => mod("icon", v)}
        />
      ) : null}

      {isNode && !isChart ? (
        <div className="dag-props__row" role="group" aria-label="Flags">
          {NODE_FLAGS.map(({ flag, label }) => (
            <label key={flag} className="dag-field dag-field--row">
              <input
                type="checkbox"
                className="dag-check"
                data-dag-prop-flag={flag}
                checked={flagOn(flag)}
                onChange={(e) => write(setFlag(src, flag, e.target.checked))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      ) : null}

      {isNode && layered(type, layout) ? <Column written={writtenCol} current={column} onSet={(v) => mod("col", v)} /> : null}

      {/* The one dialect with no reading for a drag at all, saying so where a person will look for
          it after the cursor has already said no. */}
      {REFUSAL[type] ? <p className="dag-field__hint">{REFUSAL[type]}</p> : null}

      {isNode && hasRows(type) ? <Rows type={type} body={body} line={line} onBody={onBody} /> : null}
    </div>
  );
}

/**
 * `col=` — the layer to keep this card in, offered as the number the layout just used.
 *
 * The one control here that is about *placement*, and it exists because a structural drag has one
 * honest failure: under `aspect > 0` ELK folds the diagram to a shape, so a card dropped past its
 * neighbour lands wherever the fold puts it and the file's new line order is only a tie-break. This
 * is what a person who meant it can say instead — ELK's partitioning is the one placement
 * constraint it honours exactly, and it still chooses where in the layer the card sits.
 *
 * **Offered, never written by the drag.** A gesture that quietly pinned a column would make the
 * layout stop responding to the file, which is what automatic layout is for; and a pin nobody asked
 * for is the kind of thing a person finds out about three edits later.
 *
 * The number offered is the layer the card is drawn in, which is a good number to start from and
 * not a promise about the answer: `col=` ranks the cards that carry one against each other and ELK
 * compacts the rest, so one pin on its own changes nothing and two hold their order. See `Node.col`.
 */
function Column({ written, current, onSet }: { written: string; current: number | null; onSet(next: string | null): void }) {
  if (written === "" && current === null) return null;
  return (
    <div className="dag-props__row" role="group" aria-label="Column">
      {written === "" ? (
        <button type="button" className="dag-props__add" data-dag-prop-col={current} onClick={() => onSet(String(current))}>
          Keep in column {current}
        </button>
      ) : (
        <>
          <span className="dag-field__hint">Kept in column {written}</span>
          <button type="button" className="dag-props__add" data-dag-prop-col-clear="" onClick={() => onSet(null)}>
            Release
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The rows under a card, as the lines they are.
 *
 * Addressed by line, which is what `setRow` and `removeRow` take and what `addRow` produces: a new
 * block is always written over three lines with the row on its own, because a row sharing a line
 * with a brace cannot be addressed by a line number at all.
 */
function Rows({ type, body, line, onBody }: { type: string; body: string; line: number; onBody(next: string): void }) {
  const rows = useMemo(() => rowLines(body, line), [body, line]);
  const hint = ROW_HINT[type] ?? "a row";
  return (
    <div className="dag-props__rows" data-dag-prop-rows="">
      {rows.map((row) => (
        <div className="dag-props__rowline" key={`${row.line}:${row.text}`}>
          <input
            className="dag-input dag-input--mono"
            data-dag-prop-row={row.line}
            aria-label={`Row ${row.text}`}
            defaultValue={row.text}
            onBlur={(e) => e.target.value.trim() !== row.text && onBody(setRow(body, row.line, e.target.value.trim()))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <button
            type="button"
            className="dag-icon dag-icon--tiny"
            data-dag-prop-row-remove={row.line}
            aria-label={`Remove ${row.text}`}
            title="Remove this row"
            onClick={() => onBody(removeRow(body, row.line))}
          >
            <Trash2 {...ICON} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dag-props__add"
        data-dag-prop-row-add=""
        onClick={() => onBody(writeRow(body, line, hint))}
      >
        <Plus {...ICON} aria-hidden="true" /> Add a row
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------------- the chart */

/**
 * A chart's own settings: its form, its two flags, its four options and its categories.
 *
 * The one *item* view whose controls write the **body** rather than a fence attribute, and that is
 * decision 1 of the plan showing through: the form is a body statement so that `src/board/` never
 * has to know what a chart is. Each writer finds its own line or writes one — a chart has at most
 * one of each of these — so there is nothing here to point a line number at, and none of them takes
 * one.
 *
 * Read back through `parseChart`, not off the text, because these are single statements a person
 * may have written anywhere in the body and in any order; the pick's half reads its *line*, for the
 * opposite reason (`finalize()` would otherwise offer to write back what a card is already showing).
 */
function ChartProps({ body, onBody }: { body: string; onBody(next: string): void }) {
  const model = useMemo(() => parseChart(body), [body]);
  const option = (key: "legend" | "unit" | "min" | "max" | "values", value: string | number | boolean | null) =>
    onBody(setChartOption(body, key, value));

  return (
    <>
      <label className="dag-field dag-field--row">
        <span>Form</span>
        <select
          className="dag-select"
          data-dag-prop-form=""
          value={model.form}
          onChange={(e) => onBody(setChartForm(body, e.target.value as ChartForm))}
        >
          {FORMS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      {/* Only bars stack, and only bars turn on their side. A line has one direction and a wedge
          has none, so the two checkboxes are left out rather than offered and ignored. */}
      {model.form === "bar" ? (
        <div className="dag-props__row" role="group" aria-label="Bars">
          {(["stacked", "horizontal"] as const).map((flag) => (
            <label key={flag} className="dag-field dag-field--row">
              <input
                type="checkbox"
                className="dag-check"
                data-dag-prop-chart-flag={flag}
                checked={model[flag]}
                onChange={(e) => onBody(setChartFlag(body, flag, e.target.checked))}
              />
              <span>{flag}</span>
            </label>
          ))}
        </div>
      ) : null}

      <label className="dag-field dag-field--row">
        <span>Legend</span>
        {/* "automatic" is the absence of the statement, which is a real answer and not a default:
            the layout draws one for two or more things and none for one. */}
        <select
          className="dag-select"
          data-dag-prop-legend=""
          value={model.legendAt ?? ""}
          onChange={(e) => option("legend", e.target.value || null)}
        >
          <option value="">automatic</option>
          <option value="none">none</option>
          <option value="right">right</option>
          <option value="bottom">bottom</option>
        </select>
      </label>

      <label className="dag-field dag-field--row">
        <input
          type="checkbox"
          className="dag-check"
          data-dag-prop-value-labels=""
          checked={model.values}
          onChange={(e) => option("values", e.target.checked)}
        />
        <span>Value labels</span>
      </label>

      <Field
        label="Unit"
        hook="data-dag-prop-unit"
        value={model.unit ?? ""}
        placeholder="k€"
        onSet={(v) => option("unit", v.trim() || null)}
      />

      <div className="dag-props__row">
        <NumberField
          label="Min"
          hook="data-dag-prop-min"
          value={model.min === undefined ? "" : String(model.min)}
          onSet={(v) => option("min", v)}
        />
        <NumberField
          label="Max"
          hook="data-dag-prop-max"
          value={model.max === undefined ? "" : String(model.max)}
          onSet={(v) => option("max", v)}
        />
      </div>

      {/* Emptied, the `x` line goes: no categories is a legitimate chart — the ticks come out
          `1…n` — and a bare `x` is not something the grammar should be made to mean. */}
      <Field
        label="Categories"
        hook="data-dag-prop-categories"
        value={model.categories.join(" ")}
        placeholder="Q1 Q2 Q3"
        onSet={(v) => onBody(setCategories(body, splitLabels(v)))}
      />
    </>
  );
}

/* --------------------------------------------------------------------------------- the item */

/**
 * How a laid-out diagram folds: `aspect=`, the one fence attribute the side handles write and
 * nothing could take back off.
 *
 * Three answers and each is a different thing in the file — *theme default* removes the attribute,
 * *never wrap* is `aspect=0` (a pipeline that must read as one line), *fold to a shape* is a width
 * over a height. The handles write the third, so the number box shows what they wrote. A value the
 * parser rejected (`EB_BAD_ASPECT`) is its own, disabled, option: the select says what the file
 * holds rather than pretending it says "default", and picking anything replaces it.
 */
function Wrapping({ item, editor }: { item: BoardItem; editor: Editor }) {
  const raw = item.attrs.map.aspect;
  const choice = aspectChoice(raw);
  const write = (value: number | null | undefined) => value !== undefined && editor.setAttrs(item.id, { aspect: value });
  return (
    <>
      <label className="dag-field dag-field--row">
        <span>Wrapping</span>
        <select
          className="dag-select"
          data-dag-item-aspect=""
          value={choice}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "ratio") write(aspectAttr("ratio", typeof raw === "number" && raw > 0 ? raw : ASPECT_START));
            else if (next === "auto" || next === "off") write(aspectAttr(next));
          }}
        >
          <option value="auto">theme default</option>
          <option value="off">never wrap</option>
          <option value="ratio">fold to a shape</option>
          {choice === "invalid" ? (
            <option value="invalid" disabled>
              not a number
            </option>
          ) : null}
        </select>
      </label>
      {choice === "ratio" ? (
        <label className="dag-field dag-field--row">
          <span>Width ÷ height</span>
          <input
            className="dag-input"
            data-dag-item-aspect-ratio=""
            inputMode="decimal"
            defaultValue={String(raw)}
            key={`aspect:${String(raw)}`}
            onBlur={(e) => {
              const n = Number(e.target.value.trim());
              if (e.target.value.trim() !== "" && aspectAttr("ratio", n) !== undefined) write(aspectAttr("ratio", n));
              else e.target.value = String(raw);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
      ) : null}
      {choice === "invalid" ? (
        <p className="dag-field__hint dag-field__hint--bad" data-dag-item-aspect-bad="">
          The file has <code>aspect={String(raw)}</code>, which is not a shape. Pick one above.
        </p>
      ) : null}
    </>
  );
}

function ItemProps({
  item,
  editor,
  pages,
  body,
  onBody,
}: {
  item: BoardItem;
  editor: Editor;
  pages: BoardPage[];
  /** The draft, for the one type whose *item* fields are statements in its body rather than attrs. */
  body: string;
  onBody(next: string): void;
}) {
  const [renameError, setRenameError] = useState<string | null>(null);
  const [convert, setConvert] = useState<"detach" | "relayout" | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const diagram = isDiagramType(item.type);
  const links = isLinkType(item.type);
  const fixed = item.type === "sketch" || item.layout === "fixed";
  const attr = (key: string, value: string) => editor.setAttrs(item.id, { [key]: value.trim() === "" ? null : value });

  /*
   * A diagram item that is one bare node: the item view shows *that node's* styling controls and
   * writes its line — the answer to why the panel looked useless over a shape dropped
   * from the library. Memoised on the **draft** body, not on `item.body`: the panel's draft may
   * be a quarter of a second ahead of the file, which is the same reason `Inspector.tsx` hands
   * the draft to `pickFromLine` and `declaredAt`. The other item fields the parse reads ride
   * along in the deps, because they are read even though the body is what usually moves.
   */
  const lone = useMemo(() => loneNode({ ...item, body }), [item.id, item.type, item.dir, item.aspect, item.layout, body]);

  /* The disclosure belongs to the thing being looked at, so it closes when that thing changes.
     Plain state, and deliberately not in `localStorage`: a preference about a panel belongs in
     `src/settings/` only when it is one worth a key, and how wide an inspector is or which mode
     it shows are — this is not. */
  useEffect(() => setAdvanced(false), [item.id]);

  return (
    <div className="dag-inspector__fields" data-dag-item-props={item.id}>
      {/*
       * Style, always first. What it is depends on what the item is:
       *
       * - A diagram holding one bare node: that node's own controls (`NodeStyle`), written on
       *   the node's line in the body.
       * - An `md`, a note or an image: the item's own hue, on the fence — F6's attribute, and
       *   until it was shown here only writable by typing it onto the fence line.
       * - A multi-node diagram: **no style block at all.** There is no one line a swatch could
       *   honestly recolour, and the person picks the card they mean.
       */}
      {links ? null : lone ? (
        <NodeStyle type={item.type} body={body} node={lone} onBody={onBody} />
      ) : !diagram ? (
        <Hues hue={item.hue ?? ""} onSet={(h) => editor.setAttrs(item.id, { hue: h })} />
      ) : item.type === "chart" ? null : (
        /* A many-card diagram has no style block, and an empty panel reads as one that failed to
           load rather than as one with nothing to say. This says which — and it is the same move
           the `col=` refusal and the `aspect` note already make: where a control would be a lie,
           put the reason where somebody is looking for the control. The footer says it too, in
           grey, under everything; a person who opened this panel to recolour something is looking
           at the top of it. */
        <p className="dag-field__hint" data-dag-item-pickme="">
          Click a card to change its colour, kind, icon or text.
        </p>
      )}

      {/*
       * A diagram's own hue: the tint of its frame — the hairline round it and the band behind its
       * header — which is a different thing from the hue of a card inside it, so it is labelled and
       * hooked apart from the row above. *None* first, as on every swatch row, and it is
       * `hue=` on the fence line, which is all a diagram's frame has to say about colour.
       */}
      {diagram ? (
        <div className="dag-field" data-dag-frame-hue-row="">
          <span>Frame colour</span>
          <Hues
            hue={item.hue ?? ""}
            label="Frame colour"
            hook="data-dag-frame-hue"
            none="No tint on the frame"
            onSet={(h) => editor.setAttrs(item.id, { hue: h })}
          />
        </div>
      ) : null}

      {/* The item's own content, which is not chrome and does not get hidden: a note's checkbox,
          an image's source and a chart's own settings are what the item *is*. */}
      {diagram ? (
        /* The one diagram whose own settings are statements rather than fence attributes: the
            form is a body word on purpose, so `src/board/` never learns what a chart is. */
        item.type === "chart" ? (
          <ChartProps body={body} onBody={onBody} />
        ) : null
      ) : item.type === "md" ? (
        <label className="dag-field dag-field--row">
          <input
            type="checkbox"
            className="dag-check"
            checked={item.note}
            onChange={(e) => editor.setAttrs(item.id, { note: e.target.checked ? true : null })}
          />
          <span>Draw as a note</span>
        </label>
      ) : links ? null : (
        <Field label="Source" hook="data-dag-item-src" value={item.src ?? ""} onSet={(v) => attr("src", v)} />
      )}

      {/*
       * The structural half, behind a disclosure collapsed by default.
       *
       * Everything in here is a claim about the item as a thing in the board — where it sits,
       * what it is called, whether it draws, how it is converted — and none of it is what a
       * person who just dropped a component came to change. It resets per item and is not
       * remembered across them on purpose.
       *
       * **Title and Subtitle are moved here, not deleted.** Cutting them would leave `title=`
       * and `subtitle=` with no control at all, and a control that is missing is a line somebody
       * has to go and type. What moved them is where they sat: at the top of the panel as though
       * every component should have a header, which F0 decided none should — a header is
       * something the author asks for. A person who wants a standalone title reaches for the
       * `Heading` atom in `src/board/library/diagrams.ts`, placed where they want it.
       */}
      <div className="dag-props__adv" data-dag-advanced="">
        <button
          type="button"
          className="dag-props__adv-head"
          data-dag-advanced-toggle=""
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <ChevronDown {...ICON} aria-hidden="true" />
          Advanced
        </button>
        {advanced ? (
          <div className="dag-props__adv-body" data-dag-advanced-body="">
            {/* Which page this sits on. `edges` has no place on the paper, but it does belong to
                a page: its links are resolved within one. */}
            {pages.length > 1 ? (
              <label className="dag-field dag-field--row">
                <span>Page</span>
                <select
                  className="dag-select"
                  data-dag-item-page=""
                  value={item.page}
                  onChange={(e) => editor.pages.moveTo(e.target.value, [item.id])}
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {diagram ? (
              <>
                <Field
                  label="Title"
                  hook="data-dag-item-title"
                  value={item.title ?? ""}
                  placeholder="Untitled"
                  onSet={(v) => attr("title", v)}
                />
                <Field
                  label="Subtitle"
                  hook="data-dag-item-subtitle"
                  value={item.subtitle ?? ""}
                  onSet={(v) => attr("subtitle", v)}
                />
                {/* A header is something the author asks for — no fallback to the id, no
                    exception for how many cards it holds — so a diagram with neither is quietly
                    missing the one thing that would draw it. `frame=full` is the other way. */}
                {!item.title && !item.subtitle ? <p className="dag-field__hint">Set a title to draw a header.</p> : null}
                {/* The dialects with no direction to set. Not `hasGraph()`: three of these are
                    `Graph`s whose layout has an axis of its own, and one of them (`chart`) is
                    not — the two questions happen to overlap on `sequence` and nowhere else. */}
                {item.type !== "sequence" &&
                item.type !== "timeline" &&
                item.type !== "gitgraph" &&
                item.type !== "mindmap" &&
                item.type !== "chart" ? (
                  <label className="dag-field dag-field--row">
                    <span>Direction</span>
                    <select className="dag-select" value={item.dir ?? ""} onChange={(e) => attr("dir", e.target.value)}>
                      <option value="">theme default</option>
                      <option value="LR">left to right</option>
                      <option value="TB">top to bottom</option>
                    </select>
                  </label>
                ) : null}
                <label className="dag-field dag-field--row">
                  <span>Header</span>
                  <select className="dag-select" value={item.frame ?? ""} onChange={(e) => attr("frame", e.target.value)}>
                    <option value="">automatic</option>
                    <option value="full">always</option>
                    <option value="none">never</option>
                  </select>
                </label>
              </>
            ) : null}

            {links ? null : (
              <label className="dag-field dag-field--row">
                <input
                  type="checkbox"
                  className="dag-check"
                  data-dag-item-hidden=""
                  checked={item.hidden}
                  onChange={(e) => editor.setAttrs(item.id, { hidden: e.target.checked ? true : null })}
                />
                <span>Hidden (⌃⇧H)</span>
              </label>
            )}

            {/* The id. Not `restate.ts`'s `renameId`, which renames a DSL id inside one body:
                this is the name the *board* addresses the item by from outside its fence, so
                every `edges` reference on every page moves with it. Refused inline when somebody
                already has the name — a collision would make `locateItems` report two items with
                one id the moment it next ran. Not decorative, and not gone with the milestone:
                an `edges` link names this id (`arch-3.db`), and this field is what rewrites every
                reference to it at once. */}
            <label className="dag-field">
              <span>Id</span>
              <input
                className="dag-input dag-input--mono"
                data-dag-item-id=""
                defaultValue={item.id}
                key={`id:${item.id}`}
                onFocus={() => setRenameError(null)}
                onBlur={(e) => {
                  const to = e.target.value;
                  if (to === item.id) return;
                  void editor.renameItem(item.id, to).then((err) => {
                    setRenameError(err);
                    if (err) e.target.value = item.id;
                  });
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            {renameError ? (
              <p className="dag-field__hint dag-field__hint--bad" data-dag-item-id-error="">
                {renameError}
              </p>
            ) : null}

            {/*
             * The two declared conversions between an automatic layout and the author's own
             * geometry.
             *
             * Both rewrite the whole body, which is why each asks first, in the row rather than
             * through `confirm()`: a modal dialog blocks the page, cannot be styled, and cannot
             * be driven by the checks that have to prove it works — the same argument the board
             * list makes.
             */}
            {fixed || (diagram && detachable(item.type)) ? (
              <div className="dag-props__convert" data-dag-convert="">
                {convert === null ? (
                  <button
                    type="button"
                    className="dag-props__add"
                    data-dag-detach={fixed ? "relayout" : "detach"}
                    onClick={() => setConvert(fixed ? "relayout" : "detach")}
                  >
                    {fixed ? "Re-layout" : "Detach"}
                  </button>
                ) : (
                  <>
                    <p className="dag-field__hint">
                      {convert === "detach"
                        ? "Every card keeps where it is now, and you place them from here on."
                        : "Every x= and y= goes, and the layout takes over again."}
                    </p>
                    <button
                      type="button"
                      className="dag-props__add"
                      data-dag-convert-go=""
                      onClick={() => {
                        setConvert(null);
                        if (convert === "detach") editor.detach(item.id);
                        else editor.relayout(item.id);
                      }}
                    >
                      {convert === "detach" ? "Detach" : "Re-layout"}
                    </button>
                    <button type="button" className="dag-props__add" data-dag-convert-no="" onClick={() => setConvert(null)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {/* `resizeOfItem` says which of the three this item is — the item and not the type,
                because a fence opened `layout=fixed` has stopped folding. Only a diagram's is a
                lie worth naming. */}
            {diagram && resizeOfItem(item) === "aspect" ? (
              <>
                <Wrapping item={item} editor={editor} />
                <p className="dag-field__hint">The side handles set the shape ELK folds this towards.</p>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
