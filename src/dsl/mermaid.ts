/**
 * Recognise Mermaid, and say so once.
 *
 * This DSL is Mermaid-flavoured on purpose, which is exactly why the wrong dialect gets typed into
 * it: an author reaching for a diagram reaches for the syntax they have written a hundred times.
 * Left to the tokenizer, `graph LR` is two undeclared ids and `A[Label]` is an unexpected `[`, and
 * a six-line paste comes back as sixteen errors none of which contains the word "Mermaid".
 *
 * A grammar cannot help here — the whole point is that the input is *not* in the grammar. What can
 * help is a sniffer that runs before the parser, recognises the five constructs that account for
 * nearly all of it, and prints the translation.
 *
 * The distinction that matters is **fatal**. A header — `graph TD`, `erDiagram` — means the entire
 * block is Mermaid, and parsing on produces nothing but noise, so the sniff replaces the parse. An
 * inline habit (`A[Label]`, a piped edge label) is one line inside an otherwise fine board, so it
 * is reported where it is and parsing continues.
 */

export interface MermaidHit {
  line: number;
  message: string;
}

/**
 * Mermaid's `pie` header, and the evidence it takes to tell it from ours.
 *
 * `pie` is a *chart*'s own form word, so a header pattern that fired on the word alone would read
 * the commonest chart body in existence as another language. `parseChart` does not sniff at all for
 * exactly this reason — but the Inspector's Convert offer runs the detector over any fence body
 * whatever its type, so the word has to be told apart here rather than avoided there.
 *
 * What is Mermaid's and never ours is the *suffix* — `pie showData`, `pie title Sales` — and the
 * data line under it, `"Dogs" : 386`, which no chart statement can be: a slice's value follows a
 * bare id and there is no `:` anywhere in the grammar. A bare `pie` is therefore Mermaid only when
 * one of those rows follows it, and `pie` over `slice` lines is ours.
 *
 * Exported because `fromMermaid` has to ask the same question the detector asked. Two spellings of
 * one predicate is how the converter and the offer come to disagree about the same paste.
 */
const PIE_HEAD = /^pie(?:\s+showData)?(?:\s+title\b.*)?$/;
const PIE_ROW = /^"[^"]*"\s*:\s*-?[\d.]+\s*$/;

export function mermaidPie(lines: string[], at: number): boolean {
  const head = lines[at]!.trim();
  if (!PIE_HEAD.test(head)) return false;
  if (/\b(?:showData|title)\b/.test(head)) return true;
  return lines.slice(at + 1).some((l) => PIE_ROW.test(l.trim()));
}

/**
 * A Mermaid diagram header. Each of these means "everything below is another language".
 *
 * `mindmap` and `gitGraph` name two of our own fence types, which is not a collision: this runs
 * only for the dialects that go through `parseWith`, and inside an `arch` fence a line that says
 * `mindmap` is Mermaid's header and nothing else. `pie` *is* a collision — it names a chart's form
 * — and it is the one entry carrying a guard, which is what the third slot is for.
 */
const HEADERS: [RegExp, string, ((lines: string[], at: number) => boolean)?][] = [
  [/^(graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/, "flow"],
  [/^erDiagram\b/, "erd"],
  [/^sequenceDiagram\b/, "sequence"],
  [/^classDiagram(-v2)?\b/, "class"],
  [/^stateDiagram(-v2)?\b/, "state"],
  [/^xychart-beta\b/, "chart"],
  [PIE_HEAD, "chart", mermaidPie],
  [/^(gitGraph|gantt|journey|mindmap|quadrantChart|timeline)\b/, ""],
];

/** The habits that survive into an otherwise-ours board, and what to write instead. */
const INLINE: [RegExp, string][] = [
  [
    /(-->|---|-\.->|-\.-)\s*\|[^|]+\|/,
    'Mermaid puts an edge label between pipes. Here it is the next quoted string: `a --> b "label"`.',
  ],
  /*
   * Anchored to the start of the statement, and that anchor is load-bearing rather than tidy.
   * Brackets are not foreign here — a class row carries `+skills: list[str]` and every node with
   * rows carries `{ … }` — so an unanchored `\w+\[…\]` fires on two of the reference boards. What
   * Mermaid does and this grammar never does is open a *statement* with `id[`: ours opens with a
   * kind word, which is followed by a space.
   */
  [
    /^[A-Za-z_][\w-]*(\[\[?|\(\(?|\{\{?|>)[^\]})>]+(\]\]?|\)\)?|\}\}?|\])/,
    'Mermaid declares a node by bracketing its label. Here a node is `<kind> <id> "<title>"`; the ' +
      "kind word is what picks the shape, so the brackets have nothing left to say.",
  ],
  /*
   * The half-converted line: our kind word, Mermaid's brackets. It reads as a deliberate
   * translation that stopped one step early, and it is the shape a paste takes after someone has
   * fixed the header — so it is worth its own pattern even though it shares the message above.
   */
  [
    /^[A-Za-z_][\w-]*\s+[A-Za-z_][\w-]*\s*\[[^\]]+\]/,
    'Mermaid declares a node by bracketing its label. Here a node is `<kind> <id> "<title>"`; the ' +
      "kind word is what picks the shape, so the brackets have nothing left to say.",
  ],
  [/^subgraph\b/, 'Mermaid\'s `subgraph` is `group <id> "<label>" { ... }` here, and it takes the `}`.'],
  [
    /^(style|classDef|linkStyle)\b/,
    "Styling is the theme's, never the board's (rule 2). Put `hue=` on the group and every node and " +
      "edge inside it inherits it.",
  ],
  [/^click\b/, "There is no interaction to declare: a board is a picture, and `click` has no equivalent."],
];

/**
 * What in this source is Mermaid rather than ours.
 *
 * Returns at most one hit per construct: an author who bracketed thirty labels has made one
 * mistake thirty times, and thirty identical errors is the cascade this exists to prevent. `fatal`
 * says the block is Mermaid end to end and should not be parsed at all.
 */
export function detectMermaid(src: string): { hits: MermaidHit[]; fatal: boolean } {
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%") || line.startsWith("//")) continue;
    for (const [re, ours, only] of HEADERS) {
      if (!re.test(line)) continue;
      if (only && !only(lines, i)) continue;
      const instead = ours
        ? `a \`${ours}\` fence draws this, and the fence has already said so`
        : "the fence has already said which type this is";
      return {
        fatal: true,
        hits: [
          {
            line: i + 1,
            message:
              `\`${line}\` is a Mermaid header: ${instead}. Delete the line; ` +
              "set the direction with `dir=LR` on the fence, not in the body. " +
              "`GET /__board/dsl?type=<type>` is the grammar this board actually speaks.",
          },
        ],
      };
    }
  }

  const hits: MermaidHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%") || line.startsWith("//")) continue;
    for (const [re, message] of INLINE) {
      if (seen.has(message) || !re.test(line)) continue;
      seen.add(message);
      hits.push({ line: i + 1, message });
    }
  }
  return { hits, fatal: false };
}
