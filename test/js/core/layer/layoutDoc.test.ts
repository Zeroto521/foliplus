// vitest — core/layer/layoutDoc (v2 layout document: storage key, per-map
// singleton, tolerant read, v1 -> v2 migration). The migration equivalence kill
// test is the heart: the v2 display order must equal the v1 display order
// block-for-block, including the never-frozen case (v1 `sections` empty) that
// the design doc did not cover.
import { beforeEach, describe, expect, it } from "vitest";
import {
  type FolderOrder,
  LAYOUT_DOC_KEY,
  type LayerInfo,
  fullDisplayOrder,
  fullDisplayOrderV2,
  migrateV1toV2,
  readLayoutDoc,
} from "#core/layer/index.js";

/** Minimal LayerInfo shape — the pure functions read role/folder/id only. */
function li(id: string, role: "base" | "overlay", folder?: string): LayerInfo {
  return { id, role, folder: folder ?? null } as LayerInfo;
}

const idSeq = (entries: readonly LayerInfo[]): string[] => entries.map(e => e.id);

beforeEach(() => {
  window.localStorage.clear();
});

describe("layoutDoc storage key + tolerant read", () => {
  it("reads back the empty layout when the key is absent", () => {
    const doc = readLayoutDoc();
    expect(doc).toEqual({ version: 2, folders: [], order: {}, members: {} });
  });

  it("reads back the empty layout for a corrupt payload and does not repair it", () => {
    window.localStorage.setItem(LAYOUT_DOC_KEY, JSON.stringify("not-a-record"));
    const doc = readLayoutDoc();
    expect(doc).toEqual({ version: 2, folders: [], order: {}, members: {} });
    // Reads never write: the corrupt payload is left untouched.
    expect(window.localStorage.getItem(LAYOUT_DOC_KEY)).toBe(
      JSON.stringify("not-a-record"),
    );
  });

  it("reads back the empty layout for an unknown future version", () => {
    window.localStorage.setItem(
      LAYOUT_DOC_KEY,
      JSON.stringify({ version: 3, folders: [], order: {}, members: {} }),
    );
    expect(readLayoutDoc()).toEqual({
      version: 2,
      folders: [],
      order: {},
      members: {},
    });
  });

  it("reads back a valid v2 document", () => {
    const doc = {
      version: 2,
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: { a: { section: "overlay", folder: "roads" } },
    };
    window.localStorage.setItem(LAYOUT_DOC_KEY, JSON.stringify(doc));
    expect(readLayoutDoc()).toEqual(doc);
  });
});

describe("migrateV1toV2 — display-order equivalence", () => {
  // The design §5.1 fixture: v1 has a frozen overlay + base order.
  const frozenRegistry = () => [
    li("a", "overlay", "Roads"),
    li("b", "overlay", "roads"), // casefold same key as "Roads"
    li("c", "overlay", "Water"),
    li("d", "overlay"), // root
    li("e", "base", "Parks"),
  ];
  const frozenV1 = (): FolderOrder => ({
    version: 1,
    sections: { overlay: ["roads", "water"], base: ["parks"] },
  });

  it("keeps the v1 block order element-for-element after migration (frozen case)", () => {
    const reg = frozenRegistry();
    const v1 = frozenV1();
    const v2 = migrateV1toV2(v1, reg);
    expect(idSeq(fullDisplayOrder(reg, v1))).toEqual(
      idSeq(fullDisplayOrderV2(reg, v2)),
    );
  });

  it("keeps the display order when v1 sections is empty (author-declared folders only)", () => {
    // The design doc gap: never frozen, sections empty, but layers are in
    // author-declared folders. Migration MUST derive folders+members from the
    // registry, or the grouping is entirely lost.
    const reg = [
      li("a", "overlay", "Roads"),
      li("b", "overlay", "Roads"),
      li("c", "overlay", "Water"),
      li("d", "overlay"), // root
      li("e", "base", "Parks"),
      li("f", "base"), // root
    ];
    const v1: FolderOrder = { version: 1, sections: {} };
    const v2 = migrateV1toV2(v1, reg);
    expect(idSeq(fullDisplayOrder(reg, v1))).toEqual(
      idSeq(fullDisplayOrderV2(reg, v2)),
    );
  });

  it("preserves a frozen empty folder key in the migrated order (risk R1)", () => {
    const reg = [li("a", "overlay", "Roads")];
    // "water" is frozen but has no live member.
    const v1: FolderOrder = { version: 1, sections: { overlay: ["roads", "water"] } };
    const v2 = migrateV1toV2(v1, reg);
    expect(v2.order.overlay).toEqual(["roads", "water"]);
    // The empty key survives in the catalog too.
    expect(v2.folders.some(f => f.key === "water")).toBe(true);
  });

  it("maps unlisted (anchor-ordered) folders without a sections entry", () => {
    const reg = [li("a", "overlay", "Roads"), li("b", "overlay", "Water")];
    const v1: FolderOrder = { version: 1, sections: {} };
    const v2 = migrateV1toV2(v1, reg);
    expect(idSeq(fullDisplayOrder(reg, v1))).toEqual(
      idSeq(fullDisplayOrderV2(reg, v2)),
    );
    expect(v2.members.a).toEqual({ section: "overlay", folder: "roads" });
    expect(v2.members.b).toEqual({ section: "overlay", folder: "water" });
  });
});
