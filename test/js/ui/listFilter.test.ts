// test/js/ui/listFilter.test.ts — pure filter core for a searchable option list.
import { describe, expect, it } from "vitest";
import { createListFilter } from "#ui/listFilter.js";

describe("listFilter", () => {
  const mk = (labels: string[]) => labels.map(label => ({ label }));

  it("returns the full set for an empty query", () => {
    const f = createListFilter();
    f.normalize(mk(["a", "b", "c"]));
    expect(f.setQuery("")).toEqual(mk(["a", "b", "c"]));
    expect(f.total()).toBe(3);
    expect(f.matched()).toBe(3);
  });

  it("returns the full set for a whitespace query", () => {
    const f = createListFilter();
    f.normalize(mk(["a", "b", "c"]));
    expect(f.setQuery("   ")).toEqual(mk(["a", "b", "c"]));
  });

  it("matches case-insensitively on label substring", () => {
    const f = createListFilter();
    f.normalize(mk(["Alpha", "beta", "Gamma"]));
    expect(f.setQuery("ALP")).toEqual(mk(["Alpha"]));
    expect(f.setQuery("amm")).toEqual(mk(["Gamma"]));
  });

  it("trims the query before matching", () => {
    const f = createListFilter();
    f.normalize(mk(["alpha", "beta"]));
    expect(f.setQuery("  alpha  ")).toEqual(mk(["alpha"]));
  });

  it("returns empty for no match", () => {
    const f = createListFilter();
    f.normalize(mk(["alpha", "beta"]));
    expect(f.setQuery("zzz")).toEqual([]);
    expect(f.matched()).toBe(0);
  });

  it("normalize rebuilds the cache for a new item set", () => {
    const f = createListFilter();
    f.normalize(mk(["alpha"]));
    f.setQuery("a");
    expect(f.matched()).toBe(1);
    f.normalize(mk(["one", "two"]));
    expect(f.setQuery("zzz")).toEqual([]);
    expect(f.total()).toBe(2);
  });

  it("never mutates the source items", () => {
    const items = mk(["alpha", "beta"]);
    const before = items.slice();
    const f = createListFilter();
    f.normalize(items);
    f.setQuery("a");
    expect(items).toEqual(before);
  });

  it("filters 1000+ items without pathological cost", () => {
    const f = createListFilter();
    const items = Array.from({ length: 1000 }, (_, i) => ({
      label: `value-${String(i)}`,
    }));
    f.normalize(items);
    const t0 = performance.now();
    const out = f.setQuery("value-500");
    const elapsed = performance.now() - t0;
    expect(out.length).toBe(1);
    // A generous baseline: the normalize is O(n) once, the query scan is O(n)
    // over cached labels. 1000 items should be well under 1ms; 50ms allows CI
    // jitter without masking a regression to O(n²) lower/trim per query.
    expect(elapsed).toBeLessThan(50);
  });
});
