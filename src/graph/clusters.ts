/**
 * The clusters the links themselves make, for the graph view's "group by linked clusters" (#458).
 *
 * Label propagation in a fixed order: every file starts with a label of its own, and in each pass
 * every linked file takes the label most of its neighbours hold. Files are visited from the least
 * linked to the most linked, so the hubs decide last, and ties go to the label a file already holds,
 * then to the first neighbour in adjacency order that reached the top count. There is no randomness,
 * so the same links always give the same clusters. In the first pass a neighbour's vote is weighted
 * by its degree, so the first labels to spread are the hubs'.
 *
 * If this clusters real vaults badly, one level of Louvain may replace it behind the same function.
 */

/** Passes before it stops whether or not the labels have settled. */
const PASSES = 12;

/** Links as compressed rows: file i's neighbours are `near[start[i]]` up to `near[start[i + 1]]`. */
export interface Adjacency {
  start: Int32Array;
  near: Int32Array;
}

/** The compressed rows of `n` files joined by links `src[k]`–`dst[k]`, each link both ways, in link order. */
export function adjacency(n: number, src: Int32Array, dst: Int32Array): Adjacency {
  const start = new Int32Array(n + 1);
  const m = src.length;
  for (let k = 0; k < m; k++) {
    start[src[k] + 1]++;
    start[dst[k] + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const near = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  for (let k = 0; k < m; k++) {
    near[fill[src[k]]++] = dst[k];
    near[fill[dst[k]]++] = src[k];
  }
  return { start, near };
}

/**
 * One cluster per file, -1 for a file with no links, numbered from the biggest cluster down
 * (ties by the lowest file in the cluster). This is the `group` the simulation takes.
 */
export function clusters({ start, near }: Adjacency): Int32Array {
  const n = start.length - 1;
  const deg = new Int32Array(n);
  for (let i = 0; i < n; i++) deg[i] = start[i + 1] - start[i];
  /* Most linked first, ties by number; walked backwards, so the least linked go first. */
  const byDeg = new Int32Array(n);
  for (let i = 0; i < n; i++) byDeg[i] = i;
  byDeg.sort((a, b) => deg[b] - deg[a] || a - b);

  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) label[i] = i;
  /* Votes per label, cleared after each file through the labels it touched. */
  const votes = new Float64Array(n);
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = 0;
    for (let o = n - 1; o >= 0; o--) {
      const i = byDeg[o];
      const from = start[i];
      const to = start[i + 1];
      if (from === to) continue;
      let best = label[i];
      let top = 0;
      for (let k = from; k < to; k++) {
        const j = near[k];
        const l = label[j];
        const w = votes[l] + 1 + (pass === 0 ? deg[j] : 0);
        votes[l] = w;
        if (w > top || (w === top && l === label[i])) {
          top = w;
          best = l;
        }
      }
      for (let k = from; k < to; k++) votes[label[near[k]]] = 0;
      if (best !== label[i]) {
        label[i] = best;
        moved++;
      }
    }
    if (moved === 0) break;
  }

  const raw = new Int32Array(n);
  for (let i = 0; i < n; i++) raw[i] = start[i + 1] > start[i] ? label[i] : -1;
  return numbered(raw);
}

/**
 * Renumber groups from the biggest down, ties by the lower old number, keeping -1 (no group) as it is.
 * The simulation pushes apart only the biggest groups, and reads them in this order.
 */
export function numbered(raw: Int32Array): Int32Array {
  const n = raw.length;
  let top = -1;
  for (let i = 0; i < n; i++) if (raw[i] > top) top = raw[i];
  const size = new Int32Array(top + 1);
  for (let i = 0; i < n; i++) if (raw[i] >= 0) size[raw[i]]++;
  const used: number[] = [];
  for (let v = 0; v <= top; v++) if (size[v] > 0) used.push(v);
  used.sort((a, b) => size[b] - size[a] || a - b);
  const id = new Int32Array(top + 1).fill(-1);
  for (let g = 0; g < used.length; g++) id[used[g]] = g;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i] < 0 ? -1 : id[raw[i]];
  return out;
}
