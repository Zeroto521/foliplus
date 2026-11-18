// control/LayerControl/ui/style/paintDimension — shared paint-dimension engine
// for the LayerControl style panel (fill and border).
//
// Two channels (fill, border) differ only in a handful of adapter fields
// (intent keys, paint face, gate, mode vocabulary, sub-dimension, detail
// builders). Everything else — the mode select row, the detail slot, the
// mode-switch re-render, the apply skeleton — is one engine here. The
// adapters (the fill / border adapters) supply the channel differences; this
// module is deliberately consumer-free until the adapters land; this ships the
// interface + engine only, no wiring).
//
// The engine is a shared three-layer shape plus an apply skeleton:
//   - buildPaintRow     (row layer)  — mode select + active detail slot
//   - renderPaintDetail (detail layer) — dispose + replaceChildren + build
//   - bindPaintRow / bindPaintDetail (bind layer) — mode switch + live controls
//   - applyPaintToLayer (apply skeleton) — resolve mode, dispatch to hooks
//
// Channel-agnostic design contract: the engine never reads a channel's
// intent keys, style face, or geometry directly. Every channel difference
// arrives through the adapter (PaintDimension), so adding a third paint
// channel cannot fork the engine.
import type { LayerUI } from "../surface.js";
import { buildModeRow } from "./row.js";
import type { StyleBag, StyleFace } from "./styleBag.js";
import { type IntentKey, STYLE_MODE, type StyleMode } from "#core/layer/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import {
  type DisplayModeSpec,
  resolveDisplayAndDetail,
  resolveDisplayMode,
} from "#foliplus/style/displayMode.js";
import { dom } from "#platform/dom.js";
import { dropdownSurface } from "#platform/fullscreen.js";
import { STYLE_MODE_KEY, dropdownOverlay } from "#ui/index.js";

/** One channel's paint-dimension adapter — the ONLY channel difference the
 *  engine knows. The engine reads every channel-specific decision through
 *  this interface; an adapter never leaks a channel's private machinery
 *  into a shared decision.
 *
 *  Channel-agnostic contract:
 *  - `displaySpec` is the single resolution source the engine parses.
 *    `modes` is only the allowed-option subset for the row select; it MUST
 *    be derived from (or share) the same spec, never build a second spec.
 *  - `hasValue` / `derivedKey` / `writeMode` / `dispose` are the channel
 *    hooks the apply/bind skeletons call — the engine never reaches an
 *    intent key or a scheme-picker WeakMap itself.
 *  - `isBasemap` / `buildBasemapRow` are optional: fill declares them (a
 *    solid-color basemap's fill is the pane paint, routed separately),
 *    border does not.
 */
interface PaintDimension {
  /** Channel identifier (DIM.FILL / DIM.BORDER) — the row's data-style-dim. */
  key: string;
  /** The dimension's own chrome vocabulary (select/row/detail class + label).
   *  Each channel owns its class names (STYLE_FILL_MODE_SELECT etc.) — the
   *  engine never hard-codes a dimension's chrome. */
  chrome: PaintRowChrome;
  /** The intent keys this channel owns (FILL_INTENT_KEYS / BORDER_INTENT_KEYS). */
  intentKeys: readonly IntentKey[];
  /** The style face this channel paints (FACE.FILL / FACE.STROKE). */
  face: StyleFace;
  /** Two-layer gate: layer existence + capability (capabilities.{dim} !== "none"). */
  gate: (ui: LayerUI, layerId: string) => boolean;
  /** Author-face reader bound to this channel's face (S5 authorFaceOf). */
  authorFace: <K extends keyof StyleBag>(
    ui: LayerUI,
    layerId: string,
    key: K,
  ) => StyleBag[K] | undefined;
  /** Whether the channel needs a per-feature base derivation (needsDerivation
   *  bound to this face). */
  needsDerivation: (ui: LayerUI, layerId: string) => boolean;
  /** The resolution spec the engine parses — the single source of truth for
   *  which mode this channel currently shows. */
  displaySpec: (ui: LayerUI, layerId: string) => DisplayModeSpec;
  /** The allowed-option subset for the row select. MUST derive from (or
   *  share) displaySpec's spec — never build a second one. */
  modes: (ui: LayerUI, layerId: string) => StyleMode[];
  /** The channel the INHERIT mode follows (border: { from: "fill" }). */
  inherits?: { from: "fill" };
  /** The channel's sub-dimensions (fill: opacity; border: weight) — they ride
   *  every mode and never sink it. */
  subs: PaintSubDimension[];
  /** Build the active mode's detail rows. */
  detailBuilder: (mode: StyleMode) => (ui: LayerUI, layerId: string) => HTMLElement[];
  /** Bind the active mode's detail controls. */
  detailBinder: (
    mode: StyleMode,
  ) => (ui: LayerUI, layerId: string, detail: HTMLElement) => void;
  /** The apply skeleton's channel hooks (VALUE delegate / ORIGINAL walk /
   *  SOLID derived write). */
  applyHooks: {
    value: (ui: LayerUI, layerId: string) => void;
    original: (ui: LayerUI, layerId: string) => void;
    solid: (ui: LayerUI, layerId: string, base: string | undefined) => void;
    /** FOLLOW_FILL: the derived per-leaf walk (border only; fill has no such
     *  mode, so the engine falls back to solid(ui, layerId, undefined)). */
    followFill?: (ui: LayerUI, layerId: string) => void;
  };
  /** Whether a value config is actually in force (fill: effectiveFillValue
   *  !== undefined; border: borderValueActive). */
  hasValue: (ui: LayerUI, layerId: string) => boolean;
  /** The intent key the solid base derives from (fill: FILL_COLOR /
   *  border: BORDER_COLOR). */
  derivedKey: (ui: LayerUI, layerId: string) => keyof StyleBag;
  /** Persist a mode switch + seed the value when switching to by-value. */
  writeMode: (ui: LayerUI, layerId: string, mode: StyleMode) => boolean;
  /** The mode the apply dispatch reads, when it differs from the display mode
   *  the row's select shows. Border's old apply read effectiveBorderMode
   *  (resolveStrokeMode), which is SOLID for an uncommitted layer while the
   *  display mode reads ORIGINAL — a weight-only commit paints { weight } in
   *  SOLID, not the original walk. Defaults to the display mode. */
  applyMode?: (ui: LayerUI, layerId: string) => StyleMode;
  /** Dispose the channel's scheme-picker state (each channel owns its
   *  WeakMap — the engine never merges them). */
  dispose: (ui: LayerUI) => void;
  /** Optional basemap early-out (fill only): a color basemap's fill is the
   *  pane paint, routed to a separate row. */
  isBasemap?: (ui: LayerUI, layerId: string) => boolean;
  /** Optional basemap row builder (fill only). */
  buildBasemapRow?: (ui: LayerUI, layerId: string) => HTMLElement;
  /** Optional row decoration: the channel's own tooltip/aria on the mode
   *  select (fill: the per-feature note on the control + its original-colors
   *  option). Called after buildModeRow, with the select in hand. */
  modeRowHint?: (ui: LayerUI, layerId: string, select: HTMLSelectElement) => void;
}

/** One channel's sub-dimension — a value that rides every mode and never
 *  sinks the display mode. The engine binds it alongside the active detail
 *  (the consumer wiring step); the commit path is the channel's own. */
interface PaintSubDimension {
  key: "opacity" | "weight";
  buildInput: (ui: LayerUI, layerId: string) => HTMLElement;
  bindInput: (ui: LayerUI, layerId: string, input: HTMLElement) => void;
  commit: (ui: LayerUI, layerId: string, value: number) => void;
}

/** The row chrome the mode row needs, resolved from the adapter. The chrome
 *  is a function of the UI because the row label is translated (each channel
 *  owns its label key); the classes are static, the label is not. */
type PaintRowChrome = (ui: LayerUI) => {
  /** Class on the block root (each channel owns its block vocabulary). */
  blockClass: string;
  selectClass: string;
  rowClass: string;
  detailClass: string;
  label: string;
};

/** The locale key for a mode's option label. */
const modeKeyOf = (mode: StyleMode): string => {
  switch (mode) {
    case STYLE_MODE.ORIGINAL:
      return STYLE_MODE_KEY.ORIGINAL;
    case STYLE_MODE.SOLID:
      return STYLE_MODE_KEY.SINGLE;
    case STYLE_MODE.VALUE:
      return STYLE_MODE_KEY.BY_VALUE;
    case STYLE_MODE.FOLLOW_FILL:
      return STYLE_MODE_KEY.FOLLOW_FILL;
  }
};

/** The display mode the engine parses from the adapter's spec. */
const displayMode = (dim: PaintDimension, ui: LayerUI, layerId: string): StyleMode =>
  resolveDisplayMode(dim.displaySpec(ui, layerId));

/** The detail mode the engine parses for the active display mode (the one
 *  deliberate collapse: border ORIGINAL → SOLID detail). */
const detailMode = (dim: PaintDimension, ui: LayerUI, layerId: string): StyleMode =>
  resolveDisplayAndDetail(dim.displaySpec(ui, layerId), {
    collapseOriginalDetail: dim.key === "border",
  }).detail;

/** Build the paint row: the mode select plus the active mode's detail slot.
 *  A basemap (fill) early-outs to the basemap row; a one-mode channel (no
 *  field) renders the solid detail without a select. */
const buildPaintRow = (
  dim: PaintDimension,
  ui: LayerUI,
  layerId: string,
): HTMLElement => {
  const chrome = dim.chrome(ui);
  const block = dom.el("div", {
    class: chrome.blockClass,
    "data-style-dim": dim.key,
  });
  if (dim.isBasemap?.(ui, layerId)) {
    const basemapRow = dim.buildBasemapRow?.(ui, layerId);
    if (basemapRow) block.append(basemapRow);
    return block;
  }
  const mode = displayMode(dim, ui, layerId);
  const options = dim.modes(ui, layerId).map(m => ({
    value: m,
    label: ui.T(modeKeyOf(m)),
  }));
  if (options.length === 0) {
    // One-mode channel (border without a value field): the channel offers a
    // single mode, so there is no mode row to switch — render the active
    // mode's detail rows directly into the block, the channel's own no-select
    // shape (no detail-slot wrapper). Fill never returns an empty mode list,
    // so this branch is border-only and leaves the fill parity baseline alone.
    block.append(...dim.detailBuilder(detailMode(dim, ui, layerId))(ui, layerId));
    return block;
  }
  const {
    block: modeRow,
    select,
    detail,
  } = buildModeRow({
    label: chrome.label,
    selectClass: chrome.selectClass,
    rowClass: chrome.rowClass,
    detailClass: chrome.detailClass,
    value: mode,
    options,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });
  block.append(modeRow);
  dim.modeRowHint?.(ui, layerId, select);
  renderPaintDetail(dim, ui, layerId, detail, detailMode(dim, ui, layerId));
  return block;
};

/** Render the active mode's detail into the detail slot: dispose the channel's
 *  picker state, clear the slot, then build the mode's rows. */
const renderPaintDetail = (
  dim: Pick<PaintDimension, "dispose" | "detailBuilder">,
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: StyleMode,
): void => {
  dim.dispose(ui);
  detail.replaceChildren();
  detail.append(...dim.detailBuilder(mode)(ui, layerId));
};

/** Bind the active mode's detail controls. */
const bindPaintDetail = (
  dim: Pick<PaintDimension, "detailBinder" | "subs">,
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: StyleMode,
): void => {
  dim.detailBinder(mode)(ui, layerId, detail);
  for (const sub of dim.subs) {
    const input = detail.querySelector(`[data-sub="${sub.key}"]`) as HTMLElement | null;
    if (input) sub.bindInput(ui, layerId, input);
  }
};

/** Wire the paint row: the mode select switches modes in place (rebuilding the
 *  detail slot), and the active mode's controls commit through the adapter's
 *  write path. */
const bindPaintRow = (
  dim: PaintDimension,
  ui: LayerUI,
  layerId: string,
  row: HTMLElement,
): void => {
  const block = row.closest(`[data-style-dim='${dim.key}']`) as HTMLElement | null;
  if (!block) return;
  const select = block.querySelector("select") as HTMLSelectElement | null;
  if (!select) return;
  const detail = block.querySelector(
    `.${dim.chrome(ui).detailClass}`,
  ) as HTMLElement | null;
  // listener-exempt: style-panel dimension select handler on a panel-owned element
  select.onchange = () => {
    const previous = displayMode(dim, ui, layerId);
    const next = select.value as StyleMode;
    if (next === previous) return;
    if (!dim.writeMode(ui, layerId, next)) return;
    if (detail) {
      const d = detailMode(dim, ui, layerId);
      renderPaintDetail(dim, ui, layerId, detail, d);
      bindPaintDetail(dim, ui, layerId, detail, d);
    }
  };
  if (detail) bindPaintDetail(dim, ui, layerId, detail, detailMode(dim, ui, layerId));
};

/** The apply skeleton: resolve the mode, then dispatch to the channel hook
 *  (VALUE delegate / ORIGINAL walk / INHERIT follow / SOLID derived write). */
const applyPaintToLayer = (dim: PaintDimension, ui: LayerUI, layerId: string): void => {
  const mode = dim.applyMode
    ? dim.applyMode(ui, layerId)
    : displayMode(dim, ui, layerId);
  if (mode === STYLE_MODE.VALUE && dim.hasValue(ui, layerId)) {
    dim.applyHooks.value(ui, layerId);
    return;
  }
  if (mode === STYLE_MODE.ORIGINAL) {
    dim.applyHooks.original(ui, layerId);
    return;
  }
  if (mode === STYLE_MODE.FOLLOW_FILL) {
    // FOLLOW_FILL is the border mode that follows the fill face: the border
    // derives its colour from the fill, so the apply hook receives no base of
    // its own — the channel resolves the fill's colour itself (the "follow
    // fill" semantic, not an omitted base). The border channel owns a
    // dedicated followFill walk; without it (fill has no such mode) the solid
    // hook receives undefined, which for a non-deriving channel is no-op.
    if (dim.applyHooks.followFill) {
      dim.applyHooks.followFill(ui, layerId);
    } else {
      dim.applyHooks.solid(ui, layerId, undefined);
    }
    return;
  }
  const derived = dim.needsDerivation(ui, layerId)
    ? dim.authorFace(ui, layerId, dim.derivedKey(ui, layerId))
    : undefined;
  const base = typeof derived === "string" ? derived : undefined;
  dim.applyHooks.solid(ui, layerId, base);
};

export type { PaintDimension, PaintRowChrome, PaintSubDimension };
export {
  applyPaintToLayer,
  bindPaintDetail,
  bindPaintRow,
  buildPaintRow,
  renderPaintDetail,
};
