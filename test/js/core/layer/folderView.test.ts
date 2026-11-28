// core/layer/folderView — the read-only folder-layout view (kept surface).
//
// These tests drive the pure view functions over a derived FolderLayout
// (no DOM, no storage). The single-source invariant is the thread:
// layout.members[layerId] is the ONLY assignment a layer carries once a
// layout exists, and the order keys are the ONLY block priority. The
// persistence / mutation helpers were deleted with the v2 layout write
// side — the order doc (core/order) is the single order source, and a
// folder's create / rename / delete / move goes through its commands.
import { describe, expect, it } from "vitest";
import {
  type FolderLayout,
  type LayerInfo,
  type LayerRole,
  folderEntries,
  folderKeysOfRole,
  folderOf,
  groupByFolder,
  nextFolderDefaultName,
  rootLayerEntry,
} from "#core/layer/index.js";

const layout = (partial?: Partial<FolderLayout>): FolderLayout => ({
  version: 2,
  folders: [],
  order: {},
  members: {},
  ...partial,
});

const entry = (
  id: string,
  role: LayerRole,
  folder?: string | null,
  idx = 0,
): LayerInfo =>
  ({
    id,
    name: id,
    role,
    folder: folder ?? null,
    registeredAt: idx,
    layer: null,
    kind: "custom" as const,
    carrier: {} as never,
    paneName: null,
    paneSpecs: [],
    iconSvg: null,
    type: null,
  }) as LayerInfo;

describe("folderOf", () => {
  it("reads the member assignment (single source), not the declaration", () => {
    const l = layout({ members: { a: { role: "overlay", folder: "roads" } } });
    expect(folderOf(l, entry("a", "overlay", "Roads", 0))).toBe("roads");
  });

  it("a materialised root pin wins over the declaration", () => {
    const l = layout({ members: { a: { role: "overlay", folder: "" } } });
    expect(folderOf(l, entry("a", "overlay", "Roads", 0))).toBeNull();
  });

  it("falls back to the author declaration when no member entry exists", () => {
    expect(folderOf(layout(), entry("a", "overlay", "Roads", 0))).toBe("roads");
  });

  it("normalises the declared spelling to the identity key", () => {
    expect(folderOf(layout(), entry("a", "overlay", " ROADS ", 0))).toBe("roads");
  });
});

describe("pure folder helpers (kept from the order-helper era)", () => {
  it("a root layer's block entry never collides with a folder key", () => {
    const rootEntry = rootLayerEntry("a");
    expect(rootEntry).not.toBe("a");
    expect(rootEntry).toBe("layer:a");
    expect(folderEntries(["roads", rootEntry, "water"])).toEqual(["roads", "water"]);
    expect(folderEntries([])).toEqual([]);
  });

  it("nextFolderDefaultName finds the first free candidate past a dense run", () => {
    const l = layout({
      folders: [
        { key: "new folder", name: "new folder" },
        { key: "new folder 2", name: "new folder 2" },
        { key: "new folder 3", name: "new folder 3" },
        { key: "new folder 4", name: "new folder 4" },
        { key: "new folder 5", name: "new folder 5" },
      ],
      order: {
        overlay: [
          "new folder",
          "new folder 2",
          "new folder 3",
          "new folder 4",
          "new folder 5",
        ],
      },
    });
    expect(nextFolderDefaultName(l, "overlay", "new folder")).toBe("new folder 6");
  });

  it("nextFolderDefaultName picks the first free candidate when the base is taken", () => {
    const l = layout({
      folders: [{ key: "new folder", name: "new folder" }],
      order: { overlay: ["new folder"] },
    });
    expect(nextFolderDefaultName(l, "overlay", "new folder")).toBe("new folder 2");
  });

  it("nextFolderDefaultName returns the base untouched when it is not taken", () => {
    const l = layout({
      folders: [{ key: "other", name: "Other" }],
      order: { overlay: ["other"] },
    });
    expect(nextFolderDefaultName(l, "overlay", "new folder")).toBe("new folder");
  });

  it("nextFolderDefaultName counts a member-only folder in the taken set", () => {
    const l = layout({ members: { a: { role: "overlay", folder: "roads" } } });
    expect(nextFolderDefaultName(l, "overlay", "roads")).toBe("roads 2");
  });

  it("nextFolderDefaultName truncates the stem so the suffix still fits the cap", () => {
    const base = "a".repeat(64);
    const l = layout({
      folders: [{ key: base, name: base }],
      order: { overlay: [base] },
    });
    const next = nextFolderDefaultName(l, "overlay", base);
    expect(next).not.toBe(base);
    expect(next.endsWith(" 2")).toBe(true);
  });

  it("nextFolderDefaultName ignores members of a different role", () => {
    const l = layout({
      folders: [{ key: "new folder", name: "new folder" }],
      order: { overlay: ["new folder"] },
      members: { a: { role: "base", folder: "basemap" } },
    });
    expect(nextFolderDefaultName(l, "overlay", "new folder")).toBe("new folder 2");
  });
});

describe("folderKeysOfRole", () => {
  it("unions block-order keys with live member folders", () => {
    const l = layout({
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads", "layer:a"] },
      members: { b: { role: "overlay", folder: "water" } },
    });
    expect(folderKeysOfRole(l, "overlay")).toEqual(["roads", "water"]);
  });

  it("excludes root pins and other roles", () => {
    const l = layout({
      order: { overlay: ["roads"] },
      members: {
        a: { role: "overlay", folder: "" },
        b: { role: "base", folder: "water" },
      },
    });
    expect(folderKeysOfRole(l, "overlay")).toEqual(["roads"]);
  });
});

describe("groupByFolder", () => {
  it("groups one role's members into blocks keyed by normalised name", () => {
    const l = layout({
      folders: [{ key: "roads", name: "Roads" }],
      members: {
        a: { role: "overlay", folder: "roads" },
        b: { role: "overlay", folder: "roads" },
        c: { role: "overlay", folder: "water" },
      },
    });
    const blocks = groupByFolder(
      [
        entry("a", "overlay", "Roads", 0),
        entry("b", "overlay", "Roads", 1),
        entry("c", "overlay", "Water", 2),
      ],
      "overlay",
      l,
    );
    expect([...blocks.keys()]).toEqual(["roads", "water"]);
    expect(blocks.get("roads")?.members.map(m => m.id)).toEqual(["a", "b"]);
    expect(blocks.get("roads")?.anchor).toBe(0);
    expect(blocks.get("water")?.members.map(m => m.id)).toEqual(["c"]);
  });

  it("skips root members and members of a different role", () => {
    const l = layout({ members: { a: { role: "overlay", folder: "" } } });
    const blocks = groupByFolder(
      [entry("a", "overlay", "Roads", 0), entry("b", "base", "Water", 1)],
      "overlay",
      l,
    );
    expect(blocks.size).toBe(0);
  });
});
