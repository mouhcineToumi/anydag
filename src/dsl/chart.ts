import { CODES } from "./codes";
import { namespaced, tidy } from "./common";
import { ICON_NAMES } from "./icon-names";
import { HUE_ORDER, type Diagnostic, type Hue, type LegendEntry } from "./ir";
import { suggestHue, suggestIcon, suggestKind } from "./suggest";
import { Cursor, tokenize, type LexError, type Token } from "./tokenizer";

/**
 * `chart` — the second dialect whose model is not a graph, and the first one that draws *data*.
 *
 * Every other dialect is a grammar for a kind of *system*: what runs, what stores, what a record can
 * become. A chart says none of that. Its statements are numbers and the labels on them, and what it
 * needs from a layout is a scale — so a bar is not a node, a series is not a group, and forcing
 * either into `Graph` would put chart cases into `size.ts`, `NodeView`, ELK's config and
 * `finalize()` for nothing any of them do here. `sequence` established the shape; this follows it.
 *
 *     bar stacked
 *     x Q1 Q2 Q3 Q4
 *     series web "Web" 120 140 160 180
 *     series mob "Mobile" 40 60 90 130 hue=coral
 *     legend bottom
 *     values
 *     unit "k€"
 *     max 400
 *
 *     donut "1.2M" "users"
 *     slice web "Web" 62
 *     slice oth "Other" 10 hue=bronze
 *
 * **The form is a body statement, not a fence attribute and not four fence types.** The thing a
 * person places is *a chart*; which shape it takes is a property of the data's job, and the
 * commonest edit to one is changing it. On the fence it would be a seventh thing `src/board/` knows
 * about diagrams; as four types it would be four cheat sheets and a conversion that rewrites the
 * info word. Absent, the form is `bar`.
 *
 * **`series` and `slice` both parse in every form, with a defined meaning**, which is what lets the
 * panel's Form select be a menu rather than a validation: a `slice` in a bar chart is one bar with
 * its own hue, a `series` in a pie is one wedge worth the series' total. Switching form can
 * therefore never produce an error against data that was already there.
 *
 * **Nothing here knows a colour.** A series or slice the author did not hue keeps `hue` undefined,
 * and the layout fills it from `theme.color.chartHues` — because *which* order of hues separates
 * cleanly is a property of the theme's actual colours, and this layer is theme-free. That is the one
 * place a chart departs from `HUE_ORDER`, which every other dialect assigns from in the parser.
 *
 * **It does not sniff for Mermaid, and that is not an omission.** `detectMermaid` treats a line
 * beginning `pie` as a Mermaid header — fatally, because a header means the whole block is another
 * language — and `pie` is this dialect's own form word. Sniffing here would make the commonest
 * chart body in existence a parse error. `mindmap`, `timeline` and `gitgraph` do not sniff either;
 * only `parseWith` and `parseSequence` do.
 */

/** The four shapes, and the closed set `E_UNKNOWN_KIND` and the panel's Form select both read. */
export const FORMS = ["bar", "line", "pie", "donut"] as const;
export type ChartForm = (typeof FORMS)[number];

/**
 * How many series or slices a theme's `color.chartHues` may hold, and the threshold `W_CHART_MANY`
 * counts against.
 *
 * Seven, because seven is where the doctrine's own validator stops finding a set that separates
 * under colour-vision deficiency *and* to a normal eye, and because seven is where the doctrine
 * says a series should fold into an "Other" instead. A constant here rather than a length read off
 * the theme so the parser stays theme-free; `check-theme.mjs` holds every theme's list to it.
 */
export const CHART_HUES_MAX = 7;

/** Where the legend goes, when the author says. Absent, the layout decides from the series count. */
type LegendAt = "none" | "right" | "bottom";

const LEGEND_AT: ReadonlySet<string> = new Set<LegendAt>(["none", "right", "bottom"]);

/** One line on a line chart, one group of bars, or — in a pie — one wedge worth its own total. */
export interface Series {
  id: string;
  title: string;
  /** One per category. `null` is a gap: a missing point on a line, no bar in that slot. */
  values: (number | null)[];
  /** Only ever what the author wrote. Unwritten is `undefined`, and the layout fills it. */
  hue?: Hue;
  icon?: string;
  /** 1-based line of the statement that declares it, within the body. */
  line: number;
}

/** One wedge of a pie, or — in a bar or line chart — one category with one value of its own. */
export interface Slice {
  id: string;
  title: string;
  value: number | null;
  hue?: Hue;
  icon?: string;
  line: number;
}

/** The number in the hole of a donut, and the word under it. */
interface ChartHero {
  value: string;
  label?: string;
}

export interface ChartModel {
  kind: "chart";
  form: ChartForm;
  stacked: boolean;
  horizontal: boolean;
  /** Written by an `x` line. Empty means `1…n`, drawn as blank ticks. */
  categories: string[];
  series: Series[];
  slices: Slice[];
  /**
   * `legend none|right|bottom`.
   *
   * Deliberately *not* the `legend` field below, which is the shared glyph legend every other model
   * carries and which `DiagramItem` reads off any model at all. One word means two things in this
   * dialect and they are two fields; the grammar tells them apart by whether a string follows.
   */
  legendAt?: LegendAt;
  /** `values` — direct value labels on bars and points. A pie labels its wedges regardless. */
  values: boolean;
  /** `unit "k€"` — a suffix on every tick and every value label. */
  unit?: string;
  min?: number;
  max?: number;
  hero?: ChartHero;
  /** The shared glyph legend — `legend solid "in sync"` — as in every dialect. */
  legend: LegendEntry[];
  diagnostics: Diagnostic[];
}

/**
 * The whole vocabulary, in the order the cheat sheet gives it.
 *
 * One list, read by `E_UNKNOWN_KIND`'s message and by the suggester, for the reason `kindsOf()`
 * exists: a menu and an error that disagree about what a word may be is two chances to be wrong.
 */
const CHART_WORDS: readonly string[] = [...FORMS, "x", "series", "slice", "legend", "values", "unit", "min", "max"];

/** A statement's trailing `hue=` / `icon=`. A `Series` is not a `Node`, so it never sees `modifiers()`. */
function readModifiers(
  cur: Cursor,
  push: (d: Diagnostic) => void,
  line: number,
): { hue?: Hue; icon?: string } {
  const out: { hue?: Hue; icon?: string } = {};
  while (cur.peek().kind === "word" && cur.peek(1).kind === "punct" && cur.peek(1).value === "=") {
    const key = cur.next().value;
    cur.next();
    const v = cur.peek();
    if (v.kind !== "word" && v.kind !== "string") {
      push({ line: v.line, col: v.col, code: CODES.E_EXPECTED_VALUE, message: `expected a value after \`${key}=\``, severity: "error" });
      break;
    }
    cur.next();
    /* `icon=aws:lambda` — the same namespace join `modifiers()` does, for the same reason. */
    const value = namespaced(cur, v);

    if (key === "hue") {
      /* Dropped rather than kept and ignored, exactly as `modifiers()` does it: `hueVars()` binds
         whatever it is handed straight into `--dag-h`, and a name outside `HUE_ORDER` binds a custom
         property nobody set — invisible, not merely wrong. */
      if ((HUE_ORDER as readonly string[]).includes(value)) out.hue = value;
      else {
        const guess = suggestHue(value, HUE_ORDER);
        push({
          line,
          code: CODES.W_UNKNOWN_HUE,
          message: guess
            ? `no hue named \`${value}\`. Did you mean \`${guess}\`? (${HUE_ORDER.join(", ")})`
            : `no hue named \`${value}\`: expected one of ${HUE_ORDER.join(", ")}`,
          severity: "warn",
        });
      }
      continue;
    }
    if (key === "icon") {
      out.icon = value;
      const prefix = ["mono:", "lucide:"].find((p) => value.startsWith(p));
      const bare = prefix ? value.slice(prefix.length) : value;
      if (!ICON_NAMES.has(bare)) {
        const guess = suggestIcon(value, ICON_NAMES);
        push({
          line,
          code: CODES.W_UNKNOWN_ICON,
          message:
            `no icon named "${value}"; the legend draws its swatch alone` +
            (guess ? `. Did you mean \`${guess}\`?` : ""),
          severity: "warn",
        });
      }
      continue;
    }
    push({
      line,
      code: CODES.W_UNKNOWN_ATTR,
      message: `\`${key}=\` means nothing on a chart statement (icon · hue)`,
      severity: "warn",
    });
  }
  return out;
}

export function parseChart(src: string): ChartModel {
  const diagnostics: Diagnostic[] = [];
  const push = (d: Diagnostic): void => void diagnostics.push(d);

  const lexErrors: LexError[] = [];
  const cur = new Cursor(tokenize(src, lexErrors), { push });
  for (const e of lexErrors) push({ ...e, severity: "error" });

  const model: ChartModel = {
    kind: "chart",
    form: "bar",
    stacked: false,
    horizontal: false,
    categories: [],
    series: [],
    slices: [],
    values: false,
    legend: [],
    diagnostics: [],
  };

  /** 0 while nobody has written a form line — which is what makes `bar` a default rather than a claim. */
  let formLine = 0;
  /** Series and slices share one id namespace: both are things a board link can end on. */
  const seen = new Map<string, number>();

  /** Consume the rest of the statement, saying so if there was any of it left. */
  const endStatement = (): void => {
    const t = cur.peek();
    if (t.kind === "sep") {
      cur.next();
      cur.skipSeps();
      return;
    }
    if (t.kind === "eof") return;
    push({ line: t.line, col: t.col, code: CODES.E_UNEXPECTED, message: `unexpected \`${t.value}\``, severity: "error" });
    cur.skipStatement();
    cur.skipSeps();
  };

  /** Give up on this line. */
  const abandon = (): void => {
    cur.skipStatement();
    cur.skipSeps();
  };

  /** The consecutive run of strings right after the head — a title, then a subtitle or a label. */
  const strings = (): string[] => {
    const out: string[] = [];
    for (;;) {
      const s = cur.eat("string");
      if (!s) break;
      out.push(s.value);
    }
    return out;
  };

  cur.skipSeps();
  while (!cur.done) {
    const t: Token = cur.peek();
    if (t.kind === "sep") {
      cur.next();
      continue;
    }
    if (t.kind !== "word") {
      push({ line: t.line, col: t.col, code: CODES.E_UNEXPECTED, message: `unexpected \`${t.value}\``, severity: "error" });
      abandon();
      continue;
    }

    const head = t.value;

    /* ---- the form, its flags, and a donut's hero ---- */
    if ((FORMS as readonly string[]).includes(head)) {
      cur.next();
      if (formLine) {
        push({
          line: t.line,
          code: CODES.E_CHART_FORM,
          message: `the form is already \`${model.form}\`, set on line ${formLine}; a chart draws one shape`,
          severity: "error",
        });
        abandon();
        continue;
      }
      formLine = t.line;
      model.form = head as ChartForm;

      /* Strings and flags in either order: `donut "1.2M" "users"` and `bar stacked horizontal` are
         the two spellings anyone writes, and there is no reason to have an opinion about a third. */
      const hero: string[] = [];
      for (;;) {
        const w = cur.peek();
        if (w.kind === "string") {
          cur.next();
          hero.push(w.value);
          continue;
        }
        if (w.kind === "word" && (w.value === "stacked" || w.value === "horizontal")) {
          cur.next();
          if (w.value === "stacked") model.stacked = true;
          else model.horizontal = true;
          continue;
        }
        break;
      }
      if (hero.length) model.hero = { value: hero[0]!, label: hero[1] };
      endStatement();
      continue;
    }

    /* ---- the categories ---- */
    if (head === "x") {
      cur.next();
      for (;;) {
        const w = cur.peek();
        if (w.kind === "string") {
          cur.next();
          model.categories.push(w.value);
          continue;
        }
        /* A word followed by `=` is a modifier, not a category — the same lookahead the value run
           makes, so `x Q1 Q2 hue=coral` does not swallow the key as a fifth quarter. */
        if (w.kind === "word" && !(cur.peek(1).kind === "punct" && cur.peek(1).value === "=")) {
          cur.next();
          model.categories.push(w.value);
          continue;
        }
        break;
      }
      endStatement();
      continue;
    }

    /* ---- the data ---- */
    if (head === "series" || head === "slice") {
      cur.next();
      const idTok = cur.eat("word");
      if (!idTok) {
        push({ line: t.line, code: CODES.E_EXPECTED_ID, message: `expected an id after \`${head}\``, severity: "error" });
        abandon();
        continue;
      }
      const text = strings();

      const values: (number | null)[] = [];
      for (;;) {
        const w = cur.peek();
        if (w.kind !== "word") break;
        if (cur.peek(1).kind === "punct" && cur.peek(1).value === "=") break;
        cur.next();
        /* `-` is a word to the tokenizer and a gap here — the one value that is not a number. */
        if (w.value === "-") {
          values.push(null);
          continue;
        }
        const n = Number(w.value);
        if (Number.isFinite(n)) {
          values.push(n);
          continue;
        }
        /*
         * Kept as a gap rather than dropped, and that is `ctx.broken`'s argument one dialect over:
         * dropping it shortens the series, which then disagrees with the categories, which raises a
         * `W_CHART_LENGTH` describing a *symptom* of the word above it. One wrong word costs one
         * diagnostic, and a value nobody can read is exactly what a gap already means.
         */
        values.push(null);
        push({
          line: w.line,
          col: w.col,
          code: CODES.E_CHART_VALUE,
          message: `\`${w.value}\` is not a value: write a number, or \`-\` for a gap`,
          severity: "error",
        });
      }

      const mods = readModifiers(cur, push, t.line);

      const before = seen.get(idTok.value);
      if (before !== undefined) {
        push({
          line: t.line,
          code: CODES.E_DUPLICATE_ID,
          message: `\`${idTok.value}\` is already declared on line ${before}`,
          severity: "error",
        });
        endStatement();
        continue;
      }
      seen.set(idTok.value, t.line);

      if (head === "series") {
        model.series.push({ id: idTok.value, title: text[0] ?? idTok.value, values, ...mods, line: t.line });
      } else {
        /* A slice is one value by definition. More is the same defect a long series is, and it gets
           the same warning rather than an error — the data is still drawable. */
        if (values.length > 1) {
          push({
            line: t.line,
            code: CODES.W_CHART_LENGTH,
            message: `a slice has one value; \`${idTok.value}\` was given ${values.length}, and the rest are ignored`,
            severity: "warn",
          });
        }
        model.slices.push({ id: idTok.value, title: text[0] ?? idTok.value, value: values[0] ?? null, ...mods, line: t.line });
      }
      endStatement();
      continue;
    }

    /* ---- the options ---- */
    if (head === "legend") {
      cur.next();
      const w = cur.peek();
      /* `legend bottom` places it; `legend solid "in sync"` is the shared glyph legend. A placement
         word with a string behind it is the second, which is the whole of the disambiguation. */
      if (w.kind === "word" && LEGEND_AT.has(w.value) && cur.peek(1).kind !== "string") {
        cur.next();
        model.legendAt = w.value as LegendAt;
        endStatement();
        continue;
      }
      const glyph = cur.eat("word");
      const label = cur.eat("string");
      if (glyph && label) model.legend.push({ glyph: glyph.value, text: label.value });
      else {
        push({
          line: t.line,
          code: CODES.E_BAD_LEGEND,
          message: '`legend` takes a placement (`none`, `right`, `bottom`) or a glyph and a label: `legend solid "in sync"`',
          severity: "error",
        });
      }
      endStatement();
      continue;
    }

    if (head === "values") {
      cur.next();
      model.values = true;
      endStatement();
      continue;
    }

    if (head === "unit") {
      cur.next();
      const v = cur.peek();
      if (v.kind === "string" || v.kind === "word") {
        cur.next();
        model.unit = v.value;
      } else {
        push({ line: t.line, code: CODES.E_EXPECTED_VALUE, message: '`unit` takes a suffix: `unit "k€"`', severity: "error" });
      }
      endStatement();
      continue;
    }

    if (head === "min" || head === "max") {
      cur.next();
      const v = cur.eat("word");
      const n = v ? Number(v.value) : Number.NaN;
      if (v && Number.isFinite(n)) model[head] = n;
      else {
        push({
          line: t.line,
          code: CODES.E_CHART_VALUE,
          message: v ? `\`${head}\` takes a number; \`${v.value}\` is not one` : `\`${head}\` takes a number`,
          severity: "error",
        });
      }
      endStatement();
      continue;
    }

    /*
     * Anything else. `word …` at the head of a statement is the whole grammar here, so an unknown
     * one is knowable rather than a mystery — and the vocabulary and the suggestion are both in
     * hand at the point it is raised, which is the argument `E_UNKNOWN_KIND` was written on.
     */
    cur.next();
    const guess = suggestKind(head, CHART_WORDS);
    push({
      line: t.line,
      col: t.col,
      code: CODES.E_UNKNOWN_KIND,
      message:
        `\`${head}\` is not a chart statement` +
        (guess ? `. Did you mean \`${guess}\`?` : "") +
        ` (${CHART_WORDS.join(" · ")})`,
      severity: "error",
    });
    abandon();
  }

  /*
   * The shape, reconciled.
   *
   * The categories are the truth when somebody wrote an `x` line; otherwise the longest series is,
   * and the ticks come out blank. Either way a series that disagrees is padded with gaps or cut and
   * *warned* — never refused, because a fragment dropped from the library onto an existing chart
   * would otherwise break the chart it landed on.
   */
  const n = model.categories.length || model.series.reduce((most, s) => Math.max(most, s.values.length), 0);
  for (const s of model.series) {
    if (s.values.length === n) continue;
    const short = s.values.length < n;
    push({
      line: s.line,
      code: CODES.W_CHART_LENGTH,
      message:
        `\`${s.id}\` has ${s.values.length} value${s.values.length === 1 ? "" : "s"} and the chart has ${n} ` +
        `categor${n === 1 ? "y" : "ies"}: ${short ? "the rest are drawn as gaps" : "the extra ones are dropped"}`,
      severity: "warn",
    });
    if (short) while (s.values.length < n) s.values.push(null);
    else s.values.length = n;
  }

  if (model.series.length === 0 && model.slices.length === 0) {
    push({
      line: 1,
      code: CODES.W_CHART_EMPTY,
      message: "nothing to draw: a chart wants a `series` (one value per category) or a `slice` (one value)",
      severity: "warn",
    });
  }

  /*
   * More things than the theme has colours for.
   *
   * The list is never cycled: two series in one hue is two series the reader cannot tell apart, and
   * a generated colour is one the theme does not own. So the tail draws muted and this says which
   * line it started at — the doctrine's own answer being to fold that tail into an "Other".
   */
  const unhued = [...model.series, ...model.slices].filter((s) => s.hue === undefined);
  if (unhued.length > CHART_HUES_MAX) {
    push({
      line: unhued[CHART_HUES_MAX]!.line,
      code: CODES.W_CHART_MANY,
      message:
        `${unhued.length} series or slices without a \`hue=\`, and a theme carries ${CHART_HUES_MAX} chart hues. ` +
        `From here they draw muted. Fold the tail into an "Other", or hue them yourself`,
      severity: "warn",
    });
  }

  model.diagnostics = tidy(diagnostics);
  return model;
}
