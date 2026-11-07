/**
 * Following a reference without leaving the page.
 *
 * A reference is a link to `?ref=<id>`, and following one was a page load: the fonts, the session,
 * the workspaces, the preferences, the editor's chunk and the list of files all asked for again, and
 * the sidebar empty while they were. The app is one page that changes what it shows by its query, so
 * a link it can open itself is opened by it — `App` listens, and says it took the link by cancelling
 * the event. A page with nobody listening — `?view=1`, a share link's page — goes the way it always
 * did, and so does a click with a modifier, which is a new tab.
 *
 * Most references are plain `<a>`s, and `App` catches their clicks itself. This is for the two that
 * navigate by hand: a chip inside the note editor, where a click on a link in an editable text goes
 * nowhere on its own, and a table's card, which stops its click from reaching the board under it.
 */
export const FOLLOW = "dag:follow";

/** Go to `href`: inside the app when the page can open it, by loading it when it cannot. */
export function follow(href: string): void {
  const asked = new CustomEvent<string>(FOLLOW, { detail: href, cancelable: true });
  if (document.dispatchEvent(asked)) location.assign(href);
}
