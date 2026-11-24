// The marker preset table self-consistency guard.
//
// MARKER_COLOR_PRESET_HEX is the single source for the 19 awesome-markers
// preset chassis colours: name → hex for the author default, hex → name for
// the paint path (a user hex that is exactly one preset keeps the sprite
// class). A duplicate hex value would make the reverse lookup ambiguous, a
// missing key would break declaredMarkerColor, and an uppercase hex would
// desync the reverse lookup (presetNameOfHex lowercases the needle but the
// table itself is stored lowercase). This guard pins those invariants so the
// table cannot drift internally without a test failing.
import { describe, expect, it } from "vitest";
import { MARKER_COLOR_PRESET_HEX, presetNameOfHex } from "#core/leaflet/index.js";

// The awesome-markers chassis ships 19 presets today; the table is meant to
// be able to grow, so the guard pins cardinality only from below (non-empty)
// and leans on uniqueness + round-trip for the rest.
const HEX_SHAPE = /^#[0-9a-f]{6}$/;

describe("marker preset table stays internally consistent", () => {
  const entries = Object.entries(MARKER_COLOR_PRESET_HEX);

  it("carries at least one preset", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("keeps unique keys and unique hex values", () => {
    const names = entries.map(([name]) => name);
    const hexes = entries.map(([, hex]) => hex);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("stores every hex as a lowercase #rrggbb shape", () => {
    for (const [name, hex] of entries) {
      expect(hex, name).toMatch(HEX_SHAPE);
      expect(hex, name).toBe(hex.toLowerCase());
    }
  });

  it("resolves every preset hex back to its own name", () => {
    for (const [name, hex] of entries) {
      expect(presetNameOfHex(hex), name).toBe(name);
    }
  });
});
