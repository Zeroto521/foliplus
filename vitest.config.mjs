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
    // JUnit XML output for Codecov Test Analytics.
    reporters: [
      "default",
      ["junit", { outputFile: "test-report.junit.xml", className: "{filepath}" }],
    ],
    coverage: {
      provider: "v8",
      include: ["foliplus/js/**/*.js", "foliplus/js/**/*.ts"],
      exclude: [
        "foliplus/js/runtime/**",
        // Entry modules — require full Leaflet runtime (L.Control, addTo)
        "foliplus/js/ExportControl/ExportControl.ts",
        "foliplus/js/FullscreenControl/FullscreenControl.ts",
        "foliplus/js/HeatmapControl/HeatmapControl.ts",
        "foliplus/js/LayerControl/LayerControl.ts",
        "foliplus/js/LocateControl/LocateControl.ts",
        "foliplus/js/MeasureControl/MeasureControl.ts",
        "foliplus/js/ScaleControl/ScaleControl.ts",
        "foliplus/js/SearchControl/SearchControl.ts",
        // UI modules — pure DOM builders, covered by browser tests
        "foliplus/js/ExportControl/ExportControl.ui.ts",
        "foliplus/js/ExportControl/ExportControl.renderer.ts",
        "foliplus/js/HeatmapControl/HeatmapControl.ui.ts",
        "foliplus/js/LayerControl/LayerControl.ui.ts",
        "foliplus/js/MeasureControl/MeasureControl.ui.ts",
        // MeasureControl mode subclasses — need L.polyline/L.polygon/L.circle
        "foliplus/js/MeasureControl/MeasureControl.mode.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
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
