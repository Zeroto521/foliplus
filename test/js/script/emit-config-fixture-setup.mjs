#!/usr/bin/env node
/**
 * Vitest globalSetup: regenerate test/js/config-fixture.ts before any test runs.
 *
 * The fixture's default CONFIG values are generated from foliplus/_config_schema.py, so
 * a stale fixture silently mismatches the schema on any vitest entry point that
 * does not go through `npm test` — `npx vitest run <file>`, an IDE test runner,
 * or `vitest` invoked directly. An npm `pretest` hook only covers `npm test`,
 * so the regeneration lives here: vitest runs globalSetup once per invocation,
 * before any test file is imported, and a generator failure aborts the run
 * instead of letting tests read a stale fixture.
 */
import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupFixture = () => {
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, "emit-config-fixture.mjs")],
    { stdio: "pipe", encoding: "utf-8" },
  );
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status);
};

export { setupFixture as default };
