import { ICON_NAMES } from "./icon-names";
import { CODES, type Code } from "./codes";
import { parsePoints, type InkPoint } from "./ink";
import { detectMermaid } from "./mermaid";
import { isKindAlias, nearest, suggestHue, suggestIcon, suggestKind, suggestPicture } from "./suggest";
import {
  emptyGraph,
  HUE_ORDER,
  type Diagnostic,
  type DiagramType,
  type Graph,
  type Hue,
  type Node,
  type NodeKind,
  type Ref,
  type Row,
  type Status,
} from "./ir";
import { Cursor, tokenize, type LexError, type Token } from "./tokenizer";

/**
 * The statements every dialect shares.
 *
 * A dialect is a set of node kinds, a row grammar and a default direction. Groups, lanes, edges,
 * flags, the legend, `&` buses and chained arrows are written once here, because the moment two
 * parsers each grow their own edge statement they start disagreeing about what `quiet` means.
 */

const FLAGS = new Set(["done", "wait", "stop", "muted", "async", "external", "bold", "italic"]);
const STATUS_OF: Record<string, Status> = {
  done: "done",
  wait: "wait",
  stop: "stop",
  muted: "muted",
};

/**
 * Words that used to be flags, accepted so that a board written before the accent ring was retired
 * still draws. Left out of `FLAGS`, they would break the statement instead — the parser would stop
 * at an unexpected word and report a syntax error two tokens from the real cause.
 */
const RETIRED_FLAGS = new Set(["focus", "current"]);

export interface Dialect {
  type: DiagramType;
  dir: Graph["dir"];
  /** Word → node kind. The word is what the author types; the kind is what the renderer draws. */
  kinds: Record<string, NodeKind>;
  /** Reads one row inside a node's `{ }`. Absent → the dialect has no rows. */
  row?(cur: Cursor, ctx: Ctx): Row | null;
  /** `group` in most dialects; `system` also opens one in C4 and use case. */
  groupWords?: string[];
  lanes?: boolean;
  /** Per-dialect fix-ups once everything is read — C4's string positions, class compartments. */
  finish?(graph: Graph): void;
  /**
   * Whether a container with no `hue=` takes the next hue in the theme's order.
   *
   * True everywhere but `sketch`, where a container is a phone frame or a window — scenery, drawn
   * in the theme's greys — and the automatic hue would tint it *and* inherit onto everything in it,
   * so a wireframe would arrive indigo. An explicit `hue=` still inherits, which is the half of the
   * rule worth keeping.
   */
  autoHue?: boolean;
}

export interface Ctx {
  graph: Graph;
  dialect: Dialect;
  diag: Diagnostic[];
  /** Innermost first. */
  groups: string[];
  lane?: string;
  /** Edge refs are resolved after the whole source is read, so an edge may precede its nodes. */
  pendingRefs: { ref: Ref; raw: string; line: number }[];
  /**
   * Ids that a statement tried to declare and failed to.
   *
   * A broken declaration takes every edge that mentions it down with it: `database pg "Postgres"`
   * is one mistake, and without this it is also an `E_UNKNOWN_ID` on every correct line that names
   * `pg` afterwards. Those errors point at lines with nothing wrong on them, which is the worst
   * kind of error to hand anybody — the fix is on a line the message never mentions. The id is
   * known at the point the declaration is rejected, so record it and let `resolveRefs` stay quiet
   * about it: the cause is already reported, once, where it is.
   */
  broken: Set<string>;
  seq: number;
}

export const err = (ctx: Ctx, t: Token, code: Code, message: string): void => {
  ctx.diag.push({ line: t.line, col: t.col, code, message, severity: "error" });
};

const warn = (ctx: Ctx, line: number, code: Code, message: string): void => {
  ctx.diag.push({ line, code, message, severity: "warn" });
};

/** Every consecutive string, in order: title, meta, desc. */
export function strings(cur: Cursor, max = 3): { value: string; mono: boolean }[] {
  const out: { value: string; mono: boolean }[] = [];
  while (out.length < max) {
    const t = cur.eat("string");
    if (!t) break;
    out.push({ value: t.value, mono: t.mono === true });
  }
  return out;
}

export interface Modifiers {
  status?: Status;
  async?: boolean;
  external?: boolean;
  bold?: boolean;
  italic?: boolean;
  icon?: string;
  hue?: Hue;
  w?: number;
  h?: number;
  x?: number;
  y?: number;
  pts?: InkPoint[];
  col?: number;
  quiet?: boolean;
  extra: Record<string, string>;
}

/**
 * The `key=value` names every dialect understands, for the message `W_UNKNOWN_ATTR` carries.
 *
 * `kind` and `dir` are on the list because they *are* read — `parseNode` takes `kind=` as a
 * per-node override and `parseGroup` takes `dir=` — they were simply never written down anywhere,
 * which is how they came to be working undocumented overrides.
 */
const KNOWN_ATTRS = ["icon", "hue", "w", "h", "x", "y", "pts", "col", "kind", "dir"] as const;

/** `0` is a coordinate. `Number(v) || undefined` is not, which is why this is not that. */
const numberOf = (v: string): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Whether this statement's `x=`/`y=`/`h=` are geometry rather than a mistake.
 *
 * `sketch` is fixed by nature; any fence may say so with `layout=fixed`. Everywhere else the layout
 * owns the coordinates, so a coordinate written on a node is still read onto it — nothing is thrown
 * away — and warned about, because the alternative is a value kept, ignored and never mentioned.
 */
const fixed = (ctx: Ctx): boolean => ctx.dialect.type === "sketch" || ctx.graph.layout === "fixed";

/**
 * Whether `col=` says anything here.
 *
 * It is a *layer* in a layered layout, so it means something only where ELK is the one placing —
 * not in a fence whose coordinates are the author's, and not in the two dialects whose layout is
 * ours because they have an axis ELK has no concept of. Warned rather than dropped, for the reason
 * a stray `x=` is: a value kept, ignored and never mentioned is how `extra` came to hold two
 * working undocumented overrides.
 */
const layered = (ctx: Ctx): boolean => !fixed(ctx) && ctx.dialect.lanes !== true;

/** Trailing `done`, `hue=teal`, `icon=server`, `w=320` — in any order, until the statement ends. */
export function modifiers(cur: Cursor, ctx: Ctx): Modifiers {
  const out: Modifiers = { extra: {} };
  for (;;) {
    const t = cur.peek();
    if (t.kind !== "word") break;

    if (FLAGS.has(t.value)) {
      cur.next();
      if (t.value === "async") out.async = true;
      else if (t.value === "external") out.external = true;
      /* `bold` and `italic` are emphasis on the title, not a state — falling through to
         `STATUS_OF` would look the word up, get `undefined`, and clear a status the node
         already carried (`done bold` would lose the `done`). */ else if (t.value === "bold") out.bold = true;
      else if (t.value === "italic") out.italic = true;
      else out.status = STATUS_OF[t.value];
      continue;
    }
    if (RETIRED_FLAGS.has(t.value)) {
      cur.next();
      warn(ctx, t.line, CODES.W_RETIRED_FLAG, `\`${t.value}\` no longer marks anything. Hovering a node rings it now`);
      continue;
    }
    if (t.value === "quiet") {
      cur.next();
      out.quiet = true;
      continue;
    }

    // key=value
    if (cur.peek(1).kind === "punct" && cur.peek(1).value === "=") {
      const key = cur.next().value;
      cur.next();
      const v = cur.peek();
      if (v.kind !== "word" && v.kind !== "string") {
        err(ctx, v, CODES.E_EXPECTED_VALUE, `expected a value after \`${key}=\``);
        break;
      }
      cur.next();
      /*
       * `icon=aws:lambda` — a namespaced value, joined here rather than in the tokenizer.
       *
       * The icon vocabulary needs two namespaces a bare word cannot carry: a vendor's own pack
       * (`aws:`, `azure:`, `gcp:`) and the `mono:`/`lucide:` overrides that pick which vocabulary a
       * name is read from. Teaching the tokenizer that `:` can sit inside a word would reach much
       * further than this — `a --> b: label` and a sequence message both end an id with a colon, and
       * they would start swallowing their own labels. Joining only on the right-hand side of a
       * `key=`, and only when the colon is immediately followed by another word, keeps the change
       * where it belongs.
       */
      const value = namespaced(cur, v);
      if (key === "icon") out.icon = value;
      else if (key === "hue") {
        /* Dropped, not kept and ignored: `hueVars()` binds `--dag-h`/`--dag-t` from whatever this is
           handed, and a name outside `HUE_ORDER` would bind a CSS custom property nobody set —
           invisible, not merely wrong. Leaving `out.hue` unset lets the card fall back to what it
           would have had with no `hue=` at all: inherited from its group or lane, or defaulted. */
        if ((HUE_ORDER as readonly string[]).includes(value)) out.hue = value;
        else {
          const guess = suggestHue(value, HUE_ORDER);
          warn(
            ctx,
            t.line,
            CODES.W_UNKNOWN_HUE,
            guess
              ? `no hue named \`${value}\`. Did you mean \`${guess}\`? (${HUE_ORDER.join(", ")})`
              : `no hue named \`${value}\`: expected one of ${HUE_ORDER.join(", ")}`,
          );
        }
      } else if (key === "w") out.w = numberOf(value);
      else if (key === "col") {
        const n = numberOf(value);
        if (n === undefined || !Number.isInteger(n) || n < 0) {
          warn(ctx, t.line, CODES.W_UNKNOWN_ATTR, "`col=` takes a whole number from 0: the layer to keep this card in");
        } else if (!layered(ctx)) {
          out.col = n;
          warn(
            ctx,
            t.line,
            CODES.W_UNKNOWN_ATTR,
            "`col=` is a layer in an automatic layout, and this diagram places by " +
              (fixed(ctx) ? "the coordinates you wrote" : "its lanes"),
          );
        } else out.col = n;
      } else if (key === "h" || key === "x" || key === "y") {
        out[key] = numberOf(value);
        if (!fixed(ctx)) {
          warn(
            ctx,
            t.line,
            CODES.W_UNKNOWN_ATTR,
            "`" +
              key +
              "=` is the author's geometry, and this diagram is laid out: " +
              "open the fence with `layout=fixed`, or draw it as a `sketch`",
          );
        }
      } else if (key === "pts") {
        /* A stroke's path, read like a coordinate: kept even where it means nothing, so switching
           the fence to `layout=fixed` is a one-word edit rather than a retyped stroke. A malformed
           list is an error, not a silent drop — the points are the drawing, and a node whose
           `pts=` did not parse would render as nothing and explain itself to nobody. */
        const pts = parsePoints(value);
        if (pts) out.pts = pts;
        else err(ctx, v, CODES.E_EXPECTED_VALUE, "`pts=` takes whole-number `x,y` pairs separated by spaces");
        if (!fixed(ctx)) {
          warn(
            ctx,
            t.line,
            CODES.W_UNKNOWN_ATTR,
            "`pts=` is the author's geometry, and this diagram is laid out: " +
              "open the fence with `layout=fixed`, or draw it as a `sketch`",
          );
        }
      } else {
        out.extra[key] = value;
        if (key !== "kind" && key !== "dir") {
          warn(
            ctx,
            t.line,
            CODES.W_UNKNOWN_ATTR,
            `\`${key}=\` means nothing in a ${ctx.dialect.type} diagram (${KNOWN_ATTRS.join(" · ")})`,
          );
        }
      }
      continue;
    }
    break;
  }
  return out;
}

/** `api.identity` → `{node: 'api', row: 'identity'}` — resolved once every node id is known. */
/**
 * The rest of a namespaced value — `aws` `:` `lambda` → `aws:lambda` — after its first word has
 * been consumed. Shared with the sequence parser's own `participant` loop, which had its own
 * three-line attribute reader and no join, so `icon=aws:sqs` on a participant was a parse error
 * pointing at the colon, and the same value on a service was fine.
 */
export function namespaced(cur: Cursor, v: Token): string {
  let value = v.value;
  while (v.kind === "word" && cur.peek().kind === "punct" && cur.peek().value === ":" && cur.peek(1).kind === "word") {
    cur.next();
    value += `:${cur.next().value}`;
  }
  return value;
}

function makeRef(ctx: Ctx, raw: string, line: number): Ref {
  const ref: Ref = { node: raw };
  ctx.pendingRefs.push({ ref, raw, line });
  return ref;
}

function resolveRefs(ctx: Ctx): void {
  const nodes = new Set(ctx.graph.nodes.map((n) => n.id));
  const groups = new Set(ctx.graph.groups.map((g) => g.id));
  const rowsOf = new Map(ctx.graph.nodes.map((n) => [n.id, new Set(n.rows.map((r) => r.id))]));

  for (const { ref, raw, line } of ctx.pendingRefs) {
    /* `[*]` is not declared anywhere — `finalize` turns each occurrence into its own pseudostate
       node once every real id is known. */
    if (raw === "[*]") continue;
    if (nodes.has(raw) || groups.has(raw)) {
      ref.node = raw;
      continue;
    }
    const cut = raw.lastIndexOf(".");
    if (cut > 0) {
      const head = raw.slice(0, cut);
      const tail = raw.slice(cut + 1);
      if (nodes.has(head)) {
        ref.node = head;
        if (rowsOf.get(head)?.has(tail)) ref.row = tail;
        else warn(ctx, line, CODES.W_MISSING_ROW, `\`${head}\` has no row \`${tail}\`, so the edge leaves the card instead`);
        continue;
      }
    }
    /* Its declaration was rejected on a line of its own, with a message that says why. Saying it
       again here, against a line that is correct, only buries the one that can be acted on. */
    if (ctx.broken.has(raw)) continue;

    const guess = nearest(raw, [...nodes, ...groups]);
    ctx.diag.push({
      line,
      code: CODES.E_UNKNOWN_ID,
      message: guess
        ? `unknown id \`${raw}\`. Did you mean \`${guess}\`?`
        : `unknown id \`${raw}\`: nothing in this diagram declares it`,
      severity: "error",
    });
  }
}

/** `a & b & c` — several sources or targets in one statement. */
function refList(cur: Cursor, ctx: Ctx): { refs: Ref[]; ok: boolean } {
  const refs: Ref[] = [];
  for (;;) {
    const t = cur.peek();
    if (t.kind !== "word") {
      err(ctx, t, CODES.E_EXPECTED_ID, "expected an id");
      return { refs, ok: false };
    }
    cur.next();
    refs.push(makeRef(ctx, t.value, t.line));
    if (!cur.eat("punct", "&")) return { refs, ok: true };
  }
}

/**
 * An edge statement, including chains and buses.
 *
 *     a --> b --> c              three nodes, two edges
 *     a & b & c --> d "reject"   one trunk: several sources, one line (rule 4)
 *     f1 --> a & b & c           a fan out of a fork bar
 *
 * `&` reads as "these, together" in both directions. Whether that draws as a collector or a fan is
 * the router's call, made from the node kinds — a `join` bar collects by being a bar.
 */
function parseEdge(cur: Cursor, ctx: Ctx, first?: Token): boolean {
  const startTok = first ?? cur.peek();
  let left = first
    ? (() => {
        const refs = [makeRef(ctx, first.value, first.line)];
        while (cur.eat("punct", "&")) {
          const t = cur.peek();
          if (t.kind !== "word") {
            err(ctx, t, CODES.E_EXPECTED_ID, "expected an id after `&`");
            return refs;
          }
          cur.next();
          refs.push(makeRef(ctx, t.value, t.line));
        }
        return refs;
      })()
    : refList(cur, ctx).refs;

  if (cur.peek().kind !== "arrow") {
    err(ctx, cur.peek(), CODES.E_EXPECTED_ARROW, "expected an arrow");
    return false;
  }

  let made = false;
  while (cur.peek().kind === "arrow") {
    const arrowTok = cur.next();
    const spec = arrowTok.arrow!;
    const right = refList(cur, ctx);
    if (right.refs.length === 0) return made;

    /* Mermaid writes the label after a colon; ours is just the next string. Accept both so a
       pasted Mermaid line does not need editing. */
    cur.eat("punct", ":");
    const labels = strings(cur, 2);
    const mods = modifiers(cur, ctx);

    /* One trunk when several sources converge, one fan when one source diverges. The id is shared
       so the router can recognise the family. */
    const bus = left.length > 1 ? `bus-${ctx.seq++}` : undefined;

    for (const a of left) {
      for (const b of right.refs) {
        ctx.graph.edges.push({
          id: `e${ctx.seq++}`,
          from: a,
          to: b,
          dash: spec.dash,
          quiet: mods.quiet === true,
          head: spec.head,
          tail: spec.tail,
          /* An explicit `hue=` on the statement. `finalize()` derives an edge's hue from its
             source's, and only when it has none of its own — so this is the author overruling
             that, and until F3 wanted a swatch there was nothing to write it with. */
          hue: mods.hue,
          label: labels[0]?.value,
          label2: labels[1]?.value,
          bus,
          line: arrowTok.line,
        });
        made = true;
      }
    }
    left = right.refs;
  }

  if (!made) err(ctx, startTok, CODES.E_NO_TARGET, "edge has no target");
  return made;
}

function parseNode(cur: Cursor, ctx: Ctx, kindWord: Token): void {
  const kind = ctx.dialect.kinds[kindWord.value]!;
  const idTok = cur.peek();
  if (idTok.kind !== "word") {
    err(ctx, idTok, CODES.E_EXPECTED_ID, `expected an id after \`${kindWord.value}\``);
    cur.skipStatement();
    return;
  }
  cur.next();

  const texts = strings(cur);
  const mods = modifiers(cur, ctx);

  const node: Node = {
    id: idTok.value,
    kind,
    /* A card with no title shows its id, which is how `state done` reads. A figure's title is its
       caption and a picture is allowed none, so an unwritten one stays empty rather than
       printing the id under a house. A start or end state draws no text at all. */
    title: texts[0]?.value ?? (kind === "figure" || kind === "start" || kind === "end" ? "" : idTok.value),
    meta: texts[1]?.value,
    desc: texts[2]?.value,
    rows: [],
    status: mods.status,
    async: mods.async,
    external: mods.external || kind === "external" || kind === "extsystem",
    bold: mods.bold,
    italic: mods.italic,
    icon: mods.icon,
    hue: mods.hue,
    group: ctx.groups[0],
    lane: ctx.lane,
    w: mods.w,
    h: mods.h,
    x: mods.x,
    y: mods.y,
    pts: mods.pts,
    col: mods.col,
    line: kindWord.line,
  };
  if (mods.extra.kind) node.kind = (ctx.dialect.kinds[mods.extra.kind] ?? node.kind) as NodeKind;

  if (cur.eat("punct", "{")) {
    if (!ctx.dialect.row) {
      err(ctx, kindWord, CODES.E_NO_ROWS_HERE, `\`${kindWord.value}\` takes no rows in a ${ctx.dialect.type} diagram`);
      let depth = 1;
      while (depth > 0 && !cur.done) {
        const t = cur.next();
        if (t.kind === "punct" && t.value === "{") depth++;
        if (t.kind === "punct" && t.value === "}") depth--;
      }
    } else {
      cur.skipSeps();
      while (!cur.done && !(cur.peek().kind === "punct" && cur.peek().value === "}")) {
        const before = cur.peek();
        const row = ctx.dialect.row(cur, ctx);
        if (row) node.rows.push(row);
        if (cur.peek() === before) cur.skipStatement();
        cur.skipSeps();
      }
      if (!cur.eat("punct", "}")) err(ctx, cur.peek(), CODES.E_EXPECTED_BRACE, "expected `}`");
    }
  }

  if (ctx.graph.nodes.some((n) => n.id === node.id)) {
    err(ctx, idTok, CODES.E_DUPLICATE_ID, `duplicate id \`${node.id}\``);
    return;
  }
  ctx.graph.nodes.push(node);
}

function parseGroup(cur: Cursor, ctx: Ctx, word: Token): void {
  const idTok = cur.peek();
  if (idTok.kind !== "word") {
    err(ctx, idTok, CODES.E_EXPECTED_ID, `expected an id after \`${word.value}\``);
    cur.skipStatement();
    return;
  }
  cur.next();
  const texts = strings(cur, 2);
  const mods = modifiers(cur, ctx);

  ctx.graph.groups.push({
    id: idTok.value,
    label: texts[0]?.value ?? idTok.value,
    sublabel: texts[1]?.value,
    hue: mods.hue,
    level: ctx.groups.length,
    parent: ctx.groups[0],
    shape: word.value === "system" ? "system" : "group",
    dir: mods.extra.dir === "TB" ? "DOWN" : mods.extra.dir === "LR" ? "RIGHT" : undefined,
    x: mods.x,
    y: mods.y,
    w: mods.w,
    h: mods.h,
    line: word.line,
  });

  if (!cur.eat("punct", "{")) {
    err(ctx, cur.peek(), CODES.E_EXPECTED_BRACE, "expected `{` after a group");
    return;
  }
  ctx.groups.unshift(idTok.value);
  parseBlock(cur, ctx, true);
  ctx.groups.shift();
}

function parseLane(cur: Cursor, ctx: Ctx, word: Token): void {
  const idTok = cur.peek();
  if (idTok.kind !== "word") {
    err(ctx, idTok, CODES.E_EXPECTED_ID, "expected an id after `lane`");
    cur.skipStatement();
    return;
  }
  cur.next();
  const texts = strings(cur, 1);
  const mods = modifiers(cur, ctx);

  ctx.graph.lanes.push({
    id: idTok.value,
    label: texts[0]?.value ?? idTok.value,
    hue: mods.hue,
    line: word.line,
  });

  if (!cur.eat("punct", "{")) {
    err(ctx, cur.peek(), CODES.E_EXPECTED_BRACE, "expected `{` after a lane");
    return;
  }
  const outer = ctx.lane;
  ctx.lane = idTok.value;
  parseBlock(cur, ctx, true);
  ctx.lane = outer;
}

/**
 * `<not-a-kind> <id> …` — report the kind, not the wreckage downstream of it.
 *
 * The id is consumed and remembered before the statement is skipped, so the edges that name it stay
 * quiet: one wrong word should cost one error, however many correct lines depend on it.
 */
function unknownKind(cur: Cursor, ctx: Ctx, word: Token): void {
  const kinds = Object.keys(ctx.dialect.kinds);
  const guess = suggestKind(word.value, kinds);
  const idTok = cur.peek(1);
  if (idTok.kind === "word") ctx.broken.add(idTok.value);

  /* `wait approve "…"` — a status written where the kind goes. It is the word a model reaches for
     (the state sheet lists `done`, `wait`, `stop` beside the states they colour), and "not a node
     kind" alone sent an agent back to the grammar to work out that it goes at the end. */
  const flag = FLAGS.has(word.value) ? word.value : undefined;
  const first = kinds[0] ?? "node";
  const id = idTok.kind === "word" ? idTok.value : "id";
  /* `house home "Home"` in a sketch — somebody asking for a picture of a house, which is a `figure`
     wearing that icon. A kind the synonym table names still wins: `rectangle` means `box`,
     not a picture of one. */
  const picture =
    !flag && "figure" in ctx.dialect.kinds && !(guess && isKindAlias(word.value))
      ? suggestPicture(word.value, ICON_NAMES)
      : undefined;
  err(
    ctx,
    word,
    CODES.E_UNKNOWN_KIND,
    `\`${word.value}\` is not a node kind in \`${ctx.dialect.type}\`` +
      (flag
        ? `. It is a flag, and goes after the node: \`${first} ${id} "…" ${flag}\``
        : picture !== undefined
          ? `. A picture of one is a figure: \`figure ${id} "…"${picture ? ` icon=${picture}` : ""}\``
          : guess
            ? `. Did you mean \`${guess}\`?`
            : "") +
      ` (${kinds.join(" · ")})`,
  );
  cur.skipStatement();
}

function parseBlock(cur: Cursor, ctx: Ctx, nested: boolean): void {
  const groupWords = ctx.dialect.groupWords ?? ["group"];
  cur.skipSeps();

  while (!cur.done) {
    if (cur.peek().kind === "punct" && cur.peek().value === "}") {
      if (nested) {
        cur.next();
        return;
      }
      err(ctx, cur.peek(), CODES.E_UNEXPECTED, "unexpected `}`");
      cur.next();
      cur.skipSeps();
      continue;
    }

    const t = cur.peek();
    if (t.kind !== "word") {
      err(ctx, t, CODES.E_UNEXPECTED, `unexpected ${t.kind === "string" ? "text" : `\`${t.value}\``}`);
      cur.skipStatement();
      cur.skipSeps();
      continue;
    }

    const before = cur.peek();

    if (groupWords.includes(t.value) && cur.peek(1).kind === "word") {
      cur.next();
      parseGroup(cur, ctx, t);
    } else if (ctx.dialect.lanes && t.value === "lane" && cur.peek(1).kind === "word") {
      cur.next();
      parseLane(cur, ctx, t);
    } else if (t.value === "legend") {
      cur.next();
      const glyph = cur.eat("word");
      const text = cur.eat("string");
      if (!glyph || !text) err(ctx, t, CODES.E_BAD_LEGEND, "legend takes a glyph and a description");
      /* A legend that explains a mark the diagram no longer draws is worse than no legend. */ else if (
        RETIRED_FLAGS.has(glyph.value)
      ) {
        warn(ctx, t.line, CODES.W_RETIRED_FLAG, `there is no \`${glyph.value}\` mark to explain any more`);
      } else ctx.graph.legend.push({ glyph: glyph.value, text: text.value });
    } else if (t.value === "dir" && cur.peek(1).kind === "punct" && cur.peek(1).value === "=") {
      cur.next();
      cur.next();
      const v = cur.eat("word");
      if (v?.value === "LR" || v?.value === "TB") ctx.graph.dir = v.value;
      else err(ctx, t, CODES.E_BAD_DIR, "dir must be LR or TB");
    } else if (ctx.dialect.kinds[t.value] && cur.peek(1).kind === "word") {
      cur.next();
      parseNode(cur, ctx, t);
    } else if (cur.peek(1).kind === "word") {
      /*
       * Two words in a row is a node declaration and can be nothing else — an edge's second token
       * is an arrow, a `&` or the `.` of a row ref — so the word in front is a kind, and this
       * dialect does not have it.
       *
       * Falling through to `parseEdge` here is what produced the cascade: it read both words as
       * ids, failed on the missing arrow, failed again on the title string, and then reported the
       * two ids as undeclared. Five errors, all of them true, none of them the mistake.
       */
      unknownKind(cur, ctx, t);
    } else {
      /* Anything else beginning with a word is an edge — including `[*] --> new`, where the first
         token is a pseudostate rather than a declared node. */
      cur.next();
      parseEdge(cur, ctx, t);
    }

    if (cur.peek() === before) cur.skipStatement();
    cur.skipSeps();
  }

  if (nested) err(ctx, cur.peek(), CODES.E_EXPECTED_BRACE, "expected `}`");
}

/**
 * Derived properties: pseudostate nodes, edge hues, danger edges.
 *
 * These are computed rather than written because the rules say so — "an edge carries its source's
 * group hue" is not something an author should have to repeat on ninety edges.
 */
function finalize(ctx: Ctx): void {
  const g = ctx.graph;

  /* `[*]` appears as a ref, never as a declaration. Each occurrence is its own node: a state
     machine with three ways to end draws three bullseyes, which is what the reference does. */
  let pseudo = 0;
  for (const e of g.edges) {
    for (const [ref, kind] of [
      [e.from, "start"],
      [e.to, "end"],
    ] as const) {
      if (ref.node !== "[*]") continue;
      const id = `__${kind}-${pseudo++}`;
      g.nodes.push({
        id,
        kind,
        title: "",
        rows: [],
        group: undefined,
        line: e.line,
      });
      ref.node = id;
    }
  }

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const groupById = new Map(g.groups.map((gr) => [gr.id, gr]));
  const laneById = new Map(g.lanes.map((l) => [l.id, l]));

  /* A pseudostate is written as `[*]`, so it never had a chance to say which lane it is in. It
     belongs beside whatever it connects to — otherwise every start and end collects in an
     unlabelled band at the bottom, which is where they were before this. */
  for (const e of g.edges) {
    const from = byId.get(e.from.node);
    const to = byId.get(e.to.node);
    if (from && to?.lane && !from.lane && (from.kind === "start" || from.kind === "end")) from.lane = to.lane;
    if (to && from?.lane && !to.lane && (to.kind === "start" || to.kind === "end")) to.lane = from.lane;
  }

  /* A group with no hue takes the next one in the theme's order, so a diagram is legible without
     the author naming a single colour. Not in a `sketch`, where a container is a phone frame rather
     than a domain: there the greys are the drawing, and an automatic hue would tint every shape
     inside it as well. */
  if (ctx.dialect.autoHue !== false) {
    let next = 0;
    for (const gr of g.groups) if (!gr.hue) gr.hue = HUE_ORDER[next++ % HUE_ORDER.length];
    for (const l of g.lanes) if (!l.hue) l.hue = HUE_ORDER[next++ % HUE_ORDER.length];
  }

  const hueOf = (n: Node | undefined): Hue | undefined => {
    if (!n) return undefined;
    if (n.hue) return n.hue;
    if (n.lane) return laneById.get(n.lane)?.hue;
    let gid = n.group;
    while (gid) {
      const gr = groupById.get(gid);
      if (gr?.hue) return gr.hue;
      gid = gr?.parent;
    }
    return undefined;
  };
  for (const n of g.nodes) if (!n.hue) n.hue = hueOf(n);

  for (const e of g.edges) {
    if (!e.hue) e.hue = byId.get(e.from.node)?.hue ?? groupById.get(e.from.node)?.hue;
    if (byId.get(e.to.node)?.status === "stop") e.danger = true;
  }

  /*
   * An `icon=` nobody can draw.
   *
   * Worth a diagnostic rather than a silent fallback because the icon vocabulary is now thousands
   * of names deep and full of near-misses: `groq` and `grok` are different companies, `together`
   * and `tether` are different companies, `zookeeper` and `keeper` are different companies. A typo
   * that quietly drew a generic box would be survivable; one that quietly draws a *different real
   * logo* is not, and only the author knows which they meant.
   */
  for (const n of g.nodes) {
    if (!n.icon) continue;
    const prefix = ["mono:", "lucide:"].find((p) => n.icon!.startsWith(p));
    const bare = prefix ? n.icon.slice(prefix.length) : n.icon;
    if (ICON_NAMES.has(bare)) continue;
    const guess = suggestIcon(n.icon, ICON_NAMES);
    ctx.diag.push({
      line: n.line,
      code: CODES.W_UNKNOWN_ICON,
      message: `no icon named "${n.icon}"; drawing the default for a ${n.kind}` + (guess ? `. Did you mean \`${guess}\`?` : ""),
      severity: "warn",
    });
  }
}

/**
 * In line order, and each thing said once.
 *
 * Diagnostics are produced in the order the passes run, not the order they can be read: the parser
 * walks the file, then `resolveRefs` appends every unknown id at the end, so a six-line diagram
 * reported its errors as lines 9, 9, 6, 6, 7, 7, 7, 8, 9, 11, 6 — which asks whoever is fixing it
 * to sort the list before they can start. Sorting is free and the reading order is the file's.
 *
 * The dedupe is the other half. A recovery that reports twice on the same token — two
 * `expected an arrow` on one line, at columns 7 and 9 — is one fact stated twice; the second copy
 * has no information in it and costs a reader another line to rule out.
 */
export function tidy(diag: Diagnostic[]): Diagnostic[] {
  /*
   * A line whose cause is already named does not need its symptoms as well.
   *
   * `a -->|calls| b` is one mistake, and the tokenizer, the edge parser and `resolveRefs` each have
   * something true to say about it: an unexpected `|`, a missing arrow, and an undeclared id called
   * `calls`. All three describe the pipes. Once the Mermaid sniffer has said *pipes*, and said what
   * to write instead, the other three are three more lines to read before reaching the same fix.
   */
  const CAUSES: string[] = [CODES.E_MERMAID_SYNTAX, CODES.E_UNESCAPED_QUOTE];
  const explained = new Set(diag.filter((d) => CAUSES.includes(d.code)).map((d) => d.line));

  const seen = new Set<string>();
  return diag
    .filter((d) => CAUSES.includes(d.code) || !explained.has(d.line))
    .filter((d) => {
      const key = `${d.line}:${d.code}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line || (a.col ?? 0) - (b.col ?? 0));
}

export function parseWith(dialect: Dialect, src: string, layout?: "fixed"): Graph {
  const graph = emptyGraph(dialect.type, dialect.dir);
  /* Set before a single token is read: `modifiers()` asks the graph whether a coordinate on a
     statement is geometry or a mistake, and that answer has to be true from the first line. */
  if (layout) graph.layout = layout;
  const diag: Diagnostic[] = [];

  /*
   * Before the tokenizer, because the tokenizer has no way to say this.
   *
   * A Mermaid header means the body is another language end to end, and parsing it produces one
   * error per line — every one of them describing a symptom of the same paste. Report it once and
   * hand back an empty graph; the error card says what to write instead, which is the only useful
   * thing there is to say about a block that is not in this grammar.
   */
  const mermaid = detectMermaid(src);
  for (const h of mermaid.hits) {
    diag.push({ line: h.line, code: CODES.E_MERMAID_SYNTAX, message: h.message, severity: "error" });
  }
  if (mermaid.fatal) {
    graph.diagnostics = diag;
    return graph;
  }

  const lexErrors: LexError[] = [];
  const tokens = tokenize(src, lexErrors);
  for (const e of lexErrors) diag.push({ ...e, severity: "error" });

  const ctx: Ctx = { graph, dialect, diag, groups: [], pendingRefs: [], broken: new Set(), seq: 1 };
  const cur = new Cursor(tokens, { push: (d) => diag.push(d) });

  parseBlock(cur, ctx, false);
  resolveRefs(ctx);
  /* After `finalize`, not before: a dialect's fix-ups often need the derived properties — the ERD
     resolves `fk=<group>` to that group's hue, and a group without an explicit `hue=` does not have
     one until `finalize` hands it the next in the theme's order. */
  finalize(ctx);
  dialect.finish?.(graph);

  graph.diagnostics = tidy(diag);
  return graph;
}
