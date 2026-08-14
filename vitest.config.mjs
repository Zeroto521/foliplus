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
        "foliplus/js/ExportControl/index.ts",
        "foliplus/js/FullscreenControl/index.ts",
        "foliplus/js/HeatmapControl/index.ts",
        "foliplus/js/LayerControl/index.ts",
        "foliplus/js/LocateControl/index.ts",
        "foliplus/js/MeasureControl/index.ts",
        "foliplus/js/ScaleControl/index.ts",
        "foliplus/js/SearchControl/index.ts",
        // UI modules — pure DOM builders, covered by browser tests
        "foliplus/js/ExportControl/ui.ts",
        "foliplus/js/ExportControl/renderer.ts",
        "foliplus/js/HeatmapControl/ui.ts",
        "foliplus/js/LayerControl/ui.ts",
        "foliplus/js/MeasureControl/ui.ts",
        // MeasureControl mode subclasses — need L.polyline/L.polygon/L.circle
        "foliplus/js/MeasureControl/mode.ts",
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
