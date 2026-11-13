import { expect, test, type Page } from "@playwright/test";

/**
 * The chrome's motion comes from one place (#206).
 *
 * Every transition reads `--dag-ui-motion-fast` or `--dag-ui-motion-base`, and one
 * `prefers-reduced-motion` block in `chrome.css` sets both to 0. Before, eight blocks each turned
 * one rule off, and a rule added later had to remember to bring its own. This reads what the
 * browser computed rather than the stylesheet, on controls the page draws for itself, so a
 * duration typed past the tokens shows up here as a number that does not go to zero.
 */

async function home(page: Page): Promise<void> {
  await page.goto("/");
  /* Home draws no board, so it never says `data-dag-ready`; the welcome card is its whole page. */
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 20_000 });
}

/** The computed transition and animation durations of one element of each motion family. */
async function durations(page: Page) {
  return page.evaluate(() => {
    /* Drawn here rather than found: each is a class the chrome styles, so what is read is the
       stylesheet's rule and not whichever page happens to be open. Taken away again after. */
    const made: HTMLElement[] = [];
    const make = (tag: string, className: string, parent: HTMLElement = document.body) => {
      const el = document.createElement(tag);
      el.className = className;
      parent.append(el);
      made.push(el);
      return el;
    };
    const sw = make("input", "dag-switch");
    const chev = make("span", "dag-sidebar__chev");
    const bar = make("span", "dag-run__progress-bar");
    const spin = make("span", "dag-prompt__spin");
    const css = (el: HTMLElement, pseudo?: string) => getComputedStyle(el, pseudo);
    const out = {
      fast: getComputedStyle(document.documentElement).getPropertyValue("--dag-ui-motion-fast").trim(),
      base: getComputedStyle(document.documentElement).getPropertyValue("--dag-ui-motion-base").trim(),
      switch: css(sw).transitionDuration,
      knob: css(sw, "::before").transitionDuration,
      chev: css(chev).transitionDuration,
      bar: css(bar).transitionDuration,
      spin: css(spin).animationName,
    };
    for (const el of made) el.remove();
    return out;
  });
}

test("transitions read the theme's two durations", async ({ page }) => {
  await home(page);
  const d = await durations(page);
  expect(d.fast).toBe("120ms");
  expect(d.base).toBe("160ms");
  expect(d.switch).toBe("0.16s");
  expect(d.knob).toBe("0.16s");
  expect(d.chev).toBe("0.12s");
  expect(d.bar).toBe("0.16s");
  expect(d.spin).toBe("dag-prompt-spin");
});

test("asking for less motion stops every one of them from one block", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await home(page);
  const d = await durations(page);
  expect(d.fast).toBe("0ms");
  expect(d.base).toBe("0ms");
  expect(d.switch).toBe("0s");
  expect(d.knob).toBe("0s");
  expect(d.chev).toBe("0s");
  expect(d.bar).toBe("0s");
  /* A spinner has a period rather than a duration, so it stops instead. */
  expect(d.spin).toBe("none");
});
