// core/mapApi.ts — the single owner of the per-map `map.foliplus` namespace seed.
//
// Five factories build that namespace piecemeal (ensureHint / ensureEvents /
// ensureModes / ensureLayerAPI / ensureInteraction), each adding only its own
// member, yet the rest of the codebase calls `map.foliplus!.showHint(...)`
// without narrowing. Keeping the interface's members required is what makes
// those call sites sound — making them optional would turn every one into a
// TS2722. This module is where the one necessary lie lives, and it is a leaf:
// nothing else in core imports it, so all five factories can share the seed
// without introducing a cycle.

/**
 * Seed the per-map namespace when absent and return it.
 *
 * The `LayerAPI: null` entry exists only so the empty object typechecks. Every
 * real caller reaches `LayerAPI` through `ensureLayerAPI`, which replaces the
 * null — nothing reads the seed value. See `MapFoliplus` in type/global.d.ts.
 */
const ensureMapFoliplus = (map: L.Map): MapFoliplus => {
  if (!map.foliplus) map.foliplus = { LayerAPI: null! } as unknown as MapFoliplus;
  return map.foliplus;
};

export { ensureMapFoliplus };
