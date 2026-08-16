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
    // Node might not support zh compact notation; accept either compact or plain
    const result = formatNumber(1234, "auto", "zh");
    expect(result === "1.2万" || result === "1234").toBe(true);
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
