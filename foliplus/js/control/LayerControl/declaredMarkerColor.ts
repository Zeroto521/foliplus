// control/LayerControl/declaredMarkerColor — the marker chassis preset an author declared on the layer.
// declaredMarkerColor — the marker chassis preset an author declared on the layer.
//
// `foliplus={"marker_color": "<preset>"}` in folium rides folium's
// unknown-kwargs passthrough onto `layer.options.foliplus` — the same per-layer
// namespace the fill/border declarations use. This module turns that raw name
// into a validated, cached chassis preset default via the shared
// readDeclaredKey skeleton (cache + warn-once + raw access owned there; this
// module owns only the parse).
//
// WHY a declaration at all: the runtime's chassis vocabulary
// (MARKER_COLOR_PRESET_HEX) is a DIFFERENT palette from folium's named Icon
// colours — foliplus "red" is #d63e2a while folium's is #e74c3c — so an author
// cannot reach these chassis presets through any folium kwarg. That makes the
// chassis preset a genuine foliplus-only declaration channel.
//
// The declaration is a preset NAME, not a raw hex: the panel writes a preset
// name and the chassis paint maps names forward through the same table, so a
// declared name lands on the library sprite (pixel-identical to a panel pick).
// Python's normalise_marker_color gates only the string shape; whether the
// name is one of the 19 presets is THIS reader's verdict, because the preset
// table lives here on the JS side (duplicating the closed set in Python would
// be a second vocabulary to keep in step).
//
// It is NOT user intent: nothing here touches the intent store. markerColor.ts
// resolves chassis colour as user intent > author's own > declared > derived
// default, so a later panel edit always wins and Reset — which clears the
// intent — shows the declaration through again.
//
// PURE ADDITIVE: a layer that declares no `foliplus.marker_color` behaves
// exactly as before; only a layer that names one gets the read-time default. A
// malformed or unknown-preset declaration is warned once and read as "not
// declared" — never a reason to hide the marker.
import { readDeclaredKey } from "./declaredKey.js";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";

/** The declared marker chassis preset name, or undefined when absent/unknown. */
type DeclaredMarkerColor = string | undefined;

/** Parse the raw `marker_color` declaration into a validated preset name.
 *
 *  A non-string (Python already gated the shape, but the namespace is a folium
 *  passthrough nothing validates at construction) or a blank name is rejected.
 *  A name outside MARKER_COLOR_PRESET_HEX is rejected too — an unknown preset
 *  would otherwise fall through to the derived blue and the author would never
 *  know their declaration was ignored. */
const parse = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: DeclaredMarkerColor; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "string" || !raw.trim()) {
    const message = `a non-string marker_color ${JSON.stringify(raw)}`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  const name = raw.trim();
  if (!(name in MARKER_COLOR_PRESET_HEX)) {
    const message = `an unknown marker_color preset ${JSON.stringify(name)} (expected one of ${Object.keys(MARKER_COLOR_PRESET_HEX).join(", ")})`;
    reject("preset", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: name, invalid };
};

/** Read (and cache) the marker chassis preset declared on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredMarkerColor = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredMarkerColor; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredMarkerColor, string>(
        layer,
        layerId,
        "marker_color",
        parse,
        warn,
      )
    : { invalid: [] };

export { readDeclaredMarkerColor };
export type { DeclaredMarkerColor };
