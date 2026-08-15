import { HINT_DURATION } from "#core/hint.js";
import { describe, expect, it } from "vitest";

describe("HINT_DURATION", () => {
  it("has correct values", () => {
    expect(HINT_DURATION.SHORT).toBe(1200);
    expect(HINT_DURATION.MEDIUM).toBe(2500);
    expect(HINT_DURATION.LONG).toBe(4000);
    expect(HINT_DURATION.PERSIST).toBe(0);
  });
});
