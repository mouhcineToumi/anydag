import { CODES, type Code } from "../dsl/codes";

/**
 * The fence-line attribute grammar.
 *
 *     ```arch {#infra x=0 y=0 title="What runs where" dir=LR note}
 *
 *     attrs  := '{' (attr (WS+ attr)*)? WS* '}'
 *     attr   := '#' IDENT              -- shorthand for id=IDENT
 *             | KEY '=' value
 *             | KEY                    -- boolean flag
 *     value  := NUMBER | IDENT | STRING
 *     STRING := '"' ( '\' . | [^"\] )* '"'
 *
 * Unknown keys are **kept**, in source order, so a rewrite never drops something an author (or a
 * later version of this tool) put there. That is why `Attrs` carries `order` rather than relying on
 * `Object.keys`: a JS object reorders integer-like keys, and `2026` is a plausible attribute name
 * on a timeline.
 */

export type AttrValue = string | number | true;

export interface Attrs {
  map: Record<string, AttrValue>;
  /** Keys in the order they appeared, so a rewrite puts them back where they were. */
  order: string[];
}

export interface AttrError {
  col: number;
  code: Code;
  message: string;
}

const IDENT = /[A-Za-z0-9_][A-Za-z0-9_.\-/]*/y;
/* Only the negative case: a positive number is already an IDENT, and widening IDENT to take a
   leading `-` would swallow the `-` that separates two bare words. Dragging an item above or left
   of the origin is ordinary — the canvas is infinite in all four directions — and `serializeAttrs`
   has always written `y=-176` back. Nothing could read it: the patch round-tripped a board file
   into one that no longer parsed. */
const NEGATIVE = /-(?:\d+\.?\d*|\.\d+)/y;
const KEY = /[a-zA-Z][a-z0-9-]*/y;

export function parseAttrs(src: string, errors: AttrError[] = []): Attrs {
  const map: Record<string, AttrValue> = {};
  const order: string[] = [];
  const put = (k: string, v: AttrValue) => {
    if (!(k in map)) order.push(k);
    map[k] = v;
  };

  let i = 0;
  const at = (re: RegExp): string | null => {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    i = re.lastIndex;
    return m[0];
  };

  while (i < src.length) {
    if (/\s/.test(src[i]!)) {
      i++;
      continue;
    }

    if (src[i] === "#") {
      i++;
      const id = at(IDENT);
      if (id === null) errors.push({ col: i, code: CODES.EB_EXPECTED_ID, message: "expected an id after `#`" });
      else put("id", id);
      continue;
    }

    const key = at(KEY);
    if (key === null) {
      errors.push({ col: i, code: CODES.EB_UNEXPECTED, message: `unexpected \`${src[i]}\` in the attribute list` });
      i++;
      continue;
    }

    if (src[i] !== "=") {
      put(key, true);
      continue;
    }
    i++;

    if (src[i] === '"') {
      i++;
      let out = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const c = src[i + 1]!;
          out += c === "n" ? "\n" : c;
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (src[i] !== '"') errors.push({ col: i, code: CODES.EB_UNTERMINATED_STRING, message: "unterminated string" });
      i++;
      put(key, out);
      continue;
    }

    const raw = at(IDENT) ?? at(NEGATIVE);
    if (raw === null) {
      errors.push({ col: i, code: CODES.EB_EXPECTED_VALUE, message: `expected a value after \`${key}=\`` });
      continue;
    }
    /* `01` is a step id on the workflow board and must stay a string; only a value that survives a
       round trip through Number is treated as a number. */
    const n = Number(raw);
    put(key, raw !== "" && !Number.isNaN(n) && String(n) === raw ? n : raw);
  }

  return { map, order };
}

/**
 * The inverse of `parseAttrs`, **without** the braces.
 *
 * The braces belong to the fence line, and `rewriteFenceAttrs` is what writes one. Both functions
 * used to add a pair, so composing them gave ```` ```md {{#id x=0}} ```` — which nothing noticed,
 * because until the patch endpoint neither function had a single caller.
 */
export function serializeAttrs(attrs: Attrs): string {
  const parts: string[] = [];
  for (const key of attrs.order) {
    const v = attrs.map[key];
    if (v === undefined) continue;
    if (key === "id") {
      parts.push(`#${v}`);
      continue;
    }
    if (v === true) {
      parts.push(key);
      continue;
    }
    if (typeof v === "number") {
      parts.push(`${key}=${v}`);
      continue;
    }
    const bare = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(v) && !/^\d/.test(v);
    parts.push(bare ? `${key}=${v}` : `${key}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  }
  return parts.join(" ");
}

export const num = (a: Attrs, key: string): number | undefined =>
  typeof a.map[key] === "number" ? (a.map[key] as number) : undefined;

export const str = (a: Attrs, key: string): string | undefined => {
  const v = a.map[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
};

export const flag = (a: Attrs, key: string): boolean => a.map[key] === true;
