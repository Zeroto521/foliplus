import { resolve } from "path";
import { defineConfig } from "vitest/config";
import { testPathAliases } from "./script/build-path.mjs";

export default defineConfig({
  resolve: {
    // Single source: script/build-path.mjs (shared with esbuild alias).
    alias: testPathAliases(resolve(".")),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/js/**/*.test.ts"],
    setupFiles: ["test/js/setup.ts"],
    // JUnit XML output for Codecov Test Analytics.
    reporters: [
      "default",
      ["junit", { outputFile: "test-js.junit.xml", className: "{filepath}" }],
    ],
    coverage: {
      provider: "v8",
      include: ["foliplus/js/**/*.ts", "script/**/*.mjs"],
      exclude: [
        // Build orchestrator — spawns python/git/esbuild subprocesses and needs
        // the full build pipeline; not unit-testable in isolation.
        "script/build/build.mjs",
        // Locale key scanner — CLI validated by the Python locale test suite,
        // not unit-tested.
        "script/check/scan-locale-key.mjs",
        "foliplus/js/runtime/**",
        // Entry modules — require full Leaflet runtime (L.Control, addTo).
        // Glob so a newly scaffolded control is excluded without editing this list.
        "foliplus/js/*/index.ts",
        // MeasureControl mode subclasses — need L.polyline/L.polygon/L.circle.
        // Glob so a newly added mode is excluded without editing this list.
        "foliplus/js/MeasureControl/mode/*.ts",
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
