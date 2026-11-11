import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import type { Board } from "@/board/types";
import { FLOW_DEFAULT, FLOW_RANGE, flowMeta, themeMeta } from "@/board/settings";
import type { ThemeSource } from "@/theme/pick";

const ICON = { size: 16, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

interface Props {
  board: Pick<Board, "theme" | "flow">;
  /** Every theme there is, and the one this window is drawing in. */
  themes: readonly string[];
  themeName: string;
  /** Which rule chose `themeName` (`pickTheme`), so the card can say why. */
  themeSource: ThemeSource;
  /** `Editor.setMeta`: the keys to set in the frontmatter, `null` removing one. */
  onMeta(meta: Record<string, unknown>): Promise<boolean>;
  onClose(): void;
}

/**
 * The settings that belong to *this board* rather than to the app: the look it asks to be drawn in,
 * and how the auto-flow lays out what nobody has placed. Both are in the file's frontmatter, beside
 * the `pages:` the page tabs write, and neither had a control — a person changed them by opening the
 * file.
 *
 * It is a card over the board for the settings card's reasons (and `RewriteDialog`'s): it takes
 * focus and owns its Escape, so the window's chain never sees a key typed into a field here.
 *
 * **Three things about the theme row.** It is the *board's* theme, `theme:` in the file, not the
 * Settings preference — that one is about the window and is not part of what a `?board=…` link
 * means. *Follow my settings* is no `theme:` at all, not a word that happens to name the default.
 * And the board's theme is the one drawn, unless the reader turned on *Use my theme on every board*
 * or the address names one (`pickTheme`) — so when this window is drawing another, the card says
 * which one and why, instead of leaving a person wondering why a setting they just made drew nothing.
 *
 * **Flow is only what differs from the default.** Each number is committed when its box loses
 * focus, as `Field` does, and refused in the box — put back, with the range said — when it is not a
 * number the control may write.
 */
export function BoardSettings({ board, themes, themeName, themeSource, onMeta, onClose }: Props) {
  const [width, setWidth] = useState(String(board.flow.width));
  const [gap, setGap] = useState(String(board.flow.gap));
  const [refused, setRefused] = useState<string | null>(null);

  const known = board.theme === undefined || themes.includes(board.theme);

  const commitFlow = (nextWidth: string, nextGap: string) => {
    const op = flowMeta(Number(nextWidth), Number(nextGap));
    if (!op || nextWidth.trim() === "" || nextGap.trim() === "") {
      setWidth(String(board.flow.width));
      setGap(String(board.flow.gap));
      setRefused(
        `Width is ${FLOW_RANGE.width.min}–${FLOW_RANGE.width.max} and the gap ${FLOW_RANGE.gap.min}–${FLOW_RANGE.gap.max}.`,
      );
      return;
    }
    setRefused(null);
    /* What `flowMeta` rounds to is what the file will say, so the box says it too. */
    setWidth(String(Math.round(Number(nextWidth))));
    setGap(String(Math.round(Number(nextGap))));
    if (Number(nextWidth) === board.flow.width && Number(nextGap) === board.flow.gap) return;
    void onMeta(op.meta);
  };

  return (
    <div className="dag-settings__scrim" data-dag-board-settings="" onPointerDown={onClose}>
      <section
        className="dag-settings dag-board-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Board settings"
        onPointerDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <header className="dag-settings__head">
          <SlidersHorizontal {...ICON} aria-hidden="true" />
          <h2>Board settings</h2>
          <span className="dag-toolbar__spacer" />
          <button type="button" className="dag-icon" aria-label="Close" data-dag-board-settings-close="" onClick={onClose}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </header>

        <div className="dag-board-settings__body">
          <label className="dag-field">
            <span>Theme</span>
            <select
              className="dag-select"
              data-dag-board-theme=""
              autoFocus
              value={board.theme ?? ""}
              onChange={(e) => void onMeta(themeMeta(e.target.value || null).meta)}
            >
              <option value="">follow my settings</option>
              {!known ? <option value={board.theme}>{board.theme} (not installed)</option> : null}
              {themes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <p className="dag-field__hint" data-dag-board-theme-note={board.theme ? themeSource : ""}>
            {themeNote(board.theme, themeName, themeSource)}
          </p>

          <div className="dag-board-settings__flow" role="group" aria-label="Flow">
            <label className="dag-field">
              <span>Flow width</span>
              <input
                className="dag-input"
                data-dag-board-flow-width=""
                inputMode="numeric"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                onBlur={() => commitFlow(width, gap)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label className="dag-field">
              <span>Flow gap</span>
              <input
                className="dag-input"
                data-dag-board-flow-gap=""
                inputMode="numeric"
                value={gap}
                onChange={(e) => setGap(e.target.value)}
                onBlur={() => commitFlow(width, gap)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
          </div>
          {refused ? (
            <p className="dag-field__hint dag-field__hint--bad" data-dag-board-flow-bad="">
              {refused}
            </p>
          ) : (
            <p className="dag-field__hint">
              Items nobody has placed wrap into rows at the width and keep the gap between them, and Tidy up keeps the gap. The
              defaults are {FLOW_DEFAULT.width} and {FLOW_DEFAULT.gap}.
            </p>
          )}
        </div>

        <div className="dag-settings__foot dag-board-settings__foot">
          <button type="button" className="dag-icon dag-icon--wide" onClick={onClose}>
            <span>Done</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/** What the theme row says under it: what is shown, and when it is not the board's, why not. */
function themeNote(boardTheme: string | undefined, drawn: string, source: ThemeSource): string {
  if (!boardTheme) return "The look this board asks for. With none, it is drawn in the theme chosen in Settings.";
  switch (source) {
    case "board":
      return "The look this board asks for. Anyone opening it sees it, unless they turned on “Use my theme on every board” in Settings.";
    case "mine":
      return `This window is drawing ${drawn}, your own theme: “Use my theme on every board” is on in Settings.`;
    case "address":
      return `This window is drawing ${drawn}, the theme named in the page’s address, which comes before the board’s.`;
    case "own":
    case "default":
      return `${boardTheme} is not installed here, so this window is drawing ${drawn}.`;
  }
}
