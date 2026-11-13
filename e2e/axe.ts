import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * The accessibility gate for the shell.
 *
 * **axe comes from the package**, never a CDN: `@axe-core/playwright` injects the `axe-core`
 * build installed with the suite, so a run has no network and the version is the lockfile's.
 *
 * A page fails on a **critical or serious** violation, and on the three landmark rules that
 * describe how the shell is framed even when axe rates them moderate: one `main`, one banner,
 * and every piece of page content inside a landmark.
 */
const ALWAYS = new Set(["landmark-one-main", "landmark-no-duplicate-banner", "region"]);

const blocking = (impact: string | null | undefined, id: string) =>
  impact === "critical" || impact === "serious" || ALWAYS.has(id);

/** Run axe over the page and fail with the rules and elements that matter, if any. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter((v) => blocking(v.impact, v.id));
  const report = violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n${v.nodes
          .map((n) => `  ${n.target.join(" ")}\n    ${n.failureSummary ?? ""}`)
          .join("\n")}`,
    )
    .join("\n\n");
  expect(violations, violations.length ? `axe found:\n\n${report}` : undefined).toEqual([]);
}
