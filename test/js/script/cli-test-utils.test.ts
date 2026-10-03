import { afterEach, describe, expect, it, vi } from "vitest";
import { trapExit } from "./cli-test-utils";

// `runCli` is exercised end-to-end by every CLI-entry `--help` test in
// script/build/*-test.ts and script/tool/new-control.test.ts; keeping a
// runCli case here would trigger a vi.resetModules() import in the same
// worker as the scripts' own doMock'd dynamic imports and trip vitest's
// path-registry cache. trapExit is pure — one unit is enough.
describe("cli-test-utils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("trapExit turns process.exit into an exit:<code> throw", () => {
    const exit = trapExit();
    expect(() => process.exit(3)).toThrow("exit:3");
    expect(exit).toHaveBeenCalledWith(3);
  });
});
