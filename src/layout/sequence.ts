import { fragId, msgId, noteId, type SeqEvent, type SequenceModel } from "@/dsl/sequence";
import type { Theme } from "@/theme/contract";

import { fontOf, getMeasurer } from "./measure";
import type { Box, RoutedEdge, SeqPlaced } from "./types";

/**
 * Sequence layout: columns across, a clock down.
 *
 * Nothing here is iterative or heuristic — the y cursor walks the event list once and every row
 * costs a fixed amount. That is what a sequence diagram is, and it means the drawing order in the
 * file is the drawing order on the page, which is the only property a reader relies on.
 *
 * The only real measurement is horizontal: a column pitch has to fit the widest label that will be
 * written between it and its neighbour, or the text of a long message runs under the next lifeline.
 */
export function layoutSequence(model: SequenceModel, theme: Theme): SeqPlaced {
  const m = theme.metric;
  const s = m.seq;
  const measure = getMeasurer();
  const proseFont = fontOf(theme, theme.type.seqLabel);
  const monoFont = fontOf(theme, theme.type.edgeLabel + 1, 500, true);

  const ids = model.participants.map((p) => p.id);
  const index = new Map(ids.map((id, i) => [id, i]));

  /* Widest label that will be drawn in each gap between neighbouring columns. A message spanning
     several columns spreads its demand across all the gaps it crosses, rather than forcing one of
     them to carry the whole width. */
  const gapNeed = new Array(Math.max(0, ids.length - 1)).fill(0);
  const walk = (events: SeqEvent[]): void => {
    for (const e of events) {
      if (e.t === "fragment") {
        for (const b of e.branches) walk(b.events);
        continue;
      }
      if (e.t !== "msg" || !e.text) continue;
      const a = index.get(e.from);
      const b = index.get(e.to);
      if (a === undefined || b === undefined) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const width = measure.width(e.text, e.mono ? monoFont : proseFont) + 40;
      const spans = Math.max(1, hi - lo);
      for (let i = lo; i < hi; i++) gapNeed[i] = Math.max(gapNeed[i]!, width / spans);
      if (lo === hi) gapNeed[Math.min(lo, gapNeed.length - 1)] = Math.max(gapNeed[Math.min(lo, gapNeed.length - 1)] ?? 0, width);
    }
  };
  walk(model.events);

  const colX: number[] = [];
  let x = m.node.participantW / 2;
  for (let i = 0; i < ids.length; i++) {
    colX.push(Math.round(x));
    x += Math.max(m.node.participantW + s.colGap, (gapNeed[i] ?? 0) + m.node.gap * 2);
  }
  const width = Math.ceil(x - s.colGap + m.node.participantW / 2);

  const participants: Record<string, Box> = {};
  model.participants.forEach((p, i) => {
    participants[p.id] = {
      x: colX[i]! - m.node.participantW / 2,
      y: 0,
      w: m.node.participantW,
      h: m.node.participantH,
    };
  });

  const hueOf = new Map(model.participants.map((p) => [p.id, p.hue]));
  const messages: RoutedEdge[] = [];
  const fragments: SeqPlaced["fragments"] = [];
  const activations: SeqPlaced["activations"] = [];
  const rows: SeqPlaced["rows"] = [];
  let fragN = 0;
  let noteN = 0;

  /* One stack per participant: `activate` pushes a start y, `deactivate` pops it and emits the bar.
     Anything still open at the end is closed at the last row, because an unclosed activation is a
     forgotten `deactivate` far more often than it is a claim that the work never finished. */
  const open = new Map<string, number[]>();
  const depthOf = (id: string) => open.get(id)?.length ?? 0;

  let y = m.node.participantH + s.firstRow;
  let seq = 0;

  const half = s.activationW / 2;
  /* An active participant's line leaves the edge of its bar, not the middle of the lifeline. */
  const edgeX = (id: string, side: -1 | 1): number => {
    const at = colX[index.get(id) ?? 0]!;
    return depthOf(id) > 0 ? at + side * half : at;
  };

  const emit = (events: SeqEvent[]): void => {
    for (const e of events) {
      /* One branch, not two: `activate` and `deactivate` share a variant, so narrowing them
         separately leaves the other in the union and every later `e.from` fails to typecheck. */
      if (e.t === "activate" || e.t === "deactivate") {
        if (e.t === "activate") {
          const stack = open.get(e.who) ?? [];
          stack.push(y - s.rowPitch / 2);
          open.set(e.who, stack);
        } else {
          const from = open.get(e.who)?.pop();
          if (from !== undefined) {
            activations.push({
              x: colX[index.get(e.who) ?? 0]! - half,
              y0: from,
              y1: y - s.rowPitch / 2,
              hue: hueOf.get(e.who),
            });
          }
        }
        continue;
      }

      if (e.t === "note") {
        const cols = e.over.map((id) => colX[index.get(id) ?? 0]!);
        const x0 = Math.min(...cols) - m.node.participantW / 2;
        const x1 = Math.max(...cols) + m.node.participantW / 2;
        fragments.push({
          id: noteId(noteN++),
          box: { x: x0, y: y - 20, w: x1 - x0, h: 44 },
          dividers: [],
          tabs: [{ y: y - 20, kind: "note", text: e.text }],
          note: true,
        });
        rows.push({ y, line: e.line, inside: false });
        y += s.rowPitch;
        continue;
      }

      if (e.t === "fragment") {
        const involved = new Set<string>();
        const collect = (list: SeqEvent[]) => {
          for (const ev of list) {
            if (ev.t === "msg") {
              involved.add(ev.from);
              involved.add(ev.to);
            }
            if (ev.t === "fragment") for (const b of ev.branches) collect(b.events);
          }
        };
        for (const b of e.branches) collect(b.events);
        const cols = [...involved].map((id) => colX[index.get(id) ?? 0]!);
        const x0 = (cols.length ? Math.min(...cols) : colX[0]!) - s.fragmentPadX;
        const x1 = (cols.length ? Math.max(...cols) : colX[0]!) + s.fragmentPadRight;

        const top = y - s.rowPitch / 2;
        /* Counted before the branches are walked, so the ids run in the order the file opens them —
           which is the order `seqParts` counts — while the boxes are pushed after their children. */
        const id = fragId(fragN++);
        rows.push({ y: top, line: e.line, inside: true });
        const tabs: SeqPlaced["fragments"][number]["tabs"] = [];
        const dividers: number[] = [];

        e.branches.forEach((b, i) => {
          if (i > 0) {
            y += s.elseH / 2;
            dividers.push(y - s.rowPitch / 2);
            rows.push({ y: y - s.rowPitch / 2, line: b.line, inside: true });
            tabs.push({ y: y - s.rowPitch / 2, kind: e.kind === "par" ? "and" : "else", text: b.label });
            y += s.elseH / 2;
          } else {
            tabs.push({ y: top, kind: e.kind, text: b.label });
            y += s.tabH;
          }
          emit(b.events);
        });
        y += s.endH;

        if (e.end !== undefined) rows.push({ y: y - s.rowPitch / 2, line: e.end, inside: false });
        fragments.push({ id, box: { x: x0, y: top, w: x1 - x0, h: y - s.rowPitch / 2 - top }, dividers, tabs });
        continue;
      }

      /* Everything else has been handled; this is the narrowing TypeScript needs to see, because
         `activate` and `deactivate` share one variant and excluding half of it excludes nothing. */
      if (e.t !== "msg") continue;

      const ai = index.get(e.from);
      const bi = index.get(e.to);
      if (ai === undefined || bi === undefined) continue;
      rows.push({ y, line: e.line, inside: false });

      const dash = e.style === "return";
      const hue = hueOf.get(e.from);
      const head = e.style === "async" ? ("open" as const) : ("chevron" as const);

      if (ai === bi) {
        /* A self-message loops out to the right and comes back one row lower. */
        const at = edgeX(e.from, 1);
        const reach = s.colGap;
        const y1 = y + s.rowPitch * 0.6;
        messages.push({
          id: msgId(seq++),
          d: `M${at},${y} C${at + reach},${y} ${at + reach},${y1} ${at},${y1}`,
          hue,
          dash,
          quiet: false,
          danger: false,
          head: { kind: head, x: at, y: y1, angle: Math.PI, surface: "paper" },
          label: e.text
            ? { x: at + reach + 8, y: (y + y1) / 2, text: e.text, anchor: "start", surface: "paper", mono: e.mono }
            : undefined,
        });
        y += s.rowPitch * 1.2;
        continue;
      }

      const dir = bi > ai ? 1 : -1;
      const from = edgeX(e.from, dir as 1 | -1);
      const to = edgeX(e.to, -dir as 1 | -1);

      messages.push({
        id: msgId(seq++),
        d: `M${from},${y} L${to},${y}`,
        hue,
        dash,
        quiet: false,
        danger: false,
        head: { kind: head, x: to, y, angle: dir > 0 ? 0 : Math.PI, surface: "paper" },
        label: e.text
          ? {
              x: (from + to) / 2,
              y: y - s.labelLift,
              text: e.text,
              anchor: "middle",
              surface: "paper",
              mono: e.mono,
            }
          : undefined,
      });
      y += s.rowPitch;
    }
  };

  emit(model.events);

  const bottom = y;
  for (const [id, stack] of open) {
    for (const from of stack) {
      activations.push({ x: colX[index.get(id) ?? 0]! - half, y0: from, y1: bottom - s.rowPitch / 2, hue: hueOf.get(id) });
    }
  }

  const lifelineEnd = bottom;
  const lifelines = ids.map((id, i) => ({ id, x: colX[i]!, y0: m.node.participantH, y1: lifelineEnd }));

  return {
    kind: "sequence",
    size: { w: width, h: Math.ceil(lifelineEnd) },
    participants,
    lifelines,
    activations,
    messages,
    fragments,
    rows,
  };
}
