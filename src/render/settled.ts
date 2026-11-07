/**
 * Whether what a page drew lazily has landed: KaTeX's equations and the colours of its code
 * blocks. Every place that says a page is ready, and the PDF, waits on this rather than on
 * either alone, so the next thing drawn lazily is added in one place.
 */
import { mathSettled } from "./Math";
import { syntaxSettled } from "./syntax";

export async function drawnSettled(): Promise<void> {
  await Promise.all([mathSettled(), syntaxSettled()]);
}
