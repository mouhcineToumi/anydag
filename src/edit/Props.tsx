import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  CircleCheck,
  Clock,
  CornerUpLeft,
  Minus,
  Plus,
  StickyNote,
  Trash2,
  Ungroup,
  type LucideIcon,
} from "lucide-react";

import { isDiagramType, isLinkType, resizeOf, resizeOfItem, type BoardItem, type BoardPage } from "@/board/types";
import { FORMS, parseChart, type ChartForm } from "@/dsl/chart";
import { gitBranchName, gitMetaOf, gitMove, gitSetTag, parseGitgraph } from "@/dsl/graph/gitgraph";
import { moveEntry, parseTimeline, readWhen, sectionOfLine, sectionsOf, setWhen, whenOf } from "@/dsl/graph/timeline";
import { HUE_ORDER, LEGEND_GLYPHS, STATUSES, type Hue, type Node, type Status } from "@/dsl/ir";
import { containersOf, descriptionSlot, hasRows, kindsOf } from "@/dsl/parse";
import {
  addChartData,
  chartIdProblem,
  chartKeyRows,
  edgeSpan,
  participantKind,
  readModifier,
  reverseEdge,
  indentTopic,
  makeRoot,
  outdentTopic,
  removeRow,
  renameChartId,
  replaceLine,
  rowLines,
  setCategories,
  setChartFlag,
  setChartForm,
  setChartHero,
  setChartKeyRows,
  setChartOption,
  setContainer,
  setDesc,
  setEdgeArrow,
  setEdgeFlag,
  setEdgeHue,
  setEdgeLabel,
  setEdgeLabel2,
  setExtent,
  setFlag,
  setGroupDir,
  setKind,
  setMeta,
  setModifier,
  setParticipantKind,
  setRow,
  setStatus,
  setTitle,
  setValues,
  takeBodyDir,
  updateRetired,
  shiftTopic,
  topicMoves,
  valuesText,
  type TopicEdit,
  addRow as writeRow,
  type ContainerWord,
  type Flag,
  type ModifierKey,
} from "@/dsl/restate";
import { retiredLines } from "@/dsl/diagnose";
import { parseSequence, PARTICIPANT_KINDS, seqIdOf, seqIdOn } from "@/dsl/sequence";
import {
  addBranch,
  branchesOf,
  insertParticipant,
  insertStatement,
  MESSAGE_ARROWS,
  messageParts,
  moveRow,
  noteParts,
  noteStatement,
  removeBranch,
  setBranchLabel,
  setMessageArrow,
  setMessageEnd,
  setMessageMark,
  setMessageText,
  setNoteOver,
  setNoteText,
  unwrap,
} from "@/dsl/sequence-write";
import { ARROWS, tokenize } from "@/dsl/tokenizer";

import { ASPECT_START, aspectAttr, aspectChoice } from "@/board/settings";

import { detachable, freshNodeId, hasPseudo, loneNode, wrapPlan, type Pseudo } from "./build";
import { layered } from "./drag";
import { EdgeEnds, type EndChoices } from "./EdgeEnds";
import { edgeTargets } from "./pick";
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
/**
 * The lines a board link is offered, in words. Each spelling is one the tokenizer reads and
 * `parseLinks` draws: dashed or not, and which ends wear a head.
 */
const LINK_LINES: readonly (readonly [string, string])[] = [
  ["-->", "Arrow"],
  ["-.->", "Dashed arrow"],
  ["<->", "Arrow both ways"],
  ["---", "Line"],
  ["-.-", "Dashed line"],
];

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

/**
 * The kind a statement is drawn as: its `kind=` when that names one of the dialect's words, else
 * the word it is declared with. The parser reads the override after the word, so a control that read
 * only the word would show a card as the kind it is not.
 */
function kindOf(src: string, kinds: readonly string[]): string {
  const written = readModifier(src, "kind");
  if (written !== null && kinds.includes(written)) return written;
  return /^\s*([A-Za-z0-9_-]+)\s/.exec(src)?.[1] ?? "";
}

/** The retired flags a line wears, by name, for the one sentence that says what is out of date. */
const retiredOn = (src: string): string[] =>
  ["focus", "current"].filter((w) => new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(src.replace(/"[^"]*"/g, '""')));

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
  onRenameNode,
  linkEnds,
}: {
  item: BoardItem;
  editor: Editor;
  pages: BoardPage[];
  /** What a board link's ends may name, when this is an `edges` fence. */
  linkEnds?: EndChoices;
  /** The panel's draft — what the person is looking at, which may be ahead of the file. */
  body: string;
  subject: Subject | null;
  /** Whether the item's own fields belong on screen: the props half, or an item with no halves. */
  showItem: boolean;
  onBody(next: string): void;
  /**
   * The body with a node renamed `from` → `to`, to be written together with the `edges` lines
   * that name it. Not `onBody`: that is the panel's debounced typing, one fence at a time.
   */
  onRenameNode(next: string, from: string, to: string): void;
}) {
  /* What the parser called out as out of date, read off the *draft* like every other control here.
     Memoised on what a parse reads, so a keystroke in a field that changes nothing about it does
     not parse twice. */
  const retired = useMemo(
    () =>
      isDiagramType(item.type)
        ? retiredLines({ type: item.type, body, dir: item.dir, aspect: item.aspect, layout: item.layout })
        : [],
    [item.type, item.dir, item.aspect, item.layout, body],
  );
  if (subject && item.type === "gitgraph") {
    return <GitProps item={item.id} editor={editor} body={body} subject={subject} onBody={onBody} />;
  }
  if (subject) {
    /* Asked of the *draft*, which is what the person is looking at; `wrapPicked` asks again of the
       file at the moment of the click, so a draft that is a quarter of a second ahead is refused
       there rather than written wrong. */
    const wrap = subject.what === "edge" || subject.link ? null : wrapPlan({ ...item, body }, subject.id);
    /* `pickNode(item, null)` is how a pick is let go: it clears the node, the edge and the board
       link in one, which is what Escape does one layer up. */
    return (
      <PickProps
        type={item.type}
        layout={item.layout}
        body={body}
        subject={subject}
        wrap={wrap?.word ?? null}
        onWrap={() => editor.wrapPicked()}
        onPseudo={(kind) => editor.growPseudo(kind)}
        /* Read every render, like the pick's own ring: the layout's answer lives on the page and
           there is no signal from inside a memoised, asynchronously laid out subtree to depend on.
           One `querySelector` is cheaper than inventing one — the argument `paint()` already makes. */
        column={subject.what === "node" ? editor.columnOf(item.id, subject.id) : null}
        retired={retired}
        onBody={onBody}
        onPick={(id) => editor.pickNode(item.id, id)}
        onId={
          item.type === "chart" && subject.what === "node"
            ? (to) => {
                const problem = chartIdProblem(body, subject.id, to);
                if (problem) return problem;
                /* The series declaration and every board link that names `chart.<id>` go in one
                   write, so one undo: `onBody` would carry the fence alone. */
                onRenameNode(renameChartId(body, subject.id, to), subject.id, to);
                /* The pick carries the id, so it has to be told the new one or the panel would
                   find no statement under the old name and close itself. */
                editor.pickNode(item.id, to);
                return null;
              }
            : undefined
        }
        /* The body and the pick move together: a topic's id is the parser's counter, so the same
           topic has another one once it has moved. */
        onTopic={(made) => {
          onBody(made.body);
          editor.pickFromLine(item.id, made.line, made.body);
        }}
        onOut={() => editor.pickNode(item.id, null)}
        onRepick={(id, what) => (what === "edge" ? editor.pickEdge(item.id, id) : editor.pickNode(item.id, id))}
        linkEnds={linkEnds}
        onDeleteLink={subject.link ? () => editor.removeLink(subject.id) : undefined}
      />
    );
  }
  return showItem ? <ItemProps item={item} editor={editor} pages={pages} body={body} retired={retired} onBody={onBody} /> : null;
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
 * A picked commit in a git graph: its message, its tag, its place along the branch, and a branch
 * off it.
 *
 * Its own view rather than `PickProps` with things hidden, because almost nothing in that one is
 * true here. A gitgraph line is a command with no `key=value` grammar, so a hue, a status, an icon
 * or a flag written onto it is a word the parser reads past and draws nothing for; a second string
 * is not a meta. What a commit does have — a tag, which is a statement of its own on the next line,
 * and an order that only some swaps keep — needs writers that read the whole history, and those are
 * in `src/dsl/graph/gitgraph.ts`.
 */
function GitProps({
  item,
  editor,
  body,
  subject,
  onBody,
}: {
  item: string;
  editor: Editor;
  body: string;
  subject: Subject;
  onBody(next: string): void;
}) {
  const { id, line } = subject;
  const onOut = () => editor.pickNode(item, null);
  const graph = parseGitgraph(body);
  const node = graph.nodes.find((n) => n.id === id);
  const src = body.split("\n")[line - 1] ?? "";
  /* A parent link is the order of the commands, not a statement, so a picked line has nothing of
     its own to edit; it says where its controls are instead of offering ones that write nothing. */
  if (!node) {
    return (
      <div className="dag-props" data-dag-props={id}>
        <Head what={subject.what} id={id} line={line} onOut={onOut} />
        <p className="dag-field__hint">A git graph draws its lines from the history. Pick a commit to change it.</p>
      </div>
    );
  }

  /* The first quoted string, which is the rule the parser reads a message by — not `textSlots`,
     whose idea of an id would put `merge feature "v2"`'s label in the second slot. */
  const message = /"([^"]*)"/.exec(src)?.[1] ?? "";
  const branch = gitBranchName(graph, id);
  const tip = gitMetaOf(graph).tips[branch] === id;
  const earlier = gitMove(body, id, -1);
  const later = gitMove(body, id, 1);
  const move = (made: { body: string; id: string } | null) => {
    if (!made) return;
    onBody(made.body);
    editor.pickNode(item, made.id);
  };

  return (
    <div className="dag-props" data-dag-props={id}>
      <Head what="commit" id={id} line={line} onOut={onOut} />
      <div className="dag-props__fields">
        <Field
          label="Message"
          hook="data-dag-prop-title"
          value={message}
          placeholder={node.title || id}
          onSet={(v) => onBody(replaceLine(body, line, setTitle(src, v.trim() || null)))}
        />
        <Field
          label="Tag"
          hook="data-dag-prop-tag"
          value={node.meta ?? ""}
          placeholder="v1.0"
          onSet={(v) => onBody(gitSetTag(body, id, v) ?? body)}
        />
      </div>
      <p className="dag-field__hint" data-dag-git-on={branch}>
        On <strong>{branch}</strong>
        {tip ? " — its tip: drag it onto another lane to merge it there." : "."}
      </p>
      <div className="dag-props__row" role="group" aria-label="Order">
        {/* Disabled rather than missing where the history does not allow the swap, so the
            control is where a person looks for it and says no by being unpressable. */}
        <button
          type="button"
          className="dag-props__add"
          data-dag-git-move="earlier"
          disabled={!earlier}
          title={earlier ? "Swap with the commit before it" : "Another commit depends on the one before it"}
          onClick={() => move(earlier)}
        >
          ← Earlier
        </button>
        <button
          type="button"
          className="dag-props__add"
          data-dag-git-move="later"
          disabled={!later}
          title={later ? "Swap with the commit after it" : "Another commit depends on this one"}
          onClick={() => move(later)}
        >
          Later →
        </button>
      </div>
      <div className="dag-props__row">
        <button type="button" className="dag-props__add" data-dag-git-branch-here="" onClick={() => editor.gitBranch(item, id)}>
          <Plus {...ICON} aria-hidden="true" /> New branch from here
        </button>
      </div>
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
  min,
  onSet,
}: {
  label: string;
  hook: string;
  value: string;
  /** The smallest number that means anything here: a width of 0 is not a width, so the box refuses it. */
  min?: number;
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
          if (Number.isFinite(n) && (min === undefined || n >= min)) onSet(n);
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
  const kinds = kindsOf(type);
  const kind = kindOf(src, kinds);
  const icon = /(?:^|\s)icon=([A-Za-z0-9_:.-]+)/.exec(src)?.[1] ?? "";

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

/**
 * Which of a statement's words this pick can be offered, read off the parser that would read them.
 *
 * A control that writes a word the type's parser rejects breaks the diagram; one that writes a
 * word it reads past is a click that changes nothing. Both are the panel claiming something the
 * grammar does not say, so the answer is derived from the parser rather than from the renderer:
 *
 * - the nine dialects `parseWith` reads pass a node through `modifiers()` (`dsl/common.ts`), which
 *   is where `hue=`, `icon=`, a status and the flags are read; a group takes `hue=` and its second
 *   string as a sublabel, and a lane takes `hue=` and one string — so the answer follows `what`;
 * - a `chart` reads `hue=` but no status or flag (a bare word is a value), and draws no second
 *   string (`dsl/chart.ts`);
 * - a `sequence` participant reads its two strings, `icon=`, `hue=` and `kind=`, and a bare word
 *   after them is the next statement (`dsl/sequence.ts`);
 * - a `timeline` entry's tail is read for `done` and `wait` only — its hue is its section's, and
 *   every other word, a second string included, is read past (`dsl/graph/timeline.ts`);
 * - a `gitgraph` commit is a command: the first quoted string is its message and everything else
 *   on the line is read past (`dsl/graph/gitgraph.ts`). Its own panel is `GitProps`, which offers
 *   the tag, the order and a branch instead;
 * - a mindmap topic is its line (`dsl/graph/mindmap.ts`).
 */
export interface PickControls {
  /** `hue=` is read and drawn. */
  hue: boolean;
  /** `"all"` for the four statuses, `"done-wait"` for a timeline entry, `"none"` for no status. */
  status: "all" | "done-wait" | "none";
  /** `async` / `external` are read. */
  flags: boolean;
  /** `icon=` is read and drawn. */
  icon: boolean;
  /** A second string is read and drawn under the title. */
  meta: boolean;
  /** `bold` / `italic`, the two flags the text-style control writes. */
  em: boolean;
}

const NO_WORDS: PickControls = { hue: false, status: "none", flags: false, icon: false, meta: false, em: false };

export function pickControls(type: string, what: Subject["what"]): PickControls {
  if (type === "timeline") {
    return what === "node" ? { ...NO_WORDS, status: "done-wait" } : { ...NO_WORDS, hue: what === "group" };
  }
  if (type === "gitgraph" || type === "mindmap") return NO_WORDS;
  if (type === "sequence") {
    /* A message, a fragment and a note never reach `PickProps` — they have panels of their own. */
    return what === "node" ? { hue: true, status: "none", flags: false, icon: true, meta: true, em: false } : NO_WORDS;
  }
  if (type === "chart") return { ...NO_WORDS, hue: true };
  /* The nine `parseWith` dialects. A node's line goes through `modifiers()`; a group reads its
     hue and its sublabel; a lane reads its hue and one string. */
  const node = what === "node";
  return {
    hue: true,
    status: node ? "all" : "none",
    flags: node,
    icon: node,
    meta: node || what === "group",
    em: node,
  };
}

function PickProps({
  type,
  layout,
  body,
  subject,
  wrap,
  column,
  retired,
  onBody,
  onWrap,
  onPseudo,
  onPick,
  onId,
  onTopic,
  onOut,
  onRepick,
  linkEnds,
  onDeleteLink,
}: {
  type: string;
  layout?: "fixed";
  body: string;
  subject: Subject;
  /** What a board link's ends may name — the items on its page and their cards. Only for a link. */
  linkEnds?: EndChoices;
  /** Take the picked board link out of its fence. Only for a link. */
  onDeleteLink?(): void;
  /** The word the picked thing could be wrapped in, or `null` where it cannot be — see `wrapPlan`. */
  wrap: "group" | "system" | "lane" | null;
  onWrap(): void;
  onPseudo(kind: Pseudo): void;
  /** The layer the layout put this card in, if it is the kind of diagram that has layers. */
  column: number | null;
  /** The body lines the parser read a retired flag on, so the picked line can offer to drop its own. */
  retired: readonly number[];
  onBody(next: string): void;
  /** Re-pick by id: a move renumbers a timeline's entries, and the pick has to follow its entry. */
  onPick(id: string): void;
  /** Rename the picked thing's id; the reason it was refused, or `null`. Given only for a chart. */
  onId?(to: string): string | null;
  /** A restructured mindmap: the new body, and the line the picked topic now sits on. */
  onTopic(made: TopicEdit): void;
  onOut(): void;
  /** Pick something else in this item — what a control that moved or made a thing hands over to. */
  onRepick(id: string, what: "edge" | "node"): void;
}) {
  const { id, what, line, seg } = subject;
  /* A sequence's message, fragment and note have panels of their own: none of them is a card. */
  const seq = type === "sequence" ? seqIdOf(id) : null;
  if (type === "sequence" && what === "edge") {
    return <MessageProps body={body} subject={subject} onBody={onBody} onOut={onOut} onRepick={onRepick} />;
  }
  if (seq?.what === "frag") return <FragmentProps body={body} subject={subject} onBody={onBody} onOut={onOut} />;
  if (seq?.what === "note") return <NoteProps body={body} subject={subject} onBody={onBody} onOut={onOut} />;
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
    const label2 = span?.tails[seg + 1]?.strings[1]?.value ?? "";
    const quiet = /(?:^|\s)quiet(?:\s|$)/.test(src.replace(/"[^"]*"/g, '""'));
    /* The tokenizer's own table, plus whatever is written here in case it is not in it — the ER
       cardinalities are matched structurally rather than enumerated, and offering a menu that
       silently drops `}o--||` would be worse than offering none. */
    const spellings = [...new Set([arrow, ...ARROWS.map(([text]) => text)])].filter(Boolean);
    const link = subject.link === true;
    /* A diagram's edge may name its cards, groups and rows; a board link names items on its page
       and the cards inside them, which only the board knows, so the panel hands those in. */
    const ends: EndChoices = link
      ? (linkEnds ?? [])
      : (() => {
          const all = edgeTargets(type, body);
          return [
            ["Cards", all.nodes],
            ["Groups", all.groups],
            ["Rows", all.rows],
          ] as const;
        })();
    const reversed = reverseEdge(src);

    return (
      <div className="dag-props" data-dag-props={id}>
        <Head what={link ? "link" : "edge"} id={id} line={line} onOut={onOut} />
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
        {/* The second string — C4's technology chip, drawn under the label. Positional behind the
            label, and drawn only with one, so it waits for one rather than writing a string nothing
            would show. */}
        <div className="dag-props__row">
          <input
            className="dag-input dag-props__label"
            data-dag-prop-label2=""
            aria-label={link ? "Second label" : "Technology"}
            placeholder={link ? "second label" : "technology"}
            title={label ? "Drawn under the label" : `Give the ${link ? "link" : "edge"} a label first`}
            disabled={!label}
            defaultValue={label2}
            key={`label2:${id}:${line}:${seg}:${label2}`}
            onBlur={(e) => e.target.value.trim() !== label2 && write(setEdgeLabel2(src, e.target.value.trim() || null, seg))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="dag-props__row">
          {/* A board link's line is said in words: the arrow spellings are the file's, and a person
              never reads the file. Anything else already written — a `--|>` an agent chose — is
              offered as itself, so the menu never claims the line says something it does not. */}
          {link ? (
            <select
              className="dag-select dag-props__arrow"
              data-dag-prop-arrow=""
              data-dag-prop-line=""
              aria-label="Line"
              value={arrow}
              onChange={(e) => write(setEdgeArrow(src, e.target.value, seg))}
            >
              {LINK_LINES.some(([a]) => a === arrow) ? null : <option value={arrow}>{arrow}</option>}
              {LINK_LINES.map(([a, words]) => (
                <option key={a} value={a}>
                  {words}
                </option>
              ))}
            </select>
          ) : (
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
          )}
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
        <EdgeEnds choices={ends} src={src} seg={seg} onLine={write} onOut={onOut} />
        {/* F3 promoted `hue=` in `parseEdge`, so this recolours the line rather than claiming to.
            `finalize()` still derives one from the source where the author wrote none. */}
        <Hues hue={hue} onSet={(h) => write(setEdgeHue(src, h))} />
        {link ? (
          <div className="dag-props__row">
            {/* Only a statement with one arrow turns round: a hop of a chain would have to be split
                off first, and the writer leaves the line alone, which is what hides the button. */}
            {reversed !== src ? (
              <button
                type="button"
                className="dag-props__add"
                data-dag-prop-reverse=""
                title="Swap the two ends: the link points the other way"
                onClick={() => write(reversed)}
              >
                <ArrowLeftRight {...ICON} aria-hidden="true" /> Reverse
              </button>
            ) : null}
            {onDeleteLink ? (
              <button
                type="button"
                className="dag-props__add"
                data-dag-prop-delete=""
                title="Delete this link (Delete)"
                onClick={onDeleteLink}
              >
                <Trash2 {...ICON} aria-hidden="true" /> Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const kinds = kindsOf(type);
  const kind = kindOf(src, kinds);
  /* The word the line opens with, whatever `kind=` says: what tells a `group` from a `system`. */
  const first = /^\s*([A-Za-z0-9_-]+)\s/.exec(src)?.[1] ?? "";
  const isNode = what === "node";
  /* A sequence participant has no kind word to choose — `kind=` is how it is told apart — so it
     gets a menu of its own, written the way the parser reads it. `null` for any other statement. */
  const participant = type === "sequence" && isNode ? participantKind(src, PARTICIPANT_KINDS) : null;
  /* Where the pixels are the author's — a sketch, or any fence opened `layout=fixed` — a shape,
     a group and a frame each have a box of their own to size. Elsewhere only a card's width is
     the author's to give: ELK decides everything else, and a height or a group's box written there
     is read and then ignored. A stroke's box is its points' bounds and is written only by a resize. */
  /* A start or an end state is a dot and a ring: it has no text, colour, icon, status or size to choose,
     so offering them would be offering writes the drawing ignores. Kind stays — it is how one
     becomes the other, or a real state. */
  const bare = isNode && hasPseudo(type) && (kind === "start" || kind === "end");
  const placed = type === "sketch" || layout === "fixed";
  const sizable = kinds.length > 0 && kind !== "ink" && !bare && (isNode || (what === "group" && placed));
  const retiredHere = retired.includes(line) ? retiredOn(src) : [];
  /*
   * A chart statement is `<kind> <id> "Label" <values…>`, so every writer above already fits it —
   * but most of the *controls* do not. A meta is a second string the chart parser reads and never
   * draws; a status or a flag is a bare word in the position the values are read from, so `done`
   * on a `series` line is `E_CHART_VALUE`. What is left is the label, the hue, and the numbers.
   */
  const isChart = type === "chart";
  /*
   * A mindmap line is bare text to end of line, so there is nowhere on it for a modifier or a flag
   * to go: `hue=coral` and `done` would be written straight into the topic's name. Its colour is
   * its branch's, from depth, and a topic has no status, icon or flags — so those controls are not
   * offered, which is the same answer a chart gets for the same kind of reason.
   */
  const isMind = type === "mindmap";
  /* Which of the words below this type's parser reads — see `pickControls`. */
  const controls = pickControls(type, what);
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
  /* The string the card draws as its description, if it draws one. For a C4 person or external
     system that is the *second* string — the one this panel called "Meta" — until a third is
     written, so the field has to know which slot it is. */
  const descAt = isNode && !isChart ? descriptionSlot(type, kind, strings.length) : null;
  const status = STATUSES.find((s) => new RegExp(`(?:^|\\s)${s}(?:\\s|$)`).test(src.replace(/"[^"]*"/g, '""'))) ?? "";
  const icon = /(?:^|\s)icon=([A-Za-z0-9_:.-]+)/.exec(src)?.[1] ?? "";
  /* A timeline entry is its own dialect — a date, a label and the two words it reads — so its
     panel is the date, the section and a status picker, not the card controls below. */
  const entry = type === "timeline" && isNode;
  const writtenCol = /(?:^|\s)col=(\d+)/.exec(src)?.[1] ?? "";
  const flagOn = (f: Flag) => new RegExp(`(?:^|\\s)${f}(?:\\s|$)`).test(src.replace(/"[^"]*"/g, '""'));

  return (
    <div className="dag-props" data-dag-props={id}>
      {/* A chart says which of its two words this is, because both are `node` to everything else on
          the board and "series" against "slice" is the whole difference a reader cares about. */}
      <Head what={isChart && kind ? kind : what} id={id} line={line} onOut={onOut} />

      <div className="dag-props__fields">
        {participant !== null ? (
          <label className="dag-field dag-field--row">
            <span>Kind</span>
            <select
              className="dag-select"
              data-dag-prop-kind=""
              value={participant}
              onChange={(e) => write(setParticipantKind(src, e.target.value))}
            >
              {PARTICIPANT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isChart && onId ? <ChartId id={id} onId={onId} /> : null}
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

        {bare ? null : (
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
        )}

        {/* Colour and text style, directly after the kind and the name: what a person
            reaching into a card wants first. The strings and the values below are the thing's own
            content — not chrome — so they keep their place, and keep it *under* these. */}
        {controls.hue && !bare ? <Hues hue={hue} onSet={(h) => mod("hue", h)} /> : null}
        {controls.em && !bare ? <Em src={src} onSet={(f, on) => write(setFlag(src, f, on))} /> : null}

        {!controls.meta || bare || descAt === 1 ? null : (
          <Field
            label={what === "group" ? "Sublabel" : "Meta"}
            hook="data-dag-prop-meta"
            value={slot(1)}
            onSet={(v) => write(setMeta(src, v.trim() || null))}
          />
        )}
        {/* A boundary's own two choices, which are the only things about a container that are not
            its name, its colour or what is in it. Read off the *line*, as the hue is. */}
        {what === "group" && containersOf(type).includes("system") && (first === "group" || first === "system") ? (
          <label className="dag-field dag-field--row">
            <span>Shape</span>
            <select
              className="dag-select"
              data-dag-prop-shape=""
              value={first}
              onChange={(e) => write(setContainer(src, e.target.value as ContainerWord))}
            >
              <option value="group">group</option>
              <option value="system">system</option>
            </select>
          </label>
        ) : null}
        {/* The data itself, which is the whole reason this dialect exists. */}
        {isChart ? (
          <ValuesField
            label={kind === "slice" ? "Value" : "Values"}
            value={valuesText(src)}
            one={kind === "slice"}
            onSet={(values) => write(setValues(src, values))}
          />
        ) : null}
        {descAt !== null ? (
          <Field
            label="Description"
            hook="data-dag-prop-desc"
            value={slot(descAt)}
            onSet={(v) => write(descAt === 1 ? setMeta(src, v.trim() || null) : setDesc(src, v.trim() || null))}
          />
        ) : null}
      </div>

      {/* Both are left out of a chart, for different reasons. A status is a bare word in the
          position a chart reads its values from, so `done` on a `series` line is `E_CHART_VALUE` —
          the control would break the chart it was used on. An icon merely does nothing there: it
          parses and is checked, and a series is named by its swatch. */}
      {entry ? (
        <>
          <TimelineWhen key={`${id}:${whenOf(src)}`} src={src} onSet={(start, end) => write(setWhen(src, start, end) ?? src)} />
          <TimelineSection
            body={body}
            line={line}
            onMove={(to) => {
              const moved = moveEntry(body, line, to);
              if (!moved) return;
              onBody(moved.body);
              const at = parseTimeline(moved.body).nodes.find((n) => n.line === moved.line);
              if (at) onPick(at.id);
            }}
          />
          <TimelineStatus value={status === "done" || status === "wait" ? status : ""} onSet={(v) => write(setStatus(src, v))} />
        </>
      ) : controls.status === "all" ? (
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
      ) : null}
      {/* The picker writes through the same `mod` the input did — one span in, one span out, the
          author's spacing and comments untouched — and is keyed to the pick so a change of card
          re-reads its mode and text from the line. */}
      {controls.icon && !bare ? (
        <IconPicker
          key={`${id}:${line}`}
          value={icon}
          hue={hue === "" ? undefined : (hue as Hue)}
          kind={kind}
          onSet={(v) => mod("icon", v)}
        />
      ) : null}

      {controls.flags && !bare ? (
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

      {/* The box, in pixels. A card's width is the one size an automatic layout still takes from the
          author; a placed shape, group or frame takes both. Empty is "auto" — the size it would have
          had — and clearing a box takes the `w=`/`h=` off the line. */}
      {sizable ? (
        <div className="dag-props__row" role="group" aria-label="Size">
          <NumberField
            label="Width"
            hook="data-dag-prop-w"
            value={readModifier(src, "w") ?? ""}
            min={1}
            onSet={(n) => write(setExtent(src, "w", n))}
          />
          {placed ? (
            <NumberField
              label="Height"
              hook="data-dag-prop-h"
              value={readModifier(src, "h") ?? ""}
              min={1}
              onSet={(n) => write(setExtent(src, "h", n))}
            />
          ) : null}
        </div>
      ) : null}

      {/* A group's own direction: `dir=` on its line, which sets the way *its* members run and
          nothing about the diagram's. Meaningless where the author places everything, and in the
          layouts that are not ELK's, which have no container to run anything through. */}
      {what === "group" && kinds.length > 0 && !placed && resizeOf(type as BoardItem["type"]) === "aspect" ? (
        <label className="dag-field dag-field--row">
          <span>Direction</span>
          <select
            className="dag-select"
            data-dag-prop-group-dir=""
            value={readModifier(src, "dir") ?? ""}
            onChange={(e) => write(setGroupDir(src, (e.target.value || null) as "LR" | "TB" | null))}
          >
            <option value="">follow the diagram</option>
            <option value="LR">left to right</option>
            <option value="TB">top to bottom</option>
          </select>
        </label>
      ) : null}

      {retiredHere.length > 0 ? (
        <Update
          hook="retired"
          text={`${retiredHere.map((w) => `\`${w}\``).join(" and ")} no longer mark${retiredHere.length === 1 ? "s" : ""} anything: hovering a card rings it now.`}
          onGo={() => onBody(updateRetired(body, [line]))}
        />
      ) : null}

      {isMind && isNode ? <TopicTools body={body} line={line} onTopic={onTopic} /> : null}

      {isNode && layered(type, layout) ? <Column written={writtenCol} current={column} onSet={(v) => mod("col", v)} /> : null}

      {isNode && hasRows(type) ? <Rows type={type} body={body} line={line} onBody={onBody} /> : null}

      {/* Structure, which is what a person who has built a few cards comes back to the panel for:
          put this inside a boundary, or give the flow a beginning and an end. Each is the one
          writer `+` and ctrl+G stand on, as a button that says what it will write. */}
      {wrap || (isNode && hasPseudo(type) && kind !== "start" && kind !== "end") ? (
        <div className="dag-props__row" role="group" aria-label="Structure">
          {wrap ? (
            <button type="button" className="dag-props__add" data-dag-prop-wrap={wrap} onClick={onWrap}>
              Wrap in {wrap === "lane" ? "a lane" : wrap === "system" ? "a system" : "a group"}
            </button>
          ) : null}
          {isNode && hasPseudo(type) && kind !== "start" && kind !== "end" ? (
            <>
              <button type="button" className="dag-props__add" data-dag-prop-pseudo="start" onClick={() => onPseudo("start")}>
                Add start
              </button>
              <button type="button" className="dag-props__add" data-dag-prop-pseudo="end" onClick={() => onPseudo("end")}>
                Add end
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The When field of a timeline entry: one line of free text for the date, or the two dates.
 *
 * Free text rather than a date input because the grammar's precision is the point — `2026`,
 * `2026-03` and `2026-03-01` are three different claims, and a native date picker can only make
 * the third. What is typed is read by `readWhen`, echoed back in words under the field so a person
 * sees how it was understood before it is written, and written as the grammar's own spelling at the
 * precision typed. Nothing is written while the text cannot be read, so a half-typed date never
 * reaches the file; clearing the end of a range is typing a point.
 */
function TimelineWhen({ src, onSet }: { src: string; onSet(start: string, end: string | null): void }) {
  const written = whenOf(src);
  const [text, setText] = useState(written);
  const read = readWhen(text);
  const commit = () => {
    if (!read.ok || text.trim() === written) return;
    onSet(read.start, read.end);
  };
  return (
    <div className="dag-props__fields">
      <label className="dag-field">
        <span>When</span>
        <input
          className="dag-input"
          data-dag-prop-when=""
          value={text}
          placeholder="Mar 2026 → Jun 2026"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      <p
        className={read.ok ? "dag-field__hint" : "dag-field__hint dag-field__hint--bad"}
        data-dag-prop-when-echo={read.ok ? "ok" : "bad"}
      >
        {read.ok ? `Understood: ${read.echo}` : `${read.why[0]!.toUpperCase()}${read.why.slice(1)}`}
      </p>
    </div>
  );
}

/**
 * Which section an entry is in. An entry belongs to the nearest `section` above it, so choosing one
 * moves the entry's line to the end of that section — see `moveEntry`. Left out of a timeline that
 * has no sections: there would be nothing to choose.
 */
function TimelineSection({ body, line, onMove }: { body: string; line: number; onMove(to: number | null): void }) {
  const sections = sectionsOf(body);
  if (sections.length === 0) return null;
  const at = sectionOfLine(body, line);
  return (
    <label className="dag-field dag-field--row">
      <span>Section</span>
      <select
        className="dag-select"
        data-dag-prop-section=""
        value={at === null ? "" : String(at)}
        onChange={(e) => onMove(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">no section</option>
        {sections.map((s) => (
          <option key={s.line} value={s.line}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What a timeline reads, and nothing else: `stop` and `muted` are other dialects' words. */
const TIMELINE_STATUS: { value: "" | "done" | "wait"; label: string; Icon: LucideIcon }[] = [
  { value: "", label: "None", Icon: Minus },
  { value: "done", label: "Done", Icon: CircleCheck },
  { value: "wait", label: "Wait", Icon: Clock },
];

/**
 * The status picker for a timeline entry: an icon on each option, which a native `<select>` cannot
 * hold. Three buttons in a radio group — the choice is one of three and they all fit on a row.
 */
function TimelineStatus({ value, onSet }: { value: "" | "done" | "wait"; onSet(next: "done" | "wait" | null): void }) {
  return (
    <div className="dag-props__row" role="radiogroup" aria-label="Status" data-dag-prop-status="">
      {TIMELINE_STATUS.map(({ value: v, label, Icon }) => (
        <button
          key={v || "none"}
          type="button"
          role="radio"
          aria-checked={value === v}
          data-dag-prop-status-option={v || "none"}
          className={`dag-props__choice${value === v ? " dag-props__choice--on" : ""}`}
          onClick={() => value !== v && onSet(v === "" ? null : v)}
        >
          <Icon {...ICON} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Where a mindmap topic sits in its tree, as five buttons: the structure moves a person would
 * otherwise make by dragging a topic onto another one, or by retyping its indentation.
 *
 * Each is offered only where it would act (`topicMoves` is the same answer the writers give), so a
 * disabled button is the grammar saying no — the root has no siblings, nothing can be outdented to
 * depth 0 — rather than a click that quietly does nothing. The keys do the same moves with the pick
 * held: Shift+Tab, Alt+↑/↓.
 */
function TopicTools({ body, line, onTopic }: { body: string; line: number; onTopic(made: TopicEdit): void }) {
  const can = topicMoves(body, line);
  const ops: { op: string; label: string; title: string; ok: boolean; run(): TopicEdit | null }[] = [
    {
      op: "root",
      label: "Make root",
      title: "Hang the whole map from this topic",
      ok: can.root,
      run: () => makeRoot(body, line),
    },
    {
      op: "indent",
      label: "Indent",
      title: "Make it a child of the topic above it",
      ok: can.indent,
      run: () => indentTopic(body, line),
    },
    {
      op: "outdent",
      label: "Outdent",
      title: "Move it out one level (Shift+Tab)",
      ok: can.outdent,
      run: () => outdentTopic(body, line),
    },
    { op: "up", label: "Move up", title: "Past the sibling above (Alt+↑)", ok: can.up, run: () => shiftTopic(body, line, -1) },
    {
      op: "down",
      label: "Move down",
      title: "Past the sibling below (Alt+↓)",
      ok: can.down,
      run: () => shiftTopic(body, line, 1),
    },
  ];
  return (
    <div className="dag-props__row" role="group" aria-label="Topic">
      {ops.map(({ op, label, title, ok, run }) => (
        <button
          key={op}
          type="button"
          className="dag-props__add"
          data-dag-topic-op={op}
          title={title}
          disabled={!ok}
          onClick={() => {
            const made = run();
            if (made) onTopic(made);
          }}
        >
          {label}
        </button>
      ))}
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
 * A statement the grammar still reads and no longer means, with the one click that brings it up to
 * date. The sentence says what is out of date and the button is the whole fix: nothing here asks
 * anybody to open the source and find the word.
 */
function Update({ hook, text, onGo }: { hook: string; text: string; onGo(): void }) {
  return (
    <div className="dag-props__convert" data-dag-update={hook}>
      <p className="dag-field__hint">{text}</p>
      <button type="button" className="dag-props__add" data-dag-update-go={hook} onClick={onGo}>
        Update it
      </button>
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
      {rows.map((row) => {
        /* A row on a line of its own is told apart by the line; one of several on a line, by its
           place on it too. */
        const at = row.nth === undefined ? `${row.line}` : `${row.line}.${row.nth}`;
        return (
          <div className="dag-props__rowline" key={`${at}:${row.text}`}>
            <input
              className="dag-input dag-input--mono"
              data-dag-prop-row={at}
              aria-label={`Row ${row.text}`}
              defaultValue={row.text}
              onBlur={(e) => e.target.value.trim() !== row.text && onBody(setRow(body, row.line, e.target.value.trim(), row.nth))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button
              type="button"
              className="dag-icon dag-icon--tiny"
              data-dag-prop-row-remove={at}
              aria-label={`Remove ${row.text}`}
              title="Remove this row"
              onClick={() => onBody(removeRow(body, row.line, row.nth))}
            >
              <Trash2 {...ICON} aria-hidden="true" />
            </button>
          </div>
        );
      })}
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

/* ----------------------------------------------------------------------------- a sequence */

/** Every participant, as the menus offer them: the id the line writes and the name it is drawn under. */
function useParticipants(body: string): { id: string; title: string }[] {
  return useMemo(() => parseSequence(body).participants.map((p) => ({ id: p.id, title: p.title })), [body]);
}

/**
 * A message: what it says, who sends it, who receives it, what kind of arrow, and the busy bar.
 *
 * Every control is a writer from `sequence-write.ts` over the message's own line. Moving it is a
 * row at a time through the drawing (`moveRow`), and the pick follows it: a message that passes
 * another changes its place in the count, and the panel has to keep showing the one that moved.
 */
function MessageProps({
  body,
  subject,
  onBody,
  onOut,
  onRepick,
}: {
  body: string;
  subject: Subject;
  onBody(next: string): void;
  onOut(): void;
  onRepick(id: string, what: "edge" | "node"): void;
}) {
  const { id, line } = subject;
  const src = body.split("\n")[line - 1] ?? "";
  const write = (next: string) => onBody(replaceLine(body, line, next));
  const people = useParticipants(body);
  const m = messageParts(body, line);
  if (!m) return null;
  const named = (who: string) => people.find((p) => p.id === who)?.title ?? who;
  /* What is on the line goes first, so a spelling the four do not name (`--)`) is still shown. */
  const arrows = MESSAGE_ARROWS.some((a) => a.arrow === m.arrow)
    ? MESSAGE_ARROWS
    : [{ arrow: m.arrow, name: m.arrow }, ...MESSAGE_ARROWS];
  const move = (dir: -1 | 1) => {
    const out = moveRow(body, line, dir);
    if (!out) return;
    onBody(out.body);
    const now = seqIdOn(out.body, out.line);
    if (now && now.id !== id) onRepick(now.id, "edge");
  };
  const note = () => {
    const over = m.from === m.to ? [m.from] : [m.from, m.to];
    const out = insertStatement(body, { line, inside: false }, noteStatement(over, "note"));
    onBody(out.body);
    const now = seqIdOn(out.body, out.line);
    if (now) onRepick(now.id, "node");
  };
  const who = (end: "from" | "to", hook: string) => (
    <label className="dag-field dag-field--row">
      <span>{end === "from" ? "From" : "To"}</span>
      <select
        className="dag-select"
        {...{ [hook]: "" }}
        value={m[end]}
        onChange={(e) => onBody(setMessageEnd(body, line, end, e.target.value))}
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="dag-props" data-dag-props={id}>
      <Head what="message" id={id} line={line} onOut={onOut} />
      <div className="dag-props__fields">
        <Field
          label="Text"
          hook="data-dag-prop-label"
          value={m.text}
          onSet={(v) => write(setMessageText(src, v.trim() || null))}
        />
        {who("from", "data-dag-prop-from")}
        {who("to", "data-dag-prop-to")}
        <label className="dag-field dag-field--row">
          <span>Arrow</span>
          <select
            className="dag-select"
            data-dag-prop-arrow=""
            value={m.arrow}
            onChange={(e) => write(setMessageArrow(src, e.target.value))}
          >
            {arrows.map((a) => (
              <option key={a.arrow} value={a.arrow}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* Mermaid's `+` and `-`: the busy bar starts at the receiver, or ends at the sender. */}
      <div className="dag-props__row" role="group" aria-label="Activation">
        <label className="dag-field dag-field--row">
          <input
            type="checkbox"
            className="dag-check"
            data-dag-prop-activate=""
            checked={m.activates}
            onChange={(e) => onBody(setMessageMark(body, line, "+", e.target.checked))}
          />
          <span>Activates {named(m.to)}</span>
        </label>
        <label className="dag-field dag-field--row">
          <input
            type="checkbox"
            className="dag-check"
            data-dag-prop-deactivate=""
            checked={m.deactivates}
            onChange={(e) => onBody(setMessageMark(body, line, "-", e.target.checked))}
          />
          <span>Ends {named(m.from)}'s activation</span>
        </label>
      </div>
      <div className="dag-props__row">
        <button
          type="button"
          className="dag-props__add"
          data-dag-prop-move="up"
          title="Move it up one row"
          onClick={() => move(-1)}
        >
          <ArrowUp {...ICON} aria-hidden="true" /> Up
        </button>
        <button
          type="button"
          className="dag-props__add"
          data-dag-prop-move="down"
          title="Move it down one row"
          onClick={() => move(1)}
        >
          <ArrowDown {...ICON} aria-hidden="true" /> Down
        </button>
        <button
          type="button"
          className="dag-props__add"
          data-dag-prop-note-add=""
          title="A note under this message"
          onClick={note}
        >
          <StickyNote {...ICON} aria-hidden="true" /> Note
        </button>
      </div>
      <p className="dag-field__hint">Shift-click another message to pick the run between them, then Wrap in from the bar.</p>
    </div>
  );
}

/**
 * A fragment: the condition on each branch, another branch, and Unwrap.
 *
 * Each branch is its own line — the head for the first, an `else` or an `and` after — so each field
 * writes one line, and the line numbers come from the parse of the draft rather than from the pick.
 */
function FragmentProps({
  body,
  subject,
  onBody,
  onOut,
}: {
  body: string;
  subject: Subject;
  onBody(next: string): void;
  onOut(): void;
}) {
  const { id, line } = subject;
  const frag = branchesOf(body, line);
  if (!frag) return null;
  const lines = body.split("\n");
  const more = frag.kind === "alt" ? "else" : frag.kind === "par" ? "and" : null;
  return (
    <div className="dag-props" data-dag-props={id}>
      <Head what={frag.kind} id={id} line={line} onOut={onOut} />
      <div className="dag-props__fields">
        {frag.branches.map((b, i) => (
          <div className="dag-props__rowline" key={`${b.line}:${b.label}`}>
            <Field
              label={i === 0 ? (frag.kind === "loop" ? "Repeats" : frag.kind === "par" ? "Branch" : "Condition") : (more ?? "")}
              hook={`data-dag-prop-branch-${i}`}
              value={b.label}
              onSet={(v) => onBody(replaceLine(body, b.line, setBranchLabel(lines[b.line - 1] ?? "", v.trim() || null)))}
            />
            {i > 0 ? (
              <button
                type="button"
                className="dag-icon dag-icon--tiny"
                data-dag-prop-branch-remove={i}
                aria-label={`Remove the ${more} branch`}
                title="Remove this branch and what is in it"
                onClick={() => onBody(removeBranch(body, b.line))}
              >
                <Trash2 {...ICON} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="dag-props__row">
        {more ? (
          <button
            type="button"
            className="dag-props__add"
            data-dag-prop-branch-add=""
            onClick={() => {
              const out = addBranch(body, line);
              if (out) onBody(out.body);
            }}
          >
            <Plus {...ICON} aria-hidden="true" /> {more} branch
          </button>
        ) : null}
        <button
          type="button"
          className="dag-props__add"
          data-dag-prop-unwrap=""
          title="Take the frame away and keep the messages"
          onClick={() => {
            onBody(unwrap(body, line));
            onOut();
          }}
        >
          <Ungroup {...ICON} aria-hidden="true" /> Unwrap
        </button>
      </div>
    </div>
  );
}

/** A note: its words, and which participants it is drawn over — one at least. */
function NoteProps({
  body,
  subject,
  onBody,
  onOut,
}: {
  body: string;
  subject: Subject;
  onBody(next: string): void;
  onOut(): void;
}) {
  const { id, line } = subject;
  const src = body.split("\n")[line - 1] ?? "";
  const write = (next: string) => onBody(replaceLine(body, line, next));
  const people = useParticipants(body);
  const n = noteParts(src);
  if (!n) return null;
  return (
    <div className="dag-props" data-dag-props={id}>
      <Head what="note" id={id} line={line} onOut={onOut} />
      <div className="dag-props__fields">
        <Field
          label="Text"
          hook="data-dag-prop-note-text"
          value={n.text}
          onSet={(v) => v.trim() && write(setNoteText(src, v.trim()))}
        />
      </div>
      <div className="dag-props__row" role="group" aria-label="Over">
        {people.map((p) => (
          <label key={p.id} className="dag-field dag-field--row">
            <input
              type="checkbox"
              className="dag-check"
              data-dag-prop-over={p.id}
              checked={n.over.includes(p.id)}
              onChange={(e) =>
                write(
                  setNoteOver(
                    src,
                    people.map((q) => q.id).filter((q) => (q === p.id ? e.target.checked : n.over.includes(q))),
                  ),
                )
              }
            />
            <span>{p.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * A sequence's own item view: the one thing it needs that nothing on the canvas can start, which is
 * a participant — a message is drawn between two lifelines, so with none there is nowhere to draw.
 */
function SequenceProps({ body, onBody }: { body: string; onBody(next: string): void }) {
  return (
    <>
      <button
        type="button"
        className="dag-props__add"
        data-dag-seq-participant-add=""
        onClick={() => onBody(insertParticipant(body, freshNodeId(body, "participant"), "Participant"))}
      >
        <Plus {...ICON} aria-hidden="true" /> Add a participant
      </button>
      <p className="dag-field__hint">
        Drag from one lifeline to another to draw a message. Click a message or a fragment's tab to change it.
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------------- the chart */

/**
 * A series' or slice's id, retyped in place and refused in the box.
 *
 * An id is what a board link ends on (`chart.web`) and what the pick is keyed by, so it is a
 * control of its own beside the label — which is only what the legend says. Refused inline, with
 * the reason, rather than silently reverted: a clash with another series is the one thing a person
 * cannot see from here.
 */
function ChartId({ id, onId }: { id: string; onId(to: string): string | null }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [id]);
  return (
    <>
      <label className="dag-field">
        <span>Id</span>
        <input
          className="dag-input dag-input--mono"
          data-dag-prop-chart-id=""
          defaultValue={id}
          key={`chart-id:${id}`}
          onFocus={() => setError(null)}
          onBlur={(e) => {
            const to = e.target.value.trim();
            if (to === id) return;
            const problem = onId(to);
            setError(problem);
            if (problem) e.target.value = id;
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      {error ? (
        <p className="dag-field__hint dag-field__hint--bad" data-dag-prop-chart-id-error="">
          {error}
        </p>
      ) : null}
    </>
  );
}

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
function ChartProps({
  itemId,
  editor,
  body,
  onBody,
}: {
  itemId: string;
  editor: Editor;
  body: string;
  onBody(next: string): void;
}) {
  const model = useMemo(() => parseChart(body), [body]);
  const keyRows = useMemo(() => chartKeyRows(body), [body]);
  /* A new series or slice is picked as it is made: it has no values worth keeping yet, and the
     panel that opens on it is where they are typed. */
  const add = (kind: "series" | "slice") => {
    const made = addChartData(body, kind);
    onBody(made.body);
    editor.pickNode(itemId, made.id);
  };
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

      {/* The hole's contents: a donut's own, since a pie has no hole and the parser reads the strings
          off the form line whatever it says. Both fields write one statement, so the caption is
          saved against the figure as it stands and an emptied figure takes both. */}
      {model.form === "donut" ? (
        <>
          <Field
            label="Centre figure"
            hook="data-dag-prop-hero"
            value={model.hero?.value ?? ""}
            placeholder="1.2M"
            onSet={(v) => onBody(setChartHero(body, { value: v, label: model.hero?.label }))}
          />
          <Field
            label="Centre caption"
            hook="data-dag-prop-hero-label"
            value={model.hero?.label ?? ""}
            placeholder="users"
            onSet={(v) => onBody(setChartHero(body, { value: model.hero?.value ?? "", label: v }))}
          />
        </>
      ) : null}

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

      {/* The key's own rows — `legend solid "in sync"` — are a different statement from the placement
          above, and a different thing to a reader: the placement says where the swatches go and
          these explain an encoding the swatches cannot. */}
      <div className="dag-field">
        <span>Key rows</span>
        <div className="dag-props__rows" data-dag-prop-key-rows="">
          {keyRows.map((row, i) => (
            <div className="dag-props__rowline" key={`${i}:${row.glyph}:${row.text}`}>
              <select
                className="dag-select"
                data-dag-prop-key-glyph={i}
                aria-label={`Glyph of key row ${i + 1}`}
                value={row.glyph}
                onChange={(e) =>
                  onBody(
                    setChartKeyRows(
                      body,
                      keyRows.map((r, j) => (j === i ? { ...r, glyph: e.target.value } : r)),
                    ),
                  )
                }
              >
                {[...new Set<string>([...LEGEND_GLYPHS, row.glyph])].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <input
                className="dag-input"
                data-dag-prop-key-text={i}
                aria-label={`Text of key row ${i + 1}`}
                defaultValue={row.text}
                onBlur={(e) =>
                  e.target.value.trim() !== row.text &&
                  onBody(
                    setChartKeyRows(
                      body,
                      keyRows.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)),
                    ),
                  )
                }
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <button
                type="button"
                className="dag-icon dag-icon--tiny"
                data-dag-prop-key-remove={i}
                aria-label={`Remove key row ${row.text}`}
                title="Remove this key row"
                onClick={() =>
                  onBody(
                    setChartKeyRows(
                      body,
                      keyRows.filter((_, j) => j !== i),
                    ),
                  )
                }
              >
                <Trash2 {...ICON} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="dag-props__add"
            data-dag-prop-key-add=""
            onClick={() => onBody(setChartKeyRows(body, [...keyRows, { glyph: "solid", text: "New entry" }]))}
          >
            <Plus {...ICON} aria-hidden="true" /> Add a key row
          </button>
        </div>
      </div>

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

      {/* Both parse in every form — a `series` in a pie is one wedge, a `slice` in a bar chart a
          category of its own — so both are offered whatever the form is. */}
      <div className="dag-props__row" role="group" aria-label="Add data">
        {(["series", "slice"] as const).map((kind) => (
          <button key={kind} type="button" className="dag-props__add" data-dag-prop-chart-add={kind} onClick={() => add(kind)}>
            <Plus {...ICON} aria-hidden="true" /> Add a {kind}
          </button>
        ))}
      </div>
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
  retired,
  onBody,
}: {
  item: BoardItem;
  editor: Editor;
  pages: BoardPage[];
  /** The draft, for the one type whose *item* fields are statements in its body rather than attrs. */
  body: string;
  /** The body lines the parser read a retired flag on. */
  retired: readonly number[];
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

  /* A `dir=LR` statement in the body is the parser's own and wins over the fence's `dir=`, so the
     Direction control below would answer a change with no change. Offered as a move, not a
     deletion: the statement's value becomes the fence's, and the diagram draws as it did. Only the
     dialects whose statements go through the shared parser read one. */
  const movedDir = useMemo(
    () => (diagram && kindsOf(item.type).length > 0 ? takeBodyDir(body) : null),
    [diagram, item.type, body],
  );

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
          <ChartProps itemId={item.id} editor={editor} body={body} onBody={onBody} />
        ) : item.type === "sequence" ? (
          <SequenceProps body={body} onBody={onBody} />
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

      {/* What the grammar still reads and no longer means. Outside the disclosure on purpose: it is
          a thing to fix, not a setting, and a person who was told about it is looking at the top
          of the panel. Each is one button; none needs the source. */}
      {diagram && retired.length > 0 ? (
        <Update
          hook="retired"
          text={`${retired.length} ${retired.length === 1 ? "line wears" : "lines wear"} a retired flag (focus, current): it no longer marks anything, because hovering a card rings it now.`}
          onGo={() => onBody(updateRetired(body, retired))}
        />
      ) : null}
      {movedDir ? (
        <Update
          hook="dir"
          text={`The body sets the direction (dir=${movedDir.dir}) and it overrides the Direction below. Move it there.`}
          onGo={() => editor.replace(item.id, { body: movedDir.body, attrs: { dir: movedDir.dir } })}
        />
      ) : null}

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
