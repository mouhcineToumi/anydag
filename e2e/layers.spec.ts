import { expect, test, type Page } from "@playwright/test";

/**
 * The chrome has three shadows and five layers (#206).
 *
 * Every menu and popover reads `--dag-ui-layer-popover`, every dialog and scrim
 * `--dag-ui-layer-modal`, the toast stack `--dag-ui-layer-toast` and a tooltip
 * `--dag-ui-layer-tooltip`; a bar over the canvas is on `chrome`. Before, a dock menu sat at 6,
 * under a notice, and three menus at 30, 40 and 60 disagreed about what a menu is. This reads what
 * the browser computed on elements drawn from the chrome's own classes, so a number typed past the
 * tokens shows up as a layer that does not match.
 */

async function home(page: Page): Promise<void> {
  await page.goto("/");
  /* Home draws no board, so it never says `data-dag-ready`; the welcome card is its whole page. */
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 20_000 });
}

/** The computed z-index and box-shadow of one element per class, and the five layer tokens. */
async function read(page: Page, classes: string[]) {
  return page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    const layer = (n: string) => Number(root.getPropertyValue(`--dag-ui-layer-${n}`));
    const z: Record<string, number> = {};
    const shadow: Record<string, string> = {};
    for (const name of names) {
      const el = document.createElement("div");
      el.className = name;
      document.body.append(el);
      const css = getComputedStyle(el);
      z[name] = Number(css.zIndex);
      shadow[name] = css.boxShadow;
      el.remove();
    }
    const elevation = (n: string) => {
      const probe = document.createElement("div");
      probe.style.boxShadow = `var(--dag-ui-elevation-${n})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).boxShadow;
      probe.remove();
      return value;
    };
    return {
      layers: {
        chrome: layer("chrome"),
        popover: layer("popover"),
        modal: layer("modal"),
        toast: layer("toast"),
        tooltip: layer("tooltip"),
      },
      elevation: { raised: elevation("raised"), overlay: elevation("overlay"), modal: elevation("modal") },
      z,
      shadow,
    };
  }, classes);
}

test("the five layers are ordered, and a menu sits above chrome and under a dialog and a toast", async ({ page }) => {
  await home(page);
  const d = await read(page, [
    "dag-dock",
    "dag-more__menu",
    "dag-sidebar__menu",
    "dag-export__menu",
    "dag-pagemore__menu",
    "dag-dialog",
    "dag-toasts",
    "dag-tip__bubble",
  ]);
  const { layers, z } = d;
  expect(layers).toEqual({ chrome: 10, popover: 20, modal: 30, toast: 40, tooltip: 50 });

  expect(z["dag-dock"]).toBe(layers.chrome);
  /* Every menu is the one popover layer. The dock's menu was drawn under the problems count; a
     number cannot say that across stacking contexts, so `problems.spec.ts` checks it by pointer. */
  for (const menu of ["dag-more__menu", "dag-sidebar__menu", "dag-export__menu", "dag-pagemore__menu"]) {
    expect(z[menu], menu).toBe(layers.popover);
  }
  /* A dialog covers a menu; a toast covers a dialog; a tooltip covers everything. */
  expect(z["dag-dialog"]).toBe(layers.modal);
  expect(z["dag-dialog"]).toBeGreaterThan(z["dag-more__menu"]);
  expect(z["dag-toasts"]).toBe(layers.toast);
  expect(z["dag-toasts"]).toBeGreaterThan(z["dag-dialog"]);
  expect(z["dag-tip__bubble"]).toBe(layers.tooltip);
  expect(z["dag-tip__bubble"]).toBeGreaterThan(z["dag-toasts"]);
});

test("a scrim is a modal layer, and a menu portalled out of a dialog stays above it", async ({ page }) => {
  await home(page);
  const d = await read(page, ["dag-shortcuts__scrim", "dag-settings__scrim", "dag-modelpicker__popover"]);
  expect(d.z["dag-shortcuts__scrim"]).toBe(d.layers.modal);
  expect(d.z["dag-settings__scrim"]).toBe(d.layers.modal);
  /* The model picker is portalled to <body> from inside Settings, so it has to outrank the dialog. */
  expect(d.z["dag-modelpicker__popover"]).toBeGreaterThan(d.layers.modal);
  expect(d.z["dag-modelpicker__popover"]).toBeLessThan(d.layers.toast);
});

test("shadows come in three heights, and a menu is the overlay one", async ({ page }) => {
  await home(page);
  const d = await read(page, ["dag-dock", "dag-more__menu", "dag-welcome"]);
  const { raised, overlay, modal } = d.elevation;
  expect(new Set([raised, overlay, modal]).size).toBe(3);
  expect(d.shadow["dag-dock"]).toBe(raised);
  expect(d.shadow["dag-more__menu"]).toBe(overlay);
  expect(d.shadow["dag-welcome"]).toBe(modal);
});
