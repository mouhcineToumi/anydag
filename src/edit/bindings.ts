/**
 * The leader bindings, as data.
 *
 * Every command on this board used to be a **bare letter** in a flat namespace — `n` for a note,
 * `t` for tidy, `l` for the library — while everything else was already modifier-prefixed
 * (`⌃C`, `⌃D`, `⌃G`, `⌃Z`, `⌃,`). The bare letters were the inconsistent half, not the rule, and
 * they had already cost a real defect: `K` and Enter open a fence with the source focused and its
 * caret at offset zero, so the next letter typed as a shortcut landed *in the board file* and
 * rendered as a broken `edges` fence. A chord cannot be mistaken for typing.
 *
 * **The leader is Space, and it is not `Super`.** A literal Super modifier is the one thing that
 * cannot be delivered to a web page: on Hyprland it is the compositor's own modifier and is
 * swallowed before Chrome sees it, and on macOS `Meta` is `Cmd`, where `⌘N`, `⌘T`, `⌘W` and `⌘L`
 * are the browser's and `preventDefault` does not reliably reclaim them. A leader is the shape that
 * survives both: nothing reserves it, the wait makes intent explicit, and it scales past the
 * alphabet in a way a single modifier does not.
 *
 * **Navigation stays bare**, which is the one exception and it is a rule rather than an oversight:
 * the arrows, `F`, `0`, `+`/`−` and the `]`/`[` pair are pressed in runs, and `<leader>+` four
 * times to zoom in is not a shortcut anybody would use. Everything that *names a thing to make* is
 * here — and so is the one thing that names somewhere to go, because the board list
 * is a dialog you have to ask for.
 *
 * This table is the source of truth for three readers — the chord handler in `useEditor`, the
 * which-key overlay, and the Shortcuts sheet — so a binding added here appears in all three or in
 * none. That is the drift `check:skill` exists to catch one layer out, applied to a key table.
 */

/** What a leader chord can ask for. `useEditor` maps each onto the callback that does it. */
export type Command =
  | "select"
  | "hand"
  | "pen"
  | "note"
  | "prompt"
  | "library"
  | "links"
  | "tidy"
  | "boards"
  | "assistant"
  | "help";

export type Binding = {
  /** The letter pressed after the leader, lower case. Compared against `e.key.toLowerCase()`. */
  key: string;
  command: Command;
  /** What it does, in the sheet and in the overlay. */
  label: string;
};

/** The key that opens a chord, as `KeyboardEvent.code` — a physical key, so no layout can move it. */
export const LEADER_CODE = "Space";

/** What the sheet and the overlay call it. */
export const LEADER_LABEL = "Space";

/**
 * How long a chord stays open after the leader is released, in milliseconds.
 *
 * Long enough that a person who paused to think is not punished, short enough that a leader
 * pressed and forgotten does not swallow a letter typed a minute later. Escape closes it sooner,
 * and so does any key that is not a binding.
 */
export const CHORD_MS = 3000;

/**
 * How long the leader has to be held, or held open, before the overlay names what is available.
 *
 * Which-key's bargain: somebody who knows the chord never sees it, and somebody who does not gets
 * the whole set without having to know that `?` exists.
 */
export const WHICHKEY_MS = 400;

/** In the order a person meets them, which is also the order the sheet prints. */
export const BINDINGS: Binding[] = [
  { key: "n", command: "note", label: "A note under the pointer" },
  { key: "p", command: "prompt", label: "A prompt card: describe a diagram, and a model draws it" },
  { key: "l", command: "library", label: "The component library" },
  { key: "k", command: "links", label: "The links between items, as text" },
  { key: "t", command: "tidy", label: "Tidy up the board, or the selection" },
  /* `o` for open, and it is the one binding here that names a thing to *reach* rather than a thing
     to make. It sits beside the making bindings all the same: the board list is a dialog rather
     than a column, so a chord is how somebody who knows where they are going gets there without
     aiming at the name in the toolbar. */
  { key: "o", command: "boards", label: "The boards: open one, or make one" },
  /* `a` for the Assistant: a thing to *reach*, like `o`, and the one place a chat with the person's own
     AI is a keypress away from any page — a board, a note, the Tasks page. */
  { key: "a", command: "assistant", label: "The Assistant: ask your AI about this vault, or have it make a change" },
  { key: "v", command: "select", label: "The select tool" },
  { key: "h", command: "hand", label: "The hand tool" },
  /* `b` for brush: `p` is the prompt card's and was already taken when the pen wanted a key. */
  { key: "b", command: "pen", label: "The pen: draw freehand, and keep drawing until Escape" },
  { key: "?", command: "help", label: "Every shortcut, on one sheet" },
];

/** The binding a key press asks for, or nothing. */
export function bindingFor(key: string): Binding | undefined {
  const k = key.toLowerCase();
  return BINDINGS.find((b) => b.key === k);
}

/**
 * How a chord is written on a control that runs the same command — `space T`.
 *
 * The dock is the fourth reader of this table, and the only one that speaks in the
 * imperative: the sheet and the overlay list what a chord *does*, while a tooltip says what a
 * button does and what could have been pressed instead. The tooltip is the only
 * place a name lives — the labels are gone — so it is also the only thing making these keys
 * discoverable, which is precisely why it may not be a second copy of them.
 *
 * Retyping the letter into a dozen `title=` strings is how `SKILL.md` once told every reader
 * there was no dark theme. A closed set with two copies drifts the moment the
 * set moves, and this table moved every one of them from a bare letter to a chord.
 */
export function chordFor(command: Command): string | undefined {
  const b = BINDINGS.find((x) => x.command === command);
  return b && `${LEADER_LABEL} ${b.key.toUpperCase()}`;
}
