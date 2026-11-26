// core/layer/arrangement — shadow parity with the v2 projections.
//
// The whole point of stage 1: prove the tree model produces EXACTLY what the
// v2 pair produces today, over real layout states rather than hand-written
// ones. Every layout below is produced by the production mutation functions, and
// every assertion compares against the production projections
// (`roleBlocks` for the panel, `fullDisplayOrder` for z) — `fromV2` re-derives
// the order independently, so a green here means "the model is equivalent",
// not "the model calls itself".
//
// When stage 2 flips the writes, these assertions stay as the behaviour
// contract; only the producer of `layout` changes.
import { entry, mulberry32 } from "./arrangement.fixture.js";
import { describe, expect, it } from "vitest";
import {
  type FolderLayout,
  type LayerInfo,
  type LayerRole,
  createFolder,
  deleteFolder,
  emptyFolderLayout,
  fromV2,
  fullDisplayOrder,
  hydrate,
  mergeDeclaredFolders,
  moveFolder,
  moveLayerToFolder,
  moveLayerToRoot,
  moveLayerToRootAt,
  normalizeFolderName,
  projectLayout,
  projectRows,
  projectZ,
  renameFolder,
  roleBlocks,
  seedBlockOrder,
} from "#core/layer/index.js";

const ROLES: readonly LayerRole[] = ["overlay", "base"];

/** One role's row tokens as the V2 projection sees them. */
const v2Rows = (
  role: LayerRole,
  entries: readonly LayerInfo[],
  layout: FolderLayout,
): string[] =>
  roleBlocks(role, entries, layout).flatMap(block =>
    block.kind === "folder"
      ? [
          `folder:${role}:${block.key}`,
          ...block.members.map(member => `layer:${member.id}`),
        ]
      : [`layer:${block.info.id}`],
  );

/** The v2 projection's folder display name per key (empty folders included). */
const v2FolderNames = (
  role: LayerRole,
  entries: readonly LayerInfo[],
  layout: FolderLayout,
): Record<string, string> => {
  const names: Record<string, string> = {};
  for (const block of roleBlocks(role, entries, layout)) {
    if (block.kind === "folder") names[block.key] = block.displayName;
  }
  return names;
};

/** The whole parity contract for one layout state. */
const expectParity = (layout: FolderLayout, entries: readonly LayerInfo[]): void => {
  const resolved = hydrate(fromV2(layout, entries), entries);
  for (const role of ROLES) {
    // Panel rows: header + block headers + leaves, identical item for item.
    expect(projectRows(resolved, role).slice(1)).toEqual(v2Rows(role, entries, layout));
    // Block display names travel with the block, not the row key.
    for (const [key, name] of Object.entries(v2FolderNames(role, entries, layout))) {
      expect(resolved.blocks[key]?.name).toBe(name);
    }
  }
  // Z axis: the exact sequence the registry is expected to carry.
  expect(projectZ(resolved)).toEqual(
    fullDisplayOrder(entries, layout).map(info => info.id),
  );
  // The layout mirror is the second read contract: projectLayout's three read
  // shapes must equal v2's READ shapes field for field, on every layout state.
  // v2 reads order[role] with a missing-role default of [], the members map
  // through folderOf (pin, else author declaration, normalised, "" = root) and
  // the folders directory as listed.
  const mirror = projectLayout(resolved);
  for (const role of ROLES) {
    expect(mirror.order[role] ?? []).toEqual(layout.order[role] ?? []);
  }
  for (const info of entries) {
    const assigned = layout.members[info.id];
    const v2Folder = assigned !== undefined ? assigned.folder : (info.folder ?? "");
    // v2 folderOf normalises the assignment to its identity key ("" = root).
    expect(mirror.members[info.id]?.folder ?? "").toEqual(
      v2Folder === "" ? "" : normalizeFolderName(v2Folder),
    );
  }
  // The folders directory is read by key: every folder block's display name
  // must match v2's directory entry (or the key itself when v2 has none).
  for (const folder of mirror.folders) {
    const v2Name = layout.folders.find(f => f.key === folder.key)?.name ?? folder.key;
    expect(folder.name).toEqual(v2Name);
  }
};

/** A mixed fixture: both roles, declared folders with shared names, roots. */
const entries: LayerInfo[] = [
  entry("a", "overlay", "Roads", 0),
  entry("b", "overlay", null, 1),
  entry("c", "overlay", "roads", 2),
  entry("d", "overlay", "Water", 3),
  entry("e", "overlay", null, 4),
  entry("f", "base", "Roads", 5),
  entry("g", "base", null, 6),
  entry("h", "base", "Water", 7),
];

describe("shadow parity — hand-built layout states", () => {
  it("holds for the declared seed (no order written)", () => {
    expectParity(mergeDeclaredFolders(emptyFolderLayout(), entries), entries);
  });

  it("holds for an empty layout (every layer at its role root)", () => {
    expectParity(emptyFolderLayout(), entries);
  });

  it("holds for a frozen block order with a root layer between two folders", () => {
    const layout: FolderLayout = {
      ...mergeDeclaredFolders(emptyFolderLayout(), entries),
      order: {
        overlay: ["roads", "layer:b", "water"],
        base: ["roads", "layer:g", "water"],
      },
    };
    expectParity(layout, entries);
  });

  it("holds for an empty folder block", () => {
    const layout = createFolder(
      mergeDeclaredFolders(emptyFolderLayout(), entries),
      "overlay",
      "Empty",
      entries,
    );
    expectParity(layout, entries);
  });

  it("holds after a layer moves between folders and back to root", () => {
    let layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    layout = moveLayerToFolder(layout, "b", "overlay", "water");
    expectParity(layout, entries);
    layout = moveLayerToRoot(layout, "b", "overlay");
    expectParity(layout, entries);
    layout = moveLayerToRootAt(layout, "e", "overlay", "roads");
    expectParity(layout, entries);
  });

  it("holds after a folder is renamed and another deleted", () => {
    let layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    layout = renameFolder(layout, "overlay", "roads", "Streets");
    expectParity(layout, entries);
    layout = deleteFolder(layout, "base", "water");
    expectParity(layout, entries);
  });

  it("holds after a folder block moves past a root layer", () => {
    let layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
    layout = {
      ...layout,
      order: { overlay: ["roads", "layer:b", "water"], base: [] },
    };
    layout = moveFolder(layout, "overlay", "water", "roads", true);
    expectParity(layout, entries);
  });
});

describe("shadow parity — random mutation sequences", () => {
  /** One random production mutation. Keys are always taken from the live
   *  layout, so the generator exercises real drags rather than refusals. */
  const applyRandomOp = (
    layout: FolderLayout,
    rng: () => number,
    step: number,
  ): FolderLayout => {
    const role = ROLES[Math.floor(rng() * ROLES.length)];
    const listed = layout.order[role] ?? [];
    const folderKeys = [
      ...new Set([
        ...listed.filter(k => !k.startsWith("layer:")),
        ...layout.folders.map(f => f.key),
      ]),
    ];
    const roleEntries = entries.filter(info => info.role === role);
    const pick = <T>(list: readonly T[]): T | undefined =>
      list.length === 0 ? undefined : list[Math.floor(rng() * list.length)];
    const op = Math.floor(rng() * 7);
    const info = pick(roleEntries);
    const key = pick(folderKeys);
    if (op === 0) return createFolder(layout, role, `F${step}`, entries);
    if (op === 1 && info && key) return moveLayerToFolder(layout, info.id, role, key);
    if (op === 2 && info) return moveLayerToRoot(layout, info.id, role);
    if (op === 3 && info) {
      const before = pick(seedBlockOrder(layout, role, entries)) ?? null;
      return moveLayerToRootAt(layout, info.id, role, before);
    }
    if (op === 4 && key) {
      const target = pick(folderKeys.filter(other => other !== key));
      if (target) return moveFolder(layout, role, key, target, rng() > 0.5);
    }
    if (op === 5 && key) return renameFolder(layout, role, key, `Renamed ${step}`);
    if (op === 6 && key) return deleteFolder(layout, role, key);
    return layout;
  };

  it("stays equivalent at every step of 100 seeded sequences", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const rng = mulberry32(seed);
      let layout = mergeDeclaredFolders(emptyFolderLayout(), entries);
      for (let step = 0; step < 14; step += 1) {
        layout = applyRandomOp(layout, rng, step);
        // Assert inside the loop: a divergence is reported with its step.
        try {
          expectParity(layout, entries);
        } catch (error) {
          throw new Error(`parity diverged at seed ${seed}, step ${step}`, {
            cause: error,
          });
        }
      }
    }
  });
});
