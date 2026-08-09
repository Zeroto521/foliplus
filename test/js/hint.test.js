import { describe, expect, it } from "vitest";
import { HINT_DURATION } from "../../foliplus/js/common/hint.js";

describe("HINT_DURATION", () => {
  it("has correct values", () => {
    expect(HINT_DURATION.SHORT).toBe(1200);
    expect(HINT_DURATION.MEDIUM).toBe(2500);
    expect(HINT_DURATION.LONG).toBe(4000);
    expect(HINT_DURATION.PERSIST).toBe(0);
  });
});
