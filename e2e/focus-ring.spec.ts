import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSidebar } from "./sidebar";

/**
 * The chrome's one focus ring.
 *
 * `chrome.css` draws focus as a `box-shadow` — a 2px gap in the surface, then 2px of accent — and
 * only on `:focus-visible`, so a press with a pointer does not light a control up. Rows and menu
 * items keep the same ring inset, because their neighbours would cover its outer half.
 *
 * Two checks. The first tabs through the shell itself and reads every stop in the four regions the
 * issue names; a stop that answers a Tab with no accent ring, or with the browser's own outline, is
 * a failure. The second uses the five shared control classes directly — a probe appended to the
 * page, so the check is about their rules and not about which page happens to have one — and proves
 * the keyboard half on all five, and the pointer half on the four a browser can tell apart from it.
 */

const BOARD = `---
title: Focus ring scratch
---

\`\`\`md {#one x=0 y=0 w=320}
Focus.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-focus-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** `--dag-color-accent` resolved to the `rgb(…)` a computed `box-shadow` or `outline` spells. */
function accentColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--dag-color-accent)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}

interface Style {
  shadow: string;
  outline: string;
  focusVisible: boolean;
}

function readStyle(page: Page, selector: string): Promise<Style> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`nothing matched ${sel}`);
    const style = getComputedStyle(el);
    return {
      shadow: style.boxShadow,
      outline: style.outlineStyle === "none" ? "none" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      focusVisible: el.matches(":focus-visible"),
    };
  }, selector);
}

const ringed = (style: Style, accent: string): boolean =>
  (style.shadow !== "none" && style.shadow.includes(accent)) || (style.outline !== "none" && style.outline.includes(accent));

interface Stop {
  region: "sidebar" | "toolbar" | "dock" | "zoom";
  where: string;
  style: Style;
}

/** The focused element, when it is inside one of the shell's four regions. */
function readStop(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const region = el.closest("[data-dag-sidebar]")
      ? ("sidebar" as const)
      : el.closest("[data-dag-toolbar]")
        ? ("toolbar" as const)
        : el.closest("[data-dag-dock]")
          ? ("dock" as const)
          : el.closest("[data-dag-zoombar]")
            ? ("zoom" as const)
            : null;
    if (!region) return null;
    const style = getComputedStyle(el);
    const label = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
    return {
      region,
      where: `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}${label ? ` "${label}"` : ""}`,
      style: {
        shadow: style.boxShadow,
        outline: style.outlineStyle === "none" ? "none" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        focusVisible: el.matches(":focus-visible"),
      },
    };
  });
}

test("every stop in the shell carries the accent ring", async ({ page }) => {
  await open(page);
  await openSidebar(page);
  const accent = await accentColour(page);

  /* From the top of the document, the way a person reaches the chrome without a pointer. */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const stops: Stop[] = [];
  const seen = new Set<string>();
  let afterZoom = 0;
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press("Tab");
    const stop = await readStop(page);
    if (!stop) {
      /* The dock and the zoom bar are the last two regions; a stop past the zoom bar is outside. */
      if (seen.has("zoom")) break;
      continue;
    }
    stops.push(stop);
    seen.add(stop.region);
    if (stop.region === "zoom") afterZoom++;
    else if (afterZoom > 0) break;
  }

  /* A sweep that skipped a region would pass every assertion under it. */
  expect([...seen].sort(), "regions reached by Tab").toEqual(["dock", "sidebar", "toolbar", "zoom"]);
  expect(stops.length, "stops found").toBeGreaterThan(20);

  /* Representative controls, so a region proving itself with one stop is not enough. */
  const where = stops.map((stop) => stop.where).join("\n");
  expect(where, "a sidebar row is a stop").toContain("dag-sidebar__act");
  expect(where, "a top-bar control is a stop").toContain("dag-toolbar__board");
  expect(where, "a dock icon is a stop").toContain("dag-icon");
  expect(where, "the zoom percentage is a stop").toContain("dag-zoombar__pct");

  const failures = stops
    .filter((stop) => !ringed(stop.style, accent))
    .map((stop) => `${stop.region}: ${stop.where} — shadow ${stop.style.shadow}; outline ${stop.style.outline}`);
  expect(failures, "every stop has the accent ring").toEqual([]);
});

test("the shared controls ring on the keyboard, and not on a click", async ({ page }) => {
  await open(page);
  const accent = await accentColour(page);

  /* The shared classes, on real elements, in a fixed layer of their own: the rule belongs to the
     class, and this is the one place every one of the five is reachable without opening a panel. */
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "focus-probe";
    host.style.cssText =
      "position: fixed; top: 0; left: 0; z-index: 99999; display: flex; gap: 8px; padding: 8px; background: var(--dag-color-card);";
    host.innerHTML = `
      <button class="dag-icon" id="probe-icon">Icon</button>
      <button class="dag-button" id="probe-button">Button</button>
      <select class="dag-select" id="probe-select"><option>One</option><option>Two</option></select>
      <input type="checkbox" class="dag-switch" id="probe-switch" aria-label="Switch">
      <input type="checkbox" class="dag-check" id="probe-check" aria-label="Check">
    `;
    document.body.prepend(host);
  });

  const probes = ["probe-icon", "probe-button", "probe-select", "probe-switch", "probe-check"];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  for (const id of probes) {
    await page.keyboard.press("Tab");
    await expect(page.locator(`#${id}`), `${id} is the next Tab stop`).toBeFocused();
    const style = await readStyle(page, `#${id}`);
    expect(style.focusVisible, `${id} is focus-visible from the keyboard`).toBe(true);
    expect(ringed(style, accent), `${id} draws the accent ring on the keyboard`).toBe(true);
  }

  /* A click focuses the control, but is not a request to see where the keys would land. The select
     is left out of this half: Chromium matches `:focus-visible` on a `<select>` however it was
     focused, because a select is a keyboard control, and no CSS rule can tell that click from a
     Tab. Its rule is the same `:focus-visible` as the other four, which is all the stylesheet can
     say. It is not clicked at all here, so its popup cannot swallow a later press. */
  for (const id of probes) {
    if (id === "probe-select") continue;
    await page.locator(`#${id}`).click();
    await expect(page.locator(`#${id}`), `${id} keeps the focus a click gave it`).toBeFocused();
    const style = await readStyle(page, `#${id}`);
    expect(style.focusVisible, `${id} is not focus-visible after a click`).toBe(false);
    expect(ringed(style, accent), `${id} draws no accent ring after a click`).toBe(false);
  }
});
