import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import {
  type DisplayModeSpec,
  resolveDisplayAndDetail,
  resolveDisplayMode,
} from "#foliplus/style/displayMode.js";

const base = (over: Partial<DisplayModeSpec> = {}): DisplayModeSpec => ({
  stored: undefined,
  declaredValue: false,
  colorIntent: false,
  valueIntent: false,
  carriesValue: true,
  supportsInherit: false,
  ...over,
});

describe("resolveDisplayMode 3x4 matrix", () => {
  it.each([
    { channel: "fill", over: {}, expected: STYLE_MODE.ORIGINAL },
    { channel: "fill", over: { colorIntent: true }, expected: STYLE_MODE.SOLID },
    { channel: "fill", over: { valueIntent: true }, expected: STYLE_MODE.VALUE },
    { channel: "fill", over: { declaredValue: true }, expected: STYLE_MODE.VALUE },
    { channel: "fill", over: { stored: STYLE_MODE.SOLID }, expected: STYLE_MODE.SOLID },
    { channel: "fill", over: { stored: STYLE_MODE.VALUE }, expected: STYLE_MODE.VALUE },
    {
      channel: "fill",
      over: { stored: STYLE_MODE.ORIGINAL },
      expected: STYLE_MODE.ORIGINAL,
    },
    {
      channel: "fill",
      over: { stored: STYLE_MODE.FOLLOW_FILL },
      expected: STYLE_MODE.SOLID,
    },
    {
      channel: "border",
      over: { supportsInherit: true },
      expected: STYLE_MODE.ORIGINAL,
    },
    {
      channel: "border",
      over: { supportsInherit: true, colorIntent: true },
      expected: STYLE_MODE.SOLID,
    },
    {
      channel: "border",
      over: { supportsInherit: true, carriesValue: false },
      expected: STYLE_MODE.ORIGINAL,
    },
    {
      channel: "border",
      over: { supportsInherit: true, stored: STYLE_MODE.VALUE, carriesValue: false },
      expected: STYLE_MODE.ORIGINAL,
    },
    {
      channel: "border",
      over: { supportsInherit: true, stored: STYLE_MODE.FOLLOW_FILL },
      expected: STYLE_MODE.FOLLOW_FILL,
    },
    {
      channel: "border",
      over: { supportsInherit: true, stored: STYLE_MODE.SOLID },
      expected: STYLE_MODE.SOLID,
    },
    {
      channel: "border",
      over: { supportsInherit: true, stored: STYLE_MODE.ORIGINAL },
      expected: STYLE_MODE.ORIGINAL,
    },
  ])(
    "channel=$channel stored=$stored color=$colorIntent value=$valueIntent -> $expected",
    row => {
      const spec = base(row.over);
      expect(resolveDisplayMode(spec)).toBe(row.expected);
    },
  );
});

describe("resolveDisplayMode kill rows", () => {
  it("opacity intent never sinks the fill mode (#953)", () => {
    const spec: DisplayModeSpec = {
      stored: undefined,
      declaredValue: false,
      colorIntent: false,
      valueIntent: false,
      carriesValue: true,
      supportsInherit: false,
    };
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.ORIGINAL);
  });
  it("weight intent never sinks the border mode (mirror of #953)", () => {
    const spec: DisplayModeSpec = {
      stored: undefined,
      declaredValue: false,
      colorIntent: false,
      valueIntent: false,
      carriesValue: true,
      supportsInherit: true,
    };
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.ORIGINAL);
  });
  it("fill cannot INHERIT — a stray stored INHERIT reads as SOLID", () => {
    const spec: DisplayModeSpec = {
      stored: STYLE_MODE.FOLLOW_FILL,
      declaredValue: false,
      colorIntent: false,
      valueIntent: false,
      carriesValue: true,
      supportsInherit: false,
    };
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.SOLID);
  });
  it("border stored VALUE on a non-LINE surface reads as ORIGINAL", () => {
    const spec: DisplayModeSpec = {
      stored: STYLE_MODE.VALUE,
      declaredValue: false,
      colorIntent: false,
      valueIntent: false,
      carriesValue: false,
      supportsInherit: true,
    };
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.ORIGINAL);
  });
});

describe("resolveDisplayAndDetail", () => {
  const borderSpec = (over: Partial<DisplayModeSpec> = {}): DisplayModeSpec => ({
    stored: STYLE_MODE.ORIGINAL,
    declaredValue: false,
    colorIntent: false,
    valueIntent: false,
    carriesValue: true,
    supportsInherit: true,
    ...over,
  });

  it("border ORIGINAL display collapses to SOLID detail", () => {
    const { display, detail } = resolveDisplayAndDetail(borderSpec(), {
      collapseOriginalDetail: true,
    });
    expect(display).toBe(STYLE_MODE.ORIGINAL);
    expect(detail).toBe(STYLE_MODE.SOLID);
  });

  it("border SOLID display keeps SOLID detail", () => {
    const { detail } = resolveDisplayAndDetail(
      borderSpec({ stored: STYLE_MODE.SOLID }),
      { collapseOriginalDetail: true },
    );
    expect(detail).toBe(STYLE_MODE.SOLID);
  });

  it("border VALUE display keeps VALUE detail", () => {
    const { detail } = resolveDisplayAndDetail(
      borderSpec({ stored: STYLE_MODE.VALUE }),
      { collapseOriginalDetail: true },
    );
    expect(detail).toBe(STYLE_MODE.VALUE);
  });

  it("border FOLLOW_FILL display keeps FOLLOW_FILL detail", () => {
    const { detail } = resolveDisplayAndDetail(
      borderSpec({ stored: STYLE_MODE.FOLLOW_FILL }),
      { collapseOriginalDetail: true },
    );
    expect(detail).toBe(STYLE_MODE.FOLLOW_FILL);
  });

  it("fill ORIGINAL display does not collapse (opt-in only)", () => {
    const { display, detail } = resolveDisplayAndDetail(
      borderSpec({ stored: STYLE_MODE.ORIGINAL }),
      { collapseOriginalDetail: false },
    );
    expect(display).toBe(STYLE_MODE.ORIGINAL);
    expect(detail).toBe(STYLE_MODE.ORIGINAL);
  });

  it("display mode is unchanged by the detail collapse", () => {
    const { display, detail } = resolveDisplayAndDetail(borderSpec(), {
      collapseOriginalDetail: true,
    });
    expect(display).toBe(STYLE_MODE.ORIGINAL);
    expect(detail).toBe(STYLE_MODE.SOLID);
    expect(display).not.toBe(detail);
  });
});

describe("resolveDisplayMode declaredMode", () => {
  it("declared follow_fill wins when no stored mode (polygon/point border)", () => {
    const spec = base({
      declaredMode: STYLE_MODE.FOLLOW_FILL,
      supportsInherit: true,
      carriesValue: false,
    });
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.FOLLOW_FILL);
  });

  it("declared follow_fill steps aside when the channel cannot inherit (line)", () => {
    const spec = base({
      declaredMode: STYLE_MODE.FOLLOW_FILL,
      supportsInherit: false,
      carriesValue: true,
    });
    // The declaration is inapplicable: the resolver falls to the derived chain.
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.ORIGINAL);
  });

  it("a stored mode always beats the declaration", () => {
    const spec = base({
      declaredMode: STYLE_MODE.FOLLOW_FILL,
      stored: STYLE_MODE.SOLID,
      supportsInherit: true,
      carriesValue: false,
    });
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.SOLID);
  });

  it("declared follow_fill beats a colour intent (same rank as declaredValue)", () => {
    const spec = base({
      declaredMode: STYLE_MODE.FOLLOW_FILL,
      colorIntent: true,
      supportsInherit: true,
      carriesValue: false,
    });
    // The declaration is a mode default; a colour intent alone is a
    // sub-dimension (the border mode select owns the mode), so it does not
    // sink the declaration — mirror of fill's declaredValue rank.
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.FOLLOW_FILL);
  });

  it("a declared value fill still beats a declared mode on the fill channel", () => {
    const spec = base({ declaredValue: true, supportsInherit: false });
    expect(resolveDisplayMode(spec)).toBe(STYLE_MODE.VALUE);
  });
});
