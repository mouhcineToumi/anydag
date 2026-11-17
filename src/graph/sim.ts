/**
 * The graph view's layout (#458): a force-directed simulation over typed arrays.
 *
 * No DOM, no clock, no randomness and no dependency, so the same graph settles to the same picture
 * byte for byte, here, in a worker or under Node. It runs only when it is asked for a step, so it has
 * no timer to leave running; `host.ts` is what paces it. Nothing is allocated per tick: every array a
 * tick touches is made when the simulation is, or when `set` changes the groups.
 *
 * The forces, per tick: links (a spring per link, its strength split between the ends by degree),
 * many-body repulsion by Barnes–Hut, a pull to the centre, and — when files are grouped — a lean
 * towards the group's middle and a push between groups whose discs overlap. Velocity decays by
 * `VEL_KEEP` a tick and the heat (`alpha`) cools from 1 to `ALPHA_MIN` in about 220 ticks.
 *
 * **The tree.** Each tick the files are sorted along a Z-order (Morton) curve by a three-pass radix
 * sort, copied in that order into packed arrays, and the quadtree is cut out of the sorted run: a
 * cell is a range of it, numbered depth first, with a `skip` to the cell after its subtree. Masses
 * and centres come from prefix sums, so a cell costs O(1) whatever it holds. A leaf holds up to
 * `LEAF` files. A cell's size in the opening test is the box tight around its files, not its
 * quadrant. The tree is walked once per leaf, not once per file, as a loop over cell numbers with no
 * stack — take a cell as one body and jump to its `skip`, or open it and step to the next number —
 * and each file of the leaf then takes the lists that walk made. Why each of these, and what it
 * bought, is in `docs/architecture/graph-simulation.md`.
 */

/** What a person turns. Each is a multiple of the built-in force, so 1 is the picture as designed. */
export interface Forces {
  /** Space between files: scales the repulsion. */
  repel: number;
  /** The length a link rests at. */
  link: number;
  /** How hard a link pulls. The effective strength is capped at 1, or it oscillates. */
  pull: number;
  /** How hard everything is pulled to the middle. */
  centre: number;
  /** How hard a file leans towards the middle of its group, 0 to 1. */
  tight: number;
  /** How far apart groups sit, 0 to 1. */
  gap: number;
}

/** The forces as designed. `tight` and `gap` do nothing without groups. */
export const FORCES: Readonly<Forces> = Object.freeze({ repel: 1, link: 1, pull: 1, centre: 1, tight: 0, gap: 0 });

export interface SimGraph {
  /** How many files. */
  n: number;
  /** Link k joins file `src[k]` to file `dst[k]`. */
  src: Int32Array;
  dst: Int32Array;
  /** Start positions, x then y per file. Without them the files start on a spiral in index order. */
  pos?: Float32Array | null;
  /** The starting heat, 0 to 1 (default 1: hot). */
  alpha?: number;
  forces?: Partial<Forces>;
  /** One group per file, -1 for none, numbered from the biggest group down. */
  group?: Int32Array | null;
}

export interface SimChange {
  /** Merged into the forces now in effect. */
  forces?: Partial<Forces>;
  /** New groups (or `null` for none); left out, the groups stay. */
  group?: Int32Array | null;
  /** Warm the graph to at least this heat, so it moves to the new layout. */
  heat?: number;
}

/** Below this heat, with nothing held, the graph is at rest. */
export const ALPHA_MIN = 0.001;
/** How much of the gap to the target heat closes per tick: from 1 to `ALPHA_MIN` in 220 ticks. */
const ALPHA_DECAY = 1 - ALPHA_MIN ** (1 / 220);
/** The heat a held file keeps the graph at. */
const ALPHA_HELD = 0.3;
/** Velocity kept per tick. */
const VEL_KEEP = 0.6;
/** The length a link rests at, at `link` 1. */
const LINK = 34;
/** The pull to the centre, at `centre` 1. */
const GRAVITY = 0.075;
/** Repulsion between two files closer than 1 is softened, and ignored beyond 900. */
const DMIN2 = 1;
const DMAX2 = 900 * 900;
/** Barnes–Hut θ²: coarse while everything still moves far, exact once it is settling into place. */
const THETA2_HOT = 1.69;
const THETA2_COLD = 0.81;
const THETA_SWITCH = 0.06;
/** Only the biggest groups are pushed apart: the push is a loop over pairs. */
const GROUPS_APART = 400;
/** Bits per axis of the Morton key, so the tree is at most this deep. 2·15 bits keep a key a positive int32. */
const LEVELS = 15;
const SIDE = 1 << LEVELS;
/** Files a leaf may hold before it is cut. */
const LEAF = 16;
/** The phyllotaxis spiral the files start on: `r = 9·√(i + 0.5)`, the angle `i` golden angles. */
const SPIRAL_R = 9;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Sim {
  readonly n: number;
  /** The heat now. */
  readonly alpha: number;
  /** Ticks since the simulation was made. */
  readonly ticks: number;
  /** Whether a step would do any work: warm, or a file held. */
  readonly live: boolean;
  /** Whether a file is held. */
  readonly held: boolean;
  /** Up to `most` ticks, fewer if it comes to rest first. Returns how many it did. */
  step(most: number): number;
  /** The positions, x then y per file, into `out` (at least `2·n` long). */
  read(out: Float32Array): void;
  /** Change forces or groups in place; the files keep their places and move to the new layout. */
  set(change: SimChange): void;
  /** Hold file `i` at (x, y): it stays there and the graph stays warm until `drop`. */
  pin(i: number, x: number, y: number): void;
  drop(): void;
}

const clamp = (v: unknown, dflt: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/** The forces with `change` merged in; a value that is not a finite number keeps the one before. */
function merge(base: Forces, change: Partial<Forces> | undefined): Forces {
  const c = change ?? {};
  return {
    repel: clamp(c.repel, base.repel, 0, 64),
    link: clamp(c.link, base.link, 0, 64),
    pull: clamp(c.pull, base.pull, 0, 64),
    centre: clamp(c.centre, base.centre, 0, 64),
    /* Above 1/0.85 a link between groups would pull with a negative strength. */
    tight: clamp(c.tight, base.tight, 0, 1),
    gap: clamp(c.gap, base.gap, 0, 1),
  };
}

/** Spread the low 15 bits of `v` to the even bits of the result. */
function spread(v: number): number {
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  return (v | (v << 1)) & 0x55555555;
}

class ForceSim implements Sim {
  readonly n: number;
  private readonly m: number;
  private f: Forces;
  alpha: number;
  private target = 0;
  ticks = 0;
  private pinned = -1;
  private pinX = 0;
  private pinY = 0;

  /** Files, in their own order: x, y, vx, vy, side by side, so a link's end is one read from memory. */
  private readonly p: Float64Array;
  /** Each file's repulsion, `26 + 9·√degree`. */
  private readonly str: Float64Array;

  /* Links. */
  private readonly ls: Int32Array;
  private readonly lt: Int32Array;
  /** 1 / the smaller degree of the two ends, before `pull`. */
  private readonly lbase: Float64Array;
  /** The share of a link's pull its target takes: deg(src) / (deg(src) + deg(dst)). */
  private readonly lbias: Float64Array;
  private readonly llen: Float64Array;
  private readonly lstr: Float64Array;

  /* Groups. */
  private group: Int32Array | null = null;
  private groups = 0;
  private gc = new Float64Array(0);
  private gx = new Float64Array(0);
  private gy = new Float64Array(0);
  private gr = new Float64Array(0);
  private gpx = new Float64Array(0);
  private gpy = new Float64Array(0);

  /* The sort: keys and file numbers, ping-ponged between A and B, and the order kept between ticks. */
  private order: Int32Array;
  private spare: Int32Array;
  private ka: Int32Array;
  private kb: Int32Array;
  private readonly count = new Int32Array(1024);
  /* The files in curve order: position, repulsion, key; and prefix sums of mass and moment. */
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sw: Float64Array;
  private readonly pw: Float64Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;

  /* The tree: one cell per number, in depth-first order. A cell is a range of the sorted run. */
  private cap = 0;
  private cells = 0;
  private clo = new Int32Array(0);
  private chi = new Int32Array(0);
  /** The number of the cell after this one's subtree: a leaf's is its own plus one. */
  private cskip = new Int32Array(0);
  private cparent = new Int32Array(0);
  /** Centre of mass, and mass. */
  private cmx = new Float64Array(0);
  private cmy = new Float64Array(0);
  private cm = new Float64Array(0);
  /** The box tight around the cell's files, and its longer side squared, for the opening test. */
  private cx0 = new Float64Array(0);
  private cy0 = new Float64Array(0);
  private cx1 = new Float64Array(0);
  private cy1 = new Float64Array(0);
  private cs2 = new Float64Array(0);
  /** One leaf's interaction lists: cells far enough to be one body (as centre and mass), and leaves near. */
  private fx = new Float64Array(0);
  private fy = new Float64Array(0);
  private fm = new Float64Array(0);
  private near = new Int32Array(0);
  /** The cells still to cut while the tree is built: range, depth, parent. Four a level is enough. */
  private readonly qlo = new Int32Array(4 * LEVELS + 8);
  private readonly qhi = new Int32Array(4 * LEVELS + 8);
  private readonly qd = new Int32Array(4 * LEVELS + 8);
  private readonly qp = new Int32Array(4 * LEVELS + 8);

  constructor(g: SimGraph) {
    const n = g.n;
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`sim: n must be a whole number, got ${n}`);
    if (g.src.length !== g.dst.length) throw new RangeError("sim: src and dst differ in length");
    const m = g.src.length;
    for (let k = 0; k < m; k++) {
      const a = g.src[k];
      const b = g.dst[k];
      if (a < 0 || a >= n || b < 0 || b >= n) throw new RangeError(`sim: link ${k} joins ${a} and ${b}, outside 0..${n - 1}`);
    }
    if (g.pos && g.pos.length < 2 * n) throw new RangeError("sim: pos holds fewer than 2·n numbers");
    this.n = n;
    this.m = m;
    this.f = merge(FORCES, g.forces);
    this.alpha = clamp(g.alpha, 1, 0, 1);

    this.p = new Float64Array(4 * n);
    for (let i = 0; i < n; i++) {
      if (g.pos) {
        this.p[4 * i] = g.pos[2 * i];
        this.p[4 * i + 1] = g.pos[2 * i + 1];
      } else {
        const r = SPIRAL_R * Math.sqrt(i + 0.5);
        const a = i * GOLDEN;
        this.p[4 * i] = r * Math.cos(a);
        this.p[4 * i + 1] = r * Math.sin(a);
      }
    }

    const deg = new Float64Array(n);
    this.ls = g.src;
    this.lt = g.dst;
    for (let k = 0; k < m; k++) {
      deg[g.src[k]]++;
      deg[g.dst[k]]++;
    }
    this.str = new Float64Array(n);
    for (let i = 0; i < n; i++) this.str[i] = 26 + 9 * Math.sqrt(deg[i]);
    this.lbase = new Float64Array(m);
    this.lbias = new Float64Array(m);
    this.llen = new Float64Array(m);
    this.lstr = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const a = deg[g.src[k]];
      const b = deg[g.dst[k]];
      /* A link from a file to itself pulls on nothing. */
      this.lbase[k] = g.src[k] === g.dst[k] ? 0 : 1 / Math.min(a, b);
      this.lbias[k] = a / (a + b);
    }

    this.order = new Int32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.spare = new Int32Array(n);
    this.ka = new Int32Array(n);
    this.kb = new Int32Array(n);
    this.sx = new Float64Array(n);
    this.sy = new Float64Array(n);
    this.sw = new Float64Array(n);
    this.pw = new Float64Array(n + 1);
    this.px = new Float64Array(n + 1);
    this.py = new Float64Array(n + 1);
    this.grow(Math.max(64, Math.ceil(n / 2)));
    this.regroup(g.group ?? null);
  }

  get live(): boolean {
    return this.n > 0 && (this.alpha >= ALPHA_MIN || this.target > 0);
  }

  get held(): boolean {
    return this.pinned >= 0;
  }

  step(most: number): number {
    let did = 0;
    while (did < most && this.live) {
      this.tick();
      did++;
    }
    return did;
  }

  read(out: Float32Array): void {
    const { n, p } = this;
    for (let i = 0; i < n; i++) {
      out[2 * i] = p[4 * i];
      out[2 * i + 1] = p[4 * i + 1];
    }
  }

  set(change: SimChange): void {
    this.f = merge(this.f, change.forces);
    if (change.group !== undefined) this.regroup(change.group);
    else this.tune();
    const heat = clamp(change.heat, 0, 0, 1);
    if (heat > this.alpha) this.alpha = heat;
  }

  pin(i: number, x: number, y: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.n || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pinned = i;
    this.pinX = x;
    this.pinY = y;
    this.target = ALPHA_HELD;
  }

  drop(): void {
    this.pinned = -1;
    this.target = 0;
  }

  private grow(want: number): void {
    const cap = Math.max(want, this.cap * 2);
    const keep = (a: Int32Array) => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    /* A grow can come mid-cut: what the cut has written is carried over; the rest is written after it. */
    this.clo = keep(this.clo);
    this.chi = keep(this.chi);
    this.cskip = keep(this.cskip);
    this.cparent = keep(this.cparent);
    const more = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.cmx = more(this.cmx);
    this.cmy = more(this.cmy);
    this.cm = more(this.cm);
    this.cx0 = more(this.cx0);
    this.cy0 = more(this.cy0);
    this.cx1 = more(this.cx1);
    this.cy1 = more(this.cy1);
    this.cs2 = new Float64Array(cap);
    this.fx = new Float64Array(cap);
    this.fy = new Float64Array(cap);
    this.fm = new Float64Array(cap);
    this.near = new Int32Array(cap);
    this.cap = cap;
  }

  /** Which group each file is in. A group with no files in it is simply never used. */
  private regroup(group: Int32Array | null): void {
    if (group && group.length < this.n) throw new RangeError("sim: group holds fewer than n numbers");
    this.group = group;
    let groups = 0;
    if (group) for (let i = 0; i < this.n; i++) if (group[i] >= groups) groups = group[i] + 1;
    this.groups = groups;
    this.gc = new Float64Array(groups);
    this.gx = new Float64Array(groups);
    this.gy = new Float64Array(groups);
    this.gr = new Float64Array(groups);
    this.gpx = new Float64Array(groups);
    this.gpy = new Float64Array(groups);
    if (group) for (let i = 0; i < this.n; i++) if (group[i] >= 0) this.gc[group[i]]++;
    this.tune();
  }

  /** What follows from the forces: each link's length and strength, each group's disc. A link between
      two groups is longer and looser than one inside a group, by how far apart groups are asked to sit. */
  private tune(): void {
    const { m, f, group, ls, lt } = this;
    const crossLen = 1 + 1.6 * f.gap;
    const crossStr = (1 - 0.85 * f.tight) / (1 + 2.5 * f.gap);
    for (let k = 0; k < m; k++) {
      const cross = group !== null && group[ls[k]] !== group[lt[k]];
      this.llen[k] = LINK * f.link * (cross ? crossLen : 1);
      this.lstr[k] = Math.min(1, this.lbase[k] * f.pull) * (cross ? crossStr : 1);
    }
    /* A disc is the room the group's files need packed together, never the spread they have now: see gather. */
    for (let g = 0; g < this.groups; g++) this.gr[g] = 10.5 * Math.sqrt(this.gc[g] * f.repel) + 8;
  }

  private tick(): void {
    this.alpha += (this.target - this.alpha) * ALPHA_DECAY;
    this.ticks++;
    this.links();
    if (this.group !== null && this.groups > 0) this.gather();
    this.build();
    this.repel();
    const { n, p, pinned } = this;
    for (let i = 0; i < 4 * n; i += 4) {
      const vx = p[i + 2] * VEL_KEEP;
      const vy = p[i + 3] * VEL_KEEP;
      p[i + 2] = vx;
      p[i + 3] = vy;
      p[i] += vx;
      p[i + 1] += vy;
    }
    if (pinned >= 0) {
      p[4 * pinned] = this.pinX;
      p[4 * pinned + 1] = this.pinY;
      p[4 * pinned + 2] = 0;
      p[4 * pinned + 3] = 0;
    }
  }

  /** Each link pulls its ends towards its resting length, looking one step ahead (x + v). */
  private links(): void {
    const { m, p, ls, lt, llen, lstr, lbias, alpha } = this;
    for (let k = 0; k < m; k++) {
      const a = 4 * ls[k];
      const b = 4 * lt[k];
      let dx = p[b] + p[b + 2] - p[a] - p[a + 2];
      let dy = p[b + 1] + p[b + 3] - p[a + 1] - p[a + 3];
      if (dx === 0 && dy === 0) {
        dx = 0.001;
        dy = 0.001;
      }
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = ((d - llen[k]) / d) * alpha * lstr[k];
      dx *= f;
      dy *= f;
      const w = lbias[k];
      p[b + 2] -= dx * w;
      p[b + 3] -= dy * w;
      p[a + 2] += dx * (1 - w);
      p[a + 3] += dy * (1 - w);
    }
  }

  /**
   * Groups: each file leans towards the middle of its group, and two groups whose discs overlap are
   * pushed apart as wholes. A disc is the room the group's files need packed together (`tune`), never
   * the spread they have now: measuring the spread fed back into itself — a grouping that cuts across
   * the links (tags) is spread wide, so its groups were pushed, so they spread wider, without end.
   */
  private gather(): void {
    const { n, p, gx, gy, gc, gr, gpx, gpy, f, alpha } = this;
    const group = this.group as Int32Array;
    const groups = this.groups;
    gx.fill(0);
    gy.fill(0);
    gpx.fill(0);
    gpy.fill(0);
    for (let i = 0; i < n; i++) {
      const g = group[i];
      if (g >= 0) {
        gx[g] += p[4 * i];
        gy[g] += p[4 * i + 1];
      }
    }
    for (let g = 0; g < groups; g++) {
      if (gc[g] > 0) {
        gx[g] /= gc[g];
        gy[g] /= gc[g];
      }
    }
    if (f.gap > 0) {
      const most = Math.min(groups, GROUPS_APART);
      const room = 1 + 0.9 * f.gap;
      const pad = LINK * 2.2 * f.gap;
      const k = 0.3 * alpha;
      for (let a = 0; a < most; a++) {
        if (gc[a] === 0) continue;
        for (let b = a + 1; b < most; b++) {
          if (gc[b] === 0) continue;
          let dx = gx[b] - gx[a];
          let dy = gy[b] - gy[a];
          const want = (gr[a] + gr[b]) * room + pad;
          const d2 = dx * dx + dy * dy;
          if (d2 >= want * want) continue;
          let d = Math.sqrt(d2);
          if (d < 0.01) {
            dx = 0.01 * (1 + a - b);
            dy = 0.01;
            d = Math.sqrt(dx * dx + dy * dy);
          }
          const push = ((want - d) / d) * k;
          const wa = gc[b] / (gc[a] + gc[b]);
          gpx[a] -= dx * push * wa;
          gpy[a] -= dy * push * wa;
          gpx[b] += dx * push * (1 - wa);
          gpy[b] += dy * push * (1 - wa);
        }
      }
    }
    const lean = (0.1 * f.tight + 0.5 * f.tight * f.tight) * alpha;
    for (let i = 0; i < n; i++) {
      const g = group[i];
      if (g >= 0) {
        p[4 * i + 2] += (gx[g] - p[4 * i]) * lean + gpx[g];
        p[4 * i + 3] += (gy[g] - p[4 * i + 1]) * lean + gpy[g];
      }
    }
  }

  /** Sort the files along the curve, copy them in that order, and cut the tree out of the run. */
  private build(): void {
    const { n, p, str, count } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = p[4 * i];
      const b = p[4 * i + 1];
      if (a < x0) x0 = a;
      if (a > x1) x1 = a;
      if (b < y0) y0 = b;
      if (b > y1) y1 = b;
    }
    /* A hair over the spread, so the farthest file still quantises inside the box. */
    const rs = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
    const scale = SIDE / rs;

    /* Keys in the order the last tick sorted to, so the sort is stable against it and nearly sorted. */
    let ka = this.ka;
    let kb = this.kb;
    let ia = this.order;
    let ib = this.spare;
    for (let j = 0; j < n; j++) {
      const i = ia[j];
      ka[j] = spread(((p[4 * i] - x0) * scale) | 0) | (spread(((p[4 * i + 1] - y0) * scale) | 0) << 1);
    }
    /* A stable radix sort, three passes of ten bits over the 30-bit key, between A and B. */
    for (let shift = 0; shift < 2 * LEVELS; shift += 10) {
      count.fill(0);
      for (let j = 0; j < n; j++) count[(ka[j] >> shift) & 1023]++;
      let sum = 0;
      for (let d = 0; d < 1024; d++) {
        const c = count[d];
        count[d] = sum;
        sum += c;
      }
      for (let j = 0; j < n; j++) {
        const k = ka[j];
        const at = count[(k >> shift) & 1023]++;
        kb[at] = k;
        ib[at] = ia[j];
      }
      const tk = ka;
      ka = kb;
      kb = tk;
      const ti = ia;
      ia = ib;
      ib = ti;
    }
    this.ka = ka;
    this.kb = kb;
    this.order = ia;
    this.spare = ib;
    const keys = ka;
    const sorted = ia;

    const { sx, sy, sw, pw, px, py } = this;
    let w = 0;
    let mx = 0;
    let my = 0;
    for (let j = 0; j < n; j++) {
      const i = sorted[j];
      const s = str[i];
      const a = p[4 * i];
      const b = p[4 * i + 1];
      sx[j] = a;
      sy[j] = b;
      sw[j] = s;
      /* Moments about the box's corner, so the sums stay small and the subtraction exact enough. */
      w += s;
      mx += s * (a - x0);
      my += s * (b - y0);
      pw[j + 1] = w;
      px[j + 1] = mx;
      py[j + 1] = my;
    }

    /* Cut the run into cells, depth first: a cell's children are pushed last quadrant first, so the
       first is popped next and a cell's number is its place in the walk. */
    const { qlo, qhi, qd, qp } = this;
    let cells = 0;
    let sp = 0;
    if (n > 0) {
      qlo[0] = 0;
      qhi[0] = n;
      qd[0] = 0;
      qp[0] = -1;
      sp = 1;
    }
    while (sp > 0) {
      sp--;
      const lo = qlo[sp];
      const hi = qhi[sp];
      const depth = qd[sp];
      if (cells === this.cap) this.grow(this.cap * 2);
      const c = cells++;
      const mass = pw[hi] - pw[lo];
      this.clo[c] = lo;
      this.chi[c] = hi;
      this.cparent[c] = qp[sp];
      this.cskip[c] = 1;
      this.cm[c] = mass;
      this.cmx[c] = (px[hi] - px[lo]) / mass + x0;
      this.cmy[c] = (py[hi] - py[lo]) / mass + y0;
      /* A leaf: few enough files, as deep as the key goes, or every file in it on one key. */
      if (hi - lo <= LEAF || depth === LEVELS || keys[lo] === keys[hi - 1]) {
        let a0 = sx[lo];
        let a1 = a0;
        let b0 = sy[lo];
        let b1 = b0;
        for (let k = lo + 1; k < hi; k++) {
          const a = sx[k];
          const b = sy[k];
          if (a < a0) a0 = a;
          else if (a > a1) a1 = a;
          if (b < b0) b0 = b;
          else if (b > b1) b1 = b;
        }
        this.cx0[c] = a0;
        this.cy0[c] = b0;
        this.cx1[c] = a1;
        this.cy1[c] = b1;
        continue;
      }
      this.cx0[c] = Infinity;
      this.cy0[c] = Infinity;
      this.cx1[c] = -Infinity;
      this.cy1[c] = -Infinity;
      /* The run's quadrants at this depth are contiguous: find where each begins, push the last first. */
      const bit = 2 * (LEVELS - 1 - depth);
      let end = hi;
      for (let q = 3; q >= 0; q--) {
        let a = lo;
        if (q > 0) {
          let b = end;
          while (a < b) {
            const mid = (a + b) >> 1;
            if (((keys[mid] >> bit) & 3) >= q) b = mid;
            else a = mid + 1;
          }
        }
        if (a < end) {
          qlo[sp] = a;
          qhi[sp] = end;
          qd[sp] = depth + 1;
          qp[sp] = c;
          sp++;
        }
        end = a;
      }
    }
    /* Children have higher numbers than their parent: walking down the numbers meets every child
       first, so each cell's box and subtree size are whole when its parent takes them in. */
    const { cskip, cparent, cx0, cy0, cx1, cy1, cs2 } = this;
    for (let c = cells - 1; c > 0; c--) {
      const p = cparent[c];
      cskip[p] += cskip[c];
      if (cx0[c] < cx0[p]) cx0[p] = cx0[c];
      if (cy0[c] < cy0[p]) cy0[p] = cy0[c];
      if (cx1[c] > cx1[p]) cx1[p] = cx1[c];
      if (cy1[c] > cy1[p]) cy1[p] = cy1[c];
    }
    for (let c = 0; c < cells; c++) {
      cskip[c] += c;
      const w = cx1[c] - cx0[c];
      const h = cy1[c] - cy0[c];
      cs2[c] = w > h ? w * w : h * h;
    }
    this.cells = cells;
  }

  /**
   * Repulsion by Barnes–Hut, and the pull to the centre. The tree is walked once per leaf, not once
   * per file: a cell is one body for the whole leaf when it is far enough from the leaf's nearest
   * edge, a leaf near the leaf is kept, and a cell whose box is beyond the cut-off from the leaf's
   * is dropped with everything under it. Then each file of the leaf takes the lists: the far bodies,
   * and each near leaf as one body if it is far enough from that file, else file by file.
   *
   * A cell's size in the opening test is the box tight around its files, not its quadrant: in the
   * sparse edge of a layout a quadrant is mostly empty, and its files are as good as one body sooner.
   */
  private repel(): void {
    const { p, sx, sy, sw, cells, clo, chi, cskip, cmx, cmy, cm, cs2, cx0, cy0, cx1, cy1, order } = this;
    const { fx, fy, fm, near } = this;
    const push = this.alpha * this.f.repel;
    const centre = GRAVITY * this.f.centre * this.alpha;
    const theta2 = this.alpha > THETA_SWITCH ? THETA2_HOT : THETA2_COLD;
    for (let l = 0; l < cells; l++) {
      if (cskip[l] !== l + 1) continue;
      const lo = clo[l];
      const hi = chi[l];
      const bx0 = cx0[l];
      const by0 = cy0[l];
      const bx1 = cx1[l];
      const by1 = cy1[l];
      let nf = 0;
      let nn = 0;
      let c = 0;
      while (c < cells) {
        const skip = cskip[c];
        const mx = cmx[c];
        const my = cmy[c];
        /* From the cell's centre of mass to the nearest point of the leaf's box. */
        const ex = mx < bx0 ? bx0 - mx : mx > bx1 ? mx - bx1 : 0;
        const ey = my < by0 ? by0 - my : my > by1 ? my - by1 : 0;
        const e2 = ex * ex + ey * ey;
        if (cs2[c] < theta2 * e2 && e2 >= DMIN2) {
          fx[nf] = mx;
          fy[nf] = my;
          fm[nf] = cm[c];
          nf++;
          c = skip;
          continue;
        }
        /* From box to box: every file under the cell is beyond the cut-off from every file of the leaf. */
        const gx = cx0[c] > bx1 ? cx0[c] - bx1 : bx0 > cx1[c] ? bx0 - cx1[c] : 0;
        const gy = cy0[c] > by1 ? cy0[c] - by1 : by0 > cy1[c] ? by0 - cy1[c] : 0;
        if (gx * gx + gy * gy >= DMAX2) {
          c = skip;
          continue;
        }
        if (skip === c + 1) near[nn++] = c;
        c++;
      }
      for (let j = lo; j < hi; j++) {
        const xi = sx[j];
        const yi = sy[j];
        let ax = 0;
        let ay = 0;
        for (let q = 0; q < nf; q++) {
          const dx = fx[q] - xi;
          const dy = fy[q] - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 < DMAX2) {
            const k = fm[q] / d2;
            ax += dx * k;
            ay += dy * k;
          }
        }
        for (let q = 0; q < nn; q++) {
          const leaf = near[q];
          if (leaf !== l) {
            /* Far enough from this file, if not from every file of the leaf: one body. */
            const dx = cmx[leaf] - xi;
            const dy = cmy[leaf] - yi;
            const d2 = dx * dx + dy * dy;
            if (cs2[leaf] < theta2 * d2 && d2 >= DMIN2) {
              if (d2 < DMAX2) {
                const k = cm[leaf] / d2;
                ax += dx * k;
                ay += dy * k;
              }
              continue;
            }
          }
          for (let k = clo[leaf], end = chi[leaf]; k < end; k++) {
            if (k === j) continue;
            let dx = sx[k] - xi;
            let dy = sy[k] - yi;
            let d2 = dx * dx + dy * dy;
            if (d2 >= DMAX2) continue;
            if (d2 < 1e-9) {
              /* Two files in the same place: part them, one each way, along a direction of their own
                 taken from the pair. One shared direction (the prototype's) lined every file of a
                 pile up on it, each pushed by every other the same way: 1,000 files in one place
                 flew 29,000 apart. Pairs pushing every which way mostly cancel. */
              const turn = ((j < k ? j : k) * 7 + (j < k ? k : j)) * GOLDEN;
              const way = j < k ? 1 : -1;
              dx = way * Math.cos(turn);
              dy = way * Math.sin(turn);
              d2 = DMIN2;
            }
            if (d2 < DMIN2) d2 = Math.sqrt(DMIN2 * d2);
            const f = sw[k] / d2;
            ax += dx * f;
            ay += dy * f;
          }
        }
        const i = 4 * order[j];
        p[i + 2] -= ax * push + p[i] * centre;
        p[i + 3] -= ay * push + p[i + 1] * centre;
      }
    }
  }
}

/** A simulation of `graph`, hot unless `graph.alpha` says otherwise. */
export function createSim(graph: SimGraph): Sim {
  return new ForceSim(graph);
}
