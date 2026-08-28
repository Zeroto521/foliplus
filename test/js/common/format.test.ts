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
    // Intl rounds to integer when abs >= 100 in comma style
    expect(formatNumber(1234.5, "comma")).toBe("1,235");
  });

  it("respects locale (Node may lack zh compact, falls back to standard)", () => {
    // Node might not support zh compact notation; accept compact, comma, or plain
    const result = formatNumber(1234, "auto", "zh");
    expect(result === "1.2万" || result === "1,234" || result === "1234").toBe(true);
  });

  // --- CJK (4-digit grouping) vs other locales ---
  it("CJK (zh) sub-10000 auto values use no thousands separator: 6000, not 6,000", () => {
    // zh grouping unit is 4 digits (万); 6000 < 1万 needs no separator
    expect(formatNumber(6000, "auto", "zh")).toBe("6000");
    expect(formatNumber(9999, "auto", "zh")).toBe("9999");
    expect(formatNumber(1234, "auto", "zh")).toBe("1234");
    expect(formatNumber(6000, "auto", "zh-CN")).toBe("6000");
  });

  it("CJK (zh) >= 10000 uses compact 万 notation", () => {
    expect(formatNumber(10000, "auto", "zh")).toBe("1万");
    expect(formatNumber(12000, "auto", "zh")).toBe("1.2万");
  });

  it("CJK 1000-9999 fallback is ungrouped; en compact, ja fallback keeps grouping", () => {
    // 6000 >= 1000. en has a compact unit -> "6K". zh has none below 1万 ->
    // fallback, and zh is CJK (4-digit 万) so grouping is disabled -> "6000".
    // ja has no compact unit here either, but ja groups in 3s, so its fallback
    // keeps grouping -> "6,000".
    expect(formatNumber(6000, "auto", "en")).toBe("6K");
    expect(formatNumber(6000, "auto", "zh")).toBe("6000");
    expect(formatNumber(6000, "auto", "ja")).toBe("6,000");
  });

  it("user-explicit comma style keeps grouping regardless of locale (6000 -> 6,000 in zh)", () => {
    // comma/int are user-requested; locale grouping rules do not override them
    expect(formatNumber(6000, "comma", "zh")).toBe("6,000");
    expect(formatNumber(6000, "int", "zh")).toBe("6,000");
    expect(formatNumber(6000, "comma", "en")).toBe("6,000");
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
