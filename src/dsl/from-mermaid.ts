import type { DiagramType, OwnModelType } from "./ir";
import { mermaidPie } from "./mermaid";

/**
 * Mermaid in, this grammar out.
 *
 * `detectMermaid` recognises a paste and says what to write instead; this writes it. They are the
 * two halves of the same problem and the reason it is worth solving is in the first one's header:
 * this DSL is Mermaid-flavoured, so Mermaid is exactly what gets pasted into it. Until now the
 * answer was a paragraph of prose telling a person to retype forty lines by hand.
 *
 * **It converts the common core of five headers and says so.** `flowchart`/`graph`, `erDiagram`
 * and `sequenceDiagram` account for nearly everything anyone pastes; `pie` and `xychart-beta` are
 * the two that draw data, and they land in one `chart` fence because a chart's form is a body
 * statement rather than a type of its own. Anything within them it does
 * not understand is kept as a `%%` comment on its own line rather than dropped — a converter that
 * silently loses a statement is worse than one that refuses, because the loss is invisible until
 * somebody reads the diagram and believes it. `left` counts those, so a caller can say how much of
 * the paste still needs a person.
 *
 * What it deliberately does not attempt: styling (`classDef`, `style`, `linkStyle`), which is the
 * theme's here and has no board-level equivalent by design (rule 2); `click`, because a board is a
 * picture; and the eight Mermaid types with no counterpart at all.
 */

export interface Conversion {
  /**
   * The fence type this belongs in — which may not be the fence it was pasted into.
   *
   * `DiagramType` plus `OWN_MODEL_TYPES` — `sequence` and `chart` are the two dialects whose model
   * is not a `Graph` and so are not in that union. Read from the list rather than spelt out beside
   * it, for the reason `hasGraph()` exists. Not imported from `src/board/`: this layer does not know
   * that a board file exists, and `board/types.ts` already imports from this one.
   */
  type: DiagramType | OwnModelType;
  body: string;
  /** `dir=` for the fence, when the header named one. */
  dir?: "LR" | "TB";
  /** How many statements came through as comments because they could not be translated. */
  left: number;
}

/** An id the tokenizer will read back as one word. `WORD` allows more than this; ids need less. */
const idOf = (raw: string): string => raw.trim().replace(/[^A-Za-z0-9_.\-/]/g, "_").toLowerCase() || "n";

/** A label, as the one string form this grammar has. */
const q = (s: string): string => JSON.stringify(s.trim().replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " "));

const comment = (line: string, why: string): string => `%% ${why}: ${line.trim()}`;

/* ---------------------------------------------------------------- flowchart */

/**
 * Mermaid's node shapes, and the kind word that draws each here.
 *
 * The bracket *is* the declaration in Mermaid; here the kind word is, which is why the conversion
 * is a shape table rather than a parser. Only the diamond family carries meaning this grammar also
 * has — a branch — so everything else becomes a `step`.
 */
const SHAPES: [RegExp, "step" | "decision"][] = [
  /* The two-character openers first: `A([x])` starts with `(`, so the plain `A(x)` pattern would
     match it and hand back a label of `[x]`. */
  [/^([A-Za-z0-9_.\-/]+)\(\[([^\]]*)\]\)/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\[\/([^\]]*)[/\\]\]/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\[\\([^\]]*)[/\\]\]/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\{\{([^}]*)\}\}/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\{([^}]*)\}/, "decision"],
  [/^([A-Za-z0-9_.\-/]+)\[\[([^\]]*)\]\]/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\[\(([^)]*)\)\]/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\[([^\]]*)\]/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\(\(([^)]*)\)\)/, "step"],
  [/^([A-Za-z0-9_.\-/]+)\(([^)]*)\)/, "step"],
  [/^([A-Za-z0-9_.\-/]+)>([^\]]*)\]/, "step"],
];

/** Mermaid's link shapes, longest first, and the arrow each becomes. */
const LINKS: [RegExp, string][] = [
  [/^-\.->/, "-.->"],
  [/^-\.-/, "-.-"],
  [/^==>/, "-->"],
  [/^===/, "---"],
  [/^-->/, "-->"],
  [/^---/, "---"],
  [/^--o/, "--o"],
  [/^--x/, "-->"],
];

interface Decl {
  kind: "step" | "decision";
  title?: string;
}

/**
 * One flowchart statement: a chain of nodes joined by links, with labels on either.
 *
 * Written as a scanner rather than a regex because a Mermaid statement is a *chain* — `A --> B --> C`
 * is one line and three nodes — and because a label may hold anything, brackets included.
 */
function flowStatement(line: string, decls: Map<string, Decl>): string[] {
  const out: string[] = [];
  let rest = line.trim();
  const chain: string[] = [];
  const labels: string[] = [];
  const arrows: string[] = [];

  for (;;) {
    let node: string | null = null;
    let matched = false;
    for (const [re, kind] of SHAPES) {
      const m = re.exec(rest);
      if (!m) continue;
      node = idOf(m[1]!);
      const had = decls.get(node);
      /* A node may be declared once and mentioned many times; the first label wins, which is what
         Mermaid does too. */
      if (!had?.title) decls.set(node, { kind, title: m[2]!.trim() || had?.title });
      else if (kind === "decision") decls.set(node, { ...had, kind });
      rest = rest.slice(m[0].length).trimStart();
      matched = true;
      break;
    }
    if (!matched) {
      const m = /^([A-Za-z0-9_.\-/]+)/.exec(rest);
      if (!m) break;
      node = idOf(m[1]!);
      if (!decls.has(node)) decls.set(node, { kind: "step" });
      rest = rest.slice(m[0].length).trimStart();
    }
    chain.push(node!);

    let link: string | null = null;
    for (const [re, arrow] of LINKS) {
      const m = re.exec(rest);
      if (!m) continue;
      link = arrow;
      rest = rest.slice(m[0].length);
      break;
    }
    if (!link) break;

    /* `-->|yes|` and `-- yes -->` are both edge labels; the second has already been swallowed by
       the arrow match above, so only the piped form is left to read. */
    let label = "";
    const piped = /^\s*\|([^|]*)\|/.exec(rest);
    if (piped) {
      label = piped[1]!.trim();
      rest = rest.slice(piped[0].length);
    }
    arrows.push(link);
    labels.push(label);
    rest = rest.trimStart();
    if (rest === "") break;
  }

  if (chain.length < 2) return out;
  /* One statement per hop: an edge here carries at most one label, and a chain with a label in the
     middle cannot be written as a chain. */
  for (let i = 0; i < arrows.length; i++) {
    const lab = labels[i] ? ` ${q(labels[i]!)}` : "";
    out.push(`${chain[i]} ${arrows[i]} ${chain[i + 1]}${lab}`);
  }
  return out;
}

function fromFlowchart(lines: string[], dir: string): Conversion {
  const decls = new Map<string, Decl>();
  const edges: string[] = [];
  const skipped: string[] = [];
  /** Open `subgraph`s, innermost last. Each closes on the matching `end`. */
  const groups: { id: string; label: string; members: string[] }[] = [];
  const groupOf = new Map<string, string>();
  const order: { id: string; label: string; members: string[] }[] = [];
  let left = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;

    const sub = /^subgraph\s+(?:([A-Za-z0-9_.\-/]+)\s*)?(?:\[([^\]]*)\]|(.*))?$/.exec(line);
    if (sub) {
      const label = (sub[2] ?? sub[3] ?? sub[1] ?? "").trim();
      const id = idOf(sub[1] ?? label ?? "group");
      const g = { id, label, members: [] as string[] };
      groups.push(g);
      order.push(g);
      continue;
    }
    if (/^end$/i.test(line)) {
      groups.pop();
      continue;
    }
    if (/^direction\s+/i.test(line)) continue;
    if (/^(style|classDef|linkStyle|class|click)\b/.test(line)) {
      /* Styling belongs to the theme here, so there is nothing to write instead. Kept as a comment
         so the author can see what was in the paste rather than wondering what went missing. */
      skipped.push(comment(line, "styling is the theme's here (rule 2)"));
      left++;
      continue;
    }

    const before = new Set(decls.keys());
    const made = flowStatement(line, decls);
    for (const id of decls.keys()) if (!before.has(id) && groups.length) groupOf.set(id, groups[groups.length - 1]!.id);
    if (made.length) {
      edges.push(...made);
      continue;
    }
    /* A bare node id inside a subgraph is Mermaid's way of saying "this belongs here"; it declares
       nothing and draws no edge, so it is membership and nothing else. */
    if (/^[A-Za-z0-9_.\-/]+$/.test(line) || SHAPES.some(([re]) => re.test(line))) continue;
    skipped.push(comment(line, "not translated"));
    left++;
  }

  for (const g of order) g.members = [...groupOf].filter(([, gid]) => gid === g.id).map(([id]) => id);

  const decl = (id: string): string => {
    const d = decls.get(id)!;
    return `${d.kind} ${id}${d.title ? ` ${q(d.title)}` : ""}`;
  };

  const body: string[] = [];
  const inGroup = new Set(groupOf.keys());
  for (const g of order) {
    if (g.members.length === 0) continue;
    body.push(`group ${g.id}${g.label ? ` ${q(g.label)}` : ""} {`);
    for (const id of g.members) body.push(`  ${decl(id)}`);
    body.push("}");
  }
  for (const id of decls.keys()) if (!inGroup.has(id)) body.push(decl(id));
  if (body.length && edges.length) body.push("");
  body.push(...edges);
  if (skipped.length) body.push("", ...skipped);

  return {
    type: "flow",
    body: body.join("\n"),
    dir: dir === "LR" || dir === "RL" ? "LR" : "TB",
    left,
  };
}

/* ---------------------------------------------------------------------- erd */

function fromErd(lines: string[]): Conversion {
  /** Every entity, in the order it is first seen, with its rows if it was given a block. */
  const entities = new Map<string, string[]>();
  const edges: string[] = [];
  const skipped: string[] = [];
  let left = 0;
  /** The entity whose attribute block is open, if any. */
  let open: string | null = null;

  const see = (id: string) => {
    if (!entities.has(id)) entities.set(id, []);
    return id;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (open !== null) {
      if (line === "}") {
        open = null;
        continue;
      }
      /* `<type> <name> [PK|FK] ["comment"]` — the type comes first in Mermaid and second here. */
      const m = /^([A-Za-z0-9_[\]()<>,. -]+?)\s+([A-Za-z0-9_]+)((?:\s+(?:PK|FK|UK))*)\s*(?:"[^"]*")?$/.exec(line);
      if (m) {
        const keys = (m[3] ?? "")
          .toLowerCase()
          .split(/\s+/)
          .filter((k) => k === "pk" || k === "fk");
        entities.get(open)!.push([m[2]!, m[1]!.trim().replace(/\s+/g, "_"), ...keys].join(" "));
        continue;
      }
      skipped.push(comment(line, "not a row this grammar can write"));
      left++;
      continue;
    }

    const block = /^([A-Za-z0-9_.-]+)\s*\{$/.exec(line);
    if (block) {
      open = see(idOf(block[1]!));
      continue;
    }

    /* `A ||--o{ B : label` — the cardinality vocabulary is already ours, character for character. */
    const rel = /^([A-Za-z0-9_.-]+)\s+([|}{o][^\s]*)\s+([A-Za-z0-9_.-]+)\s*(?::\s*(.*))?$/.exec(line);
    if (rel) {
      const from = see(idOf(rel[1]!));
      const to = see(idOf(rel[3]!));
      const label = (rel[4] ?? "").trim().replace(/^"|"$/g, "");
      edges.push(`${from} ${rel[2]} ${to}${label ? ` ${q(label)}` : ""}`);
      continue;
    }

    skipped.push(comment(line, "not translated"));
    left++;
  }

  /*
   * Declarations first, and one for every entity — a block or not.
   *
   * Mermaid lets a relationship name a table it never describes, and it draws an empty box. Here
   * an id nothing declares is `E_UNKNOWN_ID`, so the paste would arrive with an error against a
   * line the author did not write.
   */
  const body = [...entities].map(([id, rows]) => `entity ${id}${rows.length ? ` { ${rows.join("; ")} }` : ""}`);
  if (body.length && edges.length) body.push("");
  body.push(...edges);
  if (skipped.length) body.push("", ...skipped);

  return { type: "erd", body: body.join("\n"), left };
}

/* ----------------------------------------------------------------- sequence */

const SEQ_ARROWS: [RegExp, string][] = [
  [/-->>/, "-->>"],
  [/->>/, "->>"],
  [/--\)/, "-)"],
  [/-\)/, "-)"],
  [/-->/, "-->>"],
  [/->/, "->"],
  [/--x/, "-->>"],
  [/-x/, "->>"],
];

function fromSequence(lines: string[]): Conversion {
  const body: string[] = [];
  const skipped: string[] = [];
  let left = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;

    const part = /^(participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.*))?$/i.exec(line);
    if (part) {
      const id = idOf(part[2]!);
      const label = (part[3] ?? part[2]!).trim();
      const person = part[1]!.toLowerCase() === "actor" ? " kind=person" : "";
      body.push(`participant ${id} ${q(label)}${person}`);
      continue;
    }

    const frag = /^(alt|else|opt|loop|par|and|critical|break)\b\s*(.*)$/i.exec(line);
    if (frag) {
      const kind = frag[1]!.toLowerCase();
      /* `critical` and `break` have no counterpart; `opt` is the nearest honest shape for both. */
      const ours = kind === "critical" || kind === "break" ? "opt" : kind;
      const label = frag[2]!.trim();
      body.push(`${ours}${label ? ` ${q(label)}` : ""}`);
      continue;
    }
    if (/^end$/i.test(line)) {
      body.push("end");
      continue;
    }
    const act = /^(activate|deactivate)\s+([A-Za-z0-9_.-]+)$/i.exec(line);
    if (act) {
      body.push(`${act[1]!.toLowerCase()} ${idOf(act[2]!)}`);
      continue;
    }

    /*
     * `A->>B: text`, with Mermaid's `+`/`-` activation suffix.
     *
     * The id pattern allows a hyphen only *between* alphanumerics. Written as a plain character
     * class it also matched the first `-` of the arrow, so `A-->>W` read as a participant called
     * `a-` talking over `->>` — two phantom columns on every diagram with a return message in it.
     */
    const msg = /^([A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*)\s*(--?>>?|--?\)|--?x)\s*([+-]?)([A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*)\s*:\s*(.*)$/.exec(line);
    if (msg) {
      const arrow = SEQ_ARROWS.find(([re]) => re.test(msg[2]!))?.[1] ?? "->>";
      const from = idOf(msg[1]!);
      const to = idOf(msg[4]!);
      body.push(`${from} ${arrow} ${to} : ${q(msg[5]!)}`);
      /* Written out rather than passed through as a suffix. Mermaid's `+` activates the *target*
         and its `-` deactivates the *sender*, which is a rule worth stating in the output rather
         than leaving to a reader who has to remember which end the sign belongs to. */
      if (msg[3] === "+") body.push(`activate ${to}`);
      else if (msg[3] === "-") body.push(`deactivate ${from}`);
      continue;
    }

    skipped.push(comment(line, /^(note|rect|autonumber)\b/i.test(line) ? "no equivalent here" : "not translated"));
    left++;
  }
  if (skipped.length) body.push("", ...skipped);

  return { type: "sequence", body: body.join("\n"), left };
}

/* -------------------------------------------------------------------- chart */

/**
 * An id a chart statement can carry: the label, slugged, starting with a letter, unique.
 *
 * `idOf` above is not this. A flowchart's ids are written down by the author and only have to
 * survive the tokenizer; a slice's are *derived from its label*, so two labels that differ only in
 * punctuation — `Q1 2024` and `Q1-2024` — arrive as one id and the second statement is
 * `E_DUPLICATE_ID`. The leading letter is the tokenizer's `WORD`, which allows a digit first and
 * would then hand `parseChart` an id that reads as a value in every other position.
 */
function chartId(raw: string, taken: Set<string>): string {
  const base = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const head = /^[a-z]/.test(base) ? base : `s${base}`;
  let id = head || "s";
  for (let n = 2; taken.has(id); n++) id = `${head || "s"}-${n}`;
  taken.add(id);
  return id;
}

/**
 * A title, which a chart keeps on its fence and not in its body.
 *
 * `Conversion` names a type and a body; the fence's attributes are the caller's, and a title that
 * travelled would have to be threaded through the offer, `replace` and `applyPatch` for the one
 * dialect that has one. So it comes through as a comment and is counted, which is the same answer
 * this file gives a `style` line — the author can see what the paste said and put it on the fence.
 */
const TITLE_HOME = "a chart's title belongs on the fence (`title=`), not in its body";

/** An axis title, likewise, minus the one case a chart can actually say: a short one is a `unit`. */
const AXIS_HOME = "an axis title has no home here; the fence's `title=` is the chart's";

/* --------------------------------------------------------------------- pie */

/**
 * `pie [showData] [title …]` and its `"Label" : value` rows.
 *
 * The whole diagram is one form word and a list, which is why this is the shortest converter in the
 * file — and why it is worth having at all: `pie` was the one Mermaid family AnyDag could
 * not draw, so a paste was a fatal diagnostic with nothing on the other side of it.
 */
function fromPie(head: string, lines: string[]): Conversion {
  const slices: string[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();
  let left = 0;
  /* Mermaid's `showData` prints the raw number beside each label; `values` is this grammar's word
     for that ask. A pie labels its wedges either way, so nothing is lost when it is absent. */
  let values = /\bshowData\b/.test(head);

  const title = (line: string): boolean => {
    if (!/^title\s+\S/.test(line)) return false;
    skipped.push(comment(line, TITLE_HOME));
    left++;
    return true;
  };

  /* `pie showData title Pets` carries on the header what `pie` alone carries on the next line. */
  const onHead = /^pie(?:\s+showData)?\s+(title\s+.+)$/.exec(head);
  if (onHead) title(onHead[1]!);

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;
    if (title(line)) continue;
    if (/^showData$/.test(line)) {
      values = true;
      continue;
    }

    const row = /^"([^"]*)"\s*:\s*(-?[\d.]+)\s*$/.exec(line);
    const n = row ? Number(row[2]) : Number.NaN;
    if (row && Number.isFinite(n)) {
      slices.push(`slice ${chartId(row[1]!, taken)} ${q(row[1]!)} ${n}`);
      continue;
    }
    skipped.push(comment(line, "not translated"));
    left++;
  }

  const body = ["pie", ...slices];
  if (values) body.push("values");
  if (skipped.length) body.push("", ...skipped);
  return { type: "chart", body: body.join("\n"), left };
}

/* ----------------------------------------------------------------- xychart */

/** `[a, b, c]`, whose entries may be quoted and may then hold a comma of their own. */
const items = (inside: string): string[] =>
  inside.includes('"')
    ? [...inside.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)
    : inside
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

/** A category, bare where the tokenizer reads it back as one word and quoted where it would not. */
const category = (s: string): string =>
  /^[A-Za-z][A-Za-z0-9_.\-/+]*$/.test(s) || /^\d+(?:\.\d+)?$/.test(s) ? s : q(s);

/** A value, or `-` for the gap — which is what an entry nobody can read already means here. */
const value = (s: string): string => {
  const n = Number(s.trim().replace(/^"|"$/g, ""));
  return Number.isFinite(n) ? String(n) : "-";
};

/**
 * `xychart-beta [horizontal]`, its two axes and its `bar`/`line` rows.
 *
 * Two things it decides rather than reports. **The form is the first data line's**, because a chart
 * draws one shape: Mermaid's combo of a bar and a line over the same categories is two series here,
 * and the one that is not the form draws as the form — said out loud in a comment, since a
 * converter that silently redraws a series is the failure this file exists to avoid. And **a short
 * y-axis title becomes the `unit`** (`$`, `%`, `k€`), which is what a short one always is; a long
 * one is prose about the axis and there is nowhere honest to put it.
 */
function fromXychart(head: string, lines: string[]): Conversion {
  const horizontal = /\bhorizontal\b/.test(head);
  const skipped: string[] = [];
  const data: { form: "bar" | "line"; values: string[] }[] = [];
  let categories: string[] = [];
  let unit: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  let left = 0;

  /** An axis title: the `unit` if it is short enough to be one, a comment otherwise. */
  const axisTitle = (t: string | undefined, asUnit: boolean): void => {
    if (t === undefined || t.trim() === "") return;
    if (asUnit && t.length <= 4 && !/\s/.test(t)) {
      unit = t;
      return;
    }
    skipped.push(comment(q(t), AXIS_HOME));
    left++;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (/^title\s+\S/.test(line)) {
      skipped.push(comment(line, TITLE_HOME));
      left++;
      continue;
    }

    const x = /^x-axis\s+(?:"([^"]*)"\s*)?(.*)$/.exec(line);
    if (x) {
      const rest = x[2]!.trim();
      const bracket = /^\[(.*)\]$/.exec(rest);
      const range = /^(-?[\d.]+)\s*-->\s*(-?[\d.]+)$/.exec(rest);
      if (bracket) categories = items(bracket[1]!);
      else if (range) {
        /* A numeric axis is a continuum in Mermaid and a list of categories here, so it is only
           translatable while the list is short enough to be one — and only in whole steps. */
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (Number.isInteger(lo) && Number.isInteger(hi) && hi > lo && hi - lo < 60) {
          for (let n = lo; n <= hi; n++) categories.push(String(n));
        } else {
          skipped.push(comment(line, "an x axis here is a list of categories, not a range"));
          left++;
        }
      } else if (rest !== "") {
        skipped.push(comment(line, "not translated"));
        left++;
      }
      axisTitle(x[1], false);
      continue;
    }

    const y = /^y-axis\s+(?:"([^"]*)"\s*)?(?:(-?[\d.]+)\s*-->\s*(-?[\d.]+))?\s*$/.exec(line);
    if (y) {
      if (y[2] !== undefined) {
        min = Number(y[2]);
        max = Number(y[3]);
      }
      axisTitle(y[1], true);
      continue;
    }

    const row = /^(bar|line)\s*\[(.*)\]\s*$/.exec(line);
    if (row) {
      data.push({ form: row[1] as "bar" | "line", values: items(row[2]!) });
      continue;
    }

    skipped.push(comment(line, "not translated"));
    left++;
  }

  const form = data[0]?.form ?? "bar";
  const other = data.find((d) => d.form !== form);
  if (other) {
    skipped.push(`%% a chart draws one form: the \`${other.form}\` series above is drawn as \`${form}\``);
    left++;
  }

  const body: string[] = [`${form}${horizontal ? " horizontal" : ""}`];
  if (categories.length) body.push(`x ${categories.map(category).join(" ")}`);
  data.forEach((d, i) => {
    body.push(`series s${i + 1} "Series ${i + 1}" ${d.values.map(value).join(" ")}`);
  });
  if (unit !== undefined) body.push(`unit ${q(unit)}`);
  if (min !== undefined) body.push(`min ${min}`);
  if (max !== undefined) body.push(`max ${max}`);
  if (skipped.length) body.push("", ...skipped);

  return { type: "chart", body: body.join("\n"), left };
}

/* --------------------------------------------------------------------- door */

/**
 * Convert a Mermaid source, or say `null` when it is not one this can take.
 *
 * The header decides, and `detectMermaid` has already agreed there is one: that check is what makes
 * this safe to offer, since a board that merely *looks* a bit like Mermaid must never be silently
 * rewritten.
 */
export function fromMermaid(src: string): Conversion | null {
  const lines = src.split("\n");
  const at = lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("%%"));
  if (at === -1) return null;
  const head = lines[at]!.trim();
  const rest = lines.slice(at + 1);

  const flow = /^(?:graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/.exec(head);
  if (flow) return fromFlowchart(rest, flow[1]!);
  if (/^erDiagram\b/.test(head)) return fromErd(rest);
  if (/^sequenceDiagram\b/.test(head)) return fromSequence(rest);
  if (/^xychart-beta\b/.test(head)) return fromXychart(head, rest);
  /* The detector's own predicate, not a second spelling of it: `pie` is a chart's form word too,
     and a converter that took a body the offer would never show it is a converter that rewrites a
     board nobody asked it to. */
  if (mermaidPie(lines, at)) return fromPie(head, rest);
  return null;
}
