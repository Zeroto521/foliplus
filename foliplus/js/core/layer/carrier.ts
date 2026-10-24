// core/layer/carrier — the carrier-completeness contract, executable.
//
// Every layer capability (opacity, visibility, zoom range, focus dimming,
// z ordering) leans on one invariant: **a write on the layer's own panes
// reaches the layer's whole visible DOM.** The invariant stayed implicit for
// years and broke twice before it was written down — marker shadows mounted
// in the shared `shadowPane` (pane opacity never reached them) and
// ImageOverlay images left in `overlayPane` (setZ and the focus rules never
// saw them). This module turns the invariant into a checkable form: one
// enumeration of what "visible DOM" means for any layer, and one assertion
// that every element of it lives inside a given pane set.
//
// The enumeration doubles as the audit table's executable shape: a new layer
// type that paints through an element nobody lists here passes every guard
// vacuously, so teaching `visibleDomOf` about a field IS the moment the
// audit and the guards meet.
//
// Leaflet privates are reached only through `#core/leafletAdapter`
// (`layerShadow`), per that module's charter.
import { layerShadow } from "../leafletAdapter.js";

/** Every DOM element the layer can paint through, from the fields real
 *  Leaflet fills: `getElement()` (marker `_icon`, ImageOverlay `_image`,
 *  Path `_path`), the marker's drop shadow, and the GridLayer container.
 *  Containers are descended via `eachLayer`; their own (non-)element is
 *  skipped — a group paints through its leaves alone. */
const visibleDomOf = (layer: L.Layer): HTMLElement[] => {
  const out: HTMLElement[] = [];
  const visit = (node: L.Layer): void => {
    if (typeof (node as L.LayerGroup).eachLayer === "function") {
      (node as L.LayerGroup).eachLayer(visit);
      return;
    }
    const el = (node as { getElement?: () => HTMLElement | null }).getElement?.();
    if (el) out.push(el);
    const shadow = layerShadow(node as L.Layer);
    if (shadow) out.push(shadow);
    const tileContainer = (node as L.GridLayer).getContainer?.();
    if (tileContainer) out.push(tileContainer);
  };
  visit(layer);
  return out;
};

/** The carrier invariant itself: every visible element of `layer` must be a
 *  descendant of one of `panes` (the surface's own pane handles). Throws
 *  naming the escaped elements — a violation here means a pane write
 *  (opacity / z / focus) will silently miss part of the layer. */
const assertInsideOwnedPanes = (
  panes: ReadonlyArray<{ readonly element: HTMLElement }>,
  layer: L.Layer,
): void => {
  const escaped = visibleDomOf(layer).filter(
    el => !panes.some(pane => pane.element.contains(el)),
  );
  if (escaped.length) {
    throw new Error(
      `[foliplus] carrier violation: ${escaped.map(el => el.tagName).join(", ")} ` +
        `paint outside the layer's own panes — a pane write (opacity / z / ` +
        `focus) will not reach them`,
    );
  }
};

export { assertInsideOwnedPanes, visibleDomOf };
