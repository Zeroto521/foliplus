import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerInfoRegistry } from "#foliplus/core/layer/LayerInfoRegistry.js";
import { ROLE } from "#foliplus/core/layer/index.js";
import type { LayerInfo } from "#foliplus/core/layer/type.js";

describe("LayerInfoRegistry", () => {
  let registry: LayerInfoRegistry;

  beforeEach(() => {
    registry = new LayerInfoRegistry([
      { id: "overlay1", name: "Points", role: "overlay" },
      { id: "overlay2", name: "Lines", role: "overlay" },
      { id: "base1", name: "OpenStreetMap", role: "base" },
    ] as unknown as LayerInfo[]);
  });

  describe("constructor", () => {
    it("builds items and byId index", () => {
      expect(registry.size).toBe(3);
      expect(registry.get("overlay1")!.name).toBe("Points");
      expect(registry.get("base1")!.role === "base").toBe(true);
    });

    it("resolves firstBaseIdx", () => {
      expect(registry.firstBaseIdx).toBe(2);
    });

    it("returns -1 firstBaseIdx when no bases", () => {
      const r = new LayerInfoRegistry([
        { id: "a", role: "overlay" },
        { id: "b", role: "overlay" },
      ] as unknown as LayerInfo[]);
      expect(r.firstBaseIdx).toBe(-1);
    });
  });

  describe("createLayerInfo", () => {
    it("fills missing fields with defaults", () => {
      const info = registry.createLayerInfo({ id: "test" });
      expect(info.id).toBe("test");
      expect(info.name).toBe("test");
      expect(info.opacity).toBe(1);
      expect(info.opacityBake).toBe("redraw");
      expect(info.onOpacity).toBeNull();
      expect(info.role === "base").toBe(false);
      expect(info.paneName).toBeNull();
      expect(info.iconSvg).toBeNull();
      expect(info.canvas).toBeNull();
    });

    it("preserves existing values from existingLi", () => {
      const info = registry.createLayerInfo({ id: "test" }, {
        name: "Existing",
        opacity: 0.5,
      } as unknown as LayerInfo);
      expect(info.name).toBe("Existing");
      expect(info.opacity).toBe(0.5);
    });

    it("preserves metaProvider from existingLi on re-registration", () => {
      const metaProvider = () => ({ count: 1 });
      const info = registry.createLayerInfo({ id: "test" }, {
        metaProvider,
      } as unknown as LayerInfo);
      expect(info.metaProvider).toBe(metaProvider);
    });

    it("defaults metaProvider to null when absent", () => {
      const info = registry.createLayerInfo({ id: "test" });
      expect(info.metaProvider).toBeNull();
    });

    it("carries the author's declared show, false included", () => {
      expect(registry.createLayerInfo({ id: "test", show: false }).show).toBe(false);
      expect(registry.createLayerInfo({ id: "test", show: true }).show).toBe(true);
    });

    it("leaves show absent when the author declared nothing", () => {
      // Not normalised to `true` here: the registry must not invent a value
      // the caller never gave. The seed sites apply folium's default, so a
      // reader that forgets to would be the bug, not a silent `true`.
      expect(registry.createLayerInfo({ id: "test" }).show).toBeUndefined();
    });

    it("keeps the stored show when a re-registration omits it", () => {
      // A provider re-adding its layer re-advertises only its own metadata;
      // dropping the author's `show` there would resurrect a hidden layer.
      const info = registry.createLayerInfo(
        { id: "overlay1" },
        registry.createLayerInfo({ id: "overlay1", show: false }),
      );
      expect(info.show).toBe(false);
    });

    it("lets an explicit show win on re-registration", () => {
      const info = registry.createLayerInfo(
        { id: "overlay1", show: true },
        registry.createLayerInfo({ id: "overlay1", show: false }),
      );
      expect(info.show).toBe(true);
    });

    it("keeps the current name when a layer is re-registered", () => {
      // A third-party provider re-adding its layer re-advertises its own name.
      // Taking the caller's value would reset the display name on every
      // re-registration, so an existing id keeps the name the user last saw.
      const info = registry.createLayerInfo(
        { id: "overlay1", name: "Provider Name" },
        registry.get("overlay1"),
      );
      expect(info.name).toBe("Points");
    });

    it("accepts opts.name for a fresh id", () => {
      const info = registry.createLayerInfo({ id: "new1", name: "Fresh" });
      expect(info.name).toBe("Fresh");
    });

    it("populates kind and carrier on every createLayerInfo", () => {
      // No explicit carrier: pending Leaflet-layer registration (not custom).
      const info = registry.createLayerInfo({ id: "shape" });
      expect(info.kind).toBe("vector");
      expect(info.carrier.layer).toBeNull();
      expect(info.carrier.canvas).toBeNull();
    });

    it("derives solid kind and element carrier for a color face", () => {
      const face = {} as HTMLCanvasElement;
      const info = registry.createLayerInfo({
        id: "color1",
        color: "#112233",
        canvas: face,
      });
      expect(info.kind).toBe("solid");
      expect(info.carrier.element).toBe(face);
      expect(info.carrier.layer).toBeNull();
    });

    it("derives canvas kind for a canvas-only face", () => {
      const canvas = {} as HTMLCanvasElement;
      const info = registry.createLayerInfo({ id: "heat", canvas });
      expect(info.kind).toBe("canvas");
      expect(info.carrier.canvas).toBe(canvas);
    });

    it("honors declared kind and custom payload", () => {
      const custom = { plugin: "x" };
      const info = registry.createLayerInfo({
        id: "third",
        kind: "custom",
        custom,
      });
      expect(info.kind).toBe("custom");
      expect(info.carrier.custom).toBe(custom);
    });

    it("resolves layer once at registration into carrier.layer", () => {
      const layer = { id: "live" } as unknown as L.Layer;
      const info = registry.createLayerInfo({ id: "mapped", layer });
      expect(info.layer).toBe(layer);
      expect(info.carrier.layer).toBe(layer);
    });

    it("snapshots the layer's declared options.opacity when no caller value", () => {
      // folium's TileLayer(opacity=0.7) sets `options.opacity` on the Leaflet
      // layer but never surfaces it through RegisterLayerOpts — a bare `?? 1`
      // snapshot would print 100% in the panel while the map rendered 70%.
      const layer = { options: { opacity: 0.7 } } as unknown as L.Layer;
      const info = registry.createLayerInfo({ id: "tiles", layer });
      expect(info.opacity).toBe(0.7);
    });

    it("prefers opts.opacity over layer.options.opacity on re-registration", () => {
      // The caller's explicit value always wins — a user drag must not be
      // re-clobbered by the author's declaration on a silent refresh.
      const layer = { options: { opacity: 0.7 } } as unknown as L.Layer;
      const info = registry.createLayerInfo({ id: "tiles", opacity: 0.5, layer });
      expect(info.opacity).toBe(0.5);
    });

    it("falls back to 1 when the layer has no numeric options.opacity", () => {
      const layer = { options: {} } as unknown as L.Layer;
      const info = registry.createLayerInfo({ id: "bare", layer });
      expect(info.opacity).toBe(1);
    });

    it("falls back to 1 when layer is null (canvas/color/custom shapes)", () => {
      const canvas = {} as HTMLCanvasElement;
      const info = registry.createLayerInfo({ id: "heat", canvas });
      expect(info.opacity).toBe(1);
    });
  });

  describe("upsert", () => {
    it("adds a new layer", () => {
      registry.upsert(registry.createLayerInfo({ id: "new", name: "New" }));
      expect(registry.has("new")).toBe(true);
      expect(registry.size).toBe(4);
    });

    it("updates an existing layer in place", () => {
      registry.upsert(registry.createLayerInfo({ id: "overlay1", name: "Updated" }));
      expect(registry.get("overlay1")!.name).toBe("Updated");
      expect(registry.size).toBe(3);
    });

    it("refuses a role change in place and re-derives the boundary on swaps", () => {
      // The registry enforces the role-for-life rule itself, not through its
      // callers: createLayerInfo without an existing entry defaults to
      // overlay, so this swap would turn the sole base into an overlay and
      // strand the boundary — the backstop refuses it.
      const updated = registry.createLayerInfo({ id: "base1", name: "Satellite" });
      expect(() => registry.upsert(updated)).toThrow(/role/);
      // Nothing moved: the entry and the boundary are untouched.
      expect(registry.get("base1")!.name).toBe("OpenStreetMap");
      expect(registry.firstBaseIdx).toBe(2);

      // Same-role swaps still land and the boundary survives churn.
      registry.upsert(registry.createLayerInfo({ id: "overlay2", name: "v2" }));
      expect(registry.firstBaseIdx).toBe(2);
    });

    it("refreshes the boundary only when the entry is new", () => {
      const refresh = vi.spyOn(registry, "refreshFirstBaseIdx");
      registry.upsert(registry.createLayerInfo({ id: "overlay1", name: "Updated" }));
      // An in-place swap keeps the slot and cannot change the group (the
      // gate above), so the O(N) boundary scan would only repeat the same
      // answer — bulk re-registration must not pay for it.
      expect(refresh).not.toHaveBeenCalled();

      registry.upsert(registry.createLayerInfo({ id: "fresh" }));
      expect(refresh).toHaveBeenCalledTimes(1);
      // The fresh overlay enters before the base block, so the boundary moves.
      expect(registry.firstBaseIdx).toBe(3);
    });

    it("inserts a new overlay before the base block, never after it", () => {
      registry.upsert(registry.createLayerInfo({ id: "overlay3" }));
      expect(registry.layers.map(l => l.id)).toEqual([
        "overlay1",
        "overlay2",
        "overlay3",
        "base1",
      ]);
      expect(registry.firstBaseIdx).toBe(3);

      registry.upsert(registry.createLayerInfo({ id: "base2", role: ROLE.BASE }));
      // A new base appends to the base block; the boundary stays at base1.
      expect(registry.at(4).id).toBe("base2");
      expect(registry.firstBaseIdx).toBe(3);
    });

    it("repairs every derived map on an index/list disagreement", () => {
      // The defensive branch: id and list disagree (a lost delete or a bad
      // replace). Appending alone would leave stale `byId` entries and
      // positions behind, so the whole registry is rebuilt from the list.
      registry.items.length = 0;
      registry.byId.set("ghost", { id: "ghost" } as unknown as LayerInfo);
      const recovered = registry.createLayerInfo({ id: "overlay1", name: "Recovered" });
      registry.upsert(recovered);

      expect(registry.size).toBe(1);
      expect(registry.at(0)).toBe(recovered);
      expect(registry.indexOfId("overlay1")).toBe(0);
      // Entries that were only in the index are gone with the rebuild.
      expect(registry.get("ghost")).toBeUndefined();
      expect(registry.get("base1")).toBeUndefined();
      expect(registry.indexOfId("base1")).toBe(-1);
      expect(registry.firstBaseIdx).toBe(-1);
    });

    it("refuses a reorder across the overlay/base boundary", () => {
      expect(() => registry.reorder(0, 2)).toThrow(/boundary/);
      // Same-side moves stay legal.
      expect(() => registry.reorder(0, 1)).not.toThrow();
      expect(registry.layers[0].id).toBe("overlay2");
      expect(registry.layers[1].id).toBe("overlay1");
    });

    it("refuses to bring a base layer to the front", () => {
      expect(() => registry.moveToFront("base1")).toThrow(/base/);
      // The overlay block is still movable.
      registry.moveToFront("overlay2");
      expect(registry.at(0).id).toBe("overlay2");
    });
  });

  describe("prepend", () => {
    it("adds a layer at the front", () => {
      registry.prepend(registry.createLayerInfo({ id: "new", name: "New" }));
      expect(registry.at(0).id).toBe("new");
      expect(registry.size).toBe(4);
    });

    it("refuses a base layer at index 0", () => {
      // Index 0 is inside the overlay block; a base there would invert the
      // partition and strand firstBaseIdx at 0.
      const base = registry.createLayerInfo({ id: "base2", role: ROLE.BASE });
      expect(() => registry.prepend(base)).toThrow(/base layer/);
      expect(registry.size).toBe(3);
      expect(registry.at(0).id).toBe("overlay1");
      expect(registry.firstBaseIdx).toBe(2);
    });

    it("refuses an id that is already registered", () => {
      expect(() =>
        registry.prepend(registry.createLayerInfo({ id: "overlay1" })),
      ).toThrow(/already registered/);
      expect(() =>
        registry.insertAt(registry.createLayerInfo({ id: "overlay1" }), 1),
      ).toThrow(/already registered/);
      // Refused before any mutation: one entry per id, no duplicate row.
      expect(registry.size).toBe(3);
      expect(registry.indexOfId("overlay1")).toBe(0);
    });
  });

  describe("insertAt", () => {
    it("inserts a layer at a specific index", () => {
      registry.insertAt(registry.createLayerInfo({ id: "new", name: "New" }), 1);
      expect(registry.at(1).id).toBe("new");
      expect(registry.size).toBe(4);
    });

    it("refuses a non-integer or out-of-range index", () => {
      const fresh = () => registry.createLayerInfo({ id: "new" });
      for (const idx of [-1, 4, 1.5, Number.NaN]) {
        expect(() => registry.insertAt(fresh(), idx)).toThrow(/insertAt: index/);
      }
      expect(registry.size).toBe(3);

      // items.length is the inclusive upper bound — appending is legal for a
      // base (an overlay may only land before the base block).
      registry.insertAt(
        registry.createLayerInfo({ id: "base2", role: ROLE.BASE }),
        registry.size,
      );
      expect(registry.at(3).id).toBe("base2");
      expect(registry.size).toBe(4);
    });

    it("keeps the overlay/base partition at the insertion edge", () => {
      const firstBase = registry.firstBaseIdx;
      expect(firstBase).toBe(2);

      const baseAt = (idx: number) =>
        registry.insertAt(
          registry.createLayerInfo({ id: `base-${idx}`, role: ROLE.BASE }),
          idx,
        );
      // A base may start the base block or append; anything before it is in
      // the overlay block.
      expect(() => baseAt(0)).toThrow(/base block/);
      expect(() => baseAt(1)).toThrow(/base block/);
      expect(registry.size).toBe(3);

      const overlayAt = (idx: number) =>
        registry.insertAt(registry.createLayerInfo({ id: `overlay-${idx}` }), idx);
      // An overlay may reach the boundary (it lands just before the first
      // base) but never cross into the base block.
      expect(() => overlayAt(registry.size)).toThrow(/base block/);
      expect(() => overlayAt(registry.firstBaseIdx + 1)).toThrow(/base block/);
      expect(registry.size).toBe(3);

      registry.insertAt(
        registry.createLayerInfo({ id: "base2", role: ROLE.BASE }),
        firstBase,
      );
      expect(registry.firstBaseIdx).toBe(firstBase);
      expect(registry.at(firstBase).id).toBe("base2");

      registry.insertAt(
        registry.createLayerInfo({ id: "overlay3" }),
        registry.firstBaseIdx,
      );
      // The overlay lands just before the first base; firstBaseIdx moves with
      // the base block, not with the inserted overlay.
      expect(registry.at(firstBase).id).toBe("overlay3");
      expect(registry.firstBaseIdx).toBe(3);
    });

    it("only appends a base when the base block is empty", () => {
      const r = new LayerInfoRegistry([
        { id: "a", role: "overlay" },
        { id: "b", role: "overlay" },
      ] as unknown as LayerInfo[]);
      expect(() =>
        r.insertAt(r.createLayerInfo({ id: "base1", role: ROLE.BASE }), 0),
      ).toThrow(/base block/);
      r.insertAt(r.createLayerInfo({ id: "base1", role: ROLE.BASE }), r.size);
      expect(r.firstBaseIdx).toBe(2);
    });
  });

  describe("remove", () => {
    it("removes a layer by id", () => {
      registry.remove("overlay1");
      expect(registry.has("overlay1")).toBe(false);
      expect(registry.size).toBe(2);
    });

    it("returns null for unknown id", () => {
      expect(registry.remove("nonexistent")).toBeNull();
    });
  });

  describe("moveToFront (bringLayerToFront)", () => {
    it("moves an overlay to index 0", () => {
      registry.moveToFront("overlay2");
      expect(registry.at(0).id).toBe("overlay2");
    });

    it("does nothing when layer is already at front", () => {
      registry.moveToFront("overlay1");
      expect(registry.at(0).id).toBe("overlay1");
    });

    it("returns null for unknown id", () => {
      expect(registry.moveToFront("nonexistent")).toBeNull();
    });
  });

  describe("reorder", () => {
    it("moves an element within its role block", () => {
      registry.reorder(0, 1);
      expect(registry.at(0).id).toBe("overlay2");
      expect(registry.at(1).id).toBe("overlay1");
      expect(registry.at(2).id).toBe("base1");
    });

    it("refuses non-integer and out-of-range positions", () => {
      const cases: Array<[number, number]> = [
        [0, 3],
        [-1, 0],
        [0.5, 1],
        [0, Number.NaN],
      ];
      for (const [from, to] of cases) {
        expect(() => registry.reorder(from, to)).toThrow(/reorder/);
      }
      // Refused before the splice: the arrangement is untouched.
      expect(registry.layers.map(l => l.id)).toEqual(["overlay1", "overlay2", "base1"]);
    });
  });

  describe("indexOfId", () => {
    it("tracks every structural mutation and returns -1 for an unknown id", () => {
      expect(registry.indexOfId("overlay2")).toBe(1);
      expect(registry.indexOfId("ghost")).toBe(-1);

      registry.prepend(registry.createLayerInfo({ id: "front" }));
      expect(registry.indexOfId("front")).toBe(0);

      registry.insertAt(registry.createLayerInfo({ id: "middle" }), 2);
      expect(registry.indexOfId("middle")).toBe(2);

      registry.reorder(0, 1);
      expect(registry.indexOfId("front")).toBe(1);

      registry.remove("middle");
      expect(registry.indexOfId("overlay2")).toBe(2);

      registry.moveToFront("overlay2");
      expect(registry.indexOfId("overlay2")).toBe(0);

      registry.replace([registry.createLayerInfo({ id: "only" })]);
      expect(registry.indexOfId("only")).toBe(0);
      expect(registry.indexOfId("front")).toBe(-1);

      registry.clear();
      expect(registry.indexOfId("only")).toBe(-1);
    });

    it("is repaired by a structural write after an unsupported direct mutation", () => {
      // `items` is public for tests and internal walks, but direct mutation
      // is unsupported: the derived maps can only be rebuilt by a structural
      // method.
      registry.items.length = 0;
      registry.replace([registry.createLayerInfo({ id: "only" })]);
      expect(registry.indexOfId("only")).toBe(0);
      expect(registry.indexOfId("overlay1")).toBe(-1);
    });
  });

  describe("normalizeGroups", () => {
    it("reorders so overlays come before bases", () => {
      const r = new LayerInfoRegistry([
        { id: "base1", name: "B1", role: "base" },
        { id: "overlay1", name: "O1", role: "overlay" },
        { id: "base2", name: "B2", role: "base" },
      ] as unknown as LayerInfo[]);
      r.normalizeGroups();
      expect(r.at(0).id).toBe("overlay1");
      expect(r.at(1).role === "base").toBe(true);
      expect(r.at(2).role === "base").toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all layers", () => {
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.firstBaseIdx).toBe(-1);
    });
  });

  describe("canReorderBetween", () => {
    it("allows same-group reorder", () => {
      expect(registry.canReorderBetween(0, 1)).toBe(true);
      expect(registry.canReorderBetween(2, 2)).toBe(true);
    });

    it("blocks cross-group reorder", () => {
      expect(registry.canReorderBetween(0, 2)).toBe(false);
    });

    it("returns false for out-of-range indices", () => {
      expect(registry.canReorderBetween(0, 99)).toBe(false);
      expect(registry.canReorderBetween(-1, 0)).toBe(false);
    });
  });

  describe("readonly view", () => {
    it("throws on mutation via list", () => {
      expect(() => {
        registry.layers.push({ id: "x" } as unknown as LayerInfo);
      }).toThrow();
    });

    it("blocks mutating methods on view", () => {
      expect(() => {
        registry.layers.splice(0, 1);
      }).toThrow();
    });

    it("blocks defineProperty mutation on the view", () => {
      // Regression: the old Proxy without a defineProperty trap forwarded
      // Object.defineProperty to the internal mutable array, bypassing the
      // read-only guarantee. A frozen snapshot must throw instead.
      expect(() => {
        Object.defineProperty(registry.layers, "0", { value: { id: "x" } });
      }).toThrow();
    });

    it("blocks index assignment via the set trap", () => {
      // Index assignment bypasses the MUTATING_METHODS list — the set trap is
      // the backstop that must throw.
      expect(() => {
        registry.layers[0] = { id: "x" } as unknown as LayerInfo;
      }).toThrow();
    });

    it("blocks property deletion via the deleteProperty trap", () => {
      expect(() => {
        delete registry.layers[0];
      }).toThrow();
    });

    it("view reflects the latest items after an internal mutation", () => {
      registry.prepend(
        registry.createLayerInfo({ id: "new1", name: "New", role: "overlay" }),
      );
      expect(registry.layers[0].id).toBe("new1");
      expect(registry.layers.length).toBe(4);
    });
  });

  describe("replace", () => {
    it("rebuilds list and identifies from a new ordered array", () => {
      const newList = [
        registry.createLayerInfo({ id: "a", name: "A", role: "overlay" }),
        registry.createLayerInfo({ id: "b", name: "B", role: "base" }),
      ];
      registry.replace(newList);
      expect(registry.size).toBe(2);
      expect(registry.at(0).id).toBe("a");
      expect(registry.get("b")!.role === "base").toBe(true);
      expect(registry.firstBaseIdx).toBe(1);
    });
  });

  describe("indexOf", () => {
    it("returns the index of a layer info", () => {
      const li = registry.get("overlay1");
      expect(registry.indexOf(li!)).toBe(0);
    });

    it("returns -1 for an unknown layer info", () => {
      expect(registry.indexOf({ id: "nope" } as unknown as LayerInfo)).toBe(-1);
    });
  });

  describe("touch", () => {
    it("stamps updatedAt and reports true for a known id", () => {
      const before = Date.now();
      expect(registry.touch("overlay1")).toBe(true);
      const stamped = registry.get("overlay1")!.updatedAt;
      // The contract is "now", not a specific value — assert a fresh epoch ms
      // value rather than comparing to Date.now(), which can differ by a tick.
      expect(typeof stamped).toBe("number");
      expect(stamped as number).toBeGreaterThanOrEqual(before);
    });

    it("does not invent an entry for an unknown id", () => {
      expect(registry.touch("nope")).toBe(false);
      expect(registry.size).toBe(3);
      // Map semantics: get() of an absent key is undefined, not null.
      expect(registry.has("nope")).toBe(false);
      expect(registry.get("nope")).toBeUndefined();
    });

    it("overwrites a caller-supplied updatedAt (a mutation is newer than registration)", () => {
      const li = registry.createLayerInfo({
        id: "touched1",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      registry.upsert(li);
      registry.touch("touched1");
      // A string timestamp from registerLayer opts is replaced by the epoch ms
      // stamp — the panel then formats it as a real date instead of an ISO
      // literal.
      expect(registry.get("touched1")!.updatedAt).not.toBe("2026-01-01T00:00:00Z");
    });
  });

  describe("Symbol.iterator", () => {
    it("iterates in registry order, matching the view", () => {
      // `layers` is the view consumers already read; the iterator must agree on
      // both order and identity, or `for...of` and spread silently diverge from
      // the rest of the API.
      expect([...registry].map(l => l.id)).toEqual(registry.layers.map(l => l.id));
    });

    it("yields the same objects the index holds", () => {
      const li = registry.get("overlay1")!;
      expect([...registry].includes(li)).toBe(true);
    });

    it("reflects later insertions and removals", () => {
      registry.upsert(registry.createLayerInfo({ id: "tail", name: "Tail" }));
      // A new overlay enters before the base block, not at the array end.
      expect([...registry].map(l => l.id)).toEqual([
        "overlay1",
        "overlay2",
        "tail",
        "base1",
      ]);

      registry.remove("overlay1");
      expect([...registry].map(l => l.id)).not.toContain("overlay1");
    });

    it("iterates once, not twice", () => {
      // An iterator that returned a reused internal reference would be
      // surprising for consumers holding two loops over the same registry.
      const a = registry[Symbol.iterator]();
      const b = registry[Symbol.iterator]();
      expect(a).not.toBe(b);
    });
  });
});
