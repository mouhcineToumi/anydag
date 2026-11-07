import { emptyGraph, HUE_ORDER, type Graph, type Node } from "../ir";

/**
 * `mindmap` — a tree, written as indentation.
 *
 *     root Larkspur
 *       Content
 *         Tracks
 *         Nodes
 *       Progress
 *
 * The only dialect with its own parser rather than the shared one, because indentation *is* the
 * grammar here and quoting every label would drown a form whose whole appeal is that it is fast to
 * type. Labels are bare text to end of line; ids are generated.
 */
export function parseMindmap(src: string): Graph {
  const graph = emptyGraph("mindmap", "radial");
  const stack: { indent: number; id: string }[] = [];
  let seq = 0;

  src.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*(%%|\/\/)/.test(line)) return;

    const indent = /^[ \t]*/.exec(line)![0].replace(/\t/g, "  ").length;
    let label = line.trim();
    let isRoot = false;
    if (/^root\b/.test(label)) {
      label = label.replace(/^root\b\s*/, "");
      isRoot = true;
    }
    /* Mermaid wraps the root in `((…))` and a branch in `(…)`; accept and strip, so a pasted
       mindmap works without editing. */
    label = label
      .replace(/^\(+\s*/, "")
      .replace(/\s*\)+$/, "")
      .replace(/^"|"$/g, "");
    if (!label) return;

    const id = `m${seq++}`;
    const node: Node = {
      id,
      kind: "topic",
      title: label,
      rows: [],
      root: isRoot || undefined,
      line: i + 1,
    };
    graph.nodes.push(node);

    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      graph.edges.push({
        id: `e${seq++}`,
        from: { node: parent.id },
        to: { node: id },
        dash: false,
        quiet: false,
        head: "none",
        tail: "none",
        line: i + 1,
      });
    }
    stack.push({ indent, id });
  });

  /* Depth decides the hue, so a branch and everything under it read as one family. */
  const parentOf = new Map(graph.edges.map((e) => [e.to.node, e.from.node]));
  const branchHue = new Map<string, string>();
  let next = 0;
  for (const n of graph.nodes) {
    const parent = parentOf.get(n.id);
    if (parent === undefined) continue;
    if (parentOf.get(parent) === undefined) branchHue.set(n.id, HUE_ORDER[next++ % HUE_ORDER.length]!);
    else branchHue.set(n.id, branchHue.get(parent) ?? "indigo");
    n.hue = branchHue.get(n.id);
  }
  for (const e of graph.edges) e.hue = graph.nodes.find((n) => n.id === e.to.node)?.hue;

  return graph;
}
