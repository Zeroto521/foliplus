import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import {
  type DisplayModeSpec,
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
