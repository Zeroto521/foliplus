// Style capability — the one call that answers "which style
// dimensions does this layer honestly support".
//
// The panel and the menu both ask through this single projection. The
// per-dimension gates (`layerCanFill`, `layerCanBorder`, ...) are thin
// wrappers over `dims`, and the retired two-layer gate factory is gone:
// one projection, not a gate factory plus a projection. The capability
// slots are the single source (derived once by `detectCapabilities`).
//
// This module is a read-only projection over the surface — never a second
// derivation. It returns the same bits the per-dimension gates returned, so
// the row presence is unchanged; the only intended behavior change is the
// menu's `canConfigure` delegation — the menu asks the same one projection.
//
// The projection publishes all nine style dims (opacity / zoomRange / label
// / border / size / icon / fill / iconColor / markerColor) plus the layer's
// geometry class for mode resolution. The per-dimension gates are the parity
// source of truth; this reader mirrors them exactly (locked by the parity
// test), so the row presence never changes when a dim joins the projection.
// The remaining consumer migration (S2 gate move) is out of scope here.
import type { LayerUI } from "../surface.js";
import { isColorBasemap } from "./fillAuthor.js";
import { projectDims } from "./dimTable.js";
import type { StyleDims } from "./dimTable.js";

/** The surface geometry classification published for the S3 mode resolver.
 *  Five values are the surface's own `geometryType()` answer (point / line /
 *  polygon / empty / unknown / custom); `"basemap"` is a UI synthesis — the
 *  color basemap is a solid fill, not a surface-native geometry — and `null`
 *  means no layer is registered (same short circuit as an all-false dims). */
type StyleGeometry =
  "point" | "line" | "polygon" | "empty" | "unknown" | "custom" | "basemap" | null;

/** The full style-capability answer for one layer, in one object.
 *
 *  `dims` lists the dimensions the projection publishes today. They are
 *  required booleans — not `Partial` — so a reader never has to fall back on
 *  `?? false`; the type itself guarantees a boolean per published dim.
 *  Adding a new published dim means adding the key here and to both return
 *  sites in `styleCapability` below, plus one parity assertion in
 *  `styleCapability.test.ts`. */
interface StyleCapability {
  /** The dims boolean map — the field set is derived from STYLE_DIM_TABLE,
   *  so adding a dimension only touches the table (and this type follows). */
  dims: StyleDims;
  /** The layer's geometry class for mode resolution; null when the layer is
   *  missing (all-false short circuit). `"basemap"` is a UI synthesis, not a
   *  surface-native `geometryType()` value. */
  geometry: StyleGeometry;
  /** The layer publishes styleSetters (third-party canvas layers: Heatmap,
   *  Measure) — the menu's delegation gate, exactly as
   *  `layerHasStyleDelegation` reads it. */
  styleDelegation: boolean;
}

/** Resolve the full style-capability answer for one layer.
 *
 *  Pure projection: `layerInfo` absence short-circuits to all-false (a
 *  missing layer is a programming error, but the reader must not throw where
 *  the gates return `false`). Everything else reads the surface's capability
 *  slots and the registry entry's author declarations — no re-derivation. */
const styleCapability = (ui: LayerUI, layerId: string): StyleCapability => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) {
    return {
      dims: projectDims({}),
      styleDelegation: false,
      geometry: null,
    };
  }
  const surface = ui.c.surfaceFor(layerInfo);
  const caps = surface.capabilities;
  const geometry: StyleGeometry = isColorBasemap(layerInfo)
    ? "basemap"
    : (surface.geometryType() as StyleGeometry);
  return {
    dims: projectDims(caps),
    styleDelegation:
      !!layerInfo.styleSetters && Object.keys(layerInfo.styleSetters).length > 0,
    geometry,
  };
};

export { styleCapability };
