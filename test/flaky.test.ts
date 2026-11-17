import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { clean, flakes, titleOf } from "../scripts/flaky.mjs";

/**
 * **The tests that passed only on retry** (#494): what the nightly reads out of its merged Playwright
 * report and keeps an issue for. The report's shape here is the JSON reporter's, as a merge of the CI
 * shards' blobs gives it — a file's suite, describes nested in it, specs, and a test per project.
 */
const report = {
  suites: [
    {
      title: "sidebar.spec.ts",
      file: "sidebar.spec.ts",
      specs: [
        {
          title: "passes every time",
          file: "sidebar.spec.ts",
          line: 10,
          tests: [{ status: "expected", projectName: "", results: [{ status: "passed" }] }],
        },
      ],
      suites: [
        {
          title: "the tree's empty space",
          file: "sidebar.spec.ts",
          specs: [
            {
              title: "opens the + menu at the pointer",
              file: "sidebar.spec.ts",
              line: 962,
              tests: [
                {
                  status: "flaky",
                  projectName: "",
                  results: [
                    {
                      status: "failed",
                      error: { message: "\u001b[31mTypeError\u001b[39m: Cannot read properties of null (reading 'x')" },
                    },
                    { status: "passed" },
                  ],
                },
              ],
            },
            {
              title: "failed both tries",
              file: "sidebar.spec.ts",
              line: 1009,
              tests: [{ status: "unexpected", projectName: "", results: [{ status: "failed" }, { status: "failed" }] }],
            },
          ],
        },
      ],
    },
    {
      title: "templates.spec.ts",
      file: "templates.spec.ts",
      specs: [
        {
          title: "timed out, then passed",
          file: "templates.spec.ts",
          line: 110,
          tests: [
            {
              status: "flaky",
              projectName: "",
              results: [{ status: "timedOut", errors: [{ message: "Test timeout of 30000ms exceeded." }] }, { status: "passed" }],
            },
          ],
        },
        {
          title: "skipped",
          file: "templates.spec.ts",
          line: 200,
          tests: [{ status: "skipped", projectName: "", results: [] }],
        },
      ],
    },
  ],
};

describe("flakes", () => {
  it("lists a test that failed and then passed, and nothing that passed, failed outright or was skipped", () => {
    expect(flakes(report).map((f: { name: string }) => f.name)).toEqual([
      "e2e/sidebar.spec.ts › the tree's empty space › opens the + menu at the pointer",
      "e2e/templates.spec.ts › timed out, then passed",
    ]);
  });

  it("keeps the line, and the failed try's first error without its colours", () => {
    const [first, second] = flakes(report);
    expect(first).toMatchObject({
      file: "e2e/sidebar.spec.ts",
      line: 962,
      error: "TypeError: Cannot read properties of null (reading 'x')",
    });
    expect(second.error).toBe("Test timeout of 30000ms exceeded.");
  });

  it("names a test in two projects once", () => {
    const twice = structuredClone(report);
    const spec = twice.suites[1]!.specs[0]!;
    spec.tests.push({ ...spec.tests[0]!, projectName: "firefox" });
    expect(flakes(twice)).toHaveLength(2);
  });

  it("says nothing of a report with no flaky test", () => {
    expect(flakes({ suites: [] })).toEqual([]);
    expect(flakes({})).toEqual([]);
  });
});

describe("titleOf and clean", () => {
  it("titles the issue by the test's name, not its line, which moves", () => {
    expect(titleOf({ name: "e2e/a.spec.ts › b" })).toBe("flaky: e2e/a.spec.ts › b");
    expect(titleOf({ name: "x".repeat(400) })).toHaveLength(200);
  });

  it("keeps an error to 25 lines", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(clean(long).split("\n")).toHaveLength(26);
  });
});
