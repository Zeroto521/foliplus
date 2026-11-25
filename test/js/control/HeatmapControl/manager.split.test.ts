// test/js/control/HeatmapControl/manager.split.test.ts — prototype completeness for the manager mixin split.
import { describe, expect, it } from "vitest";
import { canvasMethods } from "#control/HeatmapControl/canvas.js";
import { extractMethods } from "#control/HeatmapControl/extract.js";
import { filterMethods } from "#control/HeatmapControl/filter.js";
import { initMethods } from "#control/HeatmapControl/init.js";
import { lifecycleMethods } from "#control/HeatmapControl/lifecycle.js";
import { HeatmapManager } from "#control/HeatmapControl/manager.js";
import { stateMethods } from "#control/HeatmapControl/state.js";

const MIXINS = {
  canvas: canvasMethods,
  extract: extractMethods,
  filter: filterMethods,
  init: initMethods,
  lifecycle: lifecycleMethods,
  state: stateMethods,
};

const prototype = HeatmapManager.prototype as unknown as Record<string, unknown>;

describe("HeatmapManager mixin split", () => {
  it("installs every mixin method on the prototype", () => {
    const broken: string[] = [];
    for (const [module, methods] of Object.entries(MIXINS)) {
      for (const [name, fn] of Object.entries(methods)) {
        if (typeof fn !== "function") {
          broken.push(`${module}.${name} is not a function`);
        } else if (prototype[name] !== fn) {
          broken.push(`${module}.${name} is not installed on HeatmapManager.prototype`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps every mixin module non-empty", () => {
    for (const [module, methods] of Object.entries(MIXINS)) {
      expect(Object.keys(methods).length, module).toBeGreaterThan(0);
    }
  });
});
