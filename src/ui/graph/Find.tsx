import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

/**
 * *Find a file* (#459): the keyboard's way into the graph. Typing lists the shown files whose name
 * holds the words, most linked first; the one picked is centred and lit, the arrows move between
 * them, Enter opens it, and Escape lets it go. A click on a line centres it, as the arrows do.
 *
 * A combobox over a listbox, so a screen reader hears each file as it is picked.
 */

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** How many matches are listed. */
const MOST = 8;

export interface FindHandle {
  focus(): void;
  /** Empty the field and let the found file go: Escape anywhere on the page. */
  clear(): void;
}

export const Find = forwardRef<
  FindHandle,
  {
    /** The shown files' names, and their order by links (most first). */
    names: readonly string[];
    byDegree: Int32Array;
    /** Light and centre a shown file, or `-1` to let it go. */
    onPick(i: number): void;
    onOpen(i: number): void;
  }
>(function Find({ names, byDegree, onPick, onOpen }, ref) {
  const [words, setWords] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const lower = useMemo(() => names.map((n) => n.toLowerCase()), [names]);
  const matches = useMemo(() => {
    const w = words.trim().toLowerCase();
    if (!w) return [];
    const out: number[] = [];
    for (let o = 0; o < byDegree.length && out.length < MOST; o++) {
      const i = byDegree[o]!;
      if (lower[i]!.includes(w)) out.push(i);
    }
    return out;
  }, [words, lower, byDegree]);
  const picked = matches[Math.min(active, matches.length - 1)] ?? -1;

  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (words.trim()) pick.current(picked);
  }, [picked, words]);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    clear: () => {
      setWords("");
      setActive(0);
    },
  }));

  const nothing = words.trim() !== "" && matches.length === 0;
  return (
    <div className="dag-graph__find" data-dag-graph-find="">
      <div className="dag-graph__findbox">
        <Search {...ICON} aria-hidden="true" />
        <input
          ref={input}
          className="dag-graph__findfield"
          data-dag-graph-find-field=""
          placeholder="Find a file"
          aria-label="Find a file in the graph"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={list}
          aria-activedescendant={picked >= 0 ? `${list}-${picked}` : undefined}
          value={words}
          onChange={(e) => {
            setWords(e.target.value);
            setActive(0);
            if (!e.target.value.trim()) onPick(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!matches.length) return;
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => (Math.min(a, matches.length - 1) + step + matches.length) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (picked >= 0) onOpen(picked);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setWords("");
              setActive(0);
              onPick(-1);
              input.current?.blur();
            }
          }}
        />
      </div>
      {matches.length ? (
        <div className="dag-graph__matches" id={list} role="listbox" aria-label="Files found">
          {matches.map((i, k) => (
            <div
              key={i}
              id={`${list}-${i}`}
              className="dag-graph__match"
              role="option"
              aria-selected={i === picked}
              data-dag-graph-match=""
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setActive(k)}
            >
              {names[i]}
            </div>
          ))}
          <p className="dag-graph__findhint">Enter opens it · Esc lets it go</p>
        </div>
      ) : nothing ? (
        <p className="dag-graph__findhint dag-graph__findhint--none" role="status">
          No file shown here is called that.
        </p>
      ) : null}
    </div>
  );
});
