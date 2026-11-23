// control/LayerControl/ui/style/dimTable — single-source structural
// facts for every style dimension, consumed by the registry's display
// orders and the capability projection.
//
// The nine style dims used to be declared four times (the dims interface
// and return site in styleCapability, DIM_ORDER + LABEL_DIM_ORDER in
// registry, DELEGATED_DIM_ORDER in delegated). This table is now the only
// place that says "what dimensions exist, in which panel role, read from
// which capability slot, and which intent keys prove a user set it".
// Adding a dim means editing this table first; the parity test locks the
// table against the registry and the capability interface.
import {
  CAP_TIER,
  DIM,
  INTENT,
  type IntentKey,
  type LayerCapabilities,
} from "#core/layer/index.js";

/** One style dimension's structural facts, in one table entry.
 *
 *  `role` is the panel role the row renders in — the vocabulary names this
 *  `role`, never `section`.
 *  `tier` is the capability comparison: "native" means the surface must
 *  declare the slot exactly `"native"` (a native write carrier);
 *  "not-none" means anything but `"none"` (a pane projection still counts).
 *  `capSlot` is the LayerCapabilities key the dimension reads (not always
 *  the same word as the dim: border reads `stroke`).
 *  `delegatedOwned` is true when the delegated component (Heatmap /
 *  Measure) renders the dim itself, so the delegated drawer excludes it —
 *  the delegated drawer keeps only the LayerControl-owned rows. */
interface StyleDimSpec {
  key: string;
  role: "layer" | "label";
  tier: "native" | "not-none";
  capSlot: keyof LayerCapabilities;
  intentKeys: readonly IntentKey[];
  delegatedOwned: boolean;
}

const STYLE_DIM_TABLE: readonly StyleDimSpec[] = [
  {
    key: DIM.ICON,
    role: "layer",
    tier: "native",
    capSlot: "icon",
    intentKeys: [INTENT.ICON],
    delegatedOwned: true,
  },
  {
    key: DIM.ICON_COLOR,
    role: "layer",
    tier: "native",
    capSlot: "iconColor",
    intentKeys: [INTENT.ICON_COLOR, INTENT.ICON_COLOR_OPACITY],
    delegatedOwned: true,
  },
  {
    key: DIM.MARKER_COLOR,
    role: "layer",
    tier: "native",
    capSlot: "markerColor",
    intentKeys: [INTENT.MARKER_COLOR, INTENT.MARKER_COLOR_OPACITY],
    delegatedOwned: true,
  },
  {
    key: DIM.FILL,
    role: "layer",
    tier: "native",
    capSlot: "fill",
    intentKeys: [
      INTENT.FILL_COLOR,
      INTENT.FILL_OPACITY,
      INTENT.FILL_VALUE,
      INTENT.FILL_MODE,
    ],
    delegatedOwned: true,
  },
  {
    key: DIM.SIZE,
    role: "layer",
    tier: "native",
    capSlot: "size",
    intentKeys: [INTENT.SIZE],
    delegatedOwned: true,
  },
  {
    key: DIM.BORDER,
    role: "layer",
    tier: "native",
    capSlot: "stroke",
    intentKeys: [
      INTENT.BORDER_COLOR,
      INTENT.BORDER_WEIGHT,
      INTENT.BORDER_VALUE,
      INTENT.BORDER_STYLE_MODE,
    ],
    delegatedOwned: true,
  },
  {
    key: DIM.OPACITY,
    role: "layer",
    tier: "not-none",
    capSlot: "opacity",
    intentKeys: [INTENT.OPACITY],
    delegatedOwned: false,
  },
  {
    key: DIM.ZOOM_RANGE,
    role: "layer",
    tier: "not-none",
    capSlot: "zoomRange",
    intentKeys: [INTENT.ZOOM_RANGE],
    delegatedOwned: false,
  },
  {
    key: DIM.LABEL,
    role: "label",
    tier: "not-none",
    capSlot: "label",
    intentKeys: [],
    delegatedOwned: false,
  },
];

/** The dims boolean map, keyed by the table's dim keys — derived from the
 *  table so the interface and the projection can never disagree. */
type StyleDims = Record<(typeof STYLE_DIM_TABLE)[number]["key"], boolean>;

/** Read one dim's boolean off a capability record, by its tier. A missing
 *  slot is one the surface never declared, and the two tiers read that
 *  differently: a "native" dim needs the slot to declare "native" (the write
 *  carrier), so an undeclared slot cannot enable it, while a "not-none" dim
 *  only needs something other than "none" — a surface that said nothing is
 *  not one that said "none". The missing-layer short circuit is a different
 *  answer (a layer that does not exist has no rows at all) and goes through
 *  EMPTY_DIMS rather than this projection. */
const dimEnabled = (spec: StyleDimSpec, caps: Partial<LayerCapabilities>): boolean => {
  const v = caps[spec.capSlot];
  if (v === undefined) return spec.tier !== "native";
  return spec.tier === "native" ? v === CAP_TIER.NATIVE : v !== CAP_TIER.NONE;
};

/** Every dim false, derived from the table — the missing-layer short
 *  circuit. A missing layer has no rows at all, and that must not be
 *  answered by projecting an empty record: `dimEnabled` reads an undeclared
 *  "not-none" dim as enabled, so {} would turn the empty-layer branch into a
 *  fully open panel. */
const EMPTY_DIMS: StyleDims = (() => {
  const out: Record<string, boolean> = {};
  for (const spec of STYLE_DIM_TABLE) out[spec.key] = false;
  return out as StyleDims;
})();

/** The role's authoritative display order (registry.ts consumers). */
const dimsInRole = (role: "layer" | "label"): readonly string[] =>
  STYLE_DIM_TABLE.filter(d => d.role === role).map(d => d.key);

/** The delegated drawer's rows: LayerControl-owned layer-role dims only
 *  (delegated.ts consumer). */
const DELEGATED_DIM_ORDER: readonly string[] = STYLE_DIM_TABLE.filter(
  d => !d.delegatedOwned && d.role === "layer",
).map(d => d.key);

/** Project a capability record into the StyleCapability.dims boolean map
 *  (styleCapability.ts consumer). Partial on purpose: a surface declares
 *  only the slots it owns, and `dimEnabled` reads an undeclared slot by its
 *  tier. The missing-layer short circuit does not project an empty record —
 *  it returns EMPTY_DIMS. */
const projectDims = (caps: Partial<LayerCapabilities>): StyleDims => {
  const out: Record<string, boolean> = {};
  for (const spec of STYLE_DIM_TABLE) out[spec.key] = dimEnabled(spec, caps);
  return out as StyleDims;
};

export {
  DELEGATED_DIM_ORDER,
  EMPTY_DIMS,
  STYLE_DIM_TABLE,
  dimEnabled,
  dimsInRole,
  projectDims,
};
export type { StyleDims };
