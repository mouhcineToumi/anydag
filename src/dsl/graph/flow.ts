import type { Dialect } from "../common";

/**
 * `flow` — who does what, in what order, and where the run can stop.
 *
 *     lane recruiter "Recruiter" hue=ochre {
 *       step 01 "Upload a CV" "pdf · docx · 20 MB"
 *       step 04a "Ask for a clearer file" "status = failed" stop
 *     }
 *     lane system "HunterOS" hue=teal { decision 04 "Any text found?" }
 *     01 --> 02 --> 03 --> 04
 *     04 --> 04a "no"
 *
 * A decision is a **pill**, not a diamond. A diamond is a sharp shape in a system that forbids
 * sharp corners, and the pill reads as "a branch" just as fast once you have seen one.
 */
export const flow: Dialect = {
  type: "flow",
  dir: "LR",
  kinds: { step: "step", decision: "decision" },
  lanes: true,
};

/**
 * `activity` — the same vocabulary plus the one thing a flowchart cannot say: these happen at once.
 *
 *     fork f1
 *     join j1
 *     f1 --> html & pdf & charge --> j1 --> ready
 *
 * `start s0` and `end e0` declare the filled dot and the ringed one with an id, the way `fork f1` does a bar;
 * `[*]` inside an edge still draws the same two.
 *
 * The bars are solid ink. That is the one place ink is a fill rather than a text colour, and it is
 * what makes them read as grammar rather than as another node.
 */
export const activity: Dialect = {
  type: "activity",
  dir: "LR",
  kinds: {
    action: "action",
    step: "action",
    decision: "decision",
    fork: "fork",
    join: "join",
    start: "start",
    end: "end",
  },
  lanes: true,
};
