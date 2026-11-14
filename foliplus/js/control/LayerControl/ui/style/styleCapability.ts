// Style capability — the one call that answers "which style
// dimensions does this layer honestly support".
//
// The panel and the menu today ask the same question through two shapes: the
// per-dimension gates (`layerCanFill`, `layerCanBorder`, ...) each read
// `capabilities.{slot}` via `capabilityGate`, and the menu's `canConfigure`
// re-asks a narrower set (opacity / zoomRange / label / delegation) instead of
// the panel's full dimension list. The capability slots are already the single
// source (derived once by `detectCapabilities`); what the UI lacks is ONE
// projection that reads all of them.
//
// This module is a read-only projection over the surface — never a second
// derivation. It returns the same bits the per-dimension gates return, so the
// row presence is unchanged; the only intended behavior change is the
// menu's `canConfigure` delegation — the menu asks the same one projection.
//
// The projection deliberately publishes ONLY the capability bits the menu
// consumes today (opacity / zoomRange / label / delegation). The remaining
// dimensions (fill / border / size / icon / iconColor / markerColor) still
// answer through their own per-dimension gates; each one joins this projection
// together with its consumer, in the PR that introduces that consumer.
import type { LayerUI } from "../surface.js";
import { CAP_TIER } from "#core/layer/index.js";

/** The style dimensions the reader can project. Ordered like the panel's
 *  `DIM_ORDER` + `LABEL_DIM_ORDER` union (the reader adds nothing outside
 *  those two arrays — `registry.test` locks that union). */
type StyleDim =
  | "fill"
  | "border"
  | "opacity"
  | "size"
  | "label"
  | "icon"
  | "iconColor"
  | "markerColor"
  | "zoomRange";

/** The full style-capability answer for one layer, in one object. */
interface StyleCapability {
  /** One boolean per dimension the projection currently PUBLISHES (the ones a
   *  production consumer reads). The type keeps the full vocabulary so a
   *  future consumer extends this map with its dimension — one line in the
   *  `dims` object below plus one parity assertion — instead of a type edit.
   *  Dimensions without a consumer still answer through their own gate and are
   *  absent from this map. */
  dims: Partial<Record<StyleDim, boolean>>;
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
      dims: {
        opacity: false,
        zoomRange: false,
        label: false,
        size: false,
        icon: false,
      },
      styleDelegation: false,
    };
  }
  const caps = ui.c.surfaceFor(layerInfo).capabilities;
  return {
    dims: {
      opacity: caps.opacity !== CAP_TIER.NONE,
      zoomRange: caps.zoomRange !== CAP_TIER.NONE,
      label: caps.label !== CAP_TIER.NONE,
      size: caps.size === CAP_TIER.NATIVE,
      icon: caps.icon === CAP_TIER.NATIVE,
    },
    styleDelegation:
      !!layerInfo.styleSetters && Object.keys(layerInfo.styleSetters).length > 0,
  };
};

export { styleCapability };
