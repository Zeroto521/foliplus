/**
 * CLI test harness for scripts that keep their argv/help/error handling at
 * module top level. A script's `main()` is unit-tested directly, but the CLI
 * entry branch (`process.argv[1] === import.meta.url`) is only reachable by
 * re-importing the module with `process.argv` pointing at that very file.
 *
 * The harness below swaps `process.argv`, re-runs the module body via
 * `vi.resetModules()`, and restores argv on exit. `trapExit` turns
 * `process.exit` into a rejection instead of killing the worker.
 */
import { vi } from "vitest";

/** Replace `process.exit` with a spy that throws `exit:<code>`. */
export const trapExit = () =>
  vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`exit:${code}`);
    });

/**
 * Import a script with a replaced `process.argv`, then restore argv.
 *
 * @param scriptPath — bare specifier the test wants to import
 *   (e.g. `"#script/build/bundle-fuse.mjs"`).
 * @param argv — full argv; `argv[1]` is what the CLI-entry guard compares
 *   against the module URL.
 */
export const runCli = async (scriptPath: string, argv: string[]) => {
  const original = process.argv;
  try {
    Object.defineProperty(process, "argv", {
      value: argv,
      writable: true,
      configurable: true,
    });
    vi.resetModules();
    return await import(scriptPath);
  } finally {
    Object.defineProperty(process, "argv", {
      value: original,
      writable: true,
      configurable: true,
    });
  }
};
