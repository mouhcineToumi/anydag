/**
 * Put text on the clipboard, and say whether it went. There is no clipboard API outside a secure
 * context — a board served over plain HTTP on the LAN — so that case copies through a selection.
 *
 * Its own module rather than `Share.tsx`'s, where it was written: a code block's copy button is on
 * every read-only page, and a viewer must not fetch the share card to reach it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Falls through to the selection, below. */
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.className = "dag-offscreen";
  document.body.append(box);
  box.select();
  try {
    return document.execCommand("copy");
  } finally {
    box.remove();
  }
}
