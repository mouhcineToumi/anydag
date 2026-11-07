/**
 * Tidy up: every item on the board — or every item in a selection — re-placed so that what was
 * roughly a row is exactly a row, what was roughly a grid is exactly a grid, every gap is the
 * board's gap, every edge is on the theme's grid, and nothing overlaps anything.
 *
 * **Browser-free**, like the rest of `src/board/`: this is arithmetic over boxes, and the page
 * hands it the measured ones. A diagram's *inside* is not touched — where a card sits inside an
 * `arch` is the layout's, and it is already tidy by construction. What a person can disarrange is
 * the plane the items sit on, and that is what this puts straight.
 *
 * The arrangement is read off the boxes rather than imposed on them. A person who put three notes
 * down the left and a diagram beside them meant a column and a diagram; re-flowing everything into
 * reading order, as `flow.ts` does for items with no position at all, would throw that away. So:
 *
 * 1. **Slice.** Sort the boxes along one axis and cut wherever a line could pass between them
 *    without touching any box — a *band* for a horizontal cut, a *column* for a vertical one. A
 *    slice that cuts on both axes is a grid; one that cuts on one axis is a stack along it; one that
 *    cuts on neither is a pile of overlapping boxes, which is the one case with no structure to keep.
 * 2. **Recurse** into each band, column or cell, because the structure nests: a column beside a
 *    diagram is a row whose first member is a stack.
 * 3. **Lay the tree out.** A stack puts its parts one gap apart, aligned to their leading edges; a
 *    grid takes the widest cell in each column and the tallest in each row, so a left edge is shared
 *    down a column and a top edge along a row; a pile is stacked along its longer side in the order
 *    of its centres, which is the best guess about what two boxes dropped on top of each other were
 *    meant to be.
 *
 * A grid is only a grid when it is mostly full. Two boxes on a diagonal cut both ways, and drawing
 * them as a 2×2 with two empty cells would keep the diagonal — the one arrangement nobody means. The
 * bar is `rows + cols − 1` filled cells: an L, or a grid with one hole, keeps its shape; anything
 * emptier is a stack. When both axes cut and it is not a grid, the axis with more pieces wins, and a
 * tie goes to columns, because a shared left edge is the alignment a reader notices first.
 *
 * Sizes are rounded up to the grid before any arithmetic, so a gap after a 293px note is the
 * board's gap plus three pixels and every position lands on the grid ELK and the nudge keys use;
 * the gap itself is rounded up to the grid for the same reason. Exact gaps and on-grid edges cannot
 * both hold against measured heights, and an edge that a nudge cannot reach is the worse defect.
 *
 * The result is a fixed point: tidying a tidy board changes nothing, which is what lets the page
 * skip the write. A group (`group=`) is one rigid box: it is placed like any other unit and its
 * members keep their offsets from its corner exactly, because grouping is how a person says an
 * arrangement is deliberate. See `units()`.
 */

export interface TidyBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Members of one group move as one rigid box, keeping their offsets within it. */
  group?: string;
}

export interface TidyOptions {
  /** Between any two neighbours — the board's `flow.gap`. Rounded up to the grid. */
  gap: number;
  /** The theme's grid; every edge lands on it. */
  grid: number;
}

export interface TidyPoint {
  x: number;
  y: number;
}

/** Something arranged and ready to be placed: its tidy size, and how to place its contents. */
interface Layout {
  w: number;
  h: number;
  put(x: number, y: number, out: Map<string, TidyPoint>): void;
}

/** A thing being arranged: its box as it is now, for reading the structure, and its tidy layout. */
interface Unit {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layout: Layout;
}

interface Opts {
  gap: number;
  grid: number;
  /** How far two boxes may overlap and still count as separate — a sloppy drop, not a pile. */
  tol: number;
}

type Axis = "x" | "y";

/** A size rounded up to the grid, so the box after it starts on the grid too. */
const up = (v: number, grid: number): number => Math.max(grid, Math.ceil(v / grid - 1e-6) * grid);

const start = (u: Unit, axis: Axis): number => (axis === "x" ? u.x : u.y);
const end = (u: Unit, axis: Axis): number => (axis === "x" ? u.x + u.w : u.y + u.h);
const centre = (u: Unit, axis: Axis): number => start(u, axis) + (axis === "x" ? u.w : u.h) / 2;

/**
 * The maximal runs along an axis that no cut can pass through, in order along it.
 *
 * Sorted by start, a run extends as far as the furthest end seen so far; the next box starts a new
 * run when it begins past that reach (less the tolerance). One run means the axis does not cut.
 */
function pieces(units: Unit[], axis: Axis, o: Opts): Unit[][] {
  const sorted = [...units].sort((a, b) => start(a, axis) - start(b, axis) || a.key.localeCompare(b.key));
  const out: Unit[][] = [];
  let run: Unit[] = [];
  let reach = -Infinity;
  for (const u of sorted) {
    if (run.length && start(u, axis) >= reach - o.tol) {
      out.push(run);
      run = [u];
      reach = end(u, axis);
    } else {
      run.push(u);
      reach = Math.max(reach, end(u, axis));
    }
  }
  if (run.length) out.push(run);
  return out;
}

/** Parts one gap apart along an axis, aligned to their leading edge on the other. */
function stack(parts: Layout[], axis: Axis, o: Opts): Layout {
  const along = (l: Layout) => (axis === "x" ? l.w : l.h);
  const across = (l: Layout) => (axis === "x" ? l.h : l.w);
  const length = parts.reduce((s, l) => s + along(l), 0) + o.gap * (parts.length - 1);
  const breadth = Math.max(...parts.map(across));
  return {
    w: axis === "x" ? length : breadth,
    h: axis === "x" ? breadth : length,
    put(x, y, out) {
      let at = 0;
      for (const l of parts) {
        l.put(axis === "x" ? x + at : x, axis === "x" ? y : y + at, out);
        at += along(l) + o.gap;
      }
    },
  };
}

/**
 * Bands and columns as a grid: the widest cell sets its column, the tallest its row, and each
 * cell's contents sit at its top-left. `null` when the grid is too empty to be one.
 */
function grid(bands: Unit[][], cols: Unit[][], o: Opts): Layout | null {
  const rowOf = new Map<Unit, number>();
  const colOf = new Map<Unit, number>();
  bands.forEach((band, r) => band.forEach((u) => rowOf.set(u, r)));
  cols.forEach((col, c) => col.forEach((u) => colOf.set(u, c)));

  const cells = new Map<string, { r: number; c: number; units: Unit[] }>();
  for (const u of rowOf.keys()) {
    const r = rowOf.get(u)!;
    const c = colOf.get(u)!;
    const key = `${r}:${c}`;
    const cell = cells.get(key) ?? { r, c, units: [] };
    cell.units.push(u);
    cells.set(key, cell);
  }
  if (cells.size < bands.length + cols.length - 1) return null;

  const laid = [...cells.values()].map((cell) => ({ ...cell, layout: arrange(cell.units, o) }));
  const colW = cols.map((_, c) => Math.max(...laid.filter((l) => l.c === c).map((l) => l.layout.w)));
  const rowH = bands.map((_, r) => Math.max(...laid.filter((l) => l.r === r).map((l) => l.layout.h)));
  const offsets = (sizes: number[]): number[] => {
    const out: number[] = [];
    let at = 0;
    for (const s of sizes) {
      out.push(at);
      at += s + o.gap;
    }
    return out;
  };
  const colX = offsets(colW);
  const rowY = offsets(rowH);
  return {
    w: colW.reduce((s, v) => s + v, 0) + o.gap * (colW.length - 1),
    h: rowH.reduce((s, v) => s + v, 0) + o.gap * (rowH.length - 1),
    put(x, y, out) {
      for (const l of laid) l.layout.put(x + colX[l.c]!, y + rowY[l.r]!, out);
    },
  };
}

function arrange(units: Unit[], o: Opts): Layout {
  if (units.length === 1) return units[0]!.layout;

  const bands = pieces(units, "y", o);
  const cols = pieces(units, "x", o);

  if (bands.length > 1 && cols.length > 1) {
    const g = grid(bands, cols, o);
    if (g) return g;
  }
  if (bands.length > 1 || cols.length > 1) {
    const axis: Axis = bands.length > cols.length ? "y" : "x";
    const parts = axis === "y" ? bands : cols;
    return stack(
      parts.map((p) => arrange(p, o)),
      axis,
      o,
    );
  }

  /* A pile: nothing separates them on either axis. Along the longer side, in the order of their
     centres, which is the order a person dropping them meant. */
  const x0 = Math.min(...units.map((u) => u.x));
  const x1 = Math.max(...units.map((u) => u.x + u.w));
  const y0 = Math.min(...units.map((u) => u.y));
  const y1 = Math.max(...units.map((u) => u.y + u.h));
  const axis: Axis = x1 - x0 >= y1 - y0 ? "x" : "y";
  const other: Axis = axis === "x" ? "y" : "x";
  const sorted = [...units].sort(
    (a, b) => centre(a, axis) - centre(b, axis) || centre(a, other) - centre(b, other) || a.key.localeCompare(b.key),
  );
  return stack(
    sorted.map((u) => u.layout),
    axis,
    o,
  );
}

function leaf(b: TidyBox, o: Opts): Unit {
  return {
    key: b.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    layout: {
      w: up(b.w, o.grid),
      h: up(b.h, o.grid),
      put(x, y, out) {
        out.set(b.id, { x, y });
      },
    },
  };
}

/** Items as units, with each group of two or more folded into one unit tidied on its own. */
function units(boxes: TidyBox[], o: Opts): Unit[] {
  const groups = new Map<string, TidyBox[]>();
  for (const b of boxes) if (b.group) groups.set(b.group, [...(groups.get(b.group) ?? []), b]);

  const out: Unit[] = [];
  const folded = new Set<string>();
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    folded.add(name);
    const x0 = Math.min(...members.map((b) => b.x));
    const y0 = Math.min(...members.map((b) => b.y));
    const x1 = Math.max(...members.map((b) => b.x + b.w));
    const y1 = Math.max(...members.map((b) => b.y + b.h));
    /* Offsets land on the grid like every other edge this file places — the group's own corner is
       put there by the arrangement above it, so an unsnapped offset would take its members off it
       and break the one invariant the random-board check holds. On a real board it changes
       nothing: every gesture that can move an item already snaps, so the offsets are grid
       multiples before they get here. The box is measured from the *snapped* offsets rather than
       from the raw extent, or a member rounded outwards would sit past the edge of the unit it is
       being placed inside. */
    const off = members.map((b) => ({
      b,
      dx: Math.round((b.x - x0) / o.grid) * o.grid,
      dy: Math.round((b.y - y0) / o.grid) * o.grid,
    }));
    out.push({
      key: `group:${name}`,
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      /*
       * Rigid: every member keeps its offset from the group's own corner, and the group is placed
       * as one box like anything else.
       *
       * It ran `arrange` over the members, which is this file's whole algorithm — slice into bands
       * and columns, and stack a pile along its longer side by centre. On six overlapping pen
       * strokes, which is what a drawing *is*, that reads a pile and deals it out into a column:
       * the group survives and the picture inside it does not. The comment above this function has
       * said "keep their own arrangement among themselves" since M23, and re-laying them out is
       * precisely not that.
       *
       * The general argument is the same one `group=` makes everywhere else on this board. A
       * group is a person saying *this arrangement is deliberate*; a drag moves the members
       * together without touching their spacing, and tidy has no better claim to rearrange them
       * than a drag has. The costs are not symmetric either — three notes that would have been
       * neatened can be ungrouped, tidied and grouped again, while a drawing that has been dealt
       * into a column is only recoverable through undo.
       */
      layout: {
        w: up(Math.max(...off.map((m) => m.dx + m.b.w)), o.grid),
        h: up(Math.max(...off.map((m) => m.dy + m.b.h)), o.grid),
        put(x, y, into) {
          for (const m of off) into.set(m.b.id, { x: x + m.dx, y: y + m.dy });
        },
      },
    });
  }
  for (const b of boxes) if (!b.group || !folded.has(b.group)) out.push(leaf(b, o));
  return out;
}

/** One pass: read the structure off the boxes, lay the tree out from the arrangement's corner. */
function pass(boxes: TidyBox[], o: Opts): Map<string, TidyPoint> {
  const out = new Map<string, TidyPoint>();
  const root = arrange(units(boxes, o), o);
  const x0 = Math.round(Math.min(...boxes.map((b) => b.x)) / o.grid) * o.grid;
  const y0 = Math.round(Math.min(...boxes.map((b) => b.y)) / o.grid) * o.grid;
  root.put(x0, y0, out);
  return out;
}

/**
 * Where every box should go. Every id in `boxes` is in the result, moved or not.
 *
 * The arrangement keeps its top-left corner: the tidy board starts where the untidy one did,
 * snapped to the grid, so the view a person is looking at still holds it.
 *
 * Passes repeat until one moves nothing. A single pass is not always a fixed point: a stack of
 * rows can come out with its members lined up into columns by chance, and the next reading sees a
 * grid where the last saw a stack and widens a column to fit. That second reading is the right one
 * — the boxes *are* a grid now — so the loop runs until the reading and the layout agree, which
 * takes two passes at most in practice and is capped regardless.
 */
export function tidy(boxes: TidyBox[], opts: TidyOptions): Map<string, TidyPoint> {
  if (boxes.length === 0) return new Map();
  const grid = Math.max(1, opts.grid);
  const o: Opts = { gap: up(Math.max(0, opts.gap), grid), grid, tol: grid };

  let current = boxes.map((b) => ({ ...b, w: up(b.w, grid), h: up(b.h, grid) }));
  let moves = pass(current, o);
  for (let i = 0; i < 8; i++) {
    const next = current.map((b) => ({ ...b, ...moves.get(b.id)! }));
    const again = pass(next, o);
    if (next.every((b) => again.get(b.id)!.x === b.x && again.get(b.id)!.y === b.y)) break;
    current = next;
    moves = again;
  }
  return moves;
}
