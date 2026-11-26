// core/layer/arrangement — shared fixtures for the arrangement tests.
//
// The arrangement tests need the same minimal LayerInfo fake the folder-layout
// suite uses (the ordering domain reads only id / role / folder), plus a
// deterministic PRNG so a failing random sequence is reproducible from its seed.
import type { LayerInfo, LayerRole } from "#core/layer/index.js";

/** A minimal LayerInfo: the arrangement reads identity, role and declaration. */
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

/** Deterministic 32-bit PRNG (mulberry32): each random sequence is a fixture. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export { entry, mulberry32 };
