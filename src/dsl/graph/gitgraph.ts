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
}

const META = new WeakMap<Graph, GitMeta>();
export const gitMetaOf = (graph: Graph): GitMeta =>
  META.get(graph) ?? { lanes: [], branchOf: {}, column: {} };

export function parseGitgraph(src: string): Graph {
  const graph = emptyGraph("gitgraph" as Graph["type"], "LR");
  const lanes: string[] = ["main"];
  const branchOf: Record<string, string> = {};
  const column: Record<string, number> = {};
  const tip: Record<string, string | undefined> = { main: undefined };

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
    const line = raw.trim();
    if (!line || /^(%%|\/\/)/.test(line)) return;
    const label = /"([^"]*)"/.exec(line)?.[1];
    const [verb, arg] = line.replace(/"[^"]*"/g, "").trim().split(/\s+/);

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
          graph.diagnostics.push({ line: i + 1, code: CODES.E_NO_BRANCH, message: `no branch \`${arg ?? ""}\``, severity: "error" });
          return;
        }
        head = arg;
        return;
      }

      case "merge": {
        if (!arg || !lanes.includes(arg)) {
          graph.diagnostics.push({ line: i + 1, code: CODES.E_NO_BRANCH, message: `no branch \`${arg ?? ""}\` to merge`, severity: "error" });
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
        if (node) node.meta = label ?? arg;
        return;
      }

      default:
        graph.diagnostics.push({ line: i + 1, code: CODES.E_UNKNOWN_COMMAND, message: `unknown command \`${verb}\``, severity: "error" });
    }
  });

  const hueOfLane = new Map(lanes.map((name, i) => [name, HUE_ORDER[i % HUE_ORDER.length]!]));

  /* A branch *is* a lane, so it is declared as one and the band renderer names it in the margin —
     one component draws a swimlane and a branch line. */
  for (const name of lanes) {
    graph.lanes.push({ id: name, label: name, hue: hueOfLane.get(name), line: 1 });
  }
  for (const n of graph.nodes) n.hue = hueOfLane.get(branchOf[n.id] ?? "main");
  for (const e of graph.edges) e.hue = graph.nodes.find((n) => n.id === e.to.node)?.hue;

  META.set(graph, { lanes, branchOf, column });
  return graph;
}
