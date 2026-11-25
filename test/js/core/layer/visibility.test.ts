// Unit tests for core/layer/visibility - the single-source "is it visible now"
// aggregation. resolveVisibility is pure over an input record (the caller
// gathers each factor from its own single source); the LayerAPI visibilityOf
// wrapper gathers those inputs and delegates here.
//
// Four factors AND together; visible is true only when all four hold. When
// visible is false, reason names the FIRST false factor in a fixed order
// (declared -> container -> filter -> ancestor) so the answer is stable.
import { describe, expect, it } from "vitest";
import { resolveVisibility } from "#core/layer/index.js";

describe("resolveVisibility", () => {
  it("all factors true -> visible, reason null", () => {
    const r = resolveVisibility({
      declared: true,
      container: true,
      filter: true,
      ancestor: true,
    });
    expect(r.visible).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("false declared -> reason declared", () => {
    const r = resolveVisibility({
      declared: false,
      container: true,
      filter: true,
      ancestor: true,
    });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("declared");
  });

  it("false container -> reason container", () => {
    const r = resolveVisibility({
      declared: true,
      container: false,
      filter: true,
      ancestor: true,
    });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("container");
  });

  it("false filter -> reason filter", () => {
    const r = resolveVisibility({
      declared: true,
      container: true,
      filter: false,
      ancestor: true,
    });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("filter");
  });

  it("false ancestor -> reason ancestor", () => {
    const r = resolveVisibility({
      declared: true,
      container: true,
      filter: true,
      ancestor: false,
    });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("ancestor");
  });

  it("reason is the FIRST false factor in fixed order declared>container>filter>ancestor", () => {
    const r = resolveVisibility({
      declared: false,
      container: false,
      filter: false,
      ancestor: false,
    });
    expect(r.reason).toBe("declared");
  });

  it("factors echo the inputs (diagnostic)", () => {
    const input = { declared: true, container: false, filter: true, ancestor: true };
    const r = resolveVisibility(input);
    expect(r.factors).toEqual(input);
  });
});
