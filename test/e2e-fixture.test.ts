import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Every browser check takes `test` from `e2e/fixture.ts`** (#38).
 *
 * That fixture is what pins a spec's pages, and the requests it makes itself, to the suite's vault.
 * A spec that takes `test` from `@playwright/test` has neither, and nothing fails until a loaded
 * machine widens the window in which `vaults.spec.ts` or `sync.spec.ts` has moved the server's
 * default: then its page settles in another vault and 404s. So the import is held here, where it is
 * cheap, rather than found by a flake.
 */
const E2E = "e2e";
const specs = fs.readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));

describe("the e2e fixture", () => {
  it("finds the specs", () => {
    expect(specs.length).toBeGreaterThan(10);
  });

  it.each(specs)("%s takes test from ./fixture, not from @playwright/test", (file) => {
    const text = fs.readFileSync(path.join(E2E, file), "utf8");
    expect(text).toMatch(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*"\.\/fixture"/);
    expect(text).not.toMatch(/from\s*"@playwright\/test"/);
  });

  it("leaves no caller of the hand-written pin it replaced", () => {
    for (const file of fs.readdirSync(E2E).filter((f) => f.endsWith(".ts")))
      expect(fs.readFileSync(path.join(E2E, file), "utf8"), file).not.toMatch(/\bvaulted\(/);
  });
});
