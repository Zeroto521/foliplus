import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "#common": resolve("foliplus/js/common"),
      "#foliplus": resolve("foliplus/js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/js/**/*.test.js"],
    setupFiles: ["test/js/setup.js"],
    coverage: {
      provider: "v8",
      include: ["foliplus/js/**/*.js", "foliplus/js/**/*.ts"],
      exclude: [
        "foliplus/js/runtime/**",
        // Entry modules — require browser tests (playwright) to cover wiring
        "foliplus/js/ExportControl/ExportControl.js",
        "foliplus/js/FullscreenControl/FullscreenControl.js",
        "foliplus/js/HeatmapControl/HeatmapControl.js",
        "foliplus/js/LayerControl/LayerControl.js",
        "foliplus/js/MeasureControl/MeasureControl.js",
        "foliplus/js/ScaleControl/ScaleControl.js",
        "foliplus/js/SearchControl/SearchControl.js",
        // HeatmapControl logic modules — need L.Map, canvas, h3/chroma/ss CDNs.
        // Covered by browser tests (pytest-playwright) in CI.
        "foliplus/js/HeatmapControl/HeatmapControl.logic.js",
        "foliplus/js/HeatmapControl/HeatmapControl.ui.js",
        // ExportControl logic modules — need L.Map, canvas, fetch, document.fonts.
        "foliplus/js/ExportControl/ExportControl.manager.js",
        "foliplus/js/ExportControl/ExportControl.renderer.js",
        "foliplus/js/ExportControl/ExportControl.ui.js",
        "foliplus/js/ExportControl/ExportControl.util.js",
        // LayerControl complex modules — need L.Map, L.DomEvent, panes.
        "foliplus/js/LayerControl/LayerControl.manager.js",
        "foliplus/js/LayerControl/LayerControl.pane.js",
        "foliplus/js/LayerControl/LayerControl.ui.js",
        // MeasureControl complex modules — need L.Map, L.DomEvent, panes.
        "foliplus/js/MeasureControl/MeasureControl.manager.js",
        "foliplus/js/MeasureControl/MeasureControl.mode.js",
        "foliplus/js/MeasureControl/MeasureControl.ui.js",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Thresholds: prevent accidental coverage regression.
      // Excluded browser-dependent modules are covered by pytest-playwright.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
  define: {
    // Jinja IIFE free variables — each test can override as needed.
    // Use a minimal object so module-level code (createTranslator) doesn't crash.
    // Tests that need specific CONF properties should mock the module at import.
    CONF: "{}",
    map: "{}",
  },
});
