import { AlertTriangle } from "lucide-react";

import { fixLabel, type Fix, type Problem } from "./problems";

/**
 * Problems in words, each with the buttons that mend it. The one list the page uses everywhere a
 * problem is drawn: above the grid for a tab's, in the card a column's or a row's mark opens.
 */
export function ProblemList({
  problems,
  onFix,
  disabled = false,
}: {
  problems: readonly Problem[];
  onFix(p: Problem, f: Fix): void;
  /** The table is locked: the words stay, the buttons wait. */
  disabled?: boolean;
}) {
  return (
    <ul className="dag-tablepage__problems" data-dag-tablepage-problems="">
      {problems.map((p) => (
        <li key={p.key} className="dag-tablepage__problem" data-dag-tablepage-problem={p.code} data-severity={p.severity}>
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="dag-tablepage__problem-mark" />
          <div className="dag-tablepage__problem-body">
            <p className="dag-tablepage__problem-words">{p.words}</p>
            {p.detail ? <pre className="dag-tablepage__problem-detail">{p.detail}</pre> : null}
            <div className="dag-tablepage__problem-fixes">
              {p.fixes.map((f) => (
                <button
                  key={f.kind}
                  type="button"
                  className="dag-tablepage__problem-fix"
                  data-dag-tablepage-fix={f.kind}
                  disabled={disabled}
                  onClick={() => onFix(p, f)}
                >
                  {fixLabel(f)}
                </button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
