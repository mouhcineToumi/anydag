/**
 * Undo, as versions of the file.
 *
 * Every edit the canvas makes is a write to the board file, and the file is small — a board is a
 * few kilobytes of text. So an undo entry is the text from before the edit and the text after it,
 * and undoing is putting the earlier one back. No op needs an inverse, a paste and a delete undo
 * the same way, and nothing here has to know what an edit *was*.
 *
 * What it does have to know is whether the file is still the one the edit produced. Claude writes
 * the same file, and putting a snapshot from before its rewrite back over the top would throw its
 * work away. Each side of an entry therefore carries the version it expects to find, and a stack
 * whose top no longer matches the file is cleared rather than applied — the edits it remembers
 * happened to a document that no longer exists.
 *
 * `key` coalesces: a person typing into the editor produces a write every few hundred milliseconds,
 * and one undo should take the whole run back, not one keystroke.
 */

export interface Entry {
  /** The text to restore on undo, and the version the file must be at for that to make sense. */
  undoText: string;
  undoExpect: string;
  /** The same, the other way. */
  redoText: string;
  redoExpect: string;
  key?: string;
}

export interface Version {
  text: string;
  base: string;
}

export const LIMIT = 100;

export class History {
  private undos: Entry[] = [];
  private redos: Entry[] = [];

  get canUndo(): boolean {
    return this.undos.length > 0;
  }
  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Record an edit that took the file from `before` to `after`. */
  push(before: Version, after: Version, key?: string): void {
    if (before.base === after.base) return;
    this.redos = [];
    const top = this.undos[this.undos.length - 1];
    if (key && top && top.key === key && top.undoExpect === before.base) {
      top.redoText = after.text;
      top.undoExpect = after.base;
      return;
    }
    this.undos.push({ undoText: before.text, undoExpect: after.base, redoText: after.text, redoExpect: before.base, key });
    if (this.undos.length > LIMIT) this.undos.shift();
  }

  /** The text to put back, if the file is still where the last edit left it. Otherwise `null`. */
  undo(current: string): string | null {
    const top = this.undos[this.undos.length - 1];
    if (!top) return null;
    if (top.undoExpect !== current) {
      this.clear();
      return null;
    }
    this.undos.pop();
    this.redos.push(top);
    return top.undoText;
  }

  redo(current: string): string | null {
    const top = this.redos[this.redos.length - 1];
    if (!top) return null;
    if (top.redoExpect !== current) {
      this.clear();
      return null;
    }
    this.redos.pop();
    this.undos.push(top);
    return top.redoText;
  }

  /** Break a coalescing run: the next write with the same key starts a fresh entry. */
  seal(): void {
    const top = this.undos[this.undos.length - 1];
    if (top) top.key = undefined;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}
