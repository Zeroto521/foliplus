import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureStore } from "#foliplus/MeasureControl/store.js";

// Mock Storage + ensureEvents so persistence shapes are tested in isolation —
// the store's array/id/persist contract is covered in store.test.ts; this file
// pins the versioned record envelope and the tolerant readers.
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

window.CONF.name = "MeasureControl";

const makeStore = () => {
  const map = { foliplus: { showHint: vi.fn() } } as unknown as L.Map;
  return new MeasureStore(map, "layer-1");
};

beforeEach(() => {
  storage.load.mockReset();
  storage.save.mockReset();
  storage.save.mockReturnValue(true);
  events.emit.mockReset();
});

describe("MeasureStore.persist — versioned envelope", () => {
  it("wraps the list in { version, items } on every write", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" } as any);

    expect(storage.save).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      { version: CONST.RECORD_VERSION, items: store.all() },
      "MeasureControl",
    );
  });

  it("writes the current version stamp even for an empty list", () => {
    const store = makeStore();
    store.clear();
    expect(storage.save).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      { version: CONST.RECORD_VERSION, items: [] },
      "MeasureControl",
    );
  });
});

describe("MeasureStore.load — envelope + legacy bare array + corrupt", () => {
  it("reads the new { version, items } envelope", () => {
    const items = [{ id: "a" }];
    storage.load.mockReturnValue({ version: CONST.RECORD_VERSION, items });
    expect(makeStore().load()).toBe(items);
  });

  it("accepts an older/unknown version value without migrating", () => {
    const items = [{ id: "a" }];
    storage.load.mockReturnValue({ version: 999, items });
    expect(makeStore().load()).toBe(items);
  });

  it("reads the legacy bare-array shape as items (no migration)", () => {
    const items = [{ id: "a" }, { id: "b" }];
    storage.load.mockReturnValue(items);
    expect(makeStore().load()).toBe(items);
  });

  it("returns [] for a non-array, non-envelope value", () => {
    storage.load.mockReturnValue({ not: "array" });
    expect(makeStore().load()).toEqual([]);
  });

  it("returns [] when the envelope is missing its items array", () => {
    storage.load.mockReturnValue({ version: CONST.RECORD_VERSION });
    expect(makeStore().load()).toEqual([]);
  });

  it("returns [] when the envelope's items is not an array", () => {
    storage.load.mockReturnValue({ version: CONST.RECORD_VERSION, items: { id: "a" } });
    expect(makeStore().load()).toEqual([]);
  });

  it("returns [] for null (empty store)", () => {
    storage.load.mockReturnValue(null);
    expect(makeStore().load()).toEqual([]);
  });
});

describe("round-trip through the versioned envelope", () => {
  it("save then load returns the same measurements (envelope is transparent)", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" } as any);
    store.add({ id: "b", type: "distance" } as any);
    expect(storage.save).toHaveBeenCalledTimes(2);

    // A fresh store reads whatever the previous one wrote.
    const [, payload] = storage.save.mock.calls.at(-1)! as [string, unknown, string];
    storage.load.mockReturnValue(payload);
    expect(makeStore().load()).toHaveLength(2);
  });
});
