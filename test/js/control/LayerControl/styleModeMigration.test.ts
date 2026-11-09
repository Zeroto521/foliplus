import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILL_MODE } from "#core/layer/intent.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerPersistence, RECORD_VERSION } from "#control/LayerControl/persistence.js";
import type { LayerPersistedRecord } from "#control/LayerControl/type.js";

// ── Migration-test skeleton: FILL_MODE → STYLE_MODE / fillMode → fillStyleMode ──
//
// This file pins the ONE-WAY key migration that task-41 step 3 will ship.
// TODAY (pre-migration, main c47813d04) the fill style-mode key is still
// `fillMode` (INTENT.FILL_MODE). The border side already uses
// `borderStyleMode` (INTENT.BORDER_STYLE_MODE), so the fill side is the
// asymmetric one. The migration renames the fill KEY (fillMode →
// fillStyleMode) and the CONSTANT (FILL_MODE → STYLE_MODE), WITHOUT
// changing the persisted VALUES (solid / value / original stay).
//
// The four cases below are the acceptance contract. They are SKIPPED today
// because the product code still reads/writes `fillMode` — after the
// migration lands they convert (drop the .skip) into real assertions.
// They are written against the FUTURE contract, so they fail (red) on
// today's code exactly as described, then pass (green) after the migration.

const makePersistence = () => new LayerPersistence();

const seedStorage = (record: unknown) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

const spySave = () => vi.spyOn(Storage, "saveRecord").mockImplementation(() => true);

const lastRecord = (save: ReturnType<typeof spySave>): LayerPersistedRecord =>
  save.mock.calls.at(-1)![1] as LayerPersistedRecord;

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

  // Case 1: an OLD record (fillMode key) must still read in as a VALUE state.
  // Pre-migration this passes trivially (the key is still fillMode); the
  // migration must keep it green by reading the OLD key on the read side.
  it.skip("reads the old fillMode key as the active style mode", () => {
    seedStorage({
      version: RECORD_VERSION,
      layers: {
        a: {
          fillMode: FILL_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    const loaded = makePersistence().load().layers.a;
    // After migration: the fillMode KEY is renamed to fillStyleMode, but an
    // old record written before the migration must STILL read as VALUE.
    expect(loaded).toEqual({
      fillMode: FILL_MODE.VALUE,
      overrides: ["fillMode"],
    });
  });

  // Case 2: once the old key is read in, the next WRITE emits ONLY the new
  // key — the old key is gone from the persisted record, not copied through.
  it.skip("writes only the new fillStyleMode key after reading an old record", () => {
    seedStorage({
      version: RECORD_VERSION,
      layers: {
        a: {
          fillMode: FILL_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    const loaded = makePersistence().load();
    expect(loaded.layers.a?.fillMode).toBe(FILL_MODE.VALUE);

    vi.useFakeTimers();
    const save = spySave();
    const p = makePersistence();
    p.schedule({ layers: () => loaded.layers as never });
    p.flushAll();

    const written = lastRecord(save);
    // The record written back carries the NEW key only. `fillStyleMode` does
    // not exist on PersistedLayerState until the migration lands, so the
    // future-field access is cast — convert to a direct property read when
    // the type gains the field.
    const layer = written.layers.a as Record<string, unknown> | undefined;
    expect(layer?.fillStyleMode).toBe(FILL_MODE.VALUE);
    expect(layer?.fillMode).toBeUndefined();
    // The provenance markers follow the key: only the new one is present.
    expect(written.layers.a?.overrides).toContain("fillStyleMode");
    expect(written.layers.a?.overrides).not.toContain("fillMode");
    save.mockRestore();
    vi.useRealTimers();
  });

  // Case 3: counterexample guard — DELETE the read-side old-key compat branch
  // and Case 1 must go red. This is not a runnable assertion; it documents the
  // guard so a future change that silently drops the old-key read cannot pass
  // unnoticed. It becomes a real (red-on-regression) test once the migration
  // ships the compat read.
  it.todo("deleting the old-key compat read makes Case 1 red (guard)");

  // Case 4: no RECORD_VERSION bump rationale — an old record without a version
  // field still reads (the migration is a key rename, not a shape change).
  it.skip("reads an old record that carries no version field", () => {
    seedStorage({
      layers: {
        a: {
          fillMode: FILL_MODE.VALUE,
          overrides: ["fillMode"],
        },
      },
    });
    // The rename is one-way and additive-tolerant: a version-less record is
    // not rejected, it reads with the mode segment intact and the next write
    // stamps RECORD_VERSION.
    const loaded = makePersistence().load().layers.a;
    expect(loaded).toEqual({
      fillMode: FILL_MODE.VALUE,
      overrides: ["fillMode"],
    });
  });
});
