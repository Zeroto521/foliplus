import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureStore } from "#foliplus/MeasureControl/store.js";

// Mock Storage + ensureEvents so persistence shapes are tested in isolation —
// the store's array/id/persist contract is covered in store.test.ts; this file
// pins the versioned record envelope and the tolerant readers.
const storage = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  loadVersioned: vi.fn(),
  saveVersioned: vi.fn(),
}));
const events = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("#common/storage.js", () => ({
  load: storage.load,
  save: storage.save,
  loadVersioned: storage.loadVersioned,
  saveVersioned: storage.saveVersioned,
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
  storage.loadVersioned.mockReset();
  storage.saveVersioned.mockReset();
  storage.saveVersioned.mockReturnValue(true);
  events.emit.mockReset();
});

describe("MeasureStore.persist — versioned envelope", () => {
  it("delegates every write to saveVersioned with (key, items, version, name)", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" } as any);

    expect(storage.saveVersioned).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      store.all(),
      CONST.RECORD_VERSION,
      "MeasureControl",
      "items",
    );
  });

  it("delegates an empty clear to saveVersioned with an empty list", () => {
    const store = makeStore();
    store.clear();
    expect(storage.saveVersioned).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      [],
      CONST.RECORD_VERSION,
      "MeasureControl",
      "items",
    );
  });
});

describe("MeasureStore.load — envelope + legacy bare array + corrupt", () => {
  it("reads whatever loadVersioned returns", () => {
    const items = [{ id: "a" }];
    storage.loadVersioned.mockReturnValue(items);
    expect(makeStore().load()).toBe(items);
  });

  it("tolerates an older/unknown version value without migrating", () => {
    // The envelope reader is tolerant forever: an old record stays readable
    // and is only re-wrapped on the next save.
    const items = [{ id: "a" }];
    storage.loadVersioned.mockReturnValue(items);
    expect(makeStore().load()).toBe(items);
  });

  it("falls back to [] when loadVersioned reports nothing", () => {
    storage.loadVersioned.mockReturnValue(null);
    expect(makeStore().load()).toEqual([]);
  });

  it("falls back to [] when storage is absent", () => {
    storage.loadVersioned.mockReturnValue(null);
    expect(makeStore().load()).toEqual([]);
  });
});

describe("round-trip through the versioned envelope", () => {
  it("save then load returns the same measurements (envelope is transparent)", () => {
    const store = makeStore();
    store.add({ id: "a", type: "marker" } as any);
    store.add({ id: "b", type: "distance" } as any);
    expect(storage.saveVersioned).toHaveBeenCalledTimes(2);

    // A fresh store reads whatever the previous one wrote: the write-through
    // is transparent to callers, so load() surfaces the items list the writer
    // last handed to saveVersioned.
    const [key, items, version, name, dataField] = storage.saveVersioned.mock.calls.at(
      -1,
    )! as [string, unknown, number, string, string];
    expect(key).toBe(CONST.STORAGE.KEY);
    expect(version).toBe(CONST.RECORD_VERSION);
    expect(name).toBe("MeasureControl");
    expect(dataField).toBe("items");
    storage.loadVersioned.mockReturnValue(items);
    expect(makeStore().load()).toHaveLength(2);
  });
});
