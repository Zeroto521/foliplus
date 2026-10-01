// LayerRuntimeStore — row-store unit surface.
//
// T270: the derived/transient twin of LayerIntentStore (projection last-write,
// field cache, author-visible snapshot, reserved breaks). One row per layer
// id, absent axis = never derived; explicit invalidation, never a re-scan.
import { describe, expect, it } from "vitest";
import type { AppliedProjection } from "#foliplus/core/layer/LayerRuntimeStore.js";
import { LayerRuntimeStore } from "#foliplus/core/layer/LayerRuntimeStore.js";

const applied = (id: string, opacity = 1): AppliedProjection => ({
  id,
  intent: { visible: true },
  effectiveShown: true,
  opacity,
  zoomRange: null,
  carrier: null,
});

describe("LayerRuntimeStore — row shape", () => {
  it("get returns undefined for an id nothing was ever derived for", () => {
    const store = new LayerRuntimeStore();
    expect(store.get("l1")).toBeUndefined();
  });

  it("ids lists only ids that hold runtime state", () => {
    const store = new LayerRuntimeStore();
    expect(store.ids()).toEqual([]);
    store.setAuthorVisible("a", true);
    store.setFields("b", []);
    expect(store.ids().sort()).toEqual(["a", "b"]);
  });

  it("writes to one axis never fabricate the other axes", () => {
    const store = new LayerRuntimeStore();
    store.setApplied("l1", applied("l1"));
    expect(store.getApplied("l1")).toBeDefined();
    expect(store.getFields("l1")).toBeUndefined();
    expect(store.getAuthorVisible("l1")).toBeUndefined();
  });
});

describe("LayerRuntimeStore — applied axis (projection last-write)", () => {
  it("setApplied/getApplied round-trip the executor's snapshot", () => {
    const store = new LayerRuntimeStore();
    const snap = applied("l1", 0.4);
    store.setApplied("l1", snap);
    expect(store.getApplied("l1")).toBe(snap);
  });

  it("deleteApplied drops the row; an empty row leaves the map", () => {
    const store = new LayerRuntimeStore();
    store.setApplied("l1", applied("l1"));
    store.deleteApplied("l1");
    expect(store.getApplied("l1")).toBeUndefined();
    // Prune: no axis left, the id leaves the store entirely.
    expect(store.get("l1")).toBeUndefined();
    expect(store.ids()).toEqual([]);
  });

  it("deleteApplied on an absent id is a no-op", () => {
    const store = new LayerRuntimeStore();
    expect(() => store.deleteApplied("ghost")).not.toThrow();
  });
});

describe("LayerRuntimeStore — fields axis (label-field cache)", () => {
  it("setFields/getFields round-trip the collected field list", () => {
    const store = new LayerRuntimeStore();
    const fields = [{ name: "count", numeric: true }];
    store.setFields("l1", fields);
    expect(store.getFields("l1")).toBe(fields);
  });

  it("deleteFields invalidates per id without touching other axes", () => {
    const store = new LayerRuntimeStore();
    store.setFields("l1", []);
    store.setApplied("l1", applied("l1"));
    store.deleteFields("l1");
    expect(store.getFields("l1")).toBeUndefined();
    expect(store.getApplied("l1")).toBeDefined();
  });
});

describe("LayerRuntimeStore — authorVisible axis (author-declared default)", () => {
  it("setAuthorVisible/getAuthorVisible round-trip the snapshot", () => {
    const store = new LayerRuntimeStore();
    store.setAuthorVisible("l1", false);
    expect(store.getAuthorVisible("l1")).toBe(false);
  });

  it("hasAuthorVisible distinguishes absent from a stored false", () => {
    const store = new LayerRuntimeStore();
    expect(store.hasAuthorVisible("l1")).toBe(false);
    store.setAuthorVisible("l1", false);
    expect(store.hasAuthorVisible("l1")).toBe(true);
    expect(store.getAuthorVisible("l1")).toBe(false);
  });
});

describe("LayerRuntimeStore — lifecycle", () => {
  it("drop removes the whole row (unregister symmetry with dropRow)", () => {
    const store = new LayerRuntimeStore();
    store.setApplied("l1", applied("l1"));
    store.setFields("l1", []);
    store.setAuthorVisible("l1", true);
    store.drop("l1");
    expect(store.get("l1")).toBeUndefined();
    expect(store.ids()).toEqual([]);
  });

  it("drop on an absent id is a no-op", () => {
    const store = new LayerRuntimeStore();
    expect(() => store.drop("ghost")).not.toThrow();
  });

  it("clearAll wipes every row (coordinator destroy)", () => {
    const store = new LayerRuntimeStore();
    store.setAuthorVisible("a", true);
    store.setApplied("b", applied("b"));
    store.clearAll();
    expect(store.ids()).toEqual([]);
    expect(store.get("a")).toBeUndefined();
  });
});
