import { resolve } from "path";
import { defineConfig } from "vitest/config";

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
    include: ["test/js/**/*.test.{js,ts}"],
    setupFiles: ["test/js/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["foliplus/js/**/*.js", "foliplus/js/**/*.ts"],
      exclude: [
        "foliplus/js/runtime/**",
        // Entry modules — require browser tests (playwright) to cover wiring
        "foliplus/js/ExportControl/ExportControl.ts",
        "foliplus/js/FullscreenControl/FullscreenControl.ts",
        "foliplus/js/HeatmapControl/HeatmapControl.ts",
        "foliplus/js/LayerControl/LayerControl.ts",
        "foliplus/js/MeasureControl/MeasureControl.ts",
        "foliplus/js/ScaleControl/ScaleControl.ts",
        "foliplus/js/SearchControl/SearchControl.ts",
        // HeatmapControl logic modules — need L.Map, canvas, h3/chroma/ss CDNs.
        // Covered by browser tests (pytest-playwright) in CI.
        "foliplus/js/HeatmapControl/HeatmapControl.logic.ts",
        "foliplus/js/HeatmapControl/HeatmapControl.ui.ts",
        // ExportControl logic modules — need L.Map, canvas, fetch, document.fonts.
        "foliplus/js/ExportControl/ExportControl.manager.ts",
        "foliplus/js/ExportControl/ExportControl.renderer.ts",
        "foliplus/js/ExportControl/ExportControl.ui.ts",
        "foliplus/js/ExportControl/ExportControl.util.ts",
        // LayerControl complex modules — need L.Map, L.DomEvent, panes.
        "foliplus/js/LayerControl/LayerControl.manager.ts",
        "foliplus/js/LayerControl/LayerControl.pane.ts",
        "foliplus/js/LayerControl/LayerControl.ui.ts",
        // MeasureControl complex modules — need L.Map, L.DomEvent, panes.
        "foliplus/js/MeasureControl/MeasureControl.manager.ts",
        "foliplus/js/MeasureControl/MeasureControl.mode.ts",
        "foliplus/js/MeasureControl/MeasureControl.ui.ts",
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
