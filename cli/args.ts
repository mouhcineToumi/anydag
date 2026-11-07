/**
 * Reading a command line.
 *
 * **Not `node:util`'s `parseArgs`, and a board is why.** Coordinates on a board are negative as
 * often as not — `parseAttrs` learned to read `x=-40` in M10 because a drag above the origin wrote
 * one — and `parseArgs` in strict mode refuses `--at -40,80` as ambiguous and `-40` as an unknown
 * option. A CLI whose move command cannot say "up and to the left" without `--at=-40,80` is one
 * that has to be taught around, so this is forty lines instead.
 *
 * The rules, which are the whole of it:
 *
 * - `--name value` and `--name=value`. A string flag takes the **next token whatever it looks
 *   like**, so `--at -40,80` means what it says.
 * - A token that starts with `-` and a digit is a positional, never a flag: `-40` is a number.
 * - `-` alone is a positional, meaning stdin.
 * - `--` ends the flags; everything after it is positional.
 * - A flag nobody declared is a usage error naming the nearest one that exists.
 */

type FlagType = "string" | "boolean" | "list";

export interface FlagSpec {
  name: string;
  short?: string;
  type: FlagType;
  help: string;
  /** What the value is called in help, `<file>` rather than `<value>`. */
  value?: string;
}

export interface Parsed {
  pos: string[];
  flags: Record<string, string | boolean | string[] | undefined>;
}

/** A mistake in how the command was typed, as distinct from something the server refused. */
export class UsageError extends Error {}

const NUMBERISH = /^-\.?\d/;

export function parseArgs(argv: readonly string[], specs: readonly FlagSpec[]): Parsed {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const byShort = new Map(specs.filter((s) => s.short).map((s) => [s.short as string, s]));
  const pos: string[] = [];
  const flags: Parsed["flags"] = {};

  const put = (spec: FlagSpec, value: string | true) => {
    if (spec.type === "list") {
      const had = flags[spec.name];
      flags[spec.name] = [...(Array.isArray(had) ? had : []), String(value)];
    } else flags[spec.name] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (tok === "-" || !tok.startsWith("-") || NUMBERISH.test(tok)) {
      pos.push(tok);
      continue;
    }
    let spec: FlagSpec | undefined;
    let inline: string | undefined;
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      const name = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
      inline = eq < 0 ? undefined : tok.slice(eq + 1);
      spec = byName.get(name);
      if (!spec) throw new UsageError(`unknown flag --${name}${suggest(name, specs)}`);
    } else {
      spec = byShort.get(tok.slice(1));
      if (!spec) throw new UsageError(`unknown flag ${tok}`);
    }
    if (spec.type === "boolean") {
      if (inline !== undefined) throw new UsageError(`--${spec.name} takes no value`);
      put(spec, true);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new UsageError(`--${spec.name} needs a value`);
    put(spec, value);
  }
  return { pos, flags };
}

/** ` — did you mean --x?` for a flag one or two edits from one that exists, or nothing. */
function suggest(name: string, specs: readonly FlagSpec[]): string {
  let best: string | undefined;
  let score = 3;
  for (const s of specs) {
    const d = distance(name, s.name);
    if (d < score) {
      score = d;
      best = s.name;
    }
  }
  return best ? ` — did you mean --${best}?` : "";
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

/** The string a flag was given, or `undefined`. */
export const str = (p: Parsed, name: string): string | undefined => {
  const v = p.flags[name];
  return typeof v === "string" ? v : undefined;
};

/** Whether a boolean flag was given. */
export const bool = (p: Parsed, name: string): boolean => p.flags[name] === true;

/** Every value a list flag was given, in order. */
export const list = (p: Parsed, name: string): string[] => {
  const v = p.flags[name];
  return Array.isArray(v) ? v : [];
};

/** A finite number off a flag, or a usage error saying which flag. */
export function num(p: Parsed, name: string): number | undefined {
  const raw = str(p, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} wants a number, not \`${raw}\``);
  return n;
}

/**
 * `key=value` pairs, the way a board file writes attributes.
 *
 * A value is a number when it reads as one, `true` when there is no `=` at all (`hidden`), and a
 * string otherwise — the three kinds `AttrValue` has. `key=` with nothing after it is `null`, which
 * is what `SetOp.attrs` means by "take it off".
 */
export function pairs(tokens: readonly string[]): Record<string, string | number | true | null> {
  const out: Record<string, string | number | true | null> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq === 0) throw new UsageError(`\`${tok}\` has no key`);
    if (eq < 0) {
      out[tok] = true;
      continue;
    }
    const key = tok.slice(0, eq);
    const raw = tok.slice(eq + 1);
    out[key] = raw === "" ? null : /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return out;
}
