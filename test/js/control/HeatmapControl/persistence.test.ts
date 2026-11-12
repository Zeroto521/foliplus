// Persistence round-trip guard — the field list is single-sourced in
// `toSavedConfig` (write side) and validated in `parseSavedConfig` (read
// side). These tests pin the two together: a field added on one side and
// forgotten on the other must fail, not silently drift.
import { makeManager } from "./fixture.js";
import { describe, expect, it } from "vitest";
import {
  SAVED_FIELDS,
  applySavedConfig,
  parseSavedConfig,
  toSavedConfig,
} from "#control/HeatmapControl/persistence.js";

/** A manager-like state that satisfies ManagerLike with every field at a
 *  non-default value, so a round-trip on each field actually changes it. */
const NON_DEFAULT: Record<string, unknown> = {
  version: 99,
  layerId: "layer-7",
  agg: "avg",
  method: "quantile",
  scheme: "Blues",
  numClasses: 9,
  borderWeight: 2.5,
  borderColor: "#112233",
  labelShow: true,
  labelColor: "#aabbcc",
  labelSize: 14,
  labelFormat: "comma",
  field: "height",
};

/** Override the manager's live state with a partial. */
const withState = (
  mgr: ReturnType<typeof makeManager>,
  over: Partial<Record<string, unknown>>,
) => {
  for (const [k, v] of Object.entries(over)) {
    (mgr as unknown as Record<string, unknown>)[k] = v;
  }
  return mgr;
};

describe("toSavedConfig round-trip", () => {
  it.each(SAVED_FIELDS)("round-trips %s through the read-side parser", key => {
    const mgr = makeManager();
    withState(mgr, { [key]: NON_DEFAULT[key] });
    const written = toSavedConfig(mgr);
    const parsed = parseSavedConfig(written);
    expect(parsed?.[key]).toEqual(written[key]);
  });

  it("SAVED_FIELDS covers exactly the fields toSavedConfig writes", () => {
    const mgr = makeManager();
    const written = toSavedConfig(mgr);
    expect(Object.keys(written).sort()).toEqual([...SAVED_FIELDS].sort());
  });

  it("a drift on either side makes the key set unequal (guard shape)", () => {
    const mgr = makeManager();
    const written = toSavedConfig(mgr);
    const missing = SAVED_FIELDS.filter(k => k !== "labelFormat");
    expect(Object.keys(written).sort()).not.toEqual([...missing].sort());
  });

  it("survives a full manager -> record -> apply round-trip without changing state", () => {
    const mgr = makeManager();
    withState(mgr, NON_DEFAULT);
    const before = toSavedConfig(mgr);
    const fresh = makeManager();
    applySavedConfig(fresh, before);
    const after = toSavedConfig(fresh);
    expect(after).toEqual(before);
  });
});
