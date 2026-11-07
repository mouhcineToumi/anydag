/**
 * Kept so the tests that import it still name why: `node:sqlite` is aliased to `test/node-sqlite.ts`
 * in `vitest.config.ts`, which replaced the `vi.mock` that lived here (it broke under `isolate: false`).
 */
export {};
