import { CODES } from "../codes";
import { emptyGraph, HUE_ORDER, type Graph, type Node } from "../ir";

/**
 * `gitgraph` — branches and what landed on them, in Mermaid's verbs.
 *
 *     commit "init"
 *     branch feature
 *     commit "parse"
 *     checkout main
 *     merge feature "v0.2"
 *
 * The state is a HEAD and a set of branch tips, exactly as in git, so the parser reads like the
 * commands it mirrors. A commit is a node, a parent link is an edge, and the branch decides the
 * hue — which means a merge is visibly two hues joining rather than another line.
 */
export interface GitMeta {
  /** Branch name → the lane it is drawn in, in the order branches first appear. */
  lanes: string[];
  branchOf: Record<string, string>;
  /** Commit order along the x axis. */
  column: Record<string, number>;
  /** Branch name → the commit at its tip once the whole body has run; absent for a branch with none. */
  tips: Record<string, string | undefined>;
  /** The branch HEAD is on at the end of the body: where a bare `commit` appended would land. */
  head: string;
  /** 1-based line → the branch HEAD is on once that line has run. Blank and comment lines too. */
  headAfter: Record<number, string>;
  /** Commit → every `tag` line that tagged it, in file order. The last one is what is drawn. */
  tagLines: Record<string, number[]>;
}

const META = new WeakMap<Graph, GitMeta>();
export const gitMetaOf = (graph: Graph): GitMeta =>
  META.get(graph) ?? { lanes: [], branchOf: {}, column: {}, tips: {}, head: "main", headAfter: {}, tagLines: {} };

export function parseGitgraph(src: string): Graph {
  const graph = emptyGraph("gitgraph" as Graph["type"], "LR");
  const lanes: string[] = ["main"];
  const branchOf: Record<string, string> = {};
  const column: Record<string, number> = {};
  const tip: Record<string, string | undefined> = { main: undefined };
  const headAfter: Record<number, string> = {};
  const tagLines: Record<string, number[]> = {};

  let head = "main";
  let col = 0;
  let seq = 0;

  const commit = (label: string, line: number, parents: string[], tag?: string): void => {
    const id = `c${seq++}`;
    const node: Node = {
      id,
      kind: "commit",
      title: label,
      meta: tag,
      rows: [],
      hue: undefined,
      line,
    };
    graph.nodes.push(node);
    branchOf[id] = head;
    column[id] = col++;
    for (const p of parents) {
      if (!p) continue;
      graph.edges.push({
        id: `e${seq++}`,
        from: { node: p },
        to: { node: id },
        dash: false,
        quiet: false,
        head: "none",
        tail: "none",
        line,
      });
    }
    tip[head] = id;
  };

  src.split("\n").forEach((raw, i) => {
    run(raw, i);
    headAfter[i + 1] = head;
  });

  function run(raw: string, i: number): void {
    const line = raw.trim();
    if (!line || /^(%%|\/\/)/.test(line)) return;
    const label = /"([^"]*)"/.exec(line)?.[1];
    const [verb, arg] = line
      .replace(/"[^"]*"/g, "")
      .trim()
      .split(/\s+/);

    switch (verb) {
      case "commit":
        commit(label ?? "", i + 1, [tip[head] ?? ""]);
        return;

      case "branch": {
        if (!arg) {
          graph.diagnostics.push({ line: i + 1, code: CODES.E_EXPECTED_ID, message: "`branch` needs a name", severity: "error" });
          return;
        }
        if (!lanes.includes(arg)) lanes.push(arg);
        tip[arg] = tip[head];
        head = arg;
        return;
      }

      case "checkout":
      case "switch": {
        if (!arg || !lanes.includes(arg)) {
          graph.diagnostics.push({
            line: i + 1,
            code: CODES.E_NO_BRANCH,
            message: `no branch \`${arg ?? ""}\``,
            severity: "error",
          });
          return;
        }
        head = arg;
        return;
      }

      case "merge": {
        if (!arg || !lanes.includes(arg)) {
          graph.diagnostics.push({
            line: i + 1,
            code: CODES.E_NO_BRANCH,
            message: `no branch \`${arg ?? ""}\` to merge`,
            severity: "error",
          });
          return;
        }
        /* A merge commit lands on the branch you are on and has two parents — that second edge is
           the whole point of drawing a git graph. */
        commit(label ?? `merge ${arg}`, i + 1, [tip[head] ?? "", tip[arg] ?? ""], label ? undefined : undefined);
        return;
      }

      case "tag": {
        const at = tip[head];
        const node = graph.nodes.find((n) => n.id === at);
        if (node) {
          node.meta = label ?? arg;
          (tagLines[node.id] ??= []).push(i + 1);
        }
        return;
      }

      default:
        graph.diagnostics.push({
          line: i + 1,
          code: CODES.E_UNKNOWN_COMMAND,
          message: `unknown command \`${verb}\``,
          severity: "error",
        });
    }
  }

  const hueOfLane = new Map(lanes.map((name, i) => [name, HUE_ORDER[i % HUE_ORDER.length]!]));

  /* A branch *is* a lane, so it is declared as one and the band renderer names it in the margin —
     one component draws a swimlane and a branch line. */
  for (const name of lanes) {
    graph.lanes.push({ id: name, label: name, hue: hueOfLane.get(name), line: 1 });
  }
  for (const n of graph.nodes) n.hue = hueOfLane.get(branchOf[n.id] ?? "main");
  for (const e of graph.edges) e.hue = graph.nodes.find((n) => n.id === e.to.node)?.hue;

  META.set(graph, { lanes, branchOf, column, tips: { ...tip }, head, headAfter, tagLines });
  return graph;
}

/* ------------------------------------------------------------------------------- writers */

/*
 * Building a git graph with the pointer: a commit on a branch, a branch off a commit, a merge, a
 * rename, a tag and a reorder.
 *
 * The statements of a gitgraph are *commands* run in order against a HEAD, so none of these can be
 * written as "the line for this thing" the way a card's declaration can. Each one asks where HEAD
 * is at the point it writes — `headAfter` — and writes the `checkout` it needs, and puts HEAD back
 * where the next statement expects it whenever it writes into the middle of the history. A write
 * that would change what some *other* commit descends from is refused (`null`) rather than made:
 * that is a different history, not the same one with something added to it.
 *
 * Text over text, one span in and one span out, so everything the author wrote around it — the
 * comments, the spacing, a `switch` where `checkout` would do — comes through untouched.
 */

/** What a writer that makes a commit hands back: the new body, and the commit it made. */
export interface GitMade {
  body: string;
  /** The parser's id for the commit the write made (or moved), so the caller can pick it. */
  id: string;
}

/** What a branch name may be: what git takes, near enough, and what the parser reads as one word. */
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

/** The verbs whose one argument is a branch name. */
const NAMES_A_BRANCH = new Set(["branch", "checkout", "switch", "merge"]);

const NEW_COMMIT = 'commit "New commit"';

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0]!;

/**
 * The bare words of a line, outside its strings, with where each one is.
 *
 * The parser blanks the quoted text out and splits on space, so `merge "v2" feature` and
 * `merge feature "v2"` both name `feature`; this reads the same words in the same order and
 * keeps their offsets so a rename can replace exactly one of them.
 */
function wordsOf(line: string): { value: string; from: number; to: number }[] {
  const out: { value: string; from: number; to: number }[] = [];
  const re = /"[^"]*"|[^\s"]+/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (!m[0].startsWith('"')) out.push({ value: m[0], from: m.index, to: m.index + m[0].length });
  }
  return out;
}

const isStatement = (line: string): boolean => {
  const t = line.trim();
  return t !== "" && !/^(%%|\/\/)/.test(t);
};

/** The body with lines appended, at the indent the last statement is written at. */
function append(body: string, add: string[]): string {
  const trimmed = body.replace(/\s+$/, "");
  const last = trimmed.split("\n").filter(isStatement).pop() ?? "";
  const lines = add.map((l) => indentOf(last) + l);
  return trimmed === "" ? lines.join("\n") : `${trimmed}\n${lines.join("\n")}`;
}

/** The last commit a body makes — what an append just wrote. */
const lastCommit = (body: string): string | undefined => parseGitgraph(body).nodes.at(-1)?.id;

/** The branch a commit is drawn on. */
export const gitBranchName = (graph: Graph, commit: string): string => gitMetaOf(graph).branchOf[commit] ?? "main";

/** A branch name nothing in the graph uses yet: `feature`, then `feature2`, `feature3`… */
export function freshBranch(lanes: readonly string[]): string {
  if (!lanes.includes("feature")) return "feature";
  for (let n = 2; ; n++) if (!lanes.includes(`feature${n}`)) return `feature${n}`;
}

/**
 * A new commit at the tip of `branch` — the `+` at the end of its lane.
 *
 * Appended, because the tip is the end of that branch's history and the end of the body is the one
 * place a statement cannot change what any other commit descends from. A `checkout` goes in front
 * of it when HEAD is somewhere else at the end, which is the line a person would have to remember
 * to type.
 */
export function gitCommit(body: string, branch: string): GitMade | null {
  const meta = gitMetaOf(parseGitgraph(body));
  if (!meta.lanes.includes(branch)) return null;
  const next = append(body, meta.head === branch ? [NEW_COMMIT] : [`checkout ${branch}`, NEW_COMMIT]);
  const id = lastCommit(next);
  return id ? { body: next, id } : null;
}

/**
 * A new branch, with one commit on it so it is drawn as a lane that goes somewhere.
 *
 * From `from` when a commit is picked, from the tip of the current branch when not. Starting at a
 * commit in the middle of the history means writing straight after it — the one point at which
 * HEAD's tip *is* that commit — and then putting HEAD back on the branch it was on, so the
 * statements below still land where they did. The `checkout` back is left out when the next
 * statement chooses a branch for itself, or there is none.
 */
export function gitBranch(body: string, from: string | null): (GitMade & { branch: string }) | null {
  const graph = parseGitgraph(body);
  const meta = gitMetaOf(graph);
  const branch = freshBranch(meta.lanes);

  if (from === null) {
    const next = append(body, [`branch ${branch}`, NEW_COMMIT]);
    const id = lastCommit(next);
    return id ? { body: next, id, branch } : null;
  }

  const node = graph.nodes.find((n) => n.id === from);
  if (!node) return null;
  /* After the commit, and after any tag on it: a `tag` reads HEAD's tip, which the new branch's
     commit would otherwise be. */
  const at = Math.max(node.line, ...(meta.tagLines[from] ?? []));
  const lines = body.split("\n");
  const was = meta.headAfter[at] ?? "main";
  const following = lines.slice(at).find(isStatement);
  const chooses = following === undefined || ["checkout", "switch"].includes(wordsOf(following)[0]?.value ?? "");
  const indent = indentOf(lines[node.line - 1] ?? "");
  const add = [`branch ${branch}`, NEW_COMMIT, ...(chooses ? [] : [`checkout ${was}`])].map((l) => indent + l);
  const next = [...lines.slice(0, at), ...add, ...lines.slice(at)].join("\n");
  const made = parseGitgraph(next).nodes.find((n) => n.line === at + 2);
  return made ? { body: next, id: made.id, branch } : null;
}

/** Every commit `id` descends from, itself included. */
function ancestry(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const at = stack.pop()!;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const e of graph.edges) if (e.to.node === at) stack.push(e.from.node);
  }
  return seen;
}

/**
 * `source` merged into `into` — a branch's tip dropped on another lane.
 *
 * Appended, with the `checkout` it needs: a merge lands on the branch HEAD is on, and at the end
 * of the body is the only place where "the tip of `source`" means the tip the person can see.
 * Refused when there is nothing to merge — the same branch, a branch with no commit, or one whose
 * tip `into` already holds, which git would answer "Already up to date" and draw as nothing.
 */
export function gitMerge(body: string, source: string, into: string): GitMade | null {
  const graph = parseGitgraph(body);
  const meta = gitMetaOf(graph);
  if (source === into || !meta.lanes.includes(source) || !meta.lanes.includes(into)) return null;
  const tip = meta.tips[source];
  if (!tip) return null;
  const target = meta.tips[into];
  if (target && ancestry(graph, target).has(tip)) return null;
  const next = append(body, meta.head === into ? [`merge ${source}`] : [`checkout ${into}`, `merge ${source}`]);
  const id = lastCommit(next);
  return id ? { body: next, id } : null;
}

/**
 * A branch renamed everywhere it is named: its `branch`, every `checkout` and `switch` to it, and
 * every `merge` of it.
 *
 * `null` for `main`, which no statement declares — the parser starts on it — so there is no line
 * to rename; for a name that is not one word, and for one another branch already has, which would
 * fold two lanes into one.
 */
export function gitRenameBranch(body: string, from: string, to: string): string | null {
  const want = to.trim();
  const meta = gitMetaOf(parseGitgraph(body));
  if (want === from) return body;
  if (from === "main" || !meta.lanes.includes(from) || !BRANCH_NAME.test(want) || meta.lanes.includes(want)) return null;
  return body
    .split("\n")
    .map((line) => {
      if (!isStatement(line)) return line;
      const [verb, arg] = wordsOf(line);
      if (!verb || !arg || !NAMES_A_BRANCH.has(verb.value) || arg.value !== from) return line;
      return line.slice(0, arg.from) + want + line.slice(arg.to);
    })
    .join("\n");
}

/**
 * A commit's tag, set, changed or taken off.
 *
 * A `tag` statement tags whatever HEAD's tip is where it is written, so a new one goes straight
 * after the commit, where the tip is that commit. An existing one is rewritten in place; when the
 * author tagged the same commit twice, the one that is drawn — the last — is kept and the others go,
 * because a panel that shows one tag cannot honestly leave a second one standing behind it.
 */
export function gitSetTag(body: string, commit: string, tag: string | null): string | null {
  const graph = parseGitgraph(body);
  const node = graph.nodes.find((n) => n.id === commit);
  if (!node) return null;
  const text = tag?.replace(/"/g, "'").trim() || null;
  const lines = body.split("\n");
  const tagged = gitMetaOf(graph).tagLines[commit] ?? [];
  const last = tagged.at(-1);

  if (last === undefined) {
    if (text === null) return body;
    const add = `${indentOf(lines[node.line - 1] ?? "")}tag ${JSON.stringify(text)}`;
    return [...lines.slice(0, node.line), add, ...lines.slice(node.line)].join("\n");
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i + 1 === last && text !== null) out.push(`${indentOf(line)}tag ${JSON.stringify(text)}`);
    else if (!tagged.includes(i + 1)) out.push(line);
  });
  return out.join("\n");
}

/**
 * A commit moved one place earlier (`-1`) or later (`1`) along its own branch.
 *
 * Only where the history allows it, which is narrower than "anywhere on the lane": the two
 * commits must follow each other directly on one branch, both be plain commits, and the earlier
 * must have no other child — no branch started from it, no merge that took it. Anywhere else a
 * swap changes what some other commit descends from. What is swapped is the two statements' text,
 * which in a gitgraph is the whole of a commit, and their tags travel with them.
 */
export function gitMove(body: string, commit: string, dir: -1 | 1): GitMade | null {
  const graph = parseGitgraph(body);
  const meta = gitMetaOf(graph);
  const parents = (id: string) => graph.edges.filter((e) => e.to.node === id).map((e) => e.from.node);
  const children = (id: string) => graph.edges.filter((e) => e.from.node === id).map((e) => e.to.node);

  const pair = dir === -1 ? [parents(commit), [commit]] : [[commit], children(commit)];
  const [a, b] = [pair[0]!.length === 1 ? pair[0]![0]! : null, pair[1]!.length === 1 ? pair[1]![0]! : null];
  if (!a || !b) return null;
  if (parents(b).length !== 1 || children(a).length !== 1 || parents(a).length > 1) return null;
  if (meta.branchOf[a] !== meta.branchOf[b]) return null;

  const na = graph.nodes.find((n) => n.id === a);
  const nb = graph.nodes.find((n) => n.id === b);
  if (!na || !nb) return null;
  const lines = body.split("\n");
  const la = lines[na.line - 1] ?? "";
  const lb = lines[nb.line - 1] ?? "";
  if (wordsOf(la)[0]?.value !== "commit" || wordsOf(lb)[0]?.value !== "commit") return null;

  lines[na.line - 1] = indentOf(la) + lb.trimStart();
  lines[nb.line - 1] = indentOf(lb) + la.trimStart();
  /* The ids are positional and a swap changes no count, so `a` and `b` still name the two places. */
  let next = lines.join("\n");
  next = gitSetTag(next, a, nb.meta ?? null) ?? next;
  next = gitSetTag(next, b, na.meta ?? null) ?? next;
  return { body: next, id: dir === -1 ? a : b };
}
