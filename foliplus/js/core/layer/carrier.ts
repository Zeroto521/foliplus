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
// The module also owns where a carrier write actually lands: the declaration a
// writer and an exporter both read (`CarrierDecl`), the token that identifies
// the current target, the content-pane walk, and the label pane name. Two
// pipelines used to answer "which carrier" separately — the projection executor
// built its own token, the exporter filtered panes and composed the label pane
// name by hand — and two answers drift silently, so one side styles a pane set
// the other never exports.
//
// Leaflet privates are reached only through `#core/leafletAdapter`
// (`layerShadow`), per that module's charter.
import { createLogger } from "#common/log.js";
import { layerShadow } from "../leafletAdapter.js";
import { CAP_TIER, LABEL_PANE_PREFIX } from "./const.js";

const log = createLogger("carrier");

/** The Leaflet constructor families the migrator relocates — ONE table for
 *  the whole set, so the audit, the pin and this module's enumeration cannot
 *  drift into disagreeing about what "migratable" means. Read at probe time:
 *  the global family set is replaced by test fixtures and stripped mocks, and
 *  a module-load snapshot would freeze the wrong one. */
const MIGRATABLE_FAMILIES = [
  "Path",
  "Marker",
  "GridLayer",
  "LayerGroup",
  "ImageOverlay",
] as const;

/** Why there is no `"leaf-native"` opacity tier yet.
 *
 *  The tempting split — markers fade through `setOpacity`, vectors through
 *  their pane — only pays off on a `mixed` tree. But `mixed` means at least
 *  one leaf is outside `MIGRATABLE_FAMILIES`, and that leaf is not an
 *  `L.Marker`: no native setter can fade it, and it is not relocatable, so
 *  no pane write reaches it either. Reporting `"leaf-native"` would
 *  advertise coverage for the markers while silently leaving the leaf that
 *  caused the degrade unfaded — worse than the honest `"none"`.
 *
 *  A Path+Marker tree is not mixed at all: both families are migratable, so
 *  its pane opacity already covers icons and shadows. If a future carrier
 *  makes a foreign marker-like leaf native-fadeable, the tier must first
 *  prove that leaf sits outside every opacity-written pane (otherwise pane
 *  CSS and `setOpacity` compound); `test/js/core/layer/carrier.test.ts`
 *  pins that guard. */

/** Whether a leaf belongs to a migratable family. A bare `L.featureGroup()`
 *  qualifies through the container family — its visible DOM is its subtree. */
const isMigratableLeaf = (leaf: unknown): boolean =>
  MIGRATABLE_FAMILIES.some(family => {
    const ctor = Reflect.get(L as object, family);
    return (
      typeof ctor === "function" &&
      safeRead(
        () => leaf instanceof (ctor as abstract new (...args: never[]) => object),
      ) === true
    );
  });

/** Read one fact about a value; a throwing getter answers nothing. */
const safeRead = <T>(read: () => T | undefined): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

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
  /** Pre-computed enumeration, when the caller already holds one for this
   *  dirty cycle. `LayerSurface` passes its cached audit here so a reconcile
   *  does not enumerate the same tree twice; the default keeps every direct
   *  caller (and the test suite) one call. */
  visibleDom: readonly HTMLElement[] = visibleDomOf(layer),
): void => {
  const escaped = visibleDom.filter(
    el => !panes.some(pane => pane.element.contains(el)),
  );
  if (escaped.length) {
    throw new Error(
      log.msg(
        `${escaped.map(el => el.tagName).join(", ")} paint outside the layer's ` +
          `own panes — a pane write (opacity / z / focus) will not reach them`,
      ),
    );
  }
};

/** A layer's carrier, as a writer or an exporter describes it.
 *
 *  Deliberately independent of the layer's role (`base` / `overlay`): where a
 *  layer's paint lives does not change when the role vocabulary is renamed, so
 *  this shape must not grow a role field. */
interface CarrierDecl {
  /** The canvas face of a self-drawn surface (heatmap / measure / solid color).
   *  When present it is the carrier on its own — there is nothing else to ask. */
  canvas?: HTMLCanvasElement | null;
  /** The layer whose own `options` object is the write target when the
   *  surface owns no opaque pane (GridLayer / ImageOverlay native setters). */
  layer?: L.Layer | null;
  /** Panes this surface owns, base first. Empty when it owns none. */
  panes: readonly string[];
  /** The surface's honest opacity tier: `"pane"` means a CSS write on
   *  `panes` reaches the layer's whole visible DOM. */
  opacityTier: (typeof CAP_TIER)[keyof typeof CAP_TIER];
}

/** Stable identity of the carrier a write lands on.
 *
 *  A numeric diff is not enough for carriers that can be replaced underneath
 *  the writer: a re-registered canvas starts opaque, so the previous value can
 *  match the next one while the element in front of the writer is fresh.
 *  Comparing this token says "the thing I wrote to before is not the thing in
 *  front of me now" and forces a rewrite.
 *
 *  A stable key, never an array: callers compare with `===`, so a freshly built
 *  array would never match and every pane layer would rewrite on every pass.
 *  Pane names are sorted so the order the specs happen to arrive in cannot
 *  register as "the carrier moved". */
const carrierTargetOf = (decl: CarrierDecl): unknown => {
  if (decl.canvas) return decl.canvas;
  if (decl.opacityTier === CAP_TIER.PANE) {
    return [...decl.panes].sort().join("|");
  }
  return (decl.layer?.options ?? null) as object | null;
};

/** Panes a layer's content walk covers: the surface's own panes minus every
 *  pane an exporter's shadow channel owns.
 *
 *  Shadows are drawn from the owning leaves by that channel, so admitting their
 *  pane as content would paint the same pixels twice — once below the icon and
 *  once as a content root. The subtraction keeps the channel single-source. */
const contentPanesOf = (
  panes: readonly string[],
  shadowPanes: ReadonlySet<string>,
): string[] => panes.filter(name => !shadowPanes.has(name));

/** Name of the pane that carries a layer's annotation labels.
 *
 *  One name, both ends: the registration edge declares the
 *  `role: "label"` spec with it, and the exporter looks that pane up by
 *  it. Composing it here means the declaration and the renderer cannot drift
 *  apart by editing one side. */
const labelPaneNameOf = (layerId: string): string => `${LABEL_PANE_PREFIX}${layerId}`;

export type { CarrierDecl };
export {
  labelPaneNameOf,
  assertInsideOwnedPanes,
  carrierTargetOf,
  contentPanesOf,
  isMigratableLeaf,
  visibleDomOf,
};
