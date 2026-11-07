/**
 * A folder of quizzes run as one: which quizzes, and in what order.
 *
 * **Every quiz under the folder, subfolders included** — a project's rule (`within` in
 * `src/note/project.ts`), so the course a person split into topic quizzes is one run however deep the
 * topics go. **In the order the sidebar shows them**: at each level its folders before its quizzes,
 * each by what it says, numbers read as numbers — so *2 · Joins* comes before *10 · Windows*, and a
 * run asks the course in the order the person reads it.
 *
 * No browser, no React, no `@/` aliases: the CLI imports this verbatim.
 */

/** `name` is under `folder` — never the folder itself, never the top level. */
const under = (name: string, folder: string): boolean => folder !== "" && name.startsWith(`${folder}/`);

const byWords = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The quizzes under `folder`, in the sidebar's order. `titles` is the listing's: a quiz is placed by
 * its title, a folder by its own name.
 */
export function folderQuizzes(quizzes: readonly string[], titles: Readonly<Record<string, string>>, folder: string): string[] {
  const label = (name: string) => titles[name] ?? name.slice(name.lastIndexOf("/") + 1);
  return quizzes
    .filter((name) => under(name, folder))
    .sort((a, b) => {
      const pa = a.slice(folder.length + 1).split("/");
      const pb = b.slice(folder.length + 1).split("/");
      for (let i = 0; ; i++) {
        const lastA = i === pa.length - 1;
        const lastB = i === pb.length - 1;
        /* A folder before a quiz at the same level, as the tree draws them. */
        if (lastA !== lastB) return lastA ? 1 : -1;
        if (lastA) return byWords(label(a), label(b)) || byWords(a, b);
        const by = byWords(pa[i]!, pb[i]!);
        if (by) return by;
      }
    });
}

/** The folder's own name, for the run's title. */
export const folderLabel = (folder: string): string => folder.slice(folder.lastIndexOf("/") + 1);

/** `?quizzes=1&run=folder:<path>`: the folder a run names, or `null` when it names none. */
export function folderOfRun(run: string | null | undefined): string | null {
  if (!run?.startsWith("folder:")) return null;
  const folder = run.slice("folder:".length).replace(/^\/+|\/+$/g, "");
  return folder || null;
}
