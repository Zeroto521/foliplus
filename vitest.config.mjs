import { testPathAliases } from "./script/build-path.mjs";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Single source: script/build-path.mjs (shared with esbuild alias).
    alias: {
      ...testPathAliases(resolve(".")),
      // Test-local alias so deep test files reach the shared path helper
      // (test/js/paths.ts) without a parent-dir chain.
      "#test": resolve(".", "test/js"),
    },
  },
  test: {
    // A ceiling against load-induced timeouts — not a fix, and not a
    // performance budget. The 5 000 ms default is a coin flip on a loaded
    // machine: idle, browser-probe.test.ts runs 21 tests in 319 ms, yet in the
    // full suite that default tripped disk-free tests (runCli, the vocabulary
    // tree scan). The actual fix is building the renderer report in memory,
    // not the number below. 10 000 ms is a ceiling, not a starting point: if a
    // test still times out here it has a defect — find it, do not raise this.
    testTimeout: 10_000,
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
        "foliplus/js/control/*/index.ts",
        // MeasureControl mode subclasses — need L.polyline/L.polygon/L.circle.
        // Glob so a newly added mode is excluded without editing this list.
        "foliplus/js/control/MeasureControl/mode/*.ts",
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
