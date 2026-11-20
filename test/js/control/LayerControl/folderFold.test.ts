import { describe, expect, it } from "vitest";
import type { FolderDefaults } from "#foliplus/config-schema.js";
import {
  authorFoldedKeys,
  effectiveFolderFolded,
  folderFoldKey,
} from "#control/LayerControl/folderFold.js";

describe("folderFoldKey", () => {
  it("builds role::normalizedFolderName keys", () => {
    // The key is the folder's identity: role + normalized name. Case and
    // surrounding whitespace fold so "业务数据" and "  业务数据  " are one key.
    expect(folderFoldKey("overlay", "业务数据")).toBe("overlay::业务数据");
    expect(folderFoldKey("base", "  Roads  ")).toBe("base::roads");
  });
});

describe("authorFoldedKeys", () => {
  it("derives the author-folded key set from CONF.folders", () => {
    const keys = authorFoldedKeys({
      overlay: [
        { name: "业务数据", folded: true },
        { name: "边界", folded: false },
      ],
      base: [{ name: "底图", folded: true }],
    });
    expect(keys).toEqual(new Set(["overlay::业务数据", "base::底图"]));
  });

  it("treats folded:false and missing folded as expanded (built-in default)", () => {
    const keys = authorFoldedKeys({
      overlay: [{ name: "展开组", folded: false }, { name: "未声明" }],
      base: [],
    });
    expect(keys.size).toBe(0);
  });

  it("returns an empty set for null / undefined / empty config", () => {
    expect(authorFoldedKeys(null)).toEqual(new Set());
    expect(authorFoldedKeys(undefined)).toEqual(new Set());
    expect(authorFoldedKeys({ overlay: [], base: [] })).toEqual(new Set());
  });

  it("normalizes folder names the same way the layout does", () => {
    const keys = authorFoldedKeys({
      overlay: [{ name: "  Roads  ", folded: true }],
      base: [],
    });
    expect(keys.has("overlay::roads")).toBe(true);
    expect(keys.has("overlay::  Roads  ")).toBe(false);
  });

  it("skips entries with a non-string name (tolerant derivation)", () => {
    const keys = authorFoldedKeys({
      overlay: [{ name: 123 as unknown as string, folded: true }],
      base: [],
    });
    expect(keys.size).toBe(0);
  });

  it("skips null / non-array entries and unknown sections (tolerant derivation)", () => {
    const keys = authorFoldedKeys({
      overlay: [
        null as unknown as { name: string; folded?: boolean },
        { name: "边界", folded: true },
      ],
      base: [],
      unknown_section: [{ name: "幽灵", folded: true }],
    } as unknown as FolderDefaults);
    expect(keys).toEqual(new Set(["overlay::边界"]));
  });
});

describe("effectiveFolderFolded", () => {
  it("lets the user override (folded) win over the author default", () => {
    const author = new Set(["overlay::业务数据"]);
    const user = new Set(["overlay::业务数据"]);
    // Author default folded, user keeps it folded → folded.
    expect(effectiveFolderFolded(author, user, "overlay", "业务数据")).toBe(true);
  });

  it("falls back to the author default when the user has no override", () => {
    const author = new Set(["overlay::业务数据"]);
    const user = new Set<string>();
    // No user override → author default applies.
    expect(effectiveFolderFolded(author, user, "overlay", "业务数据")).toBe(true);
  });

  it("returns expanded when neither the user nor the author folds it", () => {
    const author = new Set(["overlay::业务数据"]);
    const user = new Set<string>();
    expect(effectiveFolderFolded(author, user, "overlay", "未声明组")).toBe(false);
  });

  it("normalizes the name before the key lookup", () => {
    const author = new Set(["overlay::业务数据"]);
    const user = new Set<string>();
    expect(effectiveFolderFolded(author, user, "overlay", "  业务数据  ")).toBe(true);
  });
});
