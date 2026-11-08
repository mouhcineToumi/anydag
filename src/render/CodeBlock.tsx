import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { ExtraProps } from "react-markdown";

import { copyText } from "@/ui/clipboard";

import { codeOfPre } from "./code";
import { MathTex } from "./Math";
import { problemTitle, problemsSaid, segmentsOf, useCodeRead, type CodeRead } from "./syntax";

/** How long the button says it copied before it goes back to saying what it does. */
const SAID_MS = 1500;

/**
 * Whether a person is looking at this page, as opposed to a script taking its picture. A snapshot is
 * a fact about the file, so it draws the language — which the file says — and never the button,
 * which is for somebody with a pointer. Read per render, never cached: `App` rewrites the query.
 */
function live(): boolean {
  try {
    return new URLSearchParams(location.search).get("snapshot") !== "1";
  } catch {
    return true;
  }
}

/**
 * The copy button on a code block. `text` is asked at the click, so the note editor hands
 * over the block as it is now rather than as it was when the button was drawn.
 *
 * It stops the press it is pressed with: on a board that press would select and drag the card, in
 * the note editor it would move the caret out of whatever the person was typing, and a double-click
 * would open the card's editor panel. Its `mousedown` is cancelled for the second of those, which
 * keeps the focus where it was; a keyboard still reaches it with Tab.
 */
export function CodeCopy({ text }: { text: () => string }): ReactNode {
  const [said, setSaid] = useState<"copy" | "copied" | "failed">("copy");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const label = said === "copied" ? "Copied" : said === "failed" ? "Could not copy" : "Copy code";
  return (
    <button
      type="button"
      className="dag-code__copy"
      data-dag-code-copy={said}
      aria-label={label}
      title={label}
      onPointerDown={stop}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text()).then((ok) => {
          setSaid(ok ? "copied" : "failed");
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setSaid("copy"), SAID_MS);
        });
      }}
    >
      {said === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
    </button>
  );
}

/**
 * A fenced code block, as every read-only page draws one — a board's text card, a note at `?view=1`
 * or behind a share link, a note embedded in a note, a quiz, the DSL cheat sheet: its language above
 * its text, and a button that copies the text. `react-markdown`'s `pre`, so it is handed the parsed
 * tree and reads both off it (`codeOfPre`).
 *
 * **Unless its language is `math`**: a `$$` block reaches here as `<pre><code
 * class="language-math math-display">`, and a ```math fence as `language-math`, and both are an
 * equation, drawn by KaTeX — not a code block labelled "math" with its TeX and a copy button.
 */
export function CodePre({ node, children, ...rest }: ComponentProps<"pre"> & ExtraProps): ReactNode {
  const { language, text } = codeOfPre(node);
  if (language === "math") return <MathTex tex={text} block />;
  return <CodeBlockRead language={language} text={text} rest={rest} fallback={children} />;
}

/**
 * The block itself, coloured by its language once that has landed and, where the language is
 * checked, with what it could not read underlined and counted beside the label. Its own
 * component so `CodePre` stays a plain function `react-markdown` can call before deciding on math.
 */
function CodeBlockRead({
  language,
  text,
  rest,
  fallback,
}: {
  language: string;
  text: string;
  rest: ComponentProps<"pre">;
  fallback: ReactNode;
}): ReactNode {
  const read = useCodeRead(text, language);
  const said = problemsSaid(read);
  return (
    <div
      className="dag-code"
      data-dag-code={language}
      data-dag-code-read={read ? (read.checked ? "checked" : "coloured") : undefined}
    >
      <div className="dag-code__head">
        <span className="dag-code__lang">{language}</span>
        {said ? (
          <span className="dag-code__problems" data-dag-code-problems={read?.problems.length}>
            {said}
          </span>
        ) : null}
      </div>
      <pre {...rest}>{read ? <code className={`language-${language}`}>{painted(text, read)}</code> : fallback}</pre>
      {live() ? <CodeCopy text={() => text} /> : null}
    </div>
  );
}

/** The text in runs, each wearing its token's class and, where it could not be read, the underline. */
function painted(text: string, read: CodeRead): ReactNode[] {
  return segmentsOf(text.length, read).map((s) => {
    const piece = text.slice(s.from, s.to);
    if (!s.cls && !s.problem) return piece;
    const cls = [s.cls, s.problem ? "dag-tok-error" : null].filter(Boolean).join(" ");
    return (
      <span
        key={s.from}
        className={cls}
        title={s.problem ? problemTitle(s.problem) : undefined}
        data-dag-code-error={s.problem ? "" : undefined}
      >
        {piece}
      </span>
    );
  });
}

/**
 * `react-markdown`'s `code`: an inline equation — `$x$` reaches here as `<code
 * class="language-math math-inline">`, and `$$x$$` written mid-line as `math-display` — and every
 * other `<code>` exactly as it was. Inside a `<pre>` the `pre` above has already decided.
 */
export function MathCode({ node, className, children, ...rest }: ComponentProps<"code"> & ExtraProps): ReactNode {
  const classes = typeof className === "string" ? className.split(" ") : [];
  if (!classes.includes("language-math")) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  const tex = node?.children.map((c) => (c.type === "text" ? c.value : "")).join("") ?? "";
  return <MathTex tex={tex} display={classes.includes("math-display")} />;
}
