/**
 * The graph view's simulation, measured (#458): the `graph` group of `node scripts/bench.mjs`.
 *
 * Kept apart from `bench.mjs` because it needs no server and no browser — it imports the simulation's
 * source and runs it in this process — and because the tests make their graphs with the same
 * generator, so a test and the bench speak of the same vault.
 *
 * The vault is the one the design session's prototype made up (#262): folders of different sizes, a
 * map note in each, links that prefer what is already linked, a few links between folders, and one
 * file in eight with no link at all — about 1.3 links per file. It is seeded, so two runs make the
 * same links, and it draws its random numbers in the prototype's order, so a size here is the same
 * graph the prototype measured.
 */
import { clusters, adjacency } from "../src/graph/clusters.ts";
import { createHost } from "../src/graph/host.ts";
import { createSim } from "../src/graph/sim.ts";

/** A small fast seeded generator (mulberry32): the same seed, the same numbers. */
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The prototype's kinds, by share; only their shares matter here, for the order of random numbers. */
const KIND_SHARES = [0.76, 0.07, 0.06, 0.02, 0.03, 0.03, 0.03];
const TAGS = 14;
const TASK = 2;

/**
 * A made-up vault of `n` files: `{ n, src, dst, folder, tag }`. `folder[i]` is -1 for a file at the
 * top; `tag[i]` is the file's first tag or -1, a grouping that cuts across the links.
 */
export function graphVault(n, seed = 1) {
  const rnd = mulberry32(seed);
  const folders = Math.max(4, Math.round(Math.sqrt(n) / 2.2));
  const weights = Array.from({ length: folders }, (_, c) => 1 / (c + 1) ** 0.75);
  const total = weights.reduce((a, b) => a + b, 0);
  const lonely = Math.round(n * 0.12);
  const linked = n - lonely;
  const folder = new Int32Array(n);
  const src = [];
  const dst = [];
  const seen = new Set();
  const link = (a, b) => {
    if (a === b) return;
    const k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) return;
    seen.add(k);
    src.push(a);
    dst.push(b);
  };
  const everyEnd = [];
  let at = 0;
  for (let c = 0; c < folders; c++) {
    const size = c === folders - 1 ? linked - at : Math.max(2, Math.round((linked * weights[c]) / total));
    const first = at;
    const ends = [];
    for (let k = 0; k < size && at < linked; k++, at++) {
      folder[at] = c;
      if (k === 0) continue;
      rnd(); /* the prototype's title */
      rnd();
      const links = 1 + (rnd() < 0.42 ? 1 : 0) + (rnd() < 0.12 ? 1 : 0);
      for (let l = 0; l < links; l++) {
        const to = ends.length && rnd() < 0.82 ? ends[(rnd() * ends.length) | 0] : first;
        link(at, to);
        ends.push(at, to);
        everyEnd.push(at, to);
      }
      if (rnd() < 0.05 && everyEnd.length) link(at, everyEnd[(rnd() * everyEnd.length) | 0]);
    }
  }
  for (; at < n; at++) {
    folder[at] = -1;
    rnd(); /* the prototype's title */
    rnd();
    if (rnd() < 0.18 && at > linked) link(at, at - 1);
  }
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let r = rnd();
    let k = 0;
    while (k < KIND_SHARES.length - 1 && r > KIND_SHARES[k]) r -= KIND_SHARES[k++];
    kind[i] = k;
  }
  const tag = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const c = folder[i];
    const list = [];
    if (c >= 0 && rnd() < 0.5) list.push((c * 3 + (rnd() < 0.7 ? 0 : 1)) % TAGS);
    if (rnd() < 0.16) {
      const t = (rnd() * TAGS) | 0;
      if (!list.includes(t)) list.push(t);
    }
    if (list.length) tag[i] = list[0];
    if (kind[i] === TASK) rnd(); /* the prototype's status */
  }
  return { n, src: Int32Array.from(src), dst: Int32Array.from(dst), folder, tag };
}

/** A dense vault: `graphVault(n)` with links added inside folders (one in ten across) up to `m`. */
export function denseVault(n, m, seed = 1) {
  const v = graphVault(n, seed);
  const rnd = mulberry32(seed + 1);
  const seen = new Set();
  const src = Array.from(v.src);
  const dst = Array.from(v.dst);
  for (let k = 0; k < src.length; k++) seen.add(Math.min(src[k], dst[k]) * n + Math.max(src[k], dst[k]));
  const byFolder = new Map();
  for (let i = 0; i < n; i++) if (v.folder[i] >= 0) byFolder.set(v.folder[i], [...(byFolder.get(v.folder[i]) ?? []), i]);
  const linked = [...byFolder.values()].flat();
  while (src.length < m) {
    const a = linked[(rnd() * linked.length) | 0];
    const pool = rnd() < 0.9 ? byFolder.get(v.folder[a]) : linked;
    const b = pool[(rnd() * pool.length) | 0];
    const key = Math.min(a, b) * n + Math.max(a, b);
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    src.push(a);
    dst.push(b);
  }
  return { ...v, src: Int32Array.from(src), dst: Int32Array.from(dst) };
}

/* Words for the files' titles and folders, the prototype's. */
const WORDS_A = [
  "Retrieval",
  "Agents",
  "Indexing",
  "Embeddings",
  "Planning",
  "Sync",
  "Layout",
  "Parsers",
  "Caching",
  "Queues",
  "Evals",
  "Prompts",
  "Routing",
  "Tokens",
  "Sharding",
  "Rerankers",
  "Memory",
  "Schemas",
  "Tracing",
  "Latency",
  "Consensus",
  "Backoff",
  "Streams",
  "Vectors",
  "Chunking",
];
const WORDS_B = [
  "overview",
  "trade-offs",
  "in practice",
  "notes",
  "checklist",
  "failure modes",
  "patterns",
  "interview",
  "design",
  "review",
  "questions",
  "glossary",
  "worked example",
  "limits",
  "history",
  "benchmarks",
];
const TAG_NAMES = [
  "idea",
  "reading",
  "draft",
  "evergreen",
  "meeting",
  "question",
  "reference",
  "paper",
  "howto",
  "decision",
  "archive",
  "person",
  "course",
  "review",
];

/**
 * `v` (a `graphVault` or `denseVault`) written as a vault of files under `dir`, for the Graph page's
 * bench and for looking at the page: a folder per folder, a map note heading each, the links as
 * `[[wikilinks]]` in the note that makes them, tags in the frontmatter, and about a quarter of the
 * files a task, an event, a project, a board, a quiz or a table by the prototype's shares. A link
 * between two files that are not notes is written in neither, so a vault has a few fewer links than
 * `v`. Seeded: the same `v` writes the same bytes. Returns the files written.
 */
export function writeGraphVault(fs, path, dir, v, seed = 1) {
  const rnd = mulberry32(seed + 7);
  const n = v.n;
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let r = rnd();
    let k = 0;
    while (k < KIND_SHARES.length - 1 && r > KIND_SHARES[k]) r -= KIND_SHARES[k++];
    kind[i] = k;
  }
  const folderName = (c) =>
    c < 0 ? "" : `${WORDS_A[c % WORDS_A.length]}${c >= WORDS_A.length ? ` ${1 + Math.floor(c / WORDS_A.length)}` : ""}`;
  const first = new Map();
  for (let i = 0; i < n; i++) if (v.folder[i] >= 0 && !first.has(v.folder[i])) first.set(v.folder[i], i);
  const title = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = v.folder[i];
    title[i] =
      first.get(c) === i
        ? `${folderName(c)} map`
        : `${WORDS_A[(Math.max(c, 0) + ((rnd() * 5) | 0)) % WORDS_A.length]} ${WORDS_B[(rnd() * WORDS_B.length) | 0]}`;
    /* A hub is a note, whatever the shares said: a map is what a folder hangs off. */
    if (first.get(c) === i) kind[i] = c % 3 === 1 ? 3 : 0;
  }
  const ext = ["md", "board.md", "md", "md", "md", "quiz.md", "table.md"];
  const isNote = (i) => kind[i] === 0 || kind[i] === 2 || kind[i] === 3 || kind[i] === 4;
  const stem = (i) => {
    const f = folderName(v.folder[i]);
    return `${f ? `${f}/` : ""}f${String(i).padStart(5, "0")}`;
  };
  const out = Array.from({ length: n }, () => []);
  for (let k = 0; k < v.src.length; k++) {
    const a = v.src[k];
    const b = v.dst[k];
    if (isNote(a)) out[a].push(b);
    else if (isNote(b)) out[b].push(a);
  }
  let made = 0;
  for (let i = 0; i < n; i++) {
    const rel = `${stem(i)}.${ext[kind[i]]}`;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tags = [];
    if (v.folder[i] >= 0 && rnd() < 0.5) tags.push(TAG_NAMES[(v.folder[i] * 3 + (rnd() < 0.7 ? 0 : 1)) % TAG_NAMES.length]);
    if (rnd() < 0.16) {
      const t = TAG_NAMES[(rnd() * TAG_NAMES.length) | 0];
      if (!tags.includes(t)) tags.push(t);
    }
    const front = [`title: ${title[i]}`];
    if (tags.length) front.push(`tags: [${tags.join(", ")}]`);
    let body;
    switch (kind[i]) {
      case 1:
        body = `\`\`\`md {#c x=0 y=0 w=360}\n### ${title[i]}\n\`\`\`\n`;
        break;
      case 5:
        body = `## What is ${title[i]}?\n\n- [x] One thing\n- [ ] Another\n`;
        break;
      case 6:
        body = "| Name | Done |\n|---|---|\n| one | yes |\n";
        break;
      default:
        if (kind[i] === 2) front.push(["status: todo", "status: in-progress", "status: done"][(rnd() * 3) | 0]);
        if (kind[i] === 3) front.push("project: active");
        if (kind[i] === 4)
          front.push(
            `start: 2026-${String(1 + ((rnd() * 12) | 0)).padStart(2, "0")}-${String(1 + ((rnd() * 28) | 0)).padStart(2, "0")}`,
          );
        body = `${title[i]}, as written down.\n\n${out[i].map((j) => `- [[${stem(j)}]]`).join("\n")}\n`;
    }
    fs.writeFileSync(abs, `---\n${front.join("\n")}\n---\n\n${body}`);
    made++;
  }
  return made;
}

/** From hot to rest, one tick at a time, timed: `{ tick, ticks, total }`, the median of `runs`. */
function timeToRest(v, runs, extra = {}) {
  const out = [];
  for (let r = 0; r < runs; r++) {
    const sim = createSim({ n: v.n, src: v.src, dst: v.dst, ...extra });
    const t0 = performance.now();
    let ticks = 0;
    while (sim.step(1)) ticks++;
    const total = performance.now() - t0;
    out.push({ tick: total / ticks, ticks, total });
  }
  out.sort((a, b) => a.total - b.total);
  return out[out.length >> 1];
}

/** From hot to rest through the host, on the real clock: what a person waits. */
function paced(v) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const host = createHost({
      createSim,
      now: () => performance.now(),
      schedule: (fn, ms) => (ms > 0 ? setTimeout(fn, ms) : setImmediate(fn)),
      post: (msg) => {
        if (msg.t === "rest") resolve(performance.now() - t0);
      },
    });
    host({ t: "init", gen: 1, n: v.n, src: v.src, dst: v.dst });
  });
}

/**
 * The group: tick time and time to rest at each size, the dense vault, and a grouped layout.
 * `record(metric, value, unit, note)` is the bench's own.
 */
export async function graphGroup(record, { quick = false } = {}) {
  const sizes = quick ? [500, 2000] : [500, 2000, 5000, 20000];
  for (const n of sizes) {
    const v = graphVault(n);
    const p = `graph.${n}`;
    const before = process.memoryUsage().arrayBuffers;
    const held = createSim({ n: v.n, src: v.src, dst: v.dst });
    held.step(1);
    record(`${p}.memory`, (process.memoryUsage().arrayBuffers - before) / 1024 / 1024, "MB", "typed arrays the simulation holds");
    const r = timeToRest(v, 3);
    record(
      `${p}.tick`,
      r.tick,
      "ms",
      `${n} files, ${v.src.length} links; mean over ${r.ticks} ticks hot to rest, median of 3 runs`,
    );
    record(`${p}.ticks`, r.ticks, "count", "hot to rest");
    record(`${p}.compute`, r.total, "ms", "every tick hot to rest, back to back");
    record(`${p}.rest`, await paced(v), "ms", "hot to rest through the host, paced by the clock at 240 ticks a second");
  }
  const dense = denseVault(5000, 150_000);
  const d = timeToRest(dense, quick ? 1 : 3);
  record("graph.dense.tick", d.tick, "ms", `5000 files, ${dense.src.length} links; mean over ${d.ticks} ticks`);
  record("graph.dense.rest", await paced(dense), "ms", "hot to rest through the host");

  const n = quick ? 2000 : 5000;
  const v = graphVault(n);
  const t0 = performance.now();
  const group = clusters(adjacency(n, v.src, v.dst));
  record(`graph.${n}.clusters`, performance.now() - t0, "ms", "label propagation over the links");
  const g = timeToRest(v, 1, { group, forces: { tight: 0.5, gap: 0.3 } });
  record(`graph.${n}.grouped.tick`, g.tick, "ms", "grouped by linked clusters, tightness 0.5, space between groups 0.3");
}
