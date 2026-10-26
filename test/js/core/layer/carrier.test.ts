// Carrier-coverage guard — REAL Leaflet, not the shared mock.
//
// Every layer capability (opacity, visibility, zoom range, focus dimming,
// z ordering) leans on one invariant the codebase never wrote down until the
// marker-shadow bug: "a write on the layer's panes reaches the layer's whole
// visible DOM". The mock-based unit tests structurally cannot see a breach —
// the mock has no `_shadow`, no `shadowPane`, no `_initIcon` — which is why
// the marker shadow escaped pane opacity and the ImageOverlay escaped both z
// ordering and focus for so long. These tests run the real stack (PaneManager
// + LayerSurface over a real L.Map in jsdom) and assert the invariant
// directly: every element the layer paints through is a descendant of one of
// the surface's own panes. The enumeration and the assertion live in
// `core/layer/carrier.ts` (this file is its test).
//
// What is NOT asserted here: pixel-level painting order (jsdom has no layout
// engine). The stacking claim rests on the pane ladder — the shadow pane's z
// is one step below the base pane's, and the icons' inline z-index competes
// inside the base pane's stacking context — which IS asserted numerically.
import L from "leaflet";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import {
  assertInsideOwnedPanes,
  isMigratableLeaf,
  visibleDomOf,
} from "#foliplus/core/layer/carrier.js";
import { PANE_ROLE } from "#foliplus/core/layer/const.js";

// The mock `window.L` is swapped for the real library for this file only.
// The modules under test resolve `L` at call time, so the swap reaches them;
// no production module captures `L` at import time.
window.L = L as unknown as typeof window.L;

// 1×1 transparent PNGs. Data URIs keep jsdom from attempting any fetch.
const ICON_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SHADOW_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const makeIcon = () => L.icon({ iconUrl: ICON_URL, shadowUrl: SHADOW_URL });

const makeMap = (): { map: L.Map; host: PaneManager; container: HTMLDivElement } => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const map = L.map(container, { center: [26.08, 119.3], zoom: 12 });
  return { map, host: new PaneManager(map), container };
};

afterEach(() => {
  document.body.innerHTML = "";
});

/** A marker's shadow element, outside the class's protected surface. */
const shadowOf = (marker: L.Marker): HTMLElement | null =>
  (marker as unknown as { _shadow?: HTMLElement })._shadow ?? null;

/** The invariant itself, through the production guard: every visible element
 *  of the layer must sit inside one of the surface's own panes. This is the
 *  check the mock-based tests structurally cannot express. */
const expectInsideOwnedPanes = (surface: LayerSurface, layer: L.Layer): void => {
  expect(() => assertInsideOwnedPanes(surface.panes, layer)).not.toThrow();
};

/** The effective opacity a pixel of `el` paints at: the product of every
 *  inline opacity along its ancestor chain — the same semantics the browser
 *  composites with, and what "the pane write covers this element" means. */
const inlineOpacityProduct = (el: Element): number => {
  let product = 1;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const raw = (node as HTMLElement).style?.opacity;
    if (raw) product *= Number(raw);
  }
  return product;
};

const markerIn = (latlng: [number, number], opts: L.MarkerOptions = {}) =>
  L.marker(latlng, { icon: makeIcon(), ...opts });

describe("the migratable-family probe", () => {
  it("answers through every family of the table", () => {
    const { map } = makeMap();
    const marker = markerIn([26.08, 119.3]);
    const group = L.layerGroup([marker]);
    map.addLayer(group);
    expect(isMigratableLeaf(marker)).toBe(true);
    expect(isMigratableLeaf(group)).toBe(true);
    expect(
      isMigratableLeaf(L.imageOverlay(IMAGE_URL, L.latLngBounds([0, 0], [1, 1]))),
    ).toBe(true);
    expect(isMigratableLeaf(L.circleMarker([0, 0]))).toBe(true);
    map.remove();
  });

  it("falls back to false when the family probe throws", () => {
    // A hostile layer object whose prototype chain inspection throws must
    // answer "not migratable" through safeRead, not propagate.
    const evil = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("boom");
        },
      },
    );
    expect(isMigratableLeaf(evil)).toBe(false);
  });
});

describe("carrier coverage (real Leaflet)", () => {
  it("moves a marker group's icons AND shadows into the surface's panes", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([
      markerIn([26.08, 119.3]),
      markerIn([26.09, 119.31]),
      // Negative zIndexOffset: the icon's inline z goes negative wherever
      // pos.y < 100 — the exact regime where DOM order alone would let the
      // shadow paint above its icon. Only the pane ladder holds there.
      markerIn([26.1, 119.32], { zIndexOffset: -100 }),
    ]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();

    expectInsideOwnedPanes(surface, group);

    const base = surface.panes[0];
    const shadowPane = surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW);
    expect(shadowPane).toBeDefined();
    for (const marker of [group.getLayers()[0], group.getLayers()[1]] as L.Marker[]) {
      expect(marker.getElement()!.parentNode).toBe(base.element);
      expect(shadowOf(marker)!.parentNode).toBe(shadowPane!.element);
    }
    // Leaflet must re-create later icons/shadows into the same panes, so the
    // write contract includes the options the pin wrote.
    expect(group.getLayers()[0].options.pane).toBe(base.name);
    expect(
      (group.getLayers()[0].options as L.LayerOptions & { shadowPane?: string })
        .shadowPane,
    ).toBe(shadowPane!.name);
    map.remove();
  });

  it("keeps the shadow pane one step below the base pane's z", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([markerIn([26.08, 119.3])]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();
    surface.setZ(650);

    const base = surface.panes[0];
    const shadowPane = surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW)!;
    expect(Number(base.element.style.zIndex)).toBe(650);
    expect(Number(shadowPane.element.style.zIndex)).toBe(649);
    // The stacking guarantee, restated: the icons' inline z (negative
    // included) competes inside the base pane; the shadow pane is a sibling
    // priced below it. Whatever sign the icons carry, the shadow loses to
    // its own icon and to nothing the surface doesn't own.
    expect(Number(shadowPane.element.style.zIndex)).toBeLessThan(
      Number(base.element.style.zIndex),
    );
    map.remove();
  });

  it("covers a marker added after materialization (late content)", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();

    const late = markerIn([26.08, 119.3]);
    // Adding to a group that is already on the map places the marker on the
    // map too — the layeradd path a live session takes.
    group.addLayer(late);
    surface.markContentDirty();
    surface.materialize();

    expectInsideOwnedPanes(surface, group);
    expect(late.getElement()!.parentNode).toBe(surface.panes[0].element);
    map.remove();
  });

  it("keeps icon and shadow in the layer's panes across setIcon", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([markerIn([26.08, 119.3])]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();
    const marker = group.getLayers()[0] as L.Marker;
    const base = surface.panes[0];
    const shadowPane = surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW)!;

    // A fresh Icon (not a reuse): `_initIcon` re-creates both elements and
    // mounts them from `options.pane` / `options.shadowPane` — both written
    // by the pin, so the re-creation lands in the layer's panes directly.
    marker.setIcon(
      L.icon({
        iconUrl: ICON_URL,
        shadowUrl: SHADOW_URL,
        iconSize: [30, 30],
      }),
    );

    expect(marker.getElement()).not.toBeNull();
    expectInsideOwnedPanes(surface, group);
    expect(marker.getElement()!.parentNode).toBe(base.element);
    expect(shadowOf(marker)!.parentNode).toBe(shadowPane.element);
    map.remove();
  });

  it("covers Path leaves (CircleMarker) through the pane's renderer", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([L.circleMarker([26.08, 119.3], { radius: 10 })]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "vec", layer: group });
    surface.materialize();

    expectInsideOwnedPanes(surface, group);
    map.remove();
  });

  it("covers an ImageOverlay's image — the pane write finally reaches it", () => {
    const { map, host } = makeMap();
    const image = L.imageOverlay(
      IMAGE_URL,
      L.latLngBounds([26.0, 119.2], [26.2, 119.5]),
    );
    map.addLayer(image);
    const surface = new LayerSurface(host, { id: "img", layer: image });
    surface.materialize();

    // The image used to stay in the shared overlayPane: setZ wrote the
    // surface's panes (no effect on the image) and the focus hide rule never
    // matched it. Inside the surface pane, both work.
    expectInsideOwnedPanes(surface, image);
    expect(image.getElement()!.closest(".foliplus-layer-pane")).toBe(
      surface.panes[0].element,
    );
    expect(surface.setZ(700)).toBe(true);
    map.remove();
  });

  it("covers a TileLayer's container", () => {
    const { map, host } = makeMap();
    const tiles = L.tileLayer("data:image/png;base64,AAA/{z}/{x}/{y}.png");
    map.addLayer(tiles);
    const surface = new LayerSurface(host, { id: "basemap", layer: tiles });
    surface.materialize();

    expectInsideOwnedPanes(surface, tiles);
    map.remove();
  });

  it("multiplies the author's marker opacity with the pane write", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([markerIn([26.08, 119.3], { opacity: 0.5 })]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();
    const marker = group.getLayers()[0] as L.Marker;

    // The executor's pane write, verbatim: one CSS opacity per surface pane.
    for (const pane of surface.panes) {
      pane.element.style.opacity = "0.8";
    }

    // The slider is a multiplier over the author's declared default:
    // 0.8 (pane) × 0.5 (marker) = 0.4 — and the shadow rides the same
    // product now that it lives in a surface pane.
    expect(inlineOpacityProduct(marker.getElement()!)).toBeCloseTo(0.4);
    expect(inlineOpacityProduct(shadowOf(marker)!)).toBeCloseTo(0.4);
    map.remove();
  });

  it("fades one layer without touching another's icons or shadows", () => {
    const { map, host } = makeMap();
    const groupA = L.layerGroup([markerIn([26.08, 119.3])]);
    const groupB = L.layerGroup([markerIn([26.08, 119.3])]);
    map.addLayer(groupA);
    map.addLayer(groupB);
    const surfaceA = new LayerSurface(host, { id: "a", layer: groupA });
    const surfaceB = new LayerSurface(host, { id: "b", layer: groupB });
    surfaceA.materialize();
    surfaceB.materialize();

    for (const pane of surfaceA.panes) {
      pane.element.style.opacity = "0";
    }

    const markerB = groupB.getLayers()[0] as L.Marker;
    expect(inlineOpacityProduct(markerB.getElement()!)).toBe(1);
    expect(inlineOpacityProduct(shadowOf(markerB)!)).toBe(1);
    map.remove();
  });

  it("degrades a shared-pane declaration to a synthesized pane", () => {
    // A surface whose declared pane is one of Leaflet's shared panes must
    // never adopt it — the layer's z / opacity / focus writes would land on
    // a pane every other layer draws into. The declaration is refused (warn)
    // and the fallback synthesis gives the layer its own pane, so the
    // ordering pass writes z there instead of on the shared stack. The
    // write-side gate (`assertOwnedPane`) stays as the tripwire behind it.
    const { map, host } = makeMap();
    const marker = markerIn([26.08, 119.3]);
    map.addLayer(marker);
    const surface = new LayerSurface(host, {
      id: "misdeclared",
      layer: marker,
      paneName: "overlayPane",
    });
    surface.materialize();

    expect(surface.paneNames[0]).toMatch(/^foliplus-pane-/);
    expect(surface.paneNames).not.toContain("overlayPane");
    expect(marker.getElement()!.parentNode).toBe(surface.panes[0].element);
    expect(surface.setZ(700)).toBe(true);
    expect(surface.panes[0].element.style.zIndex).toBe("700");
    map.remove();
  });

  it("refuses a shared-pane z write if one ever reaches a surface", () => {
    // The write-side tripwire behind the declaration gate: a surface that
    // somehow holds a shared pane must fail its z write loudly rather than
    // reorder the whole map. Reached here by forcing the handle in directly.
    const { map, host } = makeMap();
    const marker = markerIn([26.08, 119.3]);
    map.addLayer(marker);
    const surface = new LayerSurface(host, { id: "pts", layer: marker });
    surface.materialize();
    (surface.panes as { name: string }[])[0].name = "tilePane";
    expect(() => surface.setZ(700)).toThrow(/shared pane/);
    map.remove();
  });
});

describe("visibleDomOf (the audit table, executable)", () => {
  it("enumerates a marker's icon and shadow", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([markerIn([26.08, 119.3])]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();
    const marker = group.getLayers()[0] as L.Marker;

    const dom = visibleDomOf(group);
    expect(dom).toHaveLength(2);
    expect(dom).toContain(marker.getElement()!);
    expect(dom).toContain(shadowOf(marker)!);
    map.remove();
  });

  it("enumerates an ImageOverlay's image", () => {
    const { map, host } = makeMap();
    const image = L.imageOverlay(
      IMAGE_URL,
      L.latLngBounds([26.0, 119.2], [26.2, 119.5]),
    );
    map.addLayer(image);
    const surface = new LayerSurface(host, { id: "img", layer: image });
    surface.materialize();

    expect(visibleDomOf(image)).toEqual([image.getElement()!]);
    map.remove();
  });

  it("enumerates a TileLayer's container, and descends groups skipping the container", () => {
    const { map, host } = makeMap();
    const tiles = L.tileLayer("data:image/png;base64,AAA/{z}/{x}/{y}.png");
    map.addLayer(tiles);
    const surface = new LayerSurface(host, { id: "basemap", layer: tiles });
    surface.materialize();

    expect(visibleDomOf(tiles)).toEqual([tiles.getContainer()!]);
    map.remove();
  });

  it("assertInsideOwnedPanes throws naming the escaped elements", () => {
    const { map, host } = makeMap();
    const group = L.layerGroup([markerIn([26.08, 119.3])]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "pts", layer: group });
    surface.materialize();

    // The guard names what escaped so the failure reads like the audit.
    expect(() => assertInsideOwnedPanes([], group)).toThrow(/IMG.*panes/);
    // And it is silent on the compliant state — the guard must never
    // manufacture a failure for a layer the carrier covers.
    expect(() => assertInsideOwnedPanes(surface.panes, group)).not.toThrow();
    map.remove();
  });
});

describe("declared panes (real Leaflet)", () => {
  it("gives a declared-pane marker its own shadow carrier", () => {
    // The declared route changes who assigns the icon's pane, not whether
    // the layer's full visible DOM is covered: the shadow pane is the
    // surface's own carrier regardless of who declared the base pane.
    // (A declared pane on a flat layer is the direct-registration shape;
    // createLayers groups route their children through pinTree.)
    const { map, host } = makeMap();
    const preBuilt = map.createPane("custom-marker-pane");
    const marker = markerIn([26.08, 119.3]);
    map.addLayer(marker);
    const surface = new LayerSurface(host, {
      id: "declared",
      layer: marker,
      paneName: "custom-marker-pane",
    });
    surface.materialize();

    const base = surface.panes[0];
    const shadowPane = surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW)!;
    expect(base.name).toBe("custom-marker-pane");
    expect(shadowPane.name).toBe("custom-marker-pane-shadow");
    // An adopted pre-built pane satisfies the same CSS contract as a created
    // one — the focus hide rule keys on the class.
    expect(base.element).toBe(preBuilt);
    expect(base.element.classList.contains("foliplus-layer-pane")).toBe(true);
    expect(marker.getElement()!.parentNode).toBe(base.element);
    expect(shadowOf(marker)!.parentNode).toBe(shadowPane.element);
    expect(marker.options.shadowPane).toBe(shadowPane.name);
    expectInsideOwnedPanes(surface, marker);
    map.remove();
  });

  it("keeps the declared shadow carrier across setIcon", () => {
    const { map, host } = makeMap();
    map.createPane("declared-icon-pane");
    const marker = markerIn([26.08, 119.3]);
    map.addLayer(marker);
    const surface = new LayerSurface(host, {
      id: "declared",
      layer: marker,
      paneName: "declared-icon-pane",
    });
    surface.materialize();

    marker.setIcon(L.icon({ iconUrl: ICON_URL, shadowUrl: SHADOW_URL }));
    expectInsideOwnedPanes(surface, marker);
    map.remove();
  });

  it("gives a declared-pane createLayers group a shadow carrier", () => {
    // createLayers routes each leaf's pane itself (pinTree writes
    // options.pane before the leaves join the map) — the surface must still
    // own the shadows: a leaf joining later lands its shadow in the shared
    // shadowPane, and the reconcile's shadow-only sweep reclaims it.
    const { map, host } = makeMap();
    map.createPane("measure-graph");
    const group = L.layerGroup([]);
    const surface = new LayerSurface(host, {
      id: "measured",
      layer: group,
      paneName: "measure-graph",
    });
    surface.materialize();
    // The group registered empty: no shadow pane yet (the probe saw no
    // markers), which is the honest state until content arrives.
    expect(surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW)).toBeUndefined();

    // A marker joins after materialization, the way MeasureControl's
    // addLayer does: pinned at the source (options.pane pre-written).
    const late = markerIn([26.08, 119.3]);
    late.options.pane = "measure-graph";
    group.addLayer(late);
    map.addLayer(late);
    // The shared shadowPane still holds the shadow — until the dirty surface
    // reconciles, which synthesizes the shadow pane and sweeps shadows into it.
    expect(shadowOf(late)!.parentNode).not.toBe(map.getPane("measure-graph-shadow"));
    surface.markContentDirty();
    surface.materialize();
    const shadowPane = surface.panes.find(pane => pane.role === PANE_ROLE.SHADOW)!;
    expect(shadowPane.name).toBe("measure-graph-shadow");
    expect(late.getElement()!.parentNode).toBe(surface.panes[0].element);
    expect(shadowOf(late)!.parentNode).toBe(shadowPane.element);
    expect(late.options.shadowPane).toBe(shadowPane.name);
    expectInsideOwnedPanes(surface, group);
    map.remove();
  });

  it("refuses a second claim on the same declared pane and degrades", () => {
    // Two surfaces declaring one custom pane would co-write it (opacity, z,
    // focus, export) — the second claim is refused at the declaration edge
    // and degrades to its own synthesized pane.
    const { map, host } = makeMap();
    map.createPane("shared-business-pane");
    const groupA = L.layerGroup([markerIn([26.08, 119.3])]);
    const groupB = L.layerGroup([markerIn([26.09, 119.31])]);
    map.addLayer(groupA);
    map.addLayer(groupB);
    const surfaceA = new LayerSurface(host, {
      id: "a",
      layer: groupA,
      paneName: "shared-business-pane",
    });
    const surfaceB = new LayerSurface(host, {
      id: "b",
      layer: groupB,
      paneName: "shared-business-pane",
    });
    surfaceA.materialize();
    surfaceB.materialize();

    expect(surfaceA.paneNames[0]).toBe("shared-business-pane");
    expect(surfaceB.paneNames).not.toContain("shared-business-pane");
    expect(surfaceB.paneNames[0]).toMatch(/^foliplus-pane-/);
    // The isolation, end to end: fading A leaves B's pixels alone.
    for (const pane of surfaceA.panes) pane.element.style.opacity = "0";
    const markerB = groupB.getLayers()[0] as L.Marker;
    expect(inlineOpacityProduct(markerB.getElement()!)).toBe(1);
    expect(inlineOpacityProduct(shadowOf(markerB)!)).toBe(1);
    map.remove();
  });
});

describe("unknown third-party layers (real Leaflet)", () => {
  it("degrades an unrecognizable layer to the none carrier", () => {
    // A plugin layer with its own getElement(): the migrator cannot relocate
    // its DOM, so promising "pane" would advertise a write the carrier never
    // delivers. Honest degradation: opacity none, not relocatable.
    const { map, host } = makeMap();
    // A minimal third-party Layer subclass: a real L.Layer (so the map takes
    // it) that paints through its own element but belongs to none of the
    // migratable families — exactly the shape the migrator cannot relocate.
    const foreignEl = document.createElement("div");
    foreignEl.className = "foreign-face";
    const ForeignLayer = L.Layer.extend({
      onAdd(m: L.Map) {
        m.getPane("overlayPane")?.appendChild(foreignEl);
      },
      onRemove() {},
      getElement: () => foreignEl,
    });
    const foreign = new ForeignLayer() as unknown as L.Layer;
    map.addLayer(foreign);
    const surface = new LayerSurface(host, { id: "foreign", layer: foreign });
    surface.materialize();

    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.relocatable).toBe(false);
    expect(surface.setZ(700)).toBe(true); // panes still price the slot
    map.remove();
  });

  it("promises pane coverage to a bare Leaflet container, even empty", () => {
    // L.featureGroup() is a built-in family: its visible DOM is its subtree,
    // and the migrator relocates leaves as they arrive. The heatmap's
    // unregister/re-draw cycle keeps an empty group registered for a frame —
    // the opacity row must not flash off in between.
    const { map, host } = makeMap();
    const group = L.featureGroup([]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "empty", layer: group });
    surface.materialize();

    expect(surface.capabilities.opacity).toBe("pane");
    expect(surface.capabilities.relocatable).toBe(true);
    map.remove();
  });

  it("treats a Path+Marker tree as pane-carried, not mixed (TT-3a premise)", () => {
    // Correcting the task premise: `mixed` is not "vectors + markers". Both
    // families are migratable, so their shared surface already gets pane
    // opacity — icons and shadows included. A Path+Marker tree never needed
    // a leaf-native split.
    const { map, host } = makeMap();
    const group = L.featureGroup([
      L.circleMarker([26.08, 119.3]),
      markerIn([26.09, 119.31]),
    ]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "mixed-content", layer: group });
    surface.materialize();

    expect(surface.capabilities.opacity).toBe("pane");
    expect(surface.capabilities.relocatable).toBe(true);
    map.remove();
  });

  it("does not promise leaf-native while an unknown leaf needs a pane carrier", () => {
    // `mixed` means at least one leaf is outside MIGRATABLE_FAMILIES. That
    // leaf is not a Marker, so no native setter can fade it, and it is not
    // relocatable, so no pane write can reach it either. Splitting the
    // markers off would advertise coverage the unknown leaf never gets —
    // the honest answer stays "none" for the whole surface.
    const { map, host } = makeMap();
    const foreignEl = document.createElement("div");
    const ForeignLayer = L.Layer.extend({
      onAdd(m: L.Map) {
        m.getPane("overlayPane")?.appendChild(foreignEl);
      },
      onRemove() {},
      getElement: () => foreignEl,
    });
    const group = L.featureGroup([
      markerIn([26.08, 119.3]),
      new ForeignLayer() as unknown as L.Layer,
    ]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "mixed-unknown", layer: group });
    surface.materialize();

    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.relocatable).toBe(false);
    map.remove();
  });

  it("keeps a native-opacity marker out of every opacity-written pane", () => {
    // The guard that makes double-apply impossible to introduce silently: if
    // a later change ever reports "leaf-native", the marker it fades with
    // `setOpacity` must not sit in a pane the executor writes CSS opacity
    // onto — that product would be worse than no opacity at all.
    const { map, host } = makeMap();
    const group = L.featureGroup([
      L.circleMarker([26.08, 119.3]),
      markerIn([26.09, 119.31]),
    ]);
    map.addLayer(group);
    const surface = new LayerSurface(host, { id: "double-apply", layer: group });
    surface.materialize();
    const marker = group.getLayers()[1] as L.Marker;

    // Widen deliberately: the tier is not in the union yet. This branch
    // documents the future contract, so a later addition cannot make the
    // guard silently unreachable (and does not trigger TS2367 today).
    const opacity: string = surface.capabilities.opacity;
    if (opacity === "leaf-native") {
      for (const pane of surface.panes) {
        if (pane.role === PANE_ROLE.ANNOTATION || pane.role === PANE_ROLE.SHADOW) {
          continue;
        }
        expect(pane.element.contains(marker.getElement()!)).toBe(false);
      }
    } else {
      // Today the tree is pane-carried: the marker is inside the written
      // pane, so pane opacity covers it and no leaf setter runs.
      expect(opacity).toBe("pane");
      expect(surface.panes[0].element.contains(marker.getElement()!)).toBe(true);
    }
    map.remove();
  });
});
