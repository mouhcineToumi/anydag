import { currentVault, withVault } from "@/vault/current";
import { desktop } from "@/vault/desktop";

/**
 * The link to a file in the app, by its permanent id: `?ref=<id>`, which the page resolves
 * to whatever the file is called now — so it survives a rename and a move, as a reference in a note
 * does. In the desktop app it is the deep link `anydag://open?vault=<id>&ref=<id>`, which the OS
 * hands to the app from anywhere it is pasted; on `anydag serve` it is this page's own address.
 */
export function appLink(id: string): string {
  if (desktop()) {
    const vault = currentVault();
    return `anydag://open?${vault ? `vault=${encodeURIComponent(vault)}&` : ""}ref=${encodeURIComponent(id)}`;
  }
  return new URL(withVault(`/?ref=${encodeURIComponent(id)}`), location.origin).href;
}
