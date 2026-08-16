import { describe, expect, it, vi } from "vitest";
import { Cache } from "#foliplus/common/cache.js";

describe("Cache", () => {
  it("stores and retrieves values", () => {
    const c = new Cache<string, number>(10);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.has("a")).toBe(true);
  });

  it("returns undefined for missing keys", () => {
    const c = new Cache<string, number>(10);
    expect(c.get("nope")).toBeUndefined();
    expect(c.has("nope")).toBe(false);
  });

  it("updates an existing key in place", () => {
    const c = new Cache<string, number>(10);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.get("a")).toBe(2);
    expect(c.size).toBe(1);
  });

  it("evicts the oldest entry when over capacity (FIFO)", () => {
    const c = new Cache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4);
    expect(c.size).toBe(3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.get("d")).toBe(4);
  });

  it("clears all entries", () => {
    const c = new Cache<string, number>(5);
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });

  it("size reflects the current entry count", () => {
    const c = new Cache<string, number>(5);
    expect(c.size).toBe(0);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size).toBe(2);
  });

  it("returns undefined and evicts when an entry exceeds its TTL", () => {
    const c = new Cache<string, number>(5, 1000);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    vi.setSystemTime(Date.now() + 1001);
    expect(c.get("a")).toBeUndefined();
    expect(c.has("a")).toBe(false);
    expect(c.size).toBe(0);
  });

  it("keeps entries within the TTL", () => {
    const c = new Cache<string, number>(5, 1000);
    c.set("a", 1);
    vi.setSystemTime(Date.now() + 500);
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(1);
  });

  it("re-inserting a key refreshes its TTL", () => {
    const c = new Cache<string, number>(5, 1000);
    c.set("a", 1);
    vi.setSystemTime(Date.now() + 800);
    c.set("a", 2);
    vi.setSystemTime(Date.now() + 800);
    expect(c.get("a")).toBe(2);
  });

  it("works without a TTL (ttlMs default 0 — no expiry)", () => {
    const c = new Cache<string, number>(5);
    c.set("a", 1);
    vi.setSystemTime(Date.now() + 10_000_000);
    expect(c.get("a")).toBe(1);
  });

  it("calls onEvict when evicting the oldest entry on overflow", () => {
    const evicted: number[] = [];
    const c = new Cache<string, number>(3, 0, v => evicted.push(v));
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4);
    expect(evicted).toEqual([1]);
    expect(c.size).toBe(3);
  });

  it("calls onEvict when replacing an existing key", () => {
    const evicted: number[] = [];
    const c = new Cache<string, number>(10, 0, v => evicted.push(v));
    c.set("a", 1);
    c.set("a", 2);
    expect(c.get("a")).toBe(2);
    expect(c.size).toBe(1);
    expect(evicted).toEqual([1]);
  });

  it("calls onEvict when an entry expires via TTL", () => {
    const evicted: number[] = [];
    const c = new Cache<string, number>(5, 1000, v => evicted.push(v));
    c.set("a", 1);
    vi.setSystemTime(Date.now() + 1001);
    expect(c.get("a")).toBeUndefined();
    expect(evicted).toEqual([1]);
  });

  it("calls onEvict once per entry on clear", () => {
    const evicted: number[] = [];
    const c = new Cache<string, number>(10, 0, v => evicted.push(v));
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.clear();
    expect(evicted).toEqual([1, 2, 3]);
    expect(c.size).toBe(0);
  });

  it("does not call onEvict for a normal hit (ttlMs 0)", () => {
    const evicted: number[] = [];
    const c = new Cache<string, number>(5, 0, v => evicted.push(v));
    c.set("a", 1);
    c.get("a");
    expect(evicted).toEqual([]);
  });
});
