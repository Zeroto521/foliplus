// Discriminator: does unchecking a nested group hide its
// GRANDCHILDREN on the map, and does the group row's visible count track them?
//
// Three questions this pins (lead's directive — evidence before code):
//   (1) After unchecking group A (which contains group B, which contains marker
//       M), is map.hasLayer(M) false? A real Leaflet map cascades removeLayer
//       through the whole subtree, so if it is already false the "grandchild
//       stays visible" premise does not exist on main.
//   (2) What does countVisibleChildLayers(A, map) read, and does it track the
//       grandchild the row UI claims to represent? It counts DIRECT children
//       only, so a grandchild is invisible to it by design.
//   (3) After unchecking A, does group B report on the map (folding state)?
import { installLeafletGlobals } from "./fixture.js";
import { describe, expect, it, vi } from "vitest";
import { countVisibleChildLayers } from "#core/layer/index.js";
import { dispatchStateOp } from "#control/LayerControl/ui/apply.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";

/** A membership-tracking map that emulates Leaflet's recursive cascade:
 *  removing a container removes every descendant it owns. */
const makeMembershipMap = () => {
  installLeafletGlobals();
  const members = new Set<unknown>();
  const parents = new Map<unknown, unknown[]>();
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn((l: unknown) => members.has(l)),
    addLayer: vi.fn((l: any) => {
      members.add(l);
      for (const kid of parents.get(l) ?? []) map.addLayer(kid);
    }),
    removeLayer: vi.fn((l: any) => {
      members.delete(l);
      for (const kid of parents.get(l) ?? []) map.removeLayer(kid);
    }),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
  };
  return {
    map,
    members,
    register: (parent: unknown, kids: unknown[]) => parents.set(parent, kids),
  };
};

const markerM = () => ({ options: {}, eachLayer: undefined });
/** A group node exposing its kids through eachLayer (Leaflet LayerGroup shape). */
const groupNode = (kids: unknown[]) => ({
  options: {},
  eachLayer: (fn: (c: unknown) => void) => {
    for (const k of kids) fn(k);
  },
});

const makeUi = (map: unknown) =>
  ({
    c: {
      map,
      surfaceFor: () => ({ capabilities: { visibility: "native" } }),
      findLayer: vi.fn(),
    },
  }) as unknown as LayerUI;

describe("nested group grandchild visibility", () => {
  it("unchecking group A hides the grandchild M (cascade)", () => {
    const { map, register } = makeMembershipMap();
    const m = markerM();
    const b = groupNode([m]);
    const a = groupNode([b]);
    register(a, [b]);
    register(b, [m]);

    const layerInfo = {
      id: "a",
      layer: a,
      canvas: undefined,
    } as unknown as Parameters<typeof dispatchStateOp>[1];
    const ui = makeUi(map);

    map.addLayer(a);
    expect(map.hasLayer(m)).toBe(true);

    dispatchStateOp(ui, layerInfo, { type: "visible", value: false });
    // The control removes the WHOLE group in one call and lets Leaflet
    // cascade; a per-child loop would call removeLayer for b and m too.
    // The first call is the control's own: the whole group, not a child.
    // (The mock's own cascade adds further calls, so count the first.)
    expect(map.removeLayer.mock.calls[0][0]).toBe(a);
    expect(map.hasLayer(m)).toBe(false);
  });

  it("countVisibleChildLayers counts only DIRECT children of A", () => {
    const { map, register } = makeMembershipMap();
    const m = markerM();
    const b = groupNode([m]);
    const a = groupNode([b]);
    register(a, [b]);
    register(b, [m]);

    map.addLayer(a); // cascades: b and m are on the map
    expect(map.hasLayer(b)).toBe(true);
    // Only the DIRECT child (b) counts; the grandchild m is invisible to the
    // direct-child census by design.
    expect(countVisibleChildLayers(a as never, map as never)).toBe(1);
  });
});
