import { Keyboard, X } from "lucide-react";

import { BINDINGS, bindingOn, LEADER_LABEL } from "@/edit/bindings";
import { useAi } from "@/settings/useAi";

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * Every key the board answers to, on one card. `<leader> ?` opens it; Escape (handled by the
 * editor's key handler, so the two never race), the close button or a click on the scrim closes it.
 *
 * **The Commands section is generated from `BINDINGS`, and the rest is written here.** That split
 * is the honest one: a leader binding is a row in a table three readers share, so printing it from
 * anywhere else would be a fourth copy waiting to drift. A mouse gesture is not a binding — there
 * is no table for "drag a round handle" to be missing from — and a person reads those in the order
 * things are done, not in the order the code tests for them.
 */
const SECTIONS: { title: string; rows: [string, string[]][] }[] = [
  {
    title: "Commands",
    rows: [
      ["Hold or tap it, then a letter; the whole set is below", [LEADER_LABEL]],
      ...BINDINGS.map((b): [string, string[]] => [b.label, [LEADER_LABEL, b.key]]),
    ],
  },
  {
    title: "Select",
    rows: [
      ["Select an item, or its group", ["click"]],
      ["Add to or remove from the selection", ["shift", "click"]],
      ["Select what a rectangle crosses", ["drag the paper"]],
      ["Select everything", ["⌃A"]],
      ["Clear the selection, close a panel", ["Esc"]],
    ],
  },
  {
    title: "Inside a diagram",
    rows: [
      ["Pick a card, once its diagram is selected", ["click again"]],
      ["Pick one of its edges", ["click the line"]],
      ["Its properties, in the panel (on a mindmap topic, the toolbar's Edit)", ["Enter"]],
      ["Rename it where it is drawn", ["double-click"]],
      ["Add a card beside it", ["the + on a picked card"]],
      ["Mindmap topic: a child · a sibling", ["Tab", "Enter"]],
      ["Mindmap topic: out one level", ["shift", "Tab"]],
      ["Mindmap topic: past its siblings", ["alt", "arrows"]],
      ["Move it: into a group, a band, or past a card", ["drag a picked card"]],
      ["Move the whole diagram instead", ["alt", "drag"]],
      ["Draw an edge to another card", ["drag a round handle"]],
      ["Delete it, and every edge that named it", ["Del"]],
      ["Copy the statement under a fresh id", ["⌃D"]],
      ["Let go of the pick, keeping the diagram", ["Esc"]],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Edit the selected item", ["Enter"]],
      ["Rename a card, a group, a band or a label", ["double-click"]],
      ["Copy · cut · paste", ["⌃C", "⌃X", "⌃V"]],
      ["Duplicate", ["⌃D"]],
      ["Delete", ["Del"]],
      ["Group · ungroup", ["⌃G", "⌃⇧G"]],
      ["Bring to front · send to back", ["]", "["]],
      ["Hide the selection", ["⌃⇧H"]],
      ["Nudge, or by ten", ["arrows", "shift"]],
      ["Link this to something", ["drag a round handle"]],
      ["Pick a link · its properties · delete it", ["click", "Enter", "Delete"]],
      ["Bend a picked link · straighten it", ["drag its middle", "double-click"]],
      ["Keep the selection as a component", ["⌃⇧K"]],
      ["Undo · redo", ["⌃Z", "⌃⇧Z"]],
      ["Drag without the guides", ["alt", "drag"]],
    ],
  },
  {
    title: "Add",
    rows: [
      ["A note where you double-click", ["double-click"]],
      ["An image or text from the clipboard", ["⌃V"]],
    ],
  },
  {
    title: "Pages and boards",
    rows: [
      ["Open a page", ["click a tab"]],
      ["Add a page · rename one", ["the +", "double-click"]],
      ["Reorder the pages", ["drag a tab", "⇧← ⇧→"]],
      ["Move between tabs", ["← →"]],
      ["Put a board in a folder", ["drag it onto one"]],
    ],
  },
  {
    title: "Move around",
    rows: [
      ["Move the paper", ["wheel"]],
      ["Zoom about the pointer", ["⌃", "wheel"]],
      ["Drag the paper, over anything", ["space", "drag"]],
      ["Fit · 100% · zoom", ["F", "0", "+ −"]],
    ],
  },
  {
    title: "Anywhere",
    rows: [
      ["Settings", ["⌃,"]],
      ["Put the sidebar away, or bring it back", ["⌃\\"]],
      ["Lock: read only, so nothing changes by accident", ["⌃⇧L"]],
    ],
  },
];

/**
 * The list itself, without the card around it: the board's sheet draws it, and so does the Settings
 * modal's Shortcuts tab — one list in two places, so the two cannot disagree about a key.
 */
export function ShortcutList() {
  const ai = useAi();
  /* A row is a binding's when its label is one: an AI feature that is off takes its row with it. */
  const hidden = new Set(BINDINGS.filter((b) => !bindingOn(b, (f) => ai[f])).map((b) => b.label));
  const sections = hidden.size ? SECTIONS.map((s) => ({ ...s, rows: s.rows.filter(([what]) => !hidden.has(what)) })) : SECTIONS;
  return (
    <div className="dag-shortcuts__grid">
      {sections.map((s) => (
        <section key={s.title} className="dag-shortcuts__group">
          <h3 className="dag-shortcuts__section">{s.title}</h3>
          <div className="dag-shortcuts__list">
            {s.rows.map(([what, keys]) => (
              <div key={what} className="dag-shortcuts__row">
                <span>{what}</span>
                <span className="dag-shortcuts__keys">
                  {keys.map((k) =>
                    gesture(k) ? (
                      <span key={k} className="dag-shortcuts__gesture">
                        {k}
                      </span>
                    ) : (
                      <kbd key={k}>{keyName(k)}</kbd>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The keys written as words in `SECTIONS`, and how a keyboard labels them. */
const NAMED: Record<string, string> = { shift: "Shift", alt: "Alt", space: "Space", arrows: "Arrows" };

/**
 * A gesture — "click", "drag the paper", "the + on a picked card" — is something done with the
 * pointer, not a key, so it is written as words rather than drawn as a keycap.
 */
function gesture(k: string): boolean {
  return !(k in NAMED) && /^[a-z][a-z+ -]*[a-z]$/.test(k) && k.length > 1;
}

function keyName(k: string): string {
  return NAMED[k] ?? k;
}

export function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <div className="dag-shortcuts__scrim" data-dag-shortcuts="" onPointerDown={onClose}>
      <section className="dag-shortcuts" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
        <header className="dag-shortcuts__head">
          <Keyboard {...ICON} aria-hidden="true" />
          <h2>Shortcuts</h2>
          <span className="dag-toolbar__spacer" />
          <button type="button" className="dag-icon" aria-label="Close" onClick={onClose}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </header>
        <ShortcutList />
      </section>
    </div>
  );
}
