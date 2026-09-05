import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = resolve(fileURLToPath(import.meta.url), "../../../..");
const distDir = resolve(__dirname, "foliplus/dist");

const JS_ARTIFACTS = [
  "foliplus-common.min.js",
  "foliplus-ExportControl.min.js",
  "foliplus-FullscreenControl.min.js",
  "foliplus-HeatmapControl.min.js",
  "foliplus-LayerControl.min.js",
  "foliplus-LocateControl.min.js",
  "foliplus-MeasureControl.min.js",
  "foliplus-ScaleControl.min.js",
  "foliplus-SearchControl.min.js",
];

const CSS_ARTIFACTS = [
  "foliplus-common.min.css",
  "foliplus-ExportControl.min.css",
  "foliplus-FullscreenControl.min.css",
  "foliplus-HeatmapControl.min.css",
  "foliplus-LayerControl.min.css",
  "foliplus-MeasureControl.min.css",
  "foliplus-ScaleControl.min.css",
  "foliplus-SearchControl.min.css",
];

describe("build artifacts", () => {
  it("all JS artifacts exist", () => {
    for (const artifact of JS_ARTIFACTS) {
      expect(existsSync(resolve(distDir, artifact)), artifact).toBe(true);
    }
  });

  it("all CSS artifacts exist", () => {
    for (const artifact of CSS_ARTIFACTS) {
      expect(existsSync(resolve(distDir, artifact)), artifact).toBe(true);
    }
  });

  it("common JS contains BaseControl class", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("BaseControl");
  });

  it("common JS contains L.Control (Leaflet base)", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("L.Control");
  });

  it("common JS has version banner", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("foliplus@");
    expect(content).toMatch(/\/\*!/);
  });

  it("component JS externalizes BaseControl", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ScaleControl.min.js"),
      "utf-8",
    );
    expect(content).toContain("foliplus.BaseControl");
  });

  it("component JS externalizes common modules", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ExportControl.min.js"),
      "utf-8",
    );
    expect(content).toContain("foliplus.common");
  });

  it("component JS does NOT bundle common modules", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ScaleControl.min.js"),
      "utf-8",
    );
    expect(content).not.toContain("class BaseControl");
  });

  it("common JS has reasonable size (20-100KB)", () => {
    const size = readFileSync(resolve(distDir, "foliplus-common.min.js")).length;
    expect(size).toBeGreaterThan(20000);
    expect(size).toBeLessThan(100000);
  });

  // Per-component upper bounds. These are sanity checks against accidental
  // bloat (e.g. an inline'd shared module or duplicated logic), not hard
  // budgets — the lower bound of >500 B guards against an empty bundle.
  // NOTE: CI runs make test -> npm run build:dev, which writes UNMINIFIED
  // output to the .min.js artifacts (the production minified build overwrites
  // them later). So these caps must accommodate the unminified dev size, not
  // the minified size — each carries ~20% headroom for future growth.
  const MAX_COMPONENT_SIZE = {
    // MeasureControl bundles its own label-collision geometry (placeLabels)
    // inline.
    "foliplus-MeasureControl.min.js": 120000,
    // LayerControl is otherwise the largest component (~98KB local, ~102KB CI
    // after feature additions: rename, focus, reorder, fold).
    "foliplus-LayerControl.min.js": 110000,
    // HeatmapControl embeds the whole h3 build twice: once as the worker
    // source string (the inline bundle has no same-origin URL to hand
    // `new Worker` a path) and once in the main-thread fallback.  The worker
    // copy is always minified by the inline plugin, so the component lands at
    // ~260 KB regardless of the dev/prod build mode.
    "foliplus-HeatmapControl.min.js": 330000,
  };
  it("component JS has reasonable size", () => {
    for (const artifact of JS_ARTIFACTS.filter(a => a !== "foliplus-common.min.js")) {
      const size = readFileSync(resolve(distDir, artifact)).length;
      expect(size, artifact).toBeGreaterThan(500);
      const limit = MAX_COMPONENT_SIZE[artifact] ?? 100000;
      expect(size, artifact).toBeLessThan(limit);
    }
  });

  it("CSS files are non-empty", () => {
    for (const artifact of CSS_ARTIFACTS) {
      const size = readFileSync(resolve(distDir, artifact)).length;
      expect(size, artifact).toBeGreaterThan(0);
    }
  });

  it("has correct number of JS artifacts", () => {
    const jsFiles = readdirSync(distDir).filter(f => f.endsWith(".min.js"));
    expect(jsFiles.length).toBeGreaterThanOrEqual(JS_ARTIFACTS.length);
  });

  it("has correct number of CSS artifacts", () => {
    const cssFiles = readdirSync(distDir).filter(f => f.endsWith(".min.css"));
    expect(cssFiles.length).toBeGreaterThanOrEqual(CSS_ARTIFACTS.length);
  });
});
