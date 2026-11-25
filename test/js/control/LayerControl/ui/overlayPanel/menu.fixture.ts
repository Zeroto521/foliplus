// test/js/control/LayerControl/ui/style/menu.fixture — shared stubs for the menu aspect suites.
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

export const cssDir = repoPath("foliplus/css");

export const read = (name: string): string =>
  readFileSync(resolve(cssDir, name), "utf8");

export const layerMenuCss = read("control/LayerControl/menu.css");

export const sharedMenuCss = read("common/menu.css");

/** The declarations block that follows the first occurrence of `selector`. */
export const blockOf = (css: string, selector: string): string => {
  const at = css.indexOf(selector);
  expect(at, `missing selector: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
};
