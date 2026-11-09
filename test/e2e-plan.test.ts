import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { kindOf, plan } from "../scripts/e2e-plan.mjs";

/**
 * **What a change asks of the browser suite** — the rule `.githooks/pre-push` and the `e2e`
 * workflow both read (`scripts/e2e-plan.mjs` says it in full). Held here because a wrong answer in
 * either direction is silent: too little and a push goes out untested, too much and the hook is the
 * thing people turn off.
 */
describe("kindOf", () => {
  it.each([
    ["README.md", "ignore"],
    ["docs/dsl/arch.md", "ignore"],
    ["CLAUDE.md", "ignore"],
    [".github/workflows/ci.yml", "ignore"],
    ["test/parity.test.ts", "ignore"],
    ["desktop/main.ts", "ignore"],
    ["scripts/check-theme.mjs", "ignore"],
    /* a `.md` under boards/ is a fixture the suite draws, not prose */
    ["boards/local/reference/erd.board.md", "pixels"],
    ["boards/local/demo.board.md", "pixels"],
    ["src/layout/size.ts", "pixels"],
    ["src/styles/chrome.css", "pixels"],
    ["icons/data/icons.json", "pixels"],
    ["src/ui/Sidebar.tsx", "app"],
    ["src/note/markdown.ts", "app"],
    ["server/vault.ts", "app"],
    ["cli/main.ts", "app"],
    ["vite.config.ts", "app"],
    ["scripts/dev.sh", "app"],
    ["some/path/nobody/has/heard/of.ts", "app"],
    ["api/server/app.ts", "sync"],
    ["server/sync/engine.ts", "sync"],
    ["playwright.config.ts", "harness"],
    ["package-lock.json", "harness"],
    ["scripts/e2e-docker.sh", "harness"],
    [".github/workflows/e2e.yml", "harness"],
    ["e2e/notes.spec.ts", "spec"],
    ["e2e/keys.ts", "spec"],
    ["e2e/reference.spec.ts-snapshots/reference-erd-paper-linux.png", "snapshot"],
  ])("%s is %s", (file, kind) => {
    expect(kindOf(file)).toBe(kind);
  });
});

describe("plan", () => {
  it("runs nothing for prose, CI config and unit tests", () => {
    const p = plan(["README.md", "docs/PARITY.md", ".github/workflows/ci.yml", "test/x.test.ts"]);
    expect(p.run).toBe(false);
    expect(p.grep).toBeNull();
  });

  it("runs nothing for no change at all", () => {
    expect(plan([]).run).toBe(false);
  });

  it("runs the smoke tier for application code", () => {
    expect(plan(["src/ui/Sidebar.tsx"])).toMatchObject({ run: true, grep: "@smoke" });
    expect(plan(["server/routes/docs.ts", "README.md"])).toMatchObject({ run: true, grep: "@smoke" });
  });

  it("adds the screenshots when a change can move pixels", () => {
    expect(plan(["src/layout/route.ts"]).grep).toBe("@smoke|reference\\.spec\\.ts");
    expect(plan(["boards/local/reference/erd.board.md"]).grep).toBe("@smoke|reference\\.spec\\.ts");
  });

  it("adds the sync spec for the sync server", () => {
    expect(plan(["api/server/routes/logs.ts"]).grep).toBe("@smoke|sync\\.spec\\.ts");
  });

  it("runs the specs a change under e2e/ reaches, and only those, when nothing else changed", () => {
    const traced = () => ["/repo/e2e/notes.spec.ts", "/repo/e2e/refs.spec.ts"];
    const p = plan(["e2e/notes.spec.ts"], traced);
    expect(p.grep).toBe("notes\\.spec\\.ts|refs\\.spec\\.ts");
    expect(p.run).toBe(true);
  });

  it("runs the whole suite when a change under e2e/ reaches no spec", () => {
    expect(plan(["e2e/global-setup.ts"], () => [])).toMatchObject({ run: true, grep: null });
  });

  it("owns a snapshot change to the spec its directory is named for", () => {
    expect(plan(["e2e/export.spec.ts-snapshots/architecture-item-linux.png"], () => []).grep).toBe("export\\.spec\\.ts");
  });

  it("is the union of everything the changes ask for", () => {
    const p = plan(["src/render/Math.tsx", "e2e/math.spec.ts", "docs/x.md"], () => ["math.spec.ts"]);
    expect(p.grep).toBe("@smoke|math\\.spec\\.ts|reference\\.spec\\.ts");
  });

  it("proves the suite still runs when the way it is run changes", () => {
    expect(plan(["playwright.config.ts"]).grep).toBe("@smoke");
  });
});
