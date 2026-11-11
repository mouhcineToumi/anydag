import { parse as parseYaml } from "yaml";

import { scanFences } from "./fences";
import { locateItems } from "./locate";
import { isItemType } from "./types";

/**
 * Putting right the three things in a board file that no control could reach, because the file
 * would not parse far enough to have one: a settings block that is not YAML, and a fence whose
 * kind the board does not know.
 *
 * **Browser-free**, text in and text out, like `patch.ts`. They are not patch ops — a `SetOp` is
 * addressed by an item id and an unknown fence has none, and the frontmatter writer refuses a block
 * it cannot read for the reason it states: replacing it would throw away what the author was in
 * the middle of writing. Both go back through the page's `put`, the route undo uses, under the same
 * `base` rule.
 */

export type Repaired = { ok: true; text: string; dropped: string[] } | { ok: false; error: string };

/** A line that opens a top-level key. Everything after it, until the next one, belongs to it. */
const KEY_LINE = /^([A-Za-z_][\w-]*)[ \t]*:/;

/**
 * Keep every setting of the frontmatter that can still be read, and drop the ones that cannot.
 *
 * The block is cut into the top-level keys it holds, each with the lines under it — a `pages:` list
 * is one block — and every block is read on its own. The ones that read are kept **byte for byte**,
 * not rewritten through a YAML writer, so a repair changes the broken part and nothing else. What is
 * left is read once more as a whole, and if even that fails (two blocks that are fine alone and
 * not together) the whole block goes: a board with no settings is the one state that always parses.
 *
 * `dropped` names what went, so the person is told what they lost rather than left to find out.
 */
export function repairFrontmatter(text: string): Repaired {
  const located = locateItems(text, isItemType);
  const yaml = located.frontmatter;
  if (yaml === null) return { ok: false, error: "this board has no settings block" };
  try {
    parseYaml(yaml);
    return { ok: false, error: "the settings block reads fine, so there is nothing to repair" };
  } catch {
    /* The case this exists for. */
  }

  const blocks: { key: string; text: string }[] = [];
  let stray = false;
  for (const line of yaml.split(/\r?\n/)) {
    const m = KEY_LINE.exec(line);
    if (m) blocks.push({ key: m[1]!, text: line });
    else if (blocks.length > 0) blocks[blocks.length - 1]!.text += `\n${line}`;
    else if (line.trim() !== "" && !line.trim().startsWith("#")) stray = true;
  }

  const readable = (src: string): boolean => {
    try {
      const v = parseYaml(src) as unknown;
      return typeof v === "object" && v !== null && !Array.isArray(v);
    } catch {
      return false;
    }
  };

  const kept = blocks.filter((b) => readable(b.text));
  const dropped = blocks.filter((b) => !kept.includes(b)).map((b) => b.key);
  if (stray) dropped.push("lines before the first setting");

  /* `yaml` is the text between the two `---` lines, so it starts after the first line and its end
     is where `bodyStart` less the closing fence's own line begins. */
  const yamlStart = text.indexOf("\n") + 1;
  const yamlEnd = yamlStart + yaml.length;

  const joined = kept.map((b) => b.text).join("\n");
  if (kept.length === 0 || !readable(joined)) {
    if (kept.length > 0) dropped.splice(0, dropped.length, ...blocks.map((b) => b.key));
    const rest = text.slice(located.bodyStart).replace(/^\n+/, "");
    return { ok: true, text: rest, dropped: dropped.length ? dropped : ["the whole settings block"] };
  }
  return { ok: true, text: text.slice(0, yamlStart) + joined + text.slice(yamlEnd), dropped };
}

/**
 * Change the kind a fence is labelled with — the word after the backticks — and nothing else.
 *
 * `line` is where the unknown fence opens (`EB_UNKNOWN_TYPE`'s own line) and `from` the word it
 * carries there; both are checked against the file as it is now, so a repair offered for one reading
 * of the board and clicked after another has written is refused rather than landing on whatever
 * is on that line by then.
 */
export function retypeFence(text: string, line: number, from: string, to: string): Repaired {
  if (!isItemType(to)) return { ok: false, error: `\`${to}\` is not a kind of item` };
  const { bodyStart } = locateItems(text, isItemType);
  const lead = text.slice(0, bodyStart).split("\n").length - 1;
  const fence = scanFences(text.slice(bodyStart)).find((f) => f.line + lead === line);
  if (!fence || fence.type !== from) return { ok: false, error: `there is no \`${from}\` block on line ${line} any more` };

  const at = bodyStart + fence.openStart;
  const open = text.slice(at, bodyStart + fence.openEnd);
  const next = open.replace(/^([ \t]*`{3,}[ \t]*)[A-Za-z][A-Za-z0-9-]*/, `$1${to}`);
  if (next === open) return { ok: false, error: `could not read the block on line ${line}` };
  return { ok: true, text: text.slice(0, at) + next + text.slice(bodyStart + fence.openEnd), dropped: [] };
}
