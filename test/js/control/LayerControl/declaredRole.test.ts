// control/LayerControl/declaredRole — author-declared default fold state per
// role + the effective fold resolution.
//
// The two functions are pure: the author default is derived from the CONF.roles
// payload and the effective resolution prioritises the user override over the
// author default over the built-in expanded default.
import { describe, expect, it } from "vitest";
import {
  authorDefaultRoleFolds,
  effectiveRoleFolded,
} from "#control/LayerControl/declaredRole.js";

describe("authorDefaultRoleFolds", () => {
  it("returns {} for null / undefined roles", () => {
    expect(authorDefaultRoleFolds(null)).toEqual({});
    expect(authorDefaultRoleFolds(undefined)).toEqual({});
  });

  it("derives the author default folded map from CONF.roles", () => {
    const roles = {
      overlay: { folded: true },
      base: { folded: false },
    };
    expect(authorDefaultRoleFolds(roles)).toEqual({
      overlay: true,
      base: false,
    });
  });

  it("skips a section without a boolean folded", () => {
    // The Python normaliser guarantees bool or absent; a hand-built CONF must
    // not leak a non-boolean into the fold state.
    const roles = {
      overlay: { folded: "yes" as unknown as boolean },
      base: { folded: false },
    };
    expect(authorDefaultRoleFolds(roles)).toEqual({ base: false });
  });

  it("skips an unknown section key", () => {
    // The Python normaliser rejects unknown sections; the derivation is
    // tolerant of a stray key in a hand-built CONF.
    const roles = {
      overlay: { folded: true },
      base: { folded: false },
      bogus: { folded: true },
    };
    expect(authorDefaultRoleFolds(roles)).toEqual({
      overlay: true,
      base: false,
    });
  });

  it("returns {} for a roles object with no boolean folded anywhere", () => {
    // The Python normaliser always emits both keys; a hand-built CONF with
    // both sections but no folded values still yields an empty author map.
    expect(authorDefaultRoleFolds({ overlay: {}, base: {} })).toEqual({});
  });
});

describe("effectiveRoleFolded", () => {
  it("falls back to the author default when no user opinion exists", () => {
    expect(effectiveRoleFolded({}, { overlay: true }, "overlay")).toBe(true);
    expect(effectiveRoleFolded({}, { overlay: false }, "overlay")).toBe(false);
  });

  it("falls back to expanded when no author default and no user opinion", () => {
    expect(effectiveRoleFolded({}, {}, "overlay")).toBe(false);
  });

  it("user opinion true overrides an author-expanded default", () => {
    expect(effectiveRoleFolded({ overlay: true }, { overlay: false }, "overlay")).toBe(
      true,
    );
  });

  it("user opinion false (explicit expand) overrides an author-folded default", () => {
    // The key acceptance case: a user expands an author-folded role and the
    // false entry keeps it expanded.
    expect(effectiveRoleFolded({ overlay: false }, { overlay: true }, "overlay")).toBe(
      false,
    );
  });

  it("user opinion wins for a role with no author default", () => {
    expect(effectiveRoleFolded({ base: true }, {}, "base")).toBe(true);
  });

  it("distinguishes user false from absent (the tri-state)", () => {
    // absent → author default (true here); explicit false → expanded.
    expect(effectiveRoleFolded({}, { overlay: true }, "overlay")).toBe(true);
    expect(effectiveRoleFolded({ overlay: false }, { overlay: true }, "overlay")).toBe(
      false,
    );
  });
});
