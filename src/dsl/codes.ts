/**
 * A stable name for every way a board can be wrong.
 *
 * A diagnostic already carries a line, a column and a sentence. The sentence is for a person and it
 * is allowed to be reworded; the code is for a program and is not. That distinction is the whole
 * point: the skill's fix loop currently has nothing to branch on but prose, so improving an error
 * message is a breaking change to anything that reads it.
 *
 * It also settles a real ambiguity. Five conditions are reported in two different layers with
 * slightly different wording — `unterminated string` happens in the DSL tokenizer and in the
 * fence-line attribute parser, `duplicate id` in the graph parser and in the board parser — and
 * from the message alone you cannot tell which grammar rejected your file. The prefix says: `E_`
 * and `W_` for the diagram DSL, `EB_` and `ANYDAG_` for the board file around it, and `EG_` for what the
 * generator says about a model's answer to a prompt card.
 *
 * Codes are append-only. Retiring one is fine; reusing a retired one for something else is not.
 *
 * **Imported with a relative path from `src/board/`, never `@/dsl/codes`.** The Vite plugin reaches
 * into the board layer, and `vite.config.ts` is loaded by Node before Vite's aliases exist, so an
 * `@/` import anywhere the plugin can reach takes the dev server down at startup with a module-not-
 * found on a package called `@/dsl`.
 */

export const CODES = {
  /* ---- the DSL: lexing ---- */
  /** A `"` opened a string and the line ended before it closed. */
  E_UNTERMINATED_STRING: "E_UNTERMINATED_STRING",
  /** A character that is not part of the grammar. */
  E_BAD_CHARACTER: "E_BAD_CHARACTER",
  /**
   * A string closed right against a word — `"s = "aa""` — which is a `"` meant to be inside the
   * string ending it instead. Written `\"`.
   */
  E_UNESCAPED_QUOTE: "E_UNESCAPED_QUOTE",

  /* ---- the DSL: statements ---- */
  E_EXPECTED_ID: "E_EXPECTED_ID",
  E_EXPECTED_VALUE: "E_EXPECTED_VALUE",
  E_EXPECTED_ARROW: "E_EXPECTED_ARROW",
  E_EXPECTED_BRACE: "E_EXPECTED_BRACE",
  E_UNEXPECTED: "E_UNEXPECTED",
  E_DUPLICATE_ID: "E_DUPLICATE_ID",
  /**
   * A statement declares a node with a word this dialect does not have as a kind.
   *
   * `word word` is a node declaration and nothing else — an edge's second token is an arrow, a `&`
   * or a `.` — so this is knowable, and until it was, `database pg "Postgres"` fell through to the
   * edge parser and came back as two `E_EXPECTED_ARROW`, an `E_UNEXPECTED` and two `E_UNKNOWN_ID`,
   * not one of which contained the word `kind`. The message carries the dialect's whole vocabulary
   * and a suggestion, because both are known at the point it is raised.
   */
  E_UNKNOWN_KIND: "E_UNKNOWN_KIND",
  /** The body is Mermaid rather than this DSL. Carries the translation; see `dsl/mermaid.ts`. */
  E_MERMAID_SYNTAX: "E_MERMAID_SYNTAX",
  /** An edge names a node the diagram never declares. */
  E_UNKNOWN_ID: "E_UNKNOWN_ID",
  /** `a -> ` with nothing after the arrow. */
  E_NO_TARGET: "E_NO_TARGET",
  /** Rows were given to a node kind that has none in this dialect. */
  E_NO_ROWS_HERE: "E_NO_ROWS_HERE",
  E_BAD_LEGEND: "E_BAD_LEGEND",
  E_BAD_DIR: "E_BAD_DIR",
  /** `fk=` wants a group or a hue to point at. */
  E_BAD_FK: "E_BAD_FK",

  /* ---- the DSL: per-dialect ---- */
  E_BAD_DATE: "E_BAD_DATE",
  E_NO_BRANCH: "E_NO_BRANCH",
  E_UNKNOWN_COMMAND: "E_UNKNOWN_COMMAND",
  /** A sequence fragment (`alt`, `loop`, `opt`) that never reaches its `end`. */
  E_UNCLOSED_FRAGMENT: "E_UNCLOSED_FRAGMENT",
  /**
   * A chart was handed a word where it wanted a number.
   *
   * A value is a word `Number()` accepts, or `-` for a gap; `min`/`max` take one too. Everything
   * else is this, and it carries the word, because "not a number" without saying which word is a
   * search through the line.
   */
  E_CHART_VALUE: "E_CHART_VALUE",
  /**
   * A second form line — `bar` and then `pie` in one chart.
   *
   * The form is the one thing a chart body says about itself before it says any data, and two of
   * them is not a chart that draws twice: it is an edit that half landed. The first one stands.
   */
  E_CHART_FORM: "E_CHART_FORM",

  /* ---- the DSL: warnings, which do not stop a diagram drawing ---- */
  /** An edge names a row its node does not have, so it leaves the card instead. */
  W_MISSING_ROW: "W_MISSING_ROW",
  /** `icon=` named something no icon set has. The node draws its kind's default instead. */
  W_UNKNOWN_ICON: "W_UNKNOWN_ICON",
  /**
   * `hue=` on a node, group, lane or edge named something outside `HUE_ORDER`.
   *
   * Silent from M1 to here: `modifiers()` read any word into `Node.hue`/`Edge.hue` and `hueVars()`
   * bound whatever it was handed straight into `--dag-h`/`--dag-t`, so `hue=purple` produced no
   * diagnostic and no visible colour — a CSS custom property nobody set, falling through to
   * `--dag-h-default` by accident rather than by the mechanism that is supposed to decide that. The
   * board-item version of this mistake (`WB_BAD_HUE`) already got a diagnostic in M27; this is the
   * same mistake one grammar layer in, where it is reached far more often. The hue is dropped, not
   * kept and ignored, so the card falls back to what it would have had — inherited or defaulted —
   * rather than binding garbage.
   */
  W_UNKNOWN_HUE: "W_UNKNOWN_HUE",
  /** `focus`, `current`, or `legend focus` — the retired accent ring. Ignored, and the diagram draws. */
  W_RETIRED_FLAG: "W_RETIRED_FLAG",
  /**
   * A `key=value` on a statement that this dialect has no meaning for.
   *
   * `modifiers()` swallowed every unknown key into `extra` and said nothing, so `hue=purple` on a
   * card and `x=40` on a node the layout places were both invisible: the value was read, kept, and
   * never used. A coordinate is the sharp case — inside a `sketch` or a `layout=fixed` fence it is
   * the whole point, and outside one it is somebody expecting a drag to have stuck.
   */
  W_UNKNOWN_ATTR: "W_UNKNOWN_ATTR",
  /**
   * A series has a different number of values than the chart has categories.
   *
   * Padded with gaps, or cut, and never an error. A fragment dropped from the library onto a chart
   * that already has five quarters would otherwise break the chart it landed on, which is the one
   * thing the library may not do — so the shape is reconciled and the author is told which way.
   */
  W_CHART_LENGTH: "W_CHART_LENGTH",
  /** A chart with no `series` and no `slice`: it draws its axes and says so. */
  W_CHART_EMPTY: "W_CHART_EMPTY",
  /**
   * More series or slices without a `hue=` than the theme has chart hues (`CHART_HUES_MAX`).
   *
   * The list is never cycled — two series in one colour is two series a reader cannot tell apart —
   * so the tail draws muted. The doctrine's own answer is to fold the tail into an "Other", and
   * saying so is the honest way to draw it anyway.
   */
  W_CHART_MANY: "W_CHART_MANY",

  /* Retired, and not to be reused: `W_MULTIPLE_FOCUS`, which capped `focus` at one node per
     diagram. The flag it policed is gone — emphasis follows the reader's mouse now. */

  /* ---- the board file around the fences ---- */
  /** The board could not be read at all: no such file, or the dev server is not answering. */
  EB_UNREADABLE: "EB_UNREADABLE",
  EB_FRONTMATTER: "EB_FRONTMATTER",
  EB_UNKNOWN_TYPE: "EB_UNKNOWN_TYPE",
  EB_DUPLICATE_ID: "EB_DUPLICATE_ID",
  EB_BAD_DIR: "EB_BAD_DIR",
  EB_BAD_ASPECT: "EB_BAD_ASPECT",
  /** `frame=` was neither `none` nor `full`. */
  EB_BAD_FRAME: "EB_BAD_FRAME",
  /** `layout=` was not `fixed` — the only value there is. */
  EB_BAD_LAYOUT: "EB_BAD_LAYOUT",
  EB_UNKNOWN_PAGE: "EB_UNKNOWN_PAGE",
  /**
   * An item's `hue=` named something outside `HUE_ORDER`. `ANYDAG_`, not `EB_`, because the item is
   * still whatever it was — the hue is dropped, not the board's parse.
   */
  WB_BAD_HUE: "WB_BAD_HUE",
  /**
   * A `prompt` card's `as=` named something that is not a diagram type. `ANYDAG_` for `WB_BAD_HUE`'s
   * reason: the value is dropped and the card still generates, letting the model choose the type.
   */
  WB_BAD_AS: "WB_BAD_AS",
  /**
   * A link's `via=` was not one point. `ANYDAG_` for the same reason as the two above: the value is
   * dropped and the link is still drawn, straight, which is what it looked like before anybody
   * bent it.
   */
  WB_BAD_VIA: "WB_BAD_VIA",
  /* attribute list */
  EB_EXPECTED_ID: "EB_EXPECTED_ID",
  EB_EXPECTED_VALUE: "EB_EXPECTED_VALUE",
  EB_UNTERMINATED_STRING: "EB_UNTERMINATED_STRING",
  EB_UNEXPECTED: "EB_UNEXPECTED",
  /* an `edges` fence: the links between items */
  /** A link statement the link grammar could not read. */
  EB_LINK_SYNTAX: "EB_LINK_SYNTAX",
  /** A link names an item this page does not hold. */
  EB_LINK_UNKNOWN_ITEM: "EB_LINK_UNKNOWN_ITEM",
  /** `item.node` — the item is a diagram, and it declares no such node. */
  EB_LINK_UNKNOWN_NODE: "EB_LINK_UNKNOWN_NODE",
  /* the generator: what a model answered for a `prompt` card (`plugins/generate/`) */
  /**
   * The card asked for one type (`as=`) and the model drew another. `EG_` because neither grammar
   * is wrong — the diagram may parse clean — and the fix loop still has to say so in a way it can
   * branch on.
   */
  EG_WRONG_TYPE: "EG_WRONG_TYPE",
} as const;

export type Code = (typeof CODES)[keyof typeof CODES];

/** Whether a code reports something that stops the diagram, or something merely worth saying. */
export const severityOf = (code: Code): "error" | "warn" => (code.startsWith("W") ? "warn" : "error");
