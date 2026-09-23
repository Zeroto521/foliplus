// Isolation invariant: tests that run in the same file must not see each
// other's localStorage. This gate would have caught T85 (destroy() silently
// cleared localStorage, masking a missing `bindPopup` in a local mock).
//
// The counter-proof for this gate is in .foliplus/gate1-counterproof.md:
// comment out the global `beforeEach(resetState)` in setup.ts, re-run this
// file, and it must fail. Restoring the line and re-running must pass.

import { beforeEach, describe, expect, it } from "vitest";

// `beforeEach` is imported to make the dependency on setup.ts explicit —
// without it, the test file itself would need to clear localStorage, which
// is exactly the failure mode this gate is designed to detect.
void beforeEach;

describe("test isolation — localStorage does not leak across tests", () => {
  it("test A writes a value to localStorage", () => {
    window.localStorage.setItem("isol-test-key", "leaked-from-A");
  });

  it("test B sees no residue from test A (global beforeEach cleared it)", () => {
    expect(window.localStorage.getItem("isol-test-key")).toBeNull();
  });
});
