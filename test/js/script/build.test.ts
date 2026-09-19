import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Vitest runs with the repo root as cwd, same convention bundle-size-check
// relies on — so dist/ resolves without a parent-directory walk.
const distDir = resolve(process.cwd(), "foliplus/dist");

// Artifact names come from dist/artifacts.json, which `script/build.mjs`
// writes on every real build — the same list `test/python/test_asset.py`
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

  it("common JS has reasonable size (20-160KB)", () => {
    const size = readFileSync(resolve(distDir, "foliplus-common.min.js")).length;
    expect(size).toBeGreaterThan(20000);
    // Unminified dev build (CI path) — this reads the same `--dev` artifact
    // `make test` produces, not the minified release one, even though both
    // share the `.min.js` name. The common bundle is tree-shaken from the
    // component imports scanned into _shared-registry.ts, so this is a real
    // budget: ListCursor pushed it past 100KB, the createLayers panes
    // generalisation (#280) added the per-pane routing, the pluggable
    // geocode provider layer (Nominatim/Photon/Pelias + custom adapter) rides
    // in the same bundle because the runtime registers it on foliplus.core,
    // and the per-layer style panel (#236) shipped labelField + the shared
    // form primitives through the same shell; so do the shared label
    // contracts (field collection, collision geometry) and the label-control
    // renderer (#365) — one module for the heatmap panel and the layer style
    // drawer, replacing two copies. 155KB was the agreed ceiling — #332 raised
    // it first, then the shared renderer needed the next step; the larger
    // value wins on merge. The pane-role refactor added PaneManager.pinTree
    // (+151B) — the recursive pin that puts a GeoJSON group's child paths into
    // the declared pane. The createSurface refactor added a unified registration
    // pipeline (+2.3KB): commonLayerOpts, register/unregister/registered
    // closures, preRegister/preUnregister/shouldUnregister hooks, and the
    // content.kind dispatch. This is new code, not deduplication — the two
    // paths (mainLayer+pinTree vs canvas+resize+cancelMapPaneTranslate) are
    // too different to share content logic. The shared part is the plumbing
    // around it.
    //
    // R9 (the z ladder) is +2667B over 2a381557, dev mode, same command, and
    // every byte of it is in core/layer: the new z.ts module (+568B), plus
    // LayerSurface's setZOverride (+805B), restoreZ (+520B), writeZ (+468B)
    // and their three backing fields (+389B), less the 96B setZ loses because
    // its write loop moved into writeZ, plus 12B of formatting. Every
    // component-level edit lands in a component bundle, so this budget only
    // moves when core/layer does. R5, R9, and R10 raise this same line to
    // 160000, 160000, and 159000; the larger value wins on merge, and once
    // all are in the ceiling should be re-measured on main in dev mode and
    // set once, by one PR.
    //
    // Measured on this branch after merging main: 160897B (createSurface +2.3KB
    // from main, z ladder +2667B from R9, over 2a381557's 155660B). The ceiling
    // must accommodate both — 165000 leaves ~4KB headroom for the next round.
    //
    // R5 (this branch, layer-write-pipeline) adds detectCapabilities,
    // isMarkerCluster, the applyLayerState single write pipeline, the
    // nativeBase per-layer WeakMap, and the annotation pane carrier union —
    // +1771B over 2a381557 in dev mode, same command. Every byte lands in
    // core/layer + LayerControl, so R9's ceiling of 165000 accommodates it
    // with ~4KB headroom still.
    expect(size).toBeLessThan(165000);
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
    // LayerControl is otherwise the largest component (~136KB unminified on
    // main; style-drawer delegation pushed the unminified dev bundle past
    // 160KB — rename, focus, reorder, fold, the annotation style panel, the
    // escape-cancel chain, and the five-dimension persistence).
    "foliplus-LayerControl.min.js": 180000,
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

  it("merged common CSS carries no @import statements", () => {
    // mergeCommonCss resolves the css/common/ import graph at build time and
    // strips the statements; a leftover @import would make the bundle fetch
    // modules at runtime (or fail to resolve) instead of shipping flat.
    const css = readFileSync(resolve(distDir, "foliplus-common.min.css"), "utf-8");
    expect(css).not.toMatch(/@import/);
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
