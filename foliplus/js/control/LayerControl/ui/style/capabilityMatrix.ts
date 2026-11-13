// Style capability matrix — the one call that answers "which style
// dimensions does this layer honestly support".
//
// The panel and the menu today ask the same question through two shapes: the
// per-dimension gates (`layerCanFill`, `layerCanBorder`, ...) each read
// `capabilities.{slot}` via `capabilityGate`, and the menu's `canConfigure`
// re-asks a narrower set (opacity / zoomRange / label / delegation) instead of
// the panel's full dimension list. The capability slots are already the single
// source (derived once by `detectCapabilities`); what the UI lacks is ONE
// projection that reads all of them plus the handful of sub-questions the rows
// layer on top (per-feature author paint, value-field presence, border-carries-
// value, color-basemap mechanism, follow-fill eligibility).
//
// This module is a read-only projection over the surface — never a second
// derivation. It returns the same bits the per-dimension gates return, so the
// row presence is unchanged; the only intended behavior change is the
// menu's `canConfigure` delegation — the menu asks the same one projection.
//
// The sub-questions are exposed as booleans, not re-derived per call site, so
// a row cannot drift from the capability it belongs to.
import type { LayerUI } from "../surface.js";
import { hasValueField } from "./fillValue.js";
import { CAP_TIER, GEOM_TYPE, ROLE } from "#core/layer/index.js";

/** The style dimensions the matrix projects. Ordered like the panel's
 *  `DIM_ORDER` + `LABEL_DIM_ORDER` union (the matrix adds nothing outside
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
  /** One boolean per dimension: the surface's capability slot against the
   *  gate's required tier (native for stroke/fill/size/icon/iconColor/
   *  markerColor, non-none for opacity/zoomRange/label). */
  dims: Record<StyleDim, boolean>;
  /** Author painted per feature (explore layers) — the fill ORIGINAL gate.
   *  Reads `fillAuthor.perFeature` from the registry entry, exactly as
   *  `paintsPerFeatureFill` does. */
  perFeatureFill: boolean;
  /** Any numeric or categorical field the layer exposes — the by-value entry
   *  condition shared by the fill row and the border row. */
  hasValueField: boolean;
  /** The border classifies by value only on a line — its stroke is the
   *  element's primary colour, so VALUE is a real third state. */
  borderCarriesValue: boolean;
  /** Mechanism distinction, not a capability: a solid-color basemap's fill is
   *  its pane paint (`layerInfo.color`), not vector leaves. `detectCapabilities`
   *  already declares `fill:native` for it; this flags the write path. */
  isColorBasemap: boolean;
  /** FOLLOW_FILL is offered only where the border is an outline over a filled
   *  face (polygon/point) — never on a line (its border IS the colour). */
  canFollowFill: boolean;
  /** The layer publishes styleSetters (third-party canvas layers: Heatmap,
   *  Measure) — the menu's delegation gate, exactly as
   *  `layerHasStyleDelegation` reads it. */
  styleDelegation: boolean;
}

/** The geometry category of the layer, resolved from the surface (never a
 *  layer-name/type-string guess). `null` for a missing layer. */
const geometryKindOf = (ui: LayerUI, layerId: string): string | null => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return null;
  return ui.c.surfaceFor(layerInfo).geometryType();
};

/** Resolve the full style-capability answer for one layer.
 *
 *  Pure projection: `layerInfo` absence short-circuits to all-false (a
 *  missing layer is a programming error, but the matrix must not throw where
 *  the gates return `false`). Everything else reads the surface's capability
 *  slots and the registry entry's author declarations — no re-derivation. */
const styleCapability = (ui: LayerUI, layerId: string): StyleCapability => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) {
    return {
      dims: {
        fill: false,
        border: false,
        opacity: false,
        size: false,
        label: false,
        icon: false,
        iconColor: false,
        markerColor: false,
        zoomRange: false,
      },
      perFeatureFill: false,
      hasValueField: false,
      borderCarriesValue: false,
      isColorBasemap: false,
      canFollowFill: false,
      styleDelegation: false,
    };
  }
  const caps = ui.c.surfaceFor(layerInfo).capabilities;
  const borderCarriesValue = geometryKindOf(ui, layerId) === GEOM_TYPE.LINE;
  return {
    dims: {
      fill: caps.fill === CAP_TIER.NATIVE,
      border: caps.stroke === CAP_TIER.NATIVE,
      opacity: caps.opacity !== CAP_TIER.NONE,
      size: caps.size === CAP_TIER.NATIVE,
      label: caps.label !== CAP_TIER.NONE,
      icon: caps.icon === CAP_TIER.NATIVE,
      iconColor: caps.iconColor === CAP_TIER.NATIVE,
      markerColor: caps.markerColor === CAP_TIER.NATIVE,
      zoomRange: caps.zoomRange !== CAP_TIER.NONE,
    },
    perFeatureFill: layerInfo.fillAuthor?.perFeature === true,
    hasValueField: hasValueField(ui, layerId),
    borderCarriesValue,
    isColorBasemap:
      Boolean(layerInfo.color) &&
      layerInfo.role === ROLE.BASE &&
      !layerInfo.styleSetters,
    canFollowFill: !borderCarriesValue,
    styleDelegation:
      !!layerInfo.styleSetters && Object.keys(layerInfo.styleSetters).length > 0,
  };
};

export { styleCapability };
export type { StyleCapability, StyleDim };
