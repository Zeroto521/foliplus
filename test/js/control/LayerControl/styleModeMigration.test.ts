import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_MODE } from "#core/layer/intent.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerPersistence, RECORD_VERSION } from "#control/LayerControl/persistence.js";
import type { LayerPersistedRecord } from "#control/LayerControl/type.js";

// Migration test: fillMode -> fillStyleMode one-way key adoption
// (see prior summary for the contract). The persisted VALUES are unchanged,
// so this is a KEY rename, not a shape change - no RECORD_VERSION bump.

const makePersistence = () => new LayerPersistence();

const seedStorage = (record: unknown) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

const spySave = () => vi.spyOn(Storage, "saveRecord").mockImplementation(() => true);

const lastRecord = (save: ReturnType<typeof spySave>) => save.mock.calls.at(-1)![1];

describe("styleMode key migration (task-41 step 3 acceptance)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl" };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("reads the old fillMode key as the active style mode", () => {
    seedStorage({
      version: RECORD_VERSION,
      layers: {
        a: {
          fillMode: STYLE_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    const loaded = makePersistence().load().layers.a;
    expect(loaded).toEqual({
      fillStyleMode: STYLE_MODE.VALUE,
      overrides: ["fillStyleMode"],
    });
  });

  it("writes only the new fillStyleMode key after reading an old record", () => {
    seedStorage({
      version: RECORD_VERSION,
      layers: {
        a: {
          fillMode: STYLE_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    const loaded = makePersistence().load();
    expect(loaded.layers.a?.fillStyleMode).toBe(STYLE_MODE.VALUE);

    vi.useFakeTimers();
    const save = spySave();
    const p = makePersistence();
    p.schedule({ layers: () => loaded.layers });
    p.flushAll();

    const written = lastRecord(save) as LayerPersistedRecord;
    const layer = written.layers.a as Record<string, unknown> | undefined;
    expect(layer?.fillStyleMode).toBe(STYLE_MODE.VALUE);
    expect(layer?.fillMode).toBeUndefined();
    expect(written.layers.a?.overrides).toContain("fillStyleMode");
    expect(written.layers.a?.overrides).not.toContain("fillMode");
    save.mockRestore();
    vi.useRealTimers();
  });

  it.todo("deleting the old-key compat read makes Case 1 red (guard)");

  it("reads an old record that carries no version field", () => {
    seedStorage({
      layers: {
        a: {
          fillMode: STYLE_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    const loaded = makePersistence().load().layers.a;
    expect(loaded).toEqual({
      fillStyleMode: STYLE_MODE.VALUE,
      overrides: ["fillStyleMode"],
    });
  });
});
