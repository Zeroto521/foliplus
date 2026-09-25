import { afterEach, describe, expect, it, vi } from "vitest";
import { isCorsBlocked, pooledEach } from "#foliplus/ExportControl/renderer/util.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pooledEach", () => {
  it("returns empty array for empty input", async () => {
    expect(await pooledEach([], 3, () => 42)).toEqual([]);
  });

  it("processes all items and preserves order", async () => {
    const input = [10, 20, 30];
    const result = await pooledEach(input, 2, item => item * 2);
    expect(result).toEqual([20, 40, 60]);
  });

  it("converts returned undefined/null to null in results", async () => {
    const input = [1, 2, 3];
    const result = await pooledEach(input, 3, item => (item === 2 ? null : item));
    expect(result).toEqual([1, null, 3]);
  });

  it("swallows per-item errors and records null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = [1, 2, 3];
    const result = await pooledEach(input, 3, item => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    expect(result).toEqual([1, null, 3]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("tile load failed"),
      expect.any(Error),
    );
  });

  it("caps concurrency at 1 (serial)", async () => {
    let active = 0;
    let maxActive = 0;
    const input = [1, 2, 3, 4];
    await pooledEach(input, 1, async item => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return item;
    });
    expect(maxActive).toBe(1);
  });

  it("honors concurrency cap > 1", async () => {
    let active = 0;
    let maxActive = 0;
    const input = Array.from({ length: 8 }, (_, i) => i);
    await pooledEach(input, 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 8));
      active--;
    });
    expect(maxActive).toBe(3);
  });

  it("handles negative concurrency gracefully (cap = 1)", async () => {
    const result = await pooledEach([1, 2], -5, item => item);
    expect(result).toEqual([1, 2]);
  });

  it("handles async null correctly", async () => {
    const result = await pooledEach([1, 2], 2, async () => null);
    expect(result).toEqual([null, null]);
  });

  it("receives correct index argument", async () => {
    const indices: number[] = [];
    await pooledEach([10, 20, 30], 5, (_item, idx) => {
      indices.push(idx);
      return null;
    });
    expect(indices.sort()).toEqual([0, 1, 2]);
  });
});

describe("isCorsBlocked", () => {
  it("never flags a layer that drew every tile", () => {
    expect(isCorsBlocked({ total: 4, failed: 0 })).toBe(false);
  });

  it("never flags empty or un-attempted layers", () => {
    expect(isCorsBlocked({ total: 0, failed: 0 })).toBe(false);
    expect(isCorsBlocked({ total: 0, failed: 3 })).toBe(false);
  });

  it("ignores sporadic misses at or below the majority", () => {
    expect(isCorsBlocked({ total: 10, failed: 5 })).toBe(false);
    expect(isCorsBlocked({ total: 10, failed: 4 })).toBe(false);
  });

  it("flags a layer whose majority failed to load", () => {
    expect(isCorsBlocked({ total: 10, failed: 6 })).toBe(true);
    expect(isCorsBlocked({ total: 1, failed: 1 })).toBe(true);
  });
});
