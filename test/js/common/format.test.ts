import { describe, expect, it } from "vitest";
import { cssVar } from "#common/cssvar.js";
import { debounce } from "#common/debounce.js";
import { formatNumber } from "#common/format.js";

describe("formatNumber", () => {
  it("formats small numbers as-is (auto style)", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("uses compact notation for large numbers (auto style)", () => {
    expect(formatNumber(1234)).toBe("1.2K");
  });

  it("handles values >= 100 with 0 fractional digits", () => {
    expect(formatNumber(150)).toBe("150");
  });

  it("uses thousands separator for comma style", () => {
    expect(formatNumber(6000, "comma", "en", 0)).toBe("6,000");
  });

  it("respects locale (auto style)", () => {
    expect(formatNumber(1234, "auto", "zh")).toBe("1234");
    expect(formatNumber(1234, "auto", "ja")).toBe("1234");
  });

  // --- auto style: compact below its unit boundary renders ungrouped ---
  it("zh sub-10000 auto values use no thousands separator: 6000, not 6,000", () => {
    // zh's compact unit (万) begins at 10000, so 1000–9999 format without a
    // grouping separator -> 6000, matching Chinese 4-digit grouping.
    expect(formatNumber(6000, "auto", "zh")).toBe("6000");
    expect(formatNumber(9999, "auto", "zh")).toBe("9999");
    expect(formatNumber(1234, "auto", "zh")).toBe("1234");
    expect(formatNumber(6000, "auto", "zh-CN")).toBe("6000");
  });

  it("zh >= 10000 uses compact 万 notation", () => {
    expect(formatNumber(10000, "auto", "zh")).toBe("1万");
    expect(formatNumber(12000, "auto", "zh")).toBe("1.2万");
  });

  it("ja shares the 4-digit 万 grouping and is also ungrouped below 10000", () => {
    expect(formatNumber(6000, "auto", "ja")).toBe("6000");
    expect(formatNumber(12000, "auto", "ja")).toBe("1.2万");
  });

  it("en sub-1000 auto values stay ungrouped; en >= 1000 uses compact K", () => {
    expect(formatNumber(999, "auto", "en")).toBe("999");
    expect(formatNumber(6000, "auto", "en")).toBe("6K");
    expect(formatNumber(12000, "auto", "en")).toBe("12K");
  });

  it("comma style groups regardless of locale and always uses en separators", () => {
    // comma is language-agnostic: the locale code is not consulted at all, so
    // zh renders with an en comma instead of 万-based 4-digit grouping.
    expect(formatNumber(6000, "comma", "zh")).toBe("6,000.0");
    expect(formatNumber(6000, "comma", "en")).toBe("6,000.0");
  });

  it("int style is a plain integer with no grouping (6000 in zh)", () => {
    // int strips the grouping separator and fractional digits.
    expect(formatNumber(6000, "int", "zh")).toBe("6000");
    expect(formatNumber(1234.5, "int", "zh")).toBe("1235");
    expect(formatNumber(6000, "int", "en")).toBe("6000");
  });

  it("comma style groups and keeps one decimal by default", () => {
    // Default is a fixed 1 fraction digit, so the decimal never gets trimmed.
    expect(formatNumber(42.7, "comma")).toBe("42.7");
    expect(formatNumber(99.9, "comma")).toBe("99.9");
    expect(formatNumber(1234.5, "comma")).toBe("1,234.5");
    expect(formatNumber(5, "comma")).toBe("5.0");
  });

  it("comma style takes a numeric fraction-digit count", () => {
    // Both min and max are set, so decimals stay fixed (1.0, 2.50) rather
    // than trailing-digit-trimmed. The locale is ignored here — grouping is
    // pinned to en and language-agnostic.
    expect(formatNumber(1.5, "comma", "en", 2)).toBe("1.50");
    expect(formatNumber(10, "comma", "en", 2)).toBe("10.00");
    expect(formatNumber(0.1, "comma", "en", 2)).toBe("0.10");
    expect(formatNumber(1000, "comma", "en", 1)).toBe("1,000.0");
    expect(formatNumber(6000, "comma", "en", 0)).toBe("6,000");
    expect(formatNumber(6000, "comma", "en", 1)).toBe("6,000.0");
  });

  it("handles zero and negative values", () => {
    expect(formatNumber(0, "auto")).toBe("0");
    expect(formatNumber(-6000, "auto", "zh")).toBe("-6000");
    expect(formatNumber(-6000, "comma", "en")).toBe("-6,000.0");
    expect(formatNumber(-1234.5, "int", "zh")).toBe("-1235");
  });

  it("auto rounds up across the grouping boundary (999.9 -> 1,000)", () => {
    expect(formatNumber(999.9, "auto", "en")).toBe("1,000");
    expect(formatNumber(999.5, "auto", "en")).toBe("1,000");
  });
});

describe("debounce", () => {
  it("debounces rapid calls, invoking once after delay", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("exposes .cancel() to prevent pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("exposes .flush() to invoke immediately", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("cssVar", () => {
  it("reads a CSS custom property from computed styles", () => {
    const el = document.createElement("div");
    Object.defineProperty(window, "getComputedStyle", {
      value: () => ({ getPropertyValue: () => " 42px " }),
      configurable: true,
    });
    expect(cssVar(el, "--test-var")).toBe("42px");
  });

  it("falls back to provided default when empty", () => {
    const el = document.createElement("div");
    Object.defineProperty(window, "getComputedStyle", {
      value: () => ({ getPropertyValue: () => "" }),
      configurable: true,
    });
    expect(cssVar(el, "--test-var", "default")).toBe("default");
  });
});
