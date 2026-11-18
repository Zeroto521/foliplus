// control/LayerControl/declaredIconSize — the marker icon pixel size an author declared on the layer.
// declaredIconSize — the marker icon pixel size an author declared on the layer.
//
// `foliplus={"icon_size": <px>}` in folium rides folium's unknown-kwargs
// passthrough onto `layer.options.foliplus` — the same per-layer namespace the
// fill/border declarations use. This module turns that raw number into a
// validated, cached pixel-size default via the shared readDeclaredKey skeleton
// (cache + warn-once + raw access owned there; this module owns only the parse).
//
// WHY a declaration at all: the runtime builds every marker icon at a FIXED
// pixel size (markerIcon.ts iconSize [25, 41]) and folium's Icon exposes no
// pixel-size channel, so an author has no folium way to scale a layer's marker
// icon. That makes the px size a genuine foliplus-only declaration channel.
//
// The declared value is a whole-number pixel size (the icon box edge the
// runtime scales the sprite to). Python's normalise_icon_size already gates the
// positive-whole-number shape; this reader re-checks defensively because the
// namespace is a folium passthrough nothing validates at construction.
//
// It is NOT user intent: nothing here touches the intent store. A declared size
// is the read-time default the marker construction scales by when the user has
// not chosen a size of their own, so a later panel edit always wins.
//
// PURE ADDITIVE: a layer that declares no `foliplus.icon_size` behaves exactly
// as before (the built-in pixel size); only a layer that declares one is scaled.
// A malformed declaration is warned once and read as "not declared".
import { readDeclaredKey } from "./declaredKey.js";

/** The declared marker icon pixel size, or undefined when absent/invalid. */
type DeclaredIconSize = number | undefined;

/** Parse the raw `icon_size` declaration into a validated pixel size.
 *
 *  A non-integer, non-finite, zero or negative value is rejected (a marker icon
 *  scales as a box: a fractional pixel is not meaningful and a non-positive one
 *  would hide the marker). `readDeclaredKey` owns the warn-once, so a rejected
 *  declaration is reported once and read as "not declared". */
const parse = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: DeclaredIconSize; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    const message = `a non-positive-integer icon_size ${JSON.stringify(raw)} (expected a whole number of pixels > 0)`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: raw, invalid };
};

/** Read (and cache) the icon pixel size declared on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredIconSize = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredIconSize; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredIconSize, string>(
        layer,
        layerId,
        "icon_size",
        parse,
        warn,
      )
    : { invalid: [] };

export { readDeclaredIconSize };
export type { DeclaredIconSize };
