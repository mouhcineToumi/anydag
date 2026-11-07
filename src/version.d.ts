/**
 * The product version, from the repository's `VERSION` file — `vite.config.ts` defines it for the
 * page, as `cli/build.mjs` does for the CLI. Absent anywhere else (the unit suite, the `dsl`
 * service), so a reader tests `typeof` before it trusts it.
 */
declare const __ANYDAG_VERSION__: string;
