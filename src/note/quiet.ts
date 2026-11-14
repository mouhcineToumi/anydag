/**
 * How a note's frontmatter is read: **errors still throw, and warnings are not printed.**
 *
 * A template's frontmatter is written with `{{…}}` in it — `due: {{date}}` is a flow map holding a flow
 * map, which `yaml` reads and then warns about ("Keys with collection values will be stringified") on
 * every parse, to the server's stderr and the page's console. Nothing is wrong with the file: it is
 * a template, and the value is not YAML until it is filled. A warning is not an answer anyone here
 * acts on, and a console line fails every browser spec.
 *
 * No browser, no React, no `@/` aliases: the server imports this.
 */
export const QUIET = { logLevel: "error" } as const;
