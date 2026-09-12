import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureStore } from "#foliplus/MeasureControl/store.js";

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

vi.mock("#core/hint.js", () => ({
  HINT_DURATION: { SHORT: 1200, MEDIUM: 2500, LONG: 4000, PERSIST: 0 },
}));

// CONF is a free variable read by the store (storage name prefix). Mutate the
// object in place: createScopedTranslator captures the CONF reference at module
// import time and reads conf.name lazily, so a fresh stub object would leave
// the store's T() scoped to whatever name setup.ts installed.
window.CONF.name = "MeasureControl";

/** Store bound to a map carrying a spy on showHint. */
const makeStore = () => {
  const showHint = vi.fn();
  const map = { foliplus: { showHint } } as unknown as L.Map;
  return { store: new MeasureStore(map, "layer-1"), showHint };
};

beforeEach(() => {
  storage.load.mockReset();
  // Default success — a failure is an explicit per-test mock.
  storage.save.mockReset();
  storage.save.mockReturnValue(true);
  events.emit.mockReset();
});

describe("MeasureStore — load", () => {
  it("returns the persisted array", () => {
    const data = [{ id: "a", type: "marker" }];
    storage.load.mockReturnValue(data);
    const store = makeStore().store;
    expect(store.load()).toBe(data);
    expect(storage.load).toHaveBeenCalledWith(CONST.STORAGE.KEY, "MeasureControl");
  });

  it("falls back to [] when storage holds a non-array", () => {
    storage.load.mockReturnValue({ not: "array" });
    expect(makeStore().store.load()).toEqual([]);
  });

  it("falls back to [] when storage is null", () => {
    storage.load.mockReturnValue(null);
    expect(makeStore().store.load()).toEqual([]);
  });
});

describe("MeasureStore — hydrate + all + count", () => {
  it("hydrate replaces the backing array without persisting", () => {
    const store = makeStore().store;
    store.hydrate([{ id: "a" }, { id: "b" }]);
    expect(store.all()).toHaveLength(2);
    expect(store.count()).toBe(2);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("all returns the live backing array reference", () => {
    const store = makeStore().store;
    store.hydrate([{ id: "a" }]);
    expect(store.all()).toBe(store.all());
  });

  it("starts empty", () => {
    const store = makeStore().store;
    expect(store.count()).toBe(0);
    expect(store.all()).toEqual([]);
  });
});

describe("MeasureStore — add", () => {
  it("appends a measurement, persists, and emits count", () => {
    const store = makeStore().store;
    store.add({ id: "a", type: "marker" });
    expect(store.all()).toHaveLength(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith("foliplus:layer:item-count:change", {
      id: "layer-1",
    });
  });

  it("keeps order of insertion", () => {
    const store = makeStore().store;
    store.add({ id: "a", type: "marker" });
    store.add({ id: "b", type: "marker" });
    expect(store.all().map(m => m.id)).toEqual(["a", "b"]);
  });
});

describe("MeasureStore — remove", () => {
  it("filters out the id and persists", () => {
    const store = makeStore().store;
    store.hydrate([{ id: "a" }, { id: "b" }]);
    storage.save.mockClear();
    events.emit.mockClear();
    store.remove("a");
    expect(store.all().map(m => m.id)).toEqual(["b"]);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("is a no-op persist when id is absent (still safe)", () => {
    const store = makeStore().store;
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
    const store = makeStore().store;
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
    const store = makeStore().store;
    store.hydrate([{ id: "a" }]);
    storage.save.mockClear();
    store.update("missing", { lat: 9 });
    expect(storage.save).not.toHaveBeenCalled();
    expect(store.all()[0].lat).toBeUndefined();
  });
});

describe("MeasureStore — clear", () => {
  it("empties the list and persists", () => {
    const store = makeStore().store;
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

describe("MeasureStore — persist failure", () => {
  it("hints once when writes are rejected, and keeps emitting the count", () => {
    // The quota-exhausted state is environmental, so it is reported once rather
    // than on every click.
    storage.save.mockReturnValue(false);
    const { store, showHint } = makeStore();
    store.add({ id: "a", type: "marker" });
    store.add({ id: "b", type: "marker" });

    // PERSIST: the hint stays until the user dismisses it rather than vanishing
    // mid-session, since the condition does not clear on its own.
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(showHint).toHaveBeenCalledWith(
      "MeasureControl",
      "MeasureControl.err_not_saved",
      0,
    );
    // Every change still writes and still refreshes the LayerControl count column.
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it("does not hint when the write succeeds", () => {
    const { store, showHint } = makeStore();
    store.add({ id: "a", type: "marker" });
    expect(showHint).not.toHaveBeenCalled();
  });

  it("surfaces every failure path, not only add", () => {
    storage.save.mockReturnValue(false);
    const { store, showHint } = makeStore();
    store.hydrate([{ id: "a" }] as any);

    storage.save.mockClear();
    events.emit.mockClear();
    showHint.mockClear();
    store.remove("a");
    store.clear();
    store.update("missing", { lat: 1 });

    expect(showHint).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it("re-hints on the next store once a new session starts", () => {
    // The flag is per store, not per module: a second layer panel on the same
    // page builds a fresh MeasureStore and must be able to warn too. A module
    // flag would suppress it forever.
    storage.save.mockReturnValue(false);
    const first = makeStore();
    const second = makeStore();

    first.store.add({ id: "a" });
    second.store.add({ id: "a" });

    expect(first.showHint).toHaveBeenCalledTimes(1);
    expect(second.showHint).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the map has no hint surface", () => {
    storage.save.mockReturnValue(false);
    const store = new MeasureStore({} as unknown as L.Map, "layer-1");
    expect(() => store.add({ id: "a", type: "marker" })).not.toThrow();
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
});

describe("MeasureStore — emitCount", () => {
  it("emits without writing to storage", () => {
    const store = makeStore().store;
    store.emitCount();
    expect(events.emit).toHaveBeenCalledWith("foliplus:layer:item-count:change", {
      id: "layer-1",
    });
    expect(storage.save).not.toHaveBeenCalled();
  });
});

describe("MeasureStore — hydrate reference stability", () => {
  it("keeps the all() reference stable across hydrate calls", () => {
    const store = makeStore().store;
    store.hydrate([{ id: "a" }] as any);
    const ref = store.all();
    store.hydrate([{ id: "b" }] as any);
    expect(store.all()).toBe(ref);
    expect(store.all()).toEqual([{ id: "b" }] as any);
  });
});

describe("MeasureStore — assignMissingIds (restore path)", () => {
  it("assigns ids to id-less measurements, preserving existing ones", () => {
    const store = makeStore().store;
    store.hydrate([
      { id: "existing", type: "marker" },
      { type: "distance" },
      { type: "circle" },
    ] as any);

    expect(store.assignMissingIds()).toBe(true);

    expect(store.all()[0].id).toBe("existing"); // untouched
    expect(
      store
        .all()
        .slice(1)
        .every(m => m.id),
    ).toBe(true);
    expect(new Set(store.all().map(m => m.id)).size).toBe(3);
  });

  it("returns false and leaves the list alone when every entry already has an id", () => {
    const store = makeStore().store;
    store.hydrate([{ id: "a", type: "marker" }] as any);
    expect(store.assignMissingIds()).toBe(false);
    expect(store.all().map(m => m.id)).toEqual(["a"]);
  });

  it("returns false on an empty store", () => {
    expect(makeStore().store.assignMissingIds()).toBe(false);
  });

  it("assigns each id from nextId, so ids stay unique and type-tagged", () => {
    const store = makeStore().store;
    store.hydrate([{ type: "marker" }, { type: "marker" }] as any);
    store.assignMissingIds();
    const ids = store.all().map(m => m.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id.startsWith(CONST.ID + "_marker_"))).toBe(true);
  });
});

describe("MeasureStore — nextId", () => {
  it("increments the counter and embeds type + counter in the id", () => {
    const store = makeStore().store;
    const id1 = store.nextId("marker");
    const id2 = store.nextId("distance");
    expect(id1).toContain("marker");
    expect(id2).toContain("distance");
    expect(id1).not.toBe(id2);
  });

  it("uses the CONST.ID prefix", () => {
    const store = makeStore().store;
    expect(store.nextId("marker").startsWith(CONST.ID + "_")).toBe(true);
  });
});
