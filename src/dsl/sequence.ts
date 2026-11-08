import { CODES } from "./codes";
import { namespaced, tidy } from "./common";
import { detectMermaid } from "./mermaid";
import { HUE_ORDER, type Diagnostic, type Hue, type LegendEntry, type NodeKind } from "./ir";
import { suggestHue } from "./suggest";
import { Cursor, tokenize, type LexError } from "./tokenizer";

/**
 * `sequence` — the one dialect whose model is not a graph.
 *
 * A sequence diagram has no nodes and edges in any useful sense: it has *columns* and a *clock*.
 * Two messages between the same pair are not one relationship drawn twice, they are two moments,
 * and the vertical position is the meaning. Forcing that into `Graph` would mean a node per moment
 * and a layout that ignored every edge — so it gets its own model, its own layout and its own view.
 *
 *     participant learner "Learner" "signed in" kind=person
 *     participant api "larkspur-api" "fastapi" hue=teal
 *     learner ->> web : submit an answer
 *     activate web
 *     web ->> api : `POST /attempt · id token`
 *     alt "the answer is correct"
 *       api -->> web : `201 · node cleared`
 *     else "it is wrong"
 *       api -->> web : `200 · not yet`
 *     end
 */

export interface Participant {
  id: string;
  title: string;
  meta?: string;
  kind: NodeKind;
  icon?: string;
  hue?: Hue;
}

type MessageStyle = "call" | "return" | "plain" | "async";

export type SeqEvent =
  | {
      t: "msg";
      from: string;
      to: string;
      text: string;
      /** The label was written in backticks: it is real data and is set mono. */
      mono: boolean;
      style: MessageStyle;
      line: number;
    }
  | { t: "activate" | "deactivate"; who: string; line: number }
  | { t: "fragment"; kind: "alt" | "opt" | "loop" | "par"; branches: Branch[]; line: number }
  | { t: "note"; over: string[]; text: string; line: number };

interface Branch {
  label: string;
  events: SeqEvent[];
}

export interface SequenceModel {
  kind: "sequence";
  participants: Participant[];
  events: SeqEvent[];
  legend: LegendEntry[];
  diagnostics: Diagnostic[];
}

const FRAGMENTS = new Set(["alt", "opt", "loop", "par"]);
const KIND_WORDS: Record<string, NodeKind> = {
  person: "person",
  service: "participant",
  store: "store",
  db: "db",
  client: "client",
  external: "external",
};

export function parseSequence(src: string): SequenceModel {
  const diagnostics: Diagnostic[] = [];

  /*
   * Sequence is the dialect most likely to be handed Mermaid, because it is the one Mermaid diagram
   * everybody has written: `sequenceDiagram` followed by `participant` lines that are very nearly
   * ours. Near-miss is the dangerous case — enough parses that the errors look like ordinary
   * mistakes rather than the wrong language, which is exactly when naming it is worth most.
   */
  const mermaid = detectMermaid(src);
  for (const h of mermaid.hits) {
    diagnostics.push({ line: h.line, code: CODES.E_MERMAID_SYNTAX, message: h.message, severity: "error" });
  }
  if (mermaid.fatal) return { kind: "sequence", participants: [], events: [], legend: [], diagnostics };

  const lexErrors: LexError[] = [];
  const cur = new Cursor(tokenize(src, lexErrors), { push: (d) => diagnostics.push(d) });
  for (const e of lexErrors) diagnostics.push({ ...e, severity: "error" });

  const participants: Participant[] = [];
  const legend: LegendEntry[] = [];
  const seen = new Set<string>();

  /* Referring to a participant that was never declared is an ordinary thing to do while sketching,
     so it creates one rather than failing — the id becomes the name and the column appears where
     it was first mentioned. */
  const ensure = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    participants.push({ id, title: id, kind: "participant" });
  };

  const readEvents = (stopAt: Set<string>): SeqEvent[] => {
    const out: SeqEvent[] = [];
    cur.skipSeps();

    while (!cur.done) {
      const t = cur.peek();
      if (t.kind !== "word") {
        if (t.kind === "sep") {
          cur.next();
          continue;
        }
        diagnostics.push({
          line: t.line,
          col: t.col,
          code: CODES.E_UNEXPECTED,
          message: `unexpected \`${t.value}\``,
          severity: "error",
        });
        cur.skipStatement();
        continue;
      }
      if (stopAt.has(t.value)) return out;

      const before = cur.peek();

      if (t.value === "participant" || t.value === "actor") {
        cur.next();
        const idTok = cur.eat("word");
        if (!idTok) {
          diagnostics.push({
            line: t.line,
            code: CODES.E_EXPECTED_ID,
            message: "expected an id after `participant`",
            severity: "error",
          });
          cur.skipStatement();
          continue;
        }
        const strings: string[] = [];
        for (;;) {
          const s = cur.eat("string");
          if (!s) break;
          strings.push(s.value);
        }
        const p: Participant = {
          id: idTok.value,
          title: strings[0] ?? idTok.value,
          meta: strings[1],
          kind: t.value === "actor" ? "person" : "participant",
        };
        while (cur.peek().kind === "word" && cur.peek(1).kind === "punct" && cur.peek(1).value === "=") {
          const key = cur.next().value;
          cur.next();
          const v = namespaced(cur, cur.next());
          if (key === "kind") p.kind = KIND_WORDS[v] ?? p.kind;
          else if (key === "icon") p.icon = v;
          else if (key === "hue") {
            /* The same closed set `modifiers()` polices, read here because a participant is not a
               `Node` and never passes through it — the one place a `hue=` still bound garbage. */
            if ((HUE_ORDER as readonly string[]).includes(v)) p.hue = v;
            else {
              const guess = suggestHue(v, HUE_ORDER);
              diagnostics.push({
                line: t.line,
                code: CODES.W_UNKNOWN_HUE,
                message: guess
                  ? `no hue named \`${v}\`. Did you mean \`${guess}\`? (${HUE_ORDER.join(", ")})`
                  : `no hue named \`${v}\`: expected one of ${HUE_ORDER.join(", ")}`,
                severity: "warn",
              });
            }
          }
        }
        if (seen.has(p.id)) {
          const at = participants.findIndex((x) => x.id === p.id);
          participants[at] = p;
        } else {
          seen.add(p.id);
          participants.push(p);
        }
        cur.skipSeps();
        continue;
      }

      if (t.value === "activate" || t.value === "deactivate") {
        cur.next();
        const who = cur.eat("word");
        if (who) {
          ensure(who.value);
          out.push({ t: t.value, who: who.value, line: t.line });
        }
        cur.skipSeps();
        continue;
      }

      if (t.value === "legend") {
        cur.next();
        const glyph = cur.eat("word");
        const text = cur.eat("string");
        if (glyph && text) legend.push({ glyph: glyph.value, text: text.value });
        cur.skipSeps();
        continue;
      }

      if (t.value === "note") {
        cur.next();
        cur.eatWord("over");
        const over: string[] = [];
        for (;;) {
          const who = cur.eat("word");
          if (!who) break;
          ensure(who.value);
          over.push(who.value);
          if (!cur.eat("punct", ",")) break;
        }
        cur.eat("punct", ":");
        const text = cur.eat("string");
        out.push({ t: "note", over, text: text?.value ?? "", line: t.line });
        cur.skipSeps();
        continue;
      }

      if (FRAGMENTS.has(t.value)) {
        cur.next();
        const label = cur.eat("string");
        const branches: Branch[] = [];
        const stop = new Set(["else", "and", "end"]);
        branches.push({ label: label?.value ?? "", events: readEvents(stop) });

        for (;;) {
          const next = cur.peek();
          if (next.kind === "word" && (next.value === "else" || next.value === "and")) {
            cur.next();
            const l = cur.eat("string");
            branches.push({ label: l?.value ?? "", events: readEvents(stop) });
            continue;
          }
          break;
        }
        if (!cur.eatWord("end")) {
          diagnostics.push({
            line: t.line,
            code: CODES.E_UNCLOSED_FRAGMENT,
            message: `\`${t.value}\` is never closed with \`end\``,
            severity: "error",
          });
        }
        out.push({ t: "fragment", kind: t.value as "alt", branches, line: t.line });
        cur.skipSeps();
        continue;
      }

      /* Anything else is a message: `<from> <arrow> <to> : <text>`. */
      cur.next();
      if (cur.peek().kind !== "arrow") {
        diagnostics.push({
          line: t.line,
          col: t.col,
          code: CODES.E_EXPECTED_ARROW,
          message: `expected an arrow after \`${t.value}\``,
          severity: "error",
        });
        cur.skipStatement();
        continue;
      }
      const arrow = cur.next();
      const to = cur.eat("word");
      if (!to) {
        diagnostics.push({
          line: arrow.line,
          code: CODES.E_EXPECTED_ARROW,
          message: "expected a participant after the arrow",
          severity: "error",
        });
        cur.skipStatement();
        continue;
      }
      ensure(t.value);
      ensure(to.value);

      /* Mermaid's `+`/`-` suffix activates and deactivates in the same line as the message. */
      const plus = cur.eat("word", "+");
      const minus = cur.eat("word", "-");

      cur.eat("punct", ":");
      const label = cur.eat("string");
      const style: MessageStyle = arrow.arrow?.seq ?? (arrow.arrow?.dash ? "return" : "call");

      if (plus) out.push({ t: "activate", who: to.value, line: arrow.line });
      out.push({
        t: "msg",
        from: t.value,
        to: to.value,
        text: label?.value ?? "",
        mono: label?.mono === true,
        style,
        line: arrow.line,
      });
      if (minus) out.push({ t: "deactivate", who: t.value, line: arrow.line });

      cur.skipSeps();
      if (cur.peek() === before) cur.skipStatement();
      continue;
    }

    return out;
  };

  const events = readEvents(new Set());

  return { kind: "sequence", participants, events, legend, diagnostics: tidy(diagnostics) };
}
