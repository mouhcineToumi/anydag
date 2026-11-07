import { FilePlus2, FileText, FolderOpen, FolderPlus, LibraryBig, NotebookPen, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { chordFor } from "@/edit/bindings";

import { Logo } from "./Logo";
import { CreateVaultForm, OpenFolderForm, RecentVaults, pickFolder, enterPath } from "./Vaults";

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * What a person sees before they have opened anything: an empty board, and the two ways on.
 *
 * **The app used to open a board nobody asked for.** `boardName` was `?board=` *or the first board
 * in the list*, so a cold load landed on whichever file sorted first — somebody else's reference
 * fixture as often as not — and the only signal that this was an accident rather than a choice was
 * that you did not recognise it. The fallback is `null` now: no `?board=` is honestly no
 * board, and this card is what stands in its place.
 *
 * It is two buttons because there are exactly two answers. **Start drawing** makes a board — the
 * same `/create` the browser's `+` calls, with the same numbered-if-taken name — because there is
 * nothing to draw *on* until one exists, and asking for a name first is a form in front of a blank
 * sheet. **Open a board** is the browser. A fresh vault has no boards at all and gets the same
 * card, which is the case that decided the wording: "open a board that already exists" has to read
 * as an offer rather than as an instruction, because there may be none.
 *
 * **Start writing** is the third, since notes: the other kind of file a person can
 * begin with, made the same way — `/create`, numbered if taken — and opened full-window.
 *
 * The canvas underneath stays live — `pointer-events` is off on the layer and back on for the card
 * — so the paper can still be panned and zoomed behind it. It is an invitation, not a gate.
 */
export function Welcome({ onCreate, onWrite, onOpen }: { onCreate(): void; onWrite?(): void; onOpen(): void }) {
  const open = chordFor("boards");
  return (
    <div className="dag-welcome__layer" data-dag-welcome="">
      <section className="dag-welcome" aria-label="No board open">
        <Logo size={28} />
        <h1 className="dag-welcome__title">Nothing open</h1>
        <p className="dag-welcome__hint">Start something new, or open something you have already made.</p>
        <div className="dag-welcome__acts">
          <button type="button" className="dag-welcome__act dag-welcome__act--go" data-dag-welcome-new="" onClick={onCreate}>
            <FilePlus2 {...ICON} aria-hidden="true" />
            <span>New board</span>
          </button>
          {onWrite ? (
            <button type="button" className="dag-welcome__act" data-dag-welcome-note="" onClick={onWrite}>
              <NotebookPen {...ICON} aria-hidden="true" />
              <span>New note</span>
            </button>
          ) : null}
          <button
            type="button"
            className="dag-welcome__act"
            data-dag-welcome-open=""
            title={open ? `Search (${open})` : "Search"}
            onClick={onOpen}
          >
            <Search {...ICON} aria-hidden="true" />
            <span>Search</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * A board with nothing on it yet: the three ways a board begins, where the board is.
 *
 * **A new board used to arrive with a sentence already on it** — an `md` item saying to double-click
 * or press `space L` — shown at 205%, because a fit of one small note fills the screen. So the first
 * thing anybody did to a board they had just made was find that note and delete it. The file is empty
 * now and this card says the same thing without being in it: a note, the library, or a diagram
 * described in words. It goes the moment anything is on the page, and it is never in a snapshot.
 *
 * `Welcome`'s layer: `pointer-events` off, and back on for the card, so a double-click on the paper
 * around it still makes a note — the gesture the first button names.
 */
export function EmptyBoard({ onNote, onLibrary, onPrompt }: { onNote(): void; onLibrary(): void; onPrompt(): void }) {
  const chord = (c: "note" | "library" | "prompt") => chordFor(c);
  const acts: { key: string; label: string; hint: string; icon: typeof FileText; go(): void; lead?: boolean }[] = [
    { key: "note", label: "A note", hint: chord("note") ?? "Space N", icon: FileText, go: onNote },
    { key: "library", label: "The library", hint: chord("library") ?? "Space L", icon: LibraryBig, go: onLibrary },
    { key: "prompt", label: "Describe a diagram", hint: chord("prompt") ?? "Space P", icon: Sparkles, go: onPrompt, lead: true },
  ];
  return (
    <div className="dag-welcome__layer" data-dag-empty-board="">
      <section className="dag-welcome dag-welcome--empty" aria-label="An empty board">
        <p className="dag-welcome__hint">An empty board. Double-click anywhere for a note, or start with</p>
        <div className="dag-welcome__acts">
          {acts.map(({ key, label, hint, icon: Icon, go, lead }) => (
            <button
              key={key}
              type="button"
              className={lead ? "dag-welcome__act dag-welcome__act--tile dag-welcome__act--go" : "dag-welcome__act dag-welcome__act--tile"}
              data-dag-empty-board-act={key}
              onClick={go}
            >
              <Icon {...ICON} aria-hidden="true" />
              <span>{label}</span>
              <kbd>{hint}</kbd>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * What a person sees when no vault is open: the three ways to get one —
 * a folder to open, a folder to make, or one from the recent list. There is no canvas behind it,
 * because every request a canvas makes is about a vault; this is the whole page.
 *
 * Opening asks the desktop shell's folder dialog when there is one, and otherwise for a path typed
 * in a field. **Neither ever removes a folder**: a vault is a folder the person already owns.
 */
export function NoVault() {
  const [asking, setAsking] = useState<"open" | "create" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    setProblem(null);
    const picked = await pickFolder();
    if (picked === undefined) return setAsking("open");
    if (picked === null) return;
    try {
      await enterPath(picked);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That did not work.");
    }
  }

  return (
    <div className="dag-novault" data-dag-novault="">
      <section className="dag-welcome" aria-label="No vault open">
        <Logo size={28} />
        <h1 className="dag-welcome__title">Open a vault</h1>
        <p className="dag-welcome__hint">A vault is a folder of boards, notes and files. Open one you have, or start a new one.</p>
        {asking === "open" ? (
          <OpenFolderForm onCancel={() => setAsking(null)} />
        ) : asking === "create" ? (
          <CreateVaultForm onCancel={() => setAsking(null)} />
        ) : (
          <div className="dag-welcome__acts">
            <button type="button" className="dag-welcome__act dag-welcome__act--go" data-dag-welcome-open-folder="" onClick={() => void open()}>
              <FolderOpen {...ICON} aria-hidden="true" />
              <span>Open folder…</span>
            </button>
            <button type="button" className="dag-welcome__act" data-dag-welcome-create-vault="" onClick={() => setAsking("create")}>
              <FolderPlus {...ICON} aria-hidden="true" />
              <span>Create vault…</span>
            </button>
          </div>
        )}
        {problem ? (
          <p className="dag-vault__problem" role="alert" data-dag-vault-problem="">
            {problem}
          </p>
        ) : null}
        <RecentVaults />
      </section>
    </div>
  );
}
