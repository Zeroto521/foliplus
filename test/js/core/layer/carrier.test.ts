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
// the surface's own panes.
//
// What is NOT asserted here: pixel-level painting order (jsdom has no layout
// engine). The stacking claim rests on the pane ladder — the shadow pane's z
// is one step below the base pane's, and the icons' inline z-index competes
// inside the base pane's stacking context — which IS asserted numerically.
import L from "leaflet";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
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

/** Every DOM element the layer can paint through, from the private fields
 *  real Leaflet actually fills: `_icon` + `_shadow` (Marker), `_path`
 *  (Path, via `getElement`), `_image` (ImageOverlay, via `getElement`), and
 *  the GridLayer container. This enumeration is the carrier contract's
 *  definition of "visible DOM" — a new layer type that paints through an
 *  element nobody lists here passes the guard vacuously, which is the
 *  intended failure mode: teaching `visibleDomOf` about the field is the
 *  moment the audit table and the guard meet. */
const visibleDomOf = (layer: L.Layer): HTMLElement[] => {
  const out: HTMLElement[] = [];
  const visit = (node: L.Layer): void => {
    if (typeof (node as L.LayerGroup).eachLayer === "function") {
      (node as L.LayerGroup).eachLayer(visit);
      return;
    }
    const el = (node as { getElement?: () => HTMLElement | null }).getElement?.();
    if (el) out.push(el);
    // `_shadow` is protected on @types/leaflet's Marker — the structural
    // probe reads it like the adapter does.
    const shadow = (node as unknown as { _shadow?: HTMLElement })._shadow;
    if (shadow) out.push(shadow);
    const tileContainer = (node as L.GridLayer).getContainer?.();
    if (tileContainer) out.push(tileContainer);
  };
  visit(layer);
  return out;
};

/** A marker's shadow element, outside the class's protected surface. */
const shadowOf = (marker: L.Marker): HTMLElement | null =>
  (marker as unknown as { _shadow?: HTMLElement })._shadow ?? null;

/** The invariant itself: every visible element is a descendant of one of the
 *  surface's own panes. This is the guard the mock tests cannot express. */
const expectInsideOwnedPanes = (surface: LayerSurface, layer: L.Layer): void => {
  for (const el of visibleDomOf(layer)) {
    const owner = surface.panes.find(pane => pane.element.contains(el));
    expect(owner, `${el.tagName} escaped the surface's panes`).toBeDefined();
  }
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
