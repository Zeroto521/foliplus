import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/js/**/*.test.js"],
    setupFiles: ["test/js/setup.js"],
    coverage: {
      provider: "v8",
      include: ["foliplus/js/**/*.js"],
      exclude: [
        "foliplus/js/runtime/**",
        "foliplus/js/ExportControl/ExportControl.js",
        "foliplus/js/FullscreenControl/FullscreenControl.js",
        "foliplus/js/HeatmapControl/HeatmapControl.js",
        "foliplus/js/LayerControl/LayerControl.js",
        "foliplus/js/MeasureControl/MeasureControl.js",
        "foliplus/js/ScaleControl/ScaleControl.js",
        "foliplus/js/SearchControl/SearchControl.js",
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
