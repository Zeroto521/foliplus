// core/layer/order — behaviour parity with the layout-mirror projections, snapshotted.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type LayerInfo,
  type LayerRole,
  orderHydrate,
  orderProjectRows,
  orderProjectZ,
} from "#core/layer/index.js";

const ROLES: readonly LayerRole[] = ["overlay", "base"];

interface Snapshot {
  tree: {
    blocks: Record<string, { kind: string; key: string; name: string }>;
    roles: Record<
      string,
      { kind: string; key?: string; id?: string; children?: unknown[] }[]
    >;
  };
  entries: { id: string; role: LayerRole; folder: string | null }[];
  rows: Record<string, string[]>;
  z: string[];
}

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "./order.snapshot.json"), "utf8"),
) as Snapshot[];

const toLayerInfo = (e: {
  id: string;
  role: LayerRole;
  folder: string | null;
}): LayerInfo =>
  ({
    id: e.id,
    name: e.id,
    role: e.role,
    folder: e.folder,
    registeredAt: 0,
    layer: null,
    kind: "custom",
    carrier: {},
    paneName: null,
    paneSpecs: [],
    iconSvg: null,
    type: null,
  }) as LayerInfo;

describe("behaviour parity — captured snapshot", () => {
  it("orderProjectRows/orderProjectZ match the layout-mirror read-shape snapshot", () => {
    expect(snapshot.length).toBeGreaterThan(0);
    for (const snap of snapshot) {
      const entries = snap.entries.map(toLayerInfo);
      const resolved = orderHydrate(snap.tree as never, entries);
      for (const role of ROLES) {
        expect(orderProjectRows(resolved, role).slice(1)).toEqual(snap.rows[role]);
      }
      expect(orderProjectZ(resolved)).toEqual(snap.z);
    }
  });
});
