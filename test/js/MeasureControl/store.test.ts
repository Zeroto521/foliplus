import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Storage + ensureEvents so the store is tested in isolation — the store's
// own contract is array + id + persist/emit, not the localStorage I/O (covered
// by common/storage tests) or the event bus wiring (covered by manager tests).
const storage = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));
const events = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("#common/storage.js", () => ({
  load: storage.load,
  save: storage.save,
}));

vi.mock("#core/event/index.js", () => ({
  EVENTS: { LAYER_ITEM_COUNT_CHANGE: "foliplus:layer:item-count:change" },
  ensureEvents: () => ({ emit: events.emit }),
}));

import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureStore } from "#foliplus/MeasureControl/store.js";

// CONF is a free variable read by the store (storage name prefix).
window.CONF = { ...window.CONF, name: "MeasureControl" };

const makeStore = () => {
  const map = {} as unknown as L.Map;
  return new MeasureStore(map, "layer-1");
};

beforeEach(() => {
  storage.load.mockReset();
  storage.save.mockReset();
  events.emit.mockReset();
});

describe("MeasureStore — load", () => {
  it("returns the persisted array", () => {
    const data = [{ id: "a", type: "marker" }];
    storage.load.mockReturnValue(data);
    const store = makeStore();
    expect(store.load()).toBe(data);
    expect(storage.load).toHaveBeenCalledWith(CONST.STORAGE.KEY, "MeasureControl");
  });

  it("falls back to [] when storage holds a non-array", () => {
    storage.load.mockReturnValue({ not: "array" });
    expect(makeStore().load()).toEqual([]);
  });

  it("falls back to [] when storage is null", () => {
    storage.load.mockReturnValue(null);
    expect(makeStore().load()).toEqual([]);
  });
});

describe("MeasureStore — hydrate + all + count", () => {
  it("hydrate replaces the backing array without persisting", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }, { id: "b" }]);
    expect(store.all()).toHaveLength(2);
    expect(store.count()).toBe(2);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("all returns the live backing array reference", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }]);
    expect(store.all()).toBe(store.all());
  });

  it("starts empty", () => {
    const store = makeStore();
    expect(store.count()).toBe(0);
    expect(store.all()).toEqual([]);
  });
});

describe("MeasureStore — add", () => {
  it("appends a measurement, persists, and emits count", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" });
    expect(store.all()).toHaveLength(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      "foliplus:layer:item-count:change",
      { id: "layer-1" },
    );
  });

  it("keeps order of insertion", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" });
    store.add({ id: "b", type: "marker" });
    expect(store.all().map(m => m.id)).toEqual(["a", "b"]);
  });
});

describe("MeasureStore — remove", () => {
  it("filters out the id and persists", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }, { id: "b" }]);
    storage.save.mockClear();
    events.emit.mockClear();
    store.remove("a");
    expect(store.all().map(m => m.id)).toEqual(["b"]);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("is a no-op persist when id is absent (still safe)", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }]);
    storage.save.mockClear();
    store.remove("missing");
    expect(store.all()).toHaveLength(1);
    // persist runs unconditionally — the contract is "remove then persist"
    expect(storage.save).toHaveBeenCalledTimes(1);
  });
});

describe("MeasureStore — update", () => {
  it("merges a patch into the matched measurement and persists", () => {
    const store = makeStore();
    store.hydrate([{ id: "a", type: "marker", lng: 1, lat: 2 }]);
    storage.save.mockClear();
    events.emit.mockClear();
    store.update("a", { lat: 9, address: "x" });
    const m = store.all()[0];
    expect(m.lat).toBe(9);
    expect(m.address).toBe("x");
    expect(m.lng).toBe(1); // untouched
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when id is not found (no persist)", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }]);
    storage.save.mockClear();
    store.update("missing", { lat: 9 });
    expect(storage.save).not.toHaveBeenCalled();
    expect(store.all()[0].lat).toBeUndefined();
  });
});

describe("MeasureStore — clear", () => {
  it("empties the list and persists", () => {
    const store = makeStore();
    store.hydrate([{ id: "a" }, { id: "b" }]);
    storage.save.mockClear();
    events.emit.mockClear();
    store.clear();
    expect(store.all()).toEqual([]);
    expect(store.count()).toBe(0);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
});

describe("MeasureStore — emitCount", () => {
  it("emits without writing to storage", () => {
    const store = makeStore();
    store.emitCount();
    expect(events.emit).toHaveBeenCalledWith(
      "foliplus:layer:item-count:change",
      { id: "layer-1" },
    );
    expect(storage.save).not.toHaveBeenCalled();
  });
});

describe("MeasureStore — nextId", () => {
  it("increments the counter and embeds type + counter in the id", () => {
    const store = makeStore();
    const id1 = store.nextId("marker");
    const id2 = store.nextId("distance");
    expect(id1).toContain("marker");
    expect(id2).toContain("distance");
    expect(id1).not.toBe(id2);
  });

  it("uses the CONST.ID prefix", () => {
    const store = makeStore();
    expect(store.nextId("marker").startsWith(CONST.ID + "_")).toBe(true);
  });
});
