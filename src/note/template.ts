/**
 * A note template: an ordinary note in the vault's templates folder, whose `{{…}}` variables are
 * filled in **once**, when a note is made from it.
 *
 * **The new note is a plain note afterwards.** Nothing remembers which template it came from, the
 * variables are gone from its text, and the template is never applied to a note that exists — all
 * three are what a Templater-style scripting layer would need and this refuses. A template's
 * frontmatter is carried over as it is, so a `status:` makes a task and a `start:` an event, because
 * those are notes with a line and nothing else.
 *
 * Four variables, and nothing else is read: `{{title}}`, `{{date}}` (`YYYY-MM-DD`), `{{time}}`
 * (`HH:mm`) and `{{date:FORMAT}}`. **Anything else between braces is left exactly as it was** — a
 * `{{note}}` in a template about templates, a Handlebars snippet in a code block — and one pass fills
 * the text, so a title that itself says `{{date}}` is not filled in a second time.
 *
 * **"Today" is the reader's zone**, `zone.ts`'s `wallOf`, never `Date`'s local getters, which only
 * know the machine's: the zone Settings → Calendar names, or the machine's when it names none. A
 * format's words are English and fixed, so the same template makes the same text on every machine.
 *
 * **A value in the frontmatter stays YAML.** A title with a colon in it, or a quote, would end the
 * line it was put on; inside the block a filled value is quoted when it has to be, and a title is
 * always a string. The body is text, and what is put in it is put in it as it is.
 *
 * No browser, no React, no `@/` aliases: the local server imports this, and so does the page.
 */
import { parse as parseYaml } from "yaml";

import { within } from "./project";
import { wallOf, type Wall } from "./zone";

/** The folder a vault's templates are in when Settings names none and this one exists. */
export const TEMPLATES_DEFAULT = "Templates";

/** What a variable is filled with: the new note's title, the moment, and the zone the moment is read in. */
export interface TemplateVars {
  title: string;
  at: Date | number;
  zone: string;
}

/** A folder as the setting stores it: no slashes at either end. */
export const cleanFolder = (raw: string): string => raw.trim().replace(/^\/+|\/+$/g, "");

/**
 * Whether `name` — a document's vault-relative name — is in the templates folder, subfolders
 * included. `within`'s rule: the folder itself is nothing, and a prefix that is not a whole segment
 * (`Templates 2/x` against `Templates`) is not in it.
 */
export const inTemplates = (name: string, folder: string | null | undefined): boolean => !!folder && within(name, folder);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number, to = 2): string => String(n).padStart(to, "0");

/**
 * `wall` written as `format`, in the tokens Moment and Obsidian's templates use:
 * `YYYY` `YY` · `MMMM` `MMM` `MM` `M` · `DD` `D` · `dddd` `ddd` · `HH` `H` `hh` `h` · `mm` `m` ·
 * `ss` `s` · `A` `a`. Text in `[brackets]` is copied as it is, and any other character stands for
 * itself, so `YYYY-MM-DD` and `D MMMM YYYY` read as they look.
 */
export function formatWall(wall: Wall, format: string): string {
  /* `setUTCFullYear`, as `dueOf` does: `Date.UTC` reads a year below a hundred as 19xx. */
  const at = new Date(0);
  at.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  const day = DAYS[at.getUTCDay()]!;
  const h12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const token: Record<string, string> = {
    YYYY: pad(wall.year, 4),
    YY: pad(wall.year % 100),
    MMMM: MONTHS[wall.month - 1]!,
    MMM: MONTHS[wall.month - 1]!.slice(0, 3),
    MM: pad(wall.month),
    M: String(wall.month),
    DD: pad(wall.day),
    D: String(wall.day),
    dddd: day,
    ddd: day.slice(0, 3),
    HH: pad(wall.hour),
    H: String(wall.hour),
    hh: pad(h12),
    h: String(h12),
    mm: pad(wall.minute),
    m: String(wall.minute),
    ss: pad(wall.second),
    s: String(wall.second),
    A: wall.hour < 12 ? "AM" : "PM",
    a: wall.hour < 12 ? "am" : "pm",
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (hit, literal?: string) =>
    literal !== undefined ? literal : token[hit]!,
  );
}

/** `{{title}}`, `{{time}}`, `{{date}}` and `{{date:FORMAT}}` — with blanks allowed inside the braces. */
const VARIABLE = /\{\{\s*(?:(title|time|date)|date:([^{}]*?))\s*\}\}/g;

/**
 * `text` with its variables filled, in one pass. `quote` turns a value into what the surroundings can
 * hold (a YAML string's escapes); the body passes nothing and holds a value as it is.
 */
function fillText(text: string, vars: TemplateVars, wall: Wall, quote: (value: string) => string = (v) => v): string {
  return text.replace(VARIABLE, (hit, word?: string, format?: string) => {
    if (word === "title") return quote(vars.title);
    if (word === "date") return quote(formatWall(wall, "YYYY-MM-DD"));
    if (word === "time") return quote(formatWall(wall, "HH:mm"));
    return format && format.trim() ? quote(formatWall(wall, format.trim())) : hit;
  });
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A line of a frontmatter block: what comes before its value (a key, or a list's dash) and the value. */
const LINE = /^(\s*(?:-[ \t]+)?(?:[^\s#:'"-][^:]*:[ \t]+)?)(\S.*)$/;

/** Whether `value`, written bare, is read back as the string it is — and so needs no quotes. */
function plain(value: string, natural: boolean): boolean {
  let read: unknown;
  try {
    read = (parseYaml(`k: ${value}`) as { k?: unknown } | null)?.k;
  } catch {
    return false;
  }
  if (typeof read === "string") return read === value;
  /* A date or a year the template asked for is a number or a date by nature; a title never is. */
  return natural && read !== null && typeof read !== "object";
}

/** One line of the frontmatter, filled so that it is still one YAML value. */
function fillLine(line: string, vars: TemplateVars, wall: Wall): string {
  if (!line.includes("{{")) return line;
  const m = LINE.exec(line);
  if (!m) return fillText(line, vars, wall);
  const [, before, value] = m as unknown as [string, string, string];
  if (/^"[\s\S]*"$/.test(value) && value.length > 1) {
    const inner = fillText(value.slice(1, -1), vars, wall, (v) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
    return `${before}"${inner}"`;
  }
  if (/^'[\s\S]*'$/.test(value) && value.length > 1) {
    const inner = fillText(value.slice(1, -1), vars, wall, (v) => v.replace(/'/g, "''"));
    return `${before}'${inner}'`;
  }
  /* A flow list or map the author wrote is theirs to have kept valid; `{{` opens no map here. */
  if (/^[[{]/.test(value) && !value.startsWith("{{")) return before + fillText(value, vars, wall);
  const titled = /\{\{\s*title\s*\}\}/.test(value);
  const filled = fillText(value, vars, wall);
  return before + (filled === value || plain(filled, !titled) ? filled : JSON.stringify(filled));
}

/**
 * `text` — a template's — with every variable it holds filled in, and every other byte as it was.
 * A pure function of its arguments: the same template, title and moment make the same text.
 */
export function fillTemplate(text: string, vars: TemplateVars): string {
  const wall = wallOf(vars.at, vars.zone);
  const m = FRONT.exec(text);
  if (!m) return fillText(text, vars, wall);
  const block = m[1]!;
  const start = m[0].startsWith("---\r\n") ? 5 : 4;
  const head = block
    .split(/(\r?\n)/)
    .map((piece, i) => (i % 2 === 1 ? piece : fillLine(piece, vars, wall)))
    .join("");
  return text.slice(0, start) + head + fillText(text.slice(start + block.length), vars, wall);
}
