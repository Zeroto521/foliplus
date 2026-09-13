import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// Four levels up from test/js/script/ is the repo root. Resolving from the
// module's own path keeps this independent of where the test is launched.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const distDir = resolve(repoRoot, "foliplus/dist");

// Artifact names come from dist/artifacts.json, which `script/build.mjs`
// writes on every real build — the same list `test/python/test_assets.py`
// asserts wheel membership against. A new component therefore shows up in
// both stacks without either test hardcoding its name.
const names = JSON.parse(
  readFileSync(resolve(distDir, "artifacts.json"), "utf-8"),
).artifacts;
const artifactsFor = ext => names.map(name => `foliplus-${name}.min.${ext}`);

const JS_ARTIFACTS = artifactsFor("js");
const CSS_ARTIFACTS = artifactsFor("css");

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

  it("common JS exposes foliplus.version", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("foliplus.version");
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

  it("common JS has reasonable size (20-115KB)", () => {
    const size = readFileSync(resolve(distDir, "foliplus-common.min.js")).length;
    expect(size).toBeGreaterThan(20000);
    // Unminified dev build (CI path). The common bundle is tree-shaken from the
    // component imports scanned into _shared-registry.ts, so this is a real
    // budget: ListCursor pushed it past 100KB, and the createLayers panes
    // generalisation (#280) added the per-pane routing to the same bundle.
    expect(size).toBeLessThan(115000);
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
    // LayerControl is otherwise the largest component (~113KB unminified now:
    // rename, focus, reorder, fold, and the four-dimension persistence).
    // Raised past 130KB by the attributes panel (#241).
    "foliplus-LayerControl.min.js": 140000,
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

  it("manifest covers both halves of every component", () => {
    for (const name of names) {
      expect(JS_ARTIFACTS).toContain(`foliplus-${name}.min.js`);
      expect(CSS_ARTIFACTS).toContain(`foliplus-${name}.min.css`);
    }
    expect(names).toContain("common");
    expect(names).not.toContain("runtime");
  });
});
