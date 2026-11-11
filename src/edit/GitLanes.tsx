import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { Point } from "@/canvas/geometry";
import { gitMetaOf, parseGitgraph } from "@/dsl/graph/gitgraph";

import type { Editor } from "./useEditor";

/**
 * A git graph's lanes, made into controls while the graph is selected.
 *
 * A gitgraph is a list of commands run against a HEAD, so the things a person wants to say about
 * one — "commit on this branch", "start a branch here", "merge this into that" — are not a line of
 * the file each, and a `+` beside a card has nothing to grow. What they *are* is a lane, and the
 * lanes are already drawn. So each one gets three things here:
 *
 * - **A chip over its name**, which opens the inline rename on the branch — every statement that
 *   names it, through `gitRenameBranch`. `main` has none: the parser starts on it and no line
 *   declares it, so there is nothing to rename.
 * - **A `+` just past its tip**, which writes a commit on that branch, with the `checkout` it needs.
 * - **+ New branch** under the last lane, off the picked commit when there is one and off the tip
 *   of the current branch when not.
 *
 * Merging is a drag rather than a button: a branch's tip let go on another lane (`historyDrop` in
 * `drag.ts`), which is the picture of a merge, and is with the other drags.
 *
 * **Editing chrome, never part of the diagram.** In the layer beside `NodeHandles`, for the same
 * reason — `Item` is memoised and knows nothing about layouts — and so never in `?snapshot=1`, an
 * export or a read-only view. Positioned by measuring the drawn lane labels and tip commits through
 * `toBoard`, after every render, which is `Rename`'s argument: a commit just written reaches the DOM
 * several renders later, once its layout has come back, with nothing about this component changed.
 */

interface Spot {
  name: string;
  /** The drawn label, in board units — the chip covers it exactly. */
  chip: { x: number; y: number; w: number; h: number };
  /** The centre of the `+`. */
  plus: Point;
}

interface Spots {
  lanes: Spot[];
  /** The top-left of **+ New branch**. */
  add: Point;
}

/** How far past a tip the `+` sits, centre to edge: clear of the commit, close enough to be its. */
const PLUS_GAP = 16;

export function GitLanes({
  editor,
  item,
  body,
  picked,
}: {
  editor: Editor;
  item: string;
  body: string;
  /** The commit picked in this graph, if any: where **+ New branch** starts. */
  picked: string | null;
}) {
  const meta = useMemo(() => gitMetaOf(parseGitgraph(body)), [body]);
  const [spots, setSpots] = useState<Spots | null>(null);
  const toBoard = editor.toBoard;

  /* After every render, deliberately — see the note at the top. Compared as text so a render that
     changed nothing sets nothing, which is what keeps this from re-rendering itself forever. */
  useEffect(() => {
    const scope = document.querySelector(`[data-dag-item="${CSS.escape(item)}"]`);
    if (!scope) return;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      const a = toBoard(r.left, r.top);
      const b = toBoard(r.right, r.bottom);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    const lanes: Spot[] = [];
    for (const name of meta.lanes) {
      const label = scope.querySelector(`[data-dag-lane-label="${CSS.escape(name)}"]`);
      if (!label) continue;
      const chip = box(label);
      const tip = meta.tips[name];
      const at = tip ? scope.querySelector(`[data-dag-node="${CSS.escape(tip)}"]`) : null;
      /* A branch with no commit of its own still has a tip — the commit it started from, on
         another lane — and the next commit on it is drawn one column past that. */
      const from = at ? box(at) : chip;
      lanes.push({ name, chip, plus: { x: from.x + from.w + PLUS_GAP, y: chip.y + chip.h / 2 } });
    }
    const last = lanes.at(-1);
    if (!last) return;
    const next: Spots = { lanes, add: { x: last.chip.x, y: last.chip.y + last.chip.h + 12 } };
    setSpots((was) => (was && JSON.stringify(was) === JSON.stringify(next) ? was : next));
  });

  if (!spots) return null;

  /* The press must not reach the board underneath, which would let go of the selection or start a
     drag of the whole item before the click could land. */
  const hold = (e: ReactPointerEvent) => e.stopPropagation();

  return (
    <div className="dag-gitlanes" data-dag-git-lanes={item}>
      {spots.lanes.map(({ name, chip, plus }) => (
        <div key={name}>
          <button
            type="button"
            className="dag-git-chip"
            data-dag-git-chip={name}
            disabled={name === "main"}
            title={name === "main" ? "The history starts on main, which keeps its name" : `Rename ${name}`}
            aria-label={name === "main" ? "main" : `Rename branch ${name}`}
            style={{ transform: `translate(${chip.x}px, ${chip.y}px)`, width: chip.w, height: chip.h }}
            onPointerDown={hold}
            onClick={() => editor.renameBranch(item, name)}
          />
          <button
            type="button"
            className="dag-plus dag-git-plus"
            data-dag-git-plus={name}
            aria-label={`Add a commit on ${name}`}
            title={`Add a commit on ${name}`}
            style={{ transform: `translate(${plus.x - 8}px, ${plus.y - 8}px)` }}
            onPointerDown={hold}
            onClick={() => editor.gitCommit(item, name)}
          >
            +
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dag-git-newbranch"
        data-dag-git-new-branch={picked ?? ""}
        title={picked ? "Start a branch from the picked commit" : `Start a branch from the tip of ${meta.head}`}
        style={{ transform: `translate(${spots.add.x}px, ${spots.add.y}px)` }}
        onPointerDown={hold}
        onClick={() => editor.gitBranch(item, picked)}
      >
        + New branch
      </button>
    </div>
  );
}
